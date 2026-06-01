import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Internal } from '../../../shared/errors.js';
import { assertPublicUrl } from '../../../shared/utils/ssrfGuard.js';
const MIME = {
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
};
const MIME_EXT = {
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
};
// FFmpeg filter chains per effect
const EFFECTS = {
    chipmunk: 'asetrate=44100*1.7,aresample=44100,atempo=0.6',
    underwater: 'aecho=0.8:0.88:60:0.4,equalizer=f=1000:width_type=o:width=2:g=-20,equalizer=f=300:width_type=o:width=2:g=10',
    bass: 'equalizer=f=60:width_type=o:width=2:g=10,equalizer=f=120:width_type=o:width=2:g=8,equalizer=f=2000:width_type=o:width=2:g=-4',
    earrape: 'volume=15,acrusher=level_in=4:level_out=8:bits=8:mode=log:aa=1',
    slow: 'atempo=0.7',
    fast: 'atempo=1.6',
    reverb: 'aecho=0.8:0.9:1000|1800:0.3|0.25',
    robot: 'afftfilt=real=\'hypot(re,im)*sin(0)\':imag=\'hypot(re,im)*cos(0)\':win_size=512:overlap=0.75',
    alien: 'asetrate=44100*0.7,aresample=44100,aecho=0.6:0.6:25|50:0.4|0.3,vibrato=f=8:d=0.6',
    // Autotune via autotalent LADSPA — C major, T-Pain style (snap correction, mix 100%)
    autotune: 'aformat=sample_rates=44100:channel_layouts=mono,ladspa=file=autotalent:plugin=autotalent:controls=c0=440|c1=0|c2=0|c3=1|c4=-1.1|c5=1|c6=1|c7=-1.1|c8=1|c9=-1.1|c10=1|c11=1|c12=-1.1|c13=1|c14=-1.1|c15=1|c16=0|c17=0|c18=0|c19=0|c20=5|c21=0|c22=0|c23=0|c24=0|c25=0|c26=1',
};
// Temp dir untuk output files (persisten, dibersihkan manual atau cron)
const VC_TEMP_DIR = join(tmpdir(), 'vc-output');
mkdirSync(VC_TEMP_DIR, { recursive: true });
export function getTempDir() {
    return VC_TEMP_DIR;
}
export async function generate(opts, { signal } = {}) {
    await assertPublicUrl(opts.audio);
    // Download audio ke buffer
    const res = await fetch(opts.audio, { signal });
    if (!res.ok)
        throw Internal(`Failed to fetch audio: ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();
    const inputBuf = Buffer.from(arrayBuffer);
    // Simpan input ke temp file
    const inputId = randomBytes(8).toString('hex');
    const inputPath = join(VC_TEMP_DIR, `in-${inputId}`);
    const outputId = randomBytes(8).toString('hex');
    const outputPath = join(VC_TEMP_DIR, `${outputId}.${opts.format}`);
    await writeFile(inputPath, inputBuf);
    try {
        const filter = EFFECTS[opts.effect];
        const args = [
            '-y',
            '-i', inputPath,
            '-af', filter,
            ...(opts.format === 'mp3' ? ['-codec:a', 'libmp3lame', '-q:a', '4'] : []),
            ...(opts.format === 'ogg' ? ['-codec:a', 'libvorbis', '-q:a', '4'] : []),
            ...(opts.format === 'wav' ? ['-codec:a', 'pcm_s16le'] : []),
            outputPath,
        ];
        await runFfmpeg(args, signal);
    }
    finally {
        // Hapus input setelah selesai
        await writeFile(inputPath, '').catch(() => { });
    }
    return {
        filePath: outputPath,
        format: opts.format,
        mimeType: MIME[opts.format],
    };
}
function runFfmpeg(args, signal) {
    return new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        const onAbort = () => { proc.kill('SIGTERM'); reject(new DOMException('Aborted', 'AbortError')); };
        signal?.addEventListener('abort', onAbort, { once: true });
        proc.on('close', (code) => {
            signal?.removeEventListener('abort', onAbort);
            if (code === 0)
                resolve();
            else
                reject(Internal(`FFmpeg exited with code ${code}: ${stderr.slice(-300)}`));
        });
        proc.on('error', (err) => {
            signal?.removeEventListener('abort', onAbort);
            reject(Internal(`FFmpeg spawn error: ${err.message}`));
        });
    });
}
export const vcService = { generate, getTempDir };
//# sourceMappingURL=vc.service.js.map