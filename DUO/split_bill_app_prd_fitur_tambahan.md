# PRD Split Bill App: Fitur Tambahan (Backlog)

## Ringkasan
Dokumen ini terpisah dari PRD utama (split_bill_app_prd.md) yang isinya enam item bug fix dan fitur yang diminta langsung. Isi dokumen ini murni rekomendasi fitur tambahan buat split bill app, dengan format problem statement, priority, proposed solution, dan acceptance criteria yang sama supaya konsisten dan bisa langsung dieksekusi kapan pun mau diambil.

Setiap item dikasih priority: P1 (penting tapi gak blocking), P2 (nice to have), P3 (kerjain paling akhir kalau semua yang lain udah beres).

## 1. Debt Netting atau Settle Up Antar Bill
**Problem**
Penyelesaian utang sekarang dilakukan bill per bill, padahal dalam circle yang sama utang piutang antar bill sering saling silang, jadi jumlah transfer yang dibutuhkan jauh lebih banyak dari yang seharusnya.

**Priority**
P1, ini kemungkinan fitur dengan value tertinggi di daftar ini

**Proposed Solution**
Hitung saldo bersih tiap orang terhadap tiap orang lain di semua bill yang belum lunas, lalu terapkan algoritma penyederhanaan supaya hasil akhirnya jadi daftar transfer dengan jumlah transaksi seminimal mungkin.

**Acceptance Criteria**
* Sistem bisa menghitung saldo bersih tiap orang terhadap tiap orang lain di semua bill outstanding
* Hasil akhir berupa daftar transfer (siapa bayar ke siapa, berapa) dengan jumlah transaksi seminimal mungkin
* User bisa pilih menyelesaikan utang per bill seperti biasa, atau pakai mode settle up ini

## 2. Aturan Pembulatan Rupiah
**Problem**
Pembagian rata menghasilkan angka pecahan aneh seperti Rp 33.333 yang gak enak diminta ke orang.

**Priority**
P1

**Proposed Solution**
Tambahkan aturan pembulatan otomatis ke kelipatan 100 atau 500 (bisa dipilih) saat split dihitung, dengan selisih pembulatan dibebankan ke satu orang tertentu supaya total tetap balance.

**Acceptance Criteria**
* User bisa pilih kelipatan pembulatan, ke 100 atau ke 500
* Total setelah pembulatan tetap sama dengan total bill asli
* Selisih pembulatan tercatat jelas, gak hilang begitu saja dari pembukuan

## 3. Audit Trail Sederhana
**Problem**
Setelah fitur delete bill dibuka di PRD utama, gak ada catatan siapa menghapus atau mengubah apa dan kapan, padahal ini berkaitan langsung dengan uang.

**Priority**
P1

**Proposed Solution**
Tambahkan log sederhana yang mencatat setiap aksi delete atau edit jumlah pada bill, minimal berisi siapa yang melakukan, aksi apa, dan kapan.

**Acceptance Criteria**
* Setiap delete atau edit jumlah pada bill tercatat di log terpisah
* Log bisa dilihat minimal oleh pembuat bill atau admin
* Log gak bisa dihapus dari sisi user biasa

## 4. Dukungan QRIS Statis
**Problem**
Transfer manual butuh orang ngetik nomor rekening satu satu, padahal banyak yang lebih nyaman scan kode.

**Priority**
P2

**Proposed Solution**
Kalau tersedia QRIS statis, tambahkan sebagai opsi metode pembayaran di samping transfer bank, ditampilkan sebagai gambar kode yang bisa discan langsung dari link pembayaran atau template pesan WA.

**Acceptance Criteria**
* Kode QRIS bisa diupload dan ditampilkan di halaman pembayaran
* Pembuat bill bisa pilih metode default: transfer bank, QRIS, atau keduanya ditampilkan sekaligus

## 5. Riwayat atau Saldo Berjalan per Orang
**Problem**
Status paid/unpaid cuma keliatan per bill, gak ada tempat buat lihat total keseluruhan riwayat satu orang.

**Priority**
P2

**Proposed Solution**
Bikin halaman profil per orang yang menampilkan seluruh riwayat bill yang melibatkan orang itu, total yang sudah dibayar, dan total yang masih outstanding.

**Acceptance Criteria**
* Bisa buka satu nama dan lihat daftar semua bill yang melibatkan orang tersebut
* Ada ringkasan total paid dan total outstanding di halaman itu
* Data ini konsisten dengan yang ada di CSV export dari PRD utama

## 6. Deteksi Bill Duplikat
**Problem**
Gak ada peringatan kalau bill yang sama gak sengaja discan dua kali.

**Priority**
P3

**Proposed Solution**
Saat bill baru selesai discan, bandingkan merchant, tanggal, dan total dengan bill lain dalam rentang waktu dekat (misalnya 24 jam), dan tampilkan peringatan kalau ada kemiripan tinggi.

**Acceptance Criteria**
* Sistem membandingkan bill baru dengan bill terakhir secara otomatis saat proses scan selesai
* Peringatan duplikat muncul sebelum bill final disimpan, bukan setelahnya
* User tetap bisa lanjut simpan meski sudah diperingatkan, ini bukan blocking keras
