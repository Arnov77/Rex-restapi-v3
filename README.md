# Rex-RESTAPI

Rex-RESTAPI adalah sebuah REST API yang menyediakan berbagai fitur seperti konversi video, pengunduhan media, dan manipulasi gambar. Proyek ini dirancang untuk mempermudah integrasi layanan API ke dalam aplikasi Anda.

## Struktur Proyek

```
Rex-RESTAPI
├─ .env                  # File konfigurasi lingkungan
├─ config.js             # Konfigurasi utama aplikasi
├─ Dockerfile            # File untuk container Docker
├─ package.json          # Informasi proyek dan dependensi
├─ public                # Folder untuk file statis
│  ├─ css
│  │  └─ style.css       # Gaya untuk halaman web
│  ├─ data
│  │  └─ apis.json       # Data API yang tersedia
│  ├─ index.html         # Halaman utama
│  └─ js
│     └─ script.js       # Skrip JavaScript untuk halaman web
├─ server.js             # File utama untuk menjalankan server
└─ src                   # Folder sumber kode
   ├─ routes             # Rute API
   │  ├─ brat.js         # Rute untuk fitur 'brat'
   │  ├─ bratVid.js      # Rute untuk fitur 'bratVid'
   │  ├─ ytmp3.js        # Rute untuk konversi YouTube ke MP3
   │  ├─ ytmp4.js        # Rute untuk konversi YouTube ke MP4
   │  └─ ytplay.js       # Rute untuk memutar video YouTube
   └─ utils              # Fungsi utilitas
      └─ utils.js        # Fungsi pendukung aplikasi
```

## Fitur

- **Konversi YouTube ke MP3/MP4**: Unduh video YouTube dalam format MP3 atau MP4.
- **Manipulasi Gambar**: Ubah gambar dengan berbagai opsi seperti `hitam` atau `nerd`.
- **Streaming Video**: Putar video langsung dari YouTube.
- **API JSON**: Data API tersedia dalam format JSON.

## Instalasi

1. Clone repositori ini:
   ```bash
   git clone https://github.com/username/Rex-RESTAPI.git
   cd Rex-RESTAPI
   ```

2. Instal dependensi:
   ```bash
   npm install
   ```

3. Buat file `.env` dan tambahkan konfigurasi berikut:
   ```
   PORT=7860
   GEMINI_API_KEY=your_gemini_api_key
   ```

4. Jalankan server:
   ```bash
   node server.js
   ```

5. Akses API di `http://localhost:7860`.

## Contoh Penggunaan API

### Endpoint: Manipulasi Gambar
- **URL**: `/api/hitam`
- **Metode**: `GET`
- **Parameter**:
  - `image` (wajib): URL gambar.
  - `option` (opsional): `nerd` atau `hitam`.
- **Contoh**:
  ```
  http://localhost:7860/api/hitam?image=https://i.ibb.co/jZW6CzK9/images-1.jpg&option=nerd
  ```

### Endpoint: Konversi YouTube ke MP3
- **URL**: `/api/ytmp3`
- **Metode**: `GET`
- **Parameter**:
  - `url` (wajib): URL video YouTube.
- **Contoh**:
  ```
  http://localhost:7860/api/ytmp3?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ
  ```

## Teknologi yang Digunakan

- **Node.js**: Runtime JavaScript untuk server.
- **Express.js**: Framework untuk membangun REST API.
- **Axios**: HTTP client untuk melakukan request.
- **Google Generative AI**: API untuk manipulasi gambar.

## Kontribusi

1. Fork repositori ini.
2. Buat branch fitur baru:
   ```bash
   git checkout -b fitur-baru
   ```
3. Commit perubahan Anda:
   ```bash
   git commit -m "Menambahkan fitur baru"
   ```
4. Push ke branch Anda:
   ```bash
   git push origin fitur-baru
   ```
5. Buat Pull Request.

## Lisensi

Proyek ini dilisensikan di bawah [MIT License](LICENSE).