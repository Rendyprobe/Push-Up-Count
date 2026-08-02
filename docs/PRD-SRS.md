# PRD/SRS - Web Penghitung Push-Up Berbasis Kamera

## Ringkasan Produk
Web ini membantu pengguna menghitung jumlah push-up secara otomatis melalui kamera perangkat. Aplikasi berbasis React + Vite, berjalan di browser, memproses pose tubuh secara lokal, dan menampilkan jumlah repetisi, status gerakan, kualitas deteksi, serta panduan singkat posisi kamera.

## Tujuan
- Menghitung repetisi push-up tanpa perangkat tambahan.
- Memberikan umpan balik dasar agar gerakan lebih konsisten.
- Menjaga privasi dengan pemrosesan video di browser.
- Dapat dijalankan sebagai aplikasi frontend tanpa backend.

## Pengguna Sasaran
- Pengguna yang berolahraga sendiri di rumah.
- Pelatih atau instruktur yang membutuhkan penghitung sederhana.
- Developer yang ingin prototype computer vision ringan di browser.

## Scope MVP
- Meminta izin kamera dan menampilkan live preview.
- Mendeteksi pose tubuh menggunakan MediaPipe Pose di aplikasi React.
- Menghitung push-up berdasarkan perubahan sudut siku dari posisi atas ke bawah lalu kembali atas.
- Menampilkan counter, status fase gerakan, kualitas tracking, dan estimasi sudut siku.
- Menyediakan tombol start/stop kamera dan reset hitungan.
- Menyediakan pilihan kamera depan/belakang.
- Menyediakan target repetisi, timer sesi, progress target, dan histori sesi lokal.
- Menyediakan pengaturan threshold posisi atas/bawah untuk kalibrasi pengguna.
- Menampilkan pesan error bila browser tidak mendukung kamera atau izin ditolak.

## Di Luar Scope MVP
- Login, profil pengguna, dan penyimpanan histori latihan.
- Model machine learning custom.
- Koreksi form lanjutan untuk seluruh variasi push-up.
- Integrasi wearable atau leaderboard.

## Kebutuhan Fungsional
1. Aplikasi harus dapat memulai dan menghentikan kamera.
2. Aplikasi harus dapat mengganti mode kamera depan/belakang sebelum start.
3. Aplikasi harus menampilkan skeleton pose di atas video.
4. Aplikasi harus menghitung satu repetisi ketika pengguna:
   - mulai dari posisi atas,
   - turun sampai sudut siku cukup kecil,
   - kembali ke posisi atas dengan lengan cukup lurus.
5. Aplikasi harus menghindari hitungan ganda dengan state machine `up -> down -> up`.
6. Aplikasi harus menyediakan tombol reset untuk mengembalikan hitungan ke nol.
7. Aplikasi harus menampilkan indikator kualitas tracking berdasarkan visibility landmark.
8. Aplikasi harus memberi feedback bila tubuh belum terlihat jelas atau posisi belum sesuai.
9. Aplikasi harus menyimpan histori sesi lokal saat pengguna menekan stop atau reset setelah ada repetisi.
10. Aplikasi harus memungkinkan pengguna mengubah target repetisi dan threshold sudut atas/bawah.

## Kebutuhan Non-Fungsional
- Responsif untuk mobile dan desktop.
- Tidak membutuhkan server backend.
- Menggunakan Vite untuk development server dan production build.
- Pemrosesan video dilakukan lokal di browser.
- Target berjalan di Chrome, Edge, dan Safari modern.
- UI harus tetap terbaca pada layar kecil.

## Aturan Perhitungan
- Landmark utama: bahu, siku, pergelangan tangan, pinggul kiri/kanan.
- Landmark tambahan: pergelangan kaki untuk estimasi garis tubuh.
- Sisi tubuh yang dipakai dipilih otomatis dari sisi dengan visibility terbaik.
- Posisi `up` valid ketika sudut siku lebih besar dari 155 derajat.
- Posisi `down` valid ketika sudut siku lebih kecil dari 95 derajat.
- Satu repetisi bertambah hanya saat state sudah `down` dan kembali ke `up`.
- Deteksi tubuh dianggap valid bila visibility landmark utama cukup tinggi.
- Feedback body line muncul bila sudut bahu-pinggul-pergelangan kaki terlalu kecil.

## Acceptance Criteria
- Saat kamera aktif dan tubuh terlihat dari samping, counter bertambah setelah satu gerakan push-up lengkap.
- Counter tidak bertambah saat pengguna hanya turun tanpa kembali ke atas.
- Tombol reset mengubah counter ke 0 dan mengembalikan status ke siap.
- Tombol stop menghentikan stream kamera.
- Sesi dengan repetisi lebih dari 0 tersimpan di histori lokal.
- Progress target bertambah sesuai rasio repetisi terhadap target.
- Bila kamera tidak tersedia atau izin ditolak, aplikasi menampilkan pesan error yang jelas.
- Aplikasi dapat dijalankan dari `localhost` dengan Vite development server.

## Risiko dan Mitigasi
- Akurasi menurun bila kamera terlalu dekat, pencahayaan buruk, atau tubuh tidak terlihat penuh.
  Mitigasi: tampilkan status kualitas tracking dan instruksi ringkas.
- Browser memblokir kamera pada konteks tidak aman.
  Mitigasi: jalankan melalui `localhost` atau HTTPS.
- Variasi push-up sangat beragam.
  Mitigasi: MVP fokus pada posisi samping dengan tubuh terlihat penuh.

## Rencana Pengembangan Lanjutan
- Kalibrasi personal untuk threshold siku.
- Penyimpanan sesi latihan di localStorage.
- Target repetisi dan timer.
- Audio cue untuk hitungan.
- Analitik form seperti pinggul turun, range of motion, dan tempo.
