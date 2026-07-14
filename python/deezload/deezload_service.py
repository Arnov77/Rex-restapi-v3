"""
Service internal (localhost-only) yang membungkus logic downloader
DeezLoad (Telethon userbot) jadi HTTP endpoint, supaya bisa dipanggil
dari Fastify (Rex REST API v3) tanpa perlu spawn proses Python baru
tiap request.

Jalankan dengan:
    uvicorn deezload_service:app --host 127.0.0.1 --port 8001

WAJIB di-bind ke 127.0.0.1 saja (jangan 0.0.0.0) — service ini TIDAK
dirancang untuk diakses langsung dari internet. Fastify di VPS yang
sama yang jadi satu-satunya pemanggil, lewat header X-Internal-Secret.
"""

import asyncio
import base64
import hashlib
import hmac
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from difflib import SequenceMatcher
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from telethon import TelegramClient, events

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent / '.env')

# ==========================================
# KONFIGURASI
# ==========================================
API_ID = int(os.environ.get('TG_API_ID', '12345678'))
API_HASH = os.environ.get('TG_API_HASH', 'xxxxxxxx')
BOT_USERNAME = '@deezload2bot'
SESSION_NAME = os.environ.get('TG_SESSION_NAME', 'sesi_scraper')
DOWNLOAD_DIR = Path(os.environ.get('DEEZLOAD_DOWNLOAD_DIR', '/root/rex-api/downloads'))

INTERNAL_SECRET = os.environ.get('DEEZLOAD_INTERNAL_SECRET')

MAX_CONCURRENT_TELEGRAM_OPS = int(os.environ.get('DEEZLOAD_MAX_CONCURRENT', '3'))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger('deezload-service')

client = TelegramClient(SESSION_NAME, API_ID, API_HASH)
semaphore = asyncio.Semaphore(MAX_CONCURRENT_TELEGRAM_OPS)


# ==========================================
# FILE TOKEN (signed, 1 jam TTL)
# ==========================================
def _buat_file_token(file_path: str) -> str:
    exp = int(time.time()) + 3600
    encoded_path = base64.urlsafe_b64encode(file_path.encode()).decode()
    payload = f"{encoded_path}:{exp}"
    sig = hmac.new(INTERNAL_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{encoded_path}.{exp}.{sig}"


def _verifikasi_file_token(token: str) -> str | None:
    try:
        parts = token.rsplit('.', 2)
        if len(parts) != 3:
            return None
        encoded_path, exp_str, sig = parts
        exp = int(exp_str)
        if time.time() > exp:
            return None
        payload = f"{encoded_path}:{exp}"
        expected_sig = hmac.new(INTERNAL_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None
        file_path = base64.urlsafe_b64decode(encoded_path.encode()).decode()
        return file_path
    except Exception:
        return None


# ==========================================
# LOGIC DOWNLOADER
# ==========================================
def _skor_kemiripan(teks: str, query: str) -> float:
    return SequenceMatcher(None, teks.lower(), query.lower()).ratio()


def _kemungkinan_album(item) -> bool:
    """Deteksi album/playlist dari suffix di TITLE, bukan tebak-tebakan
    dari description. Terbukti dari observasi langsung: hasil album
    judulnya diakhiri "(Album)", misal "Komang (Album)" — sedangkan
    track individual judulnya polos tanpa suffix itu.

    Sekalian jaga-jaga buat suffix serupa yang mungkin dipakai bot ini
    untuk tipe non-track lain (Playlist/EP/dst) — kalau ternyata ada
    pola lain yang kelewat, kabari biar ditambahin ke daftar ini.
    """
    title = (item.title or '').lower()
    return bool(re.search(r'\((album|playlist|ep)\)\s*$', title))


def _skor_kandidat(item, query: str, artist: str | None = None) -> float:
    query_lower = query.lower()
    kata_query = set(query_lower.split())

    title = (item.title or '').lower()
    desc = (item.description or '').lower()
    teks_gabung = f'{title} {desc}'

    title_coverage = len(kata_query & set(title.split())) / max(len(kata_query), 1)
    ratio = _skor_kemiripan(teks_gabung, query_lower)

    artist_bonus = 0.0
    if artist:
        kata_artist = artist.lower().split()
        cocok = sum(1 for k in kata_artist if k in desc)
        artist_bonus = (cocok / max(len(kata_artist), 1)) * 0.8

    return (title_coverage * 0.5) + (ratio * 0.2) + artist_bonus


def pilih_hasil_audio(hasil, query: str, artist: str | None = None):
    if not hasil:
        return None

    kandidat_media = [item for item in hasil if item.type in ('audio', 'document', 'file')]
    target = kandidat_media if kandidat_media else hasil

    # Buang hasil yang title-nya kelihatan album/playlist/EP — filter
    # ini reliable (bukan tebakan) karena bot ini konsisten nambahin
    # suffix "(Album)" dkk di title untuk tipe non-track.
    non_album = [item for item in target if not _kemungkinan_album(item)]
    if non_album:
        target = non_album

    target.sort(key=lambda item: _skor_kandidat(item, query, artist), reverse=True)
    terbaik = target[0]
    log.info(f'    -> Dipilih: "{terbaik.title}" - {terbaik.description} (artist: {artist})')
    return terbaik


async def tunggu_pesan_audio(pesan_klik, timeout: int = 90):
    loop = asyncio.get_event_loop()
    fut: asyncio.Future = loop.create_future()

    def punya_audio(msg):
        return bool(msg.document or msg.audio)

    async def handler(event):
        msg = event.message
        if msg.id != pesan_klik.id:
            return
        if punya_audio(msg) and not fut.done():
            fut.set_result(msg)

    client.add_event_handler(handler, events.NewMessage(chats=BOT_USERNAME))
    client.add_event_handler(handler, events.MessageEdited(chats=BOT_USERNAME))

    try:
        if punya_audio(pesan_klik):
            return pesan_klik

        async def poll_manual():
            while True:
                await asyncio.sleep(2)
                msg = await client.get_messages(BOT_USERNAME, ids=pesan_klik.id)
                if msg and punya_audio(msg):
                    if not fut.done():
                        fut.set_result(msg)
                    return

        poll_task = asyncio.ensure_future(poll_manual())
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        finally:
            poll_task.cancel()
    except asyncio.TimeoutError:
        return None
    finally:
        client.remove_event_handler(handler, events.NewMessage(chats=BOT_USERNAME))
        client.remove_event_handler(handler, events.MessageEdited(chats=BOT_USERNAME))


class HasilUnduhan(BaseModel):
    file_path: str
    file_name: str
    title: str | None = None
    description: str | None = None


async def download_cepat(pesan_audio, dest_dir: Path) -> Path | None:
    try:
        if pesan_audio.document:
            media = pesan_audio.document
            filename = None
            for attr in media.attributes:
                if hasattr(attr, 'file_name'):
                    filename = attr.file_name
                    break
            if not filename:
                filename = f'audio_{media.id}.flac'
        else:
            filename = f'audio_{pesan_audio.id}.flac'

        dest_path = dest_dir / filename
        dest_dir.mkdir(parents=True, exist_ok=True)

        with open(dest_path, 'wb') as f:
            async for chunk in client.iter_download(
                pesan_audio,
                request_size=2 * 1024 * 1024,  # 2MB per request
            ):
                f.write(chunk)

        return dest_path
    except Exception as e:
        log.error(f'Download gagal: {e}')
        return None


async def _cari_inline(perintah_inline: str):
    """Inline query dengan retry. Return None kalau gagal total setelah
    beberapa percobaan, atau list (bisa kosong) kalau berhasil."""
    percobaan_maks = 3
    for percobaan in range(1, percobaan_maks + 1):
        try:
            return await client.inline_query(BOT_USERNAME, perintah_inline)
        except Exception as e:
            log.warning(f'Percobaan {percobaan}/{percobaan_maks} gagal ("{perintah_inline}"): {e}')
            if percobaan < percobaan_maks:
                await asyncio.sleep(3 * percobaan)
    log.error(f'Inline query tetap gagal setelah beberapa percobaan: "{perintah_inline}"')
    return None


async def unduh_lagu(query: str, artist: str | None = None) -> HasilUnduhan | None:
    log.info(f'Mencari: "{query}" (artist: {artist})')

    # Global dulu (tanpa prefix) — sesuai behavior manual di app
    # Telegram. Album/playlist otomatis kefilter di pilih_hasil_audio
    # lewat suffix "(Album)" di title, jadi gak perlu cascading rumit lagi.
    hasil = await _cari_inline(query)

    # .trk cuma dipakai kalau pencarian global bener-bener kosong/gagal.
    if not hasil:
        log.info('Pencarian global kosong, mencoba ".trk" sebagai fallback...')
        hasil = await _cari_inline(f'.trk {query}')

    if not hasil:
        log.warning('Tidak ada hasil pencarian sama sekali (global maupun trk).')
        return None

    target = pilih_hasil_audio(hasil, query, artist)
    if target is None:
        return None

    try:
        pesan = await target.click(BOT_USERNAME)
    except Exception as e:
        log.error(f'Gagal klik hasil inline: {e}')
        return None

    if pesan.document or pesan.audio:
        pesan_audio = pesan
    else:
        pesan_audio = await tunggu_pesan_audio(pesan, timeout=90)

    if pesan_audio is None:
        log.error('Gagal mendapatkan file audio dari bot.')
        return None

    path = await download_cepat(pesan_audio, DOWNLOAD_DIR)
    if not path:
        return None
    return HasilUnduhan(
        file_path=str(path),
        file_name=path.name,
        title=getattr(target, 'title', None),
        description=getattr(target, 'description', None),
    )


# ==========================================
# HTTP LAYER (FastAPI)
# ==========================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    if not INTERNAL_SECRET:
        log.warning('DEEZLOAD_INTERNAL_SECRET belum di-set! Endpoint ini TIDAK terlindungi.')
    await client.start()
    log.info('Telegram client siap.')
    yield
    await client.disconnect()
    log.info('Telegram client disconnect.')


app = FastAPI(lifespan=lifespan)


class DownloadRequest(BaseModel):
    query: str
    artist: str | None = None


def _cek_secret(x_internal_secret: str | None):
    if not INTERNAL_SECRET or x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail='unauthorized')


@app.post('/download')
async def download(req: DownloadRequest, x_internal_secret: str | None = Header(None)):
    _cek_secret(x_internal_secret)

    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail='query kosong')

    async with semaphore:
        hasil = await unduh_lagu(query, req.artist)

    if hasil is None:
        raise HTTPException(status_code=404, detail='lagu tidak ditemukan / gagal diunduh')

    file_token = _buat_file_token(hasil.file_path)

    return JSONResponse({
        'success': True,
        'file_path': hasil.file_path,
        'file_name': hasil.file_name,
        'file_token': file_token,
        'title': hasil.title,
        'description': hasil.description,
    })


@app.get('/file/{token}')
async def serve_file(token: str):
    file_path = _verifikasi_file_token(token)
    if file_path is None:
        raise HTTPException(status_code=403, detail='token invalid atau expired')

    path = Path(file_path)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail='file tidak ditemukan')

    # Path traversal guard
    try:
        path.resolve().relative_to(DOWNLOAD_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail='akses ditolak')

    return FileResponse(path, media_type='audio/flac', filename=path.name)


@app.get('/health')
async def health():
    return {'status': 'ok', 'connected': client.is_connected()}