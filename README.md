# Push-Up Counter

Web React + Vite untuk menghitung jumlah push-up dari kamera browser. Video diproses lokal di browser menggunakan MediaPipe Pose.

## Jalankan

```bash
npm install
npm run dev
```

Buka URL yang ditampilkan Vite, biasanya `http://localhost:5173`.

## Cara Pakai

1. Posisikan kamera dari samping.
2. Pastikan bahu, siku, pergelangan tangan, dan pinggul terlihat jelas.
3. Tekan `Start`.
4. Mulai dari posisi atas, turun sampai siku menekuk, lalu kembali ke atas.
5. Atur target dan threshold `Bawah`/`Atas` bila deteksi terlalu ketat atau terlalu longgar.
6. Tekan `Reset` untuk sesi baru atau `Stop` untuk mematikan kamera.

## Catatan Akurasi

- Pencahayaan buruk, kamera terlalu dekat, atau tubuh tidak penuh di frame bisa menurunkan akurasi.
- MVP ini memakai threshold umum: posisi bawah saat sudut siku kurang dari 95 derajat, posisi atas saat lebih dari 155 derajat.
- Browser perlu `localhost` atau HTTPS agar akses kamera tidak diblokir.
- Target, threshold, dan histori sesi disimpan di `localStorage`.

## Cara Penghitungan

1. MediaPipe Pose membaca landmark bahu, siku, pergelangan tangan, dan pinggul.
2. Aplikasi memilih sisi kiri atau kanan yang visibility-nya paling tinggi.
3. Sudut siku dihitung dari tiga titik: bahu -> siku -> pergelangan tangan.
4. State berubah ke `up` saat sudut siku lebih dari 155 derajat.
5. State berubah ke `down` saat sudut siku kurang dari 95 derajat dan sebelumnya sudah `up`.
6. Counter bertambah satu saat state sebelumnya `down` lalu kembali ke `up`.
7. Body line dihitung dari bahu -> pinggul -> pergelangan kaki untuk memberi peringatan bila badan terlalu menekuk.
