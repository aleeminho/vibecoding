# PRD Split Bill App: Bug Fix dan Fitur Baru

## Ringkasan
Dokumen ini menjabarkan enam item yang diminta (campuran bug fix dan fitur baru) untuk split bill app, plus delapan fitur tambahan yang direkomendasikan dan sudah dimasukkan formal ke backlog PRD ini. Setiap item, baik yang diminta maupun rekomendasi tambahan, punya problem statement, priority, proposed solution, dan acceptance criteria dengan format yang sama supaya bisa langsung dieksekusi tanpa ambigu.

## Asumsi dan Scope
Karena saat ini signup cuma bisa manual lewat Supabase, gue asumsikan app ini masih dipakai untuk lingkup kecil, kemungkinan besar circle temen atau kolega yang lo kenal langsung, bukan produk publik. Beberapa keputusan desain di bawah (terutama soal auth dan penyimpanan data rekening bank) berubah total kalau ternyata rencananya app ini mau dibuka untuk orang yang gak lo kenal. Kalau asumsi ini salah, tandain di bagian Risiko di bawah supaya prioritasnya bisa disesuaikan ulang.

Setiap item dikasih priority: P0 (blocking, kerjain duluan), P1 (penting tapi gak blocking), P2 (nice to have, kerjain kalau yang lain sudah beres).

## 1. Self Serve Signup
**Problem**
User baru cuma bisa masuk kalau didaftarin manual langsung di Supabase. Gak ada jalur signup mandiri.

**Priority**
Kondisional. Kalau target user tetap circle kecil yang jumlahnya bisa dihitung jari, jujur aja, manual add di Supabase itu udah cukup dan effort bikin signup flow penuh mungkin gak worth it. Baru jadi P0 kalau lo memang niat buka akses ke lebih banyak orang yang gak lo kenal satu satu.

**Proposed Solution**
Aktifkan Supabase Auth dengan email dan password plus email confirmation, atau magic link kalau mau lebih simpel buat end user. Google OAuth juga opsi bagus untuk circle kecil karena setup nya cepat dan user gak perlu bikin password baru.

**Reality Check**
Karena app ini nyimpen data terkait uang dan nomor rekening, jangan bikin registrasi kebuka bebas begitu saja. Minimal pakai salah satu dari: kode undangan, allowlist nomor telepon atau email, atau approval manual sebelum akun aktif penuh.

**Acceptance Criteria**
* User baru bisa daftar sendiri tanpa campur tangan admin di Supabase dashboard
* Ada mekanisme pembatasan siapa yang boleh daftar (invite code, allowlist, atau approval)
* Email/akun terverifikasi sebelum bisa scan atau lihat bill

## 2. Hapus Bill yang Sudah Terscan
**Problem**
Belum ada cara menghapus bill yang sudah discan.

**Priority**
P0

**Proposed Solution**
Tambahkan aksi delete di level bill (bukan per baris orang), yang menghapus atau menyembunyikan semua baris dengan ref_code yang sama sekaligus.

**Reality Check**
Sebaiknya ini soft delete (ubah status jadi deleted dan sembunyikan dari tampilan utama) dibanding hard delete langsung dari Google Sheets. Kalau ternyata salah hapus atau butuh audit belakangan, data historisnya masih ada. Hard delete permanen bisa jadi aksi terpisah nanti kalau memang perlu beres beres.

**Acceptance Criteria**
* Delete di satu bill menghapus/menyembunyikan seluruh baris terkait ref_code tersebut, bukan cuma satu baris
* Ada konfirmasi sebelum delete dieksekusi
* File bukti struk di Google Drive terkait ikut ditandai atau dipindah, gak nyampah begitu saja
* Bill yang sudah dihapus gak muncul lagi di daftar aktif maupun di CSV export default

## 3. CSV Export yang Lebih Detail untuk Analisis Excel
**Problem**
CSV yang bisa ditarik sekarang terlalu sederhana, gak cukup detail untuk dianalisis lebih lanjut di Excel.

**Priority**
P1

**Proposed Solution**
Ubah struktur export supaya satu baris mewakili satu item per orang (bukan cuma total per orang per bill), dengan ref_code sebagai kunci penghubung. Contoh kolom yang disarankan:

```
ref_code,bill_date,merchant_name,item_name,item_qty,item_unit_price,item_subtotal,person_name,person_share_amount,payment_status,payment_method,bank_name,account_number,recipient_name,paid_at,proof_of_payment_url,validation_status,discrepancy_amount
```

Dengan struktur ini, di Excel lo bisa langsung bikin PivotTable per orang, per bulan, per merchant, atau per kategori item tanpa harus utak atik data lagi.

Contoh formula buat cek total yang sudah dibayar satu orang, misalnya Alee, sepanjang waktu:

```
=SUMIFS(Table1[person_share_amount], Table1[person_name], "Alee", Table1[payment_status], "paid")
```

Dan buat lihat total yang masih outstanding per orang:

```
=SUMIFS(Table1[person_share_amount], Table1[person_name], "Alee", Table1[payment_status], "unpaid")
```

**Acceptance Criteria**
* Satu baris CSV mewakili satu item per orang, bukan agregat per bill
* Semua kolom di atas terisi konsisten, gak ada yang kosong tanpa alasan jelas
* Export bisa difilter berdasarkan rentang tanggal
* File CSV bisa langsung dibuka sebagai Excel Table tanpa perlu cleaning manual dulu

## 4. Template Pesan WA untuk Share Split Bill
**Problem**
Belum ada cara otomatis untuk share hasil split bill ke WA, sekarang berarti nulis manual tiap kali.

**Priority**
P1

**Proposed Solution**
Generate teks pesan otomatis (ringkasan bill, jumlah per orang, plus info rekening tujuan dari item 5) begitu bill selesai diproses, lengkap dengan tombol Copy Text sekali klik. User tinggal klik copy, buka grup WA tujuan, dan paste. Opsional, sediakan juga tombol Buka di WhatsApp yang pakai wa.me link dengan teks sudah terisi, sebagai jalan pintas tambahan buat yang mau langsung buka WA tanpa copy paste manual.

**Catatan Scope**
Ini disengaja dibikin satu klik copy plus paste manual ke grup, bukan forward otomatis penuh tanpa sentuhan sama sekali. WhatsApp emang gak nyediain jalan buat itu dari web app biasa, dan satu klik copy paste ini sudah cukup buat kebutuhan yang diminta.

**Acceptance Criteria**
* Teks pesan otomatis ter-generate begitu bill selesai diproses, termasuk jumlah per orang dan info rekening tujuan
* Tombol copy berfungsi dalam satu klik, tanpa perlu select teks manual
* Format pesan tetap rapi kalau dipaste ke WhatsApp (tanpa karakter aneh atau line break berantakan)
* (Opsional) Tombol buka di WhatsApp tersedia sebagai jalan pintas tambahan

## 5. Kolom Info Rekening Tujuan per Split Bill
**Problem**
Belum ada tempat nyimpen ke mana orang harus transfer.

**Priority**
P0 (ini prasyarat supaya item 6 bisa jalan)

**Proposed Solution**
Tambahkan tiga field di level bill: nama bank atau e wallet tujuan, nomor rekening atau nomor tujuan, dan nama penerima. Simpan di level bill karena biasanya satu bill cuma punya satu tujuan pembayaran, tapi kasih opsi override di level orang untuk kasus di mana ada lebih dari satu penagih dalam satu bill.

**Reality Check**
Nomor rekening itu data yang cukup sensitif meski cuma di antara circle temen. Kalau Google Sheets yang jadi database dibagikan lewat link yang kebuka untuk siapa saja yang punya link, semua orang bisa lihat rekening semua orang lain, bukan cuma rekeningnya sendiri. Kalau memang mau tetap pakai Sheets sebagai backend, minimal batasi akses sharing nya ke orang yang benar benar perlu.

**Acceptance Criteria**
* Setiap bill punya field bank/e wallet, nomor tujuan, dan nama penerima yang wajib diisi sebelum bill dianggap selesai diproses
* Field ini muncul di CSV export dan di template pesan WA
* Ada validasi dasar (nomor tujuan gak boleh kosong atau berisi karakter non angka untuk transfer bank)

## 6. Link Pembayaran dengan Validasi AI Vision
**Problem**
Belum ada cara buat payer upload bukti bayar sendiri dan divalidasi otomatis.

**Priority**
P2, kerjain setelah item 2, 3, dan 5 solid

**Proposed Solution**
Generate link unik per orang per bill (berbasis ref_code dan person id). Payer buka link itu, upload foto atau screenshot bukti bayar, lalu sistem kirim gambar itu ke vision model untuk dibaca jumlahnya dan dibandingkan dengan jumlah yang seharusnya dibayar. Kalau cocok, status jadi paid. Kalau gak cocok, tampilkan selisihnya secara spesifik, misalnya "kurang Rp 15.000" atau "lebih Rp 5.000".

**Reality Check**
Ini fitur paling flashy dari semua yang diminta, tapi juga paling gampang meleset kalau langsung dipercaya penuh di versi pertama. Layout bukti bayar beda jauh antara BCA, Mandiri, Dana, OVO, GoPay, atau konfirmasi QRIS, jadi akurasi model vision realistisnya gak langsung 100 persen dari hari pertama. Selain itu validasi jangan cuma cek jumlah, tapi juga cek nama penerima atau nomor tujuan yang tertera di bukti bayar, karena orang bisa saja upload bukti transfer dengan jumlah pas tapi ke rekening yang salah, dan kalau cuma cek angka, itu bakal lolos begitu saja. Terakhir, screenshot bisa diedit, jadi anggap fitur ini alat bantu buat nangkap salah ketik atau salah jumlah yang gak disengaja, bukan kontrol anti fraud yang bisa diandalkan penuh.

Untuk v1, sarankan status hasil validasi jadi "matched" atau "needs review" (bukan otomatis "paid" penuh), supaya tetap ada satu langkah konfirmasi manusia sebelum uang dianggap benar benar clear.

**Acceptance Criteria**
* Link pembayaran unik per orang per bill, gak bisa dipakai untuk bill atau orang lain
* Upload gambar bukti bayar berhasil tersimpan dan terhubung ke ref_code serta person id yang benar
* Sistem membandingkan jumlah pada bukti bayar dengan jumlah yang seharusnya, dan menyebutkan besaran selisih kalau tidak cocok
* Validasi turut mengecek nama penerima atau nomor tujuan, bukan cuma jumlah
* Status hasil validasi dibedakan antara cocok penuh dan butuh review manual, bukan langsung final

## Non Goals (v1)
* Forward otomatis penuh tanpa sentuhan ke grup WA (lihat catatan scope item 4)
* Validasi bukti bayar yang dianggap final tanpa review manusia sama sekali
* Dukungan multi mata uang atau transfer lintas negara
* Integrasi real time langsung ke sistem bank atau e wallet (webhook notifikasi pembayaran otomatis)

## Fitur Tambahan (Ditambahkan ke Backlog)
Delapan fitur di bawah ini awalnya rekomendasi, sekarang dimasukkan formal ke scope PRD dengan format yang sama seperti item 1 sampai 6, diurutkan dari yang paling worth it.

### 7. Debt Netting atau Settle Up Antar Bill
**Problem**
Penyelesaian utang sekarang dilakukan bill per bill, padahal dalam circle yang sama utang piutang antar bill sering saling silang, jadi jumlah transfer yang dibutuhkan jauh lebih banyak dari yang seharusnya.

**Priority**
P1

**Proposed Solution**
Hitung saldo bersih tiap orang terhadap tiap orang lain di semua bill yang belum lunas, lalu terapkan algoritma penyederhanaan supaya hasil akhirnya jadi daftar transfer dengan jumlah transaksi seminimal mungkin.

**Acceptance Criteria**
* Sistem bisa menghitung saldo bersih tiap orang terhadap tiap orang lain di semua bill outstanding
* Hasil akhir berupa daftar transfer (siapa bayar ke siapa, berapa) dengan jumlah transaksi seminimal mungkin
* User bisa pilih menyelesaikan utang per bill seperti biasa, atau pakai mode settle up ini

### 8. Aturan Pembulatan Rupiah
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

### 9. Reminder Otomatis untuk yang Belum Bayar
**Problem**
Gak ada cara sistematis buat follow up orang yang belum bayar selain japri manual satu satu.

**Priority**
P2

**Proposed Solution**
Setelah sekian hari (misal 3 hari) bill masih berstatus unpaid, generate ulang template pesan WA versi reminder yang nadanya lebih halus tapi tetap jelas jumlah dan tujuannya, pakai mekanisme copy sekali klik yang sama seperti item 4.

**Acceptance Criteria**
* Ada threshold hari yang bisa diatur untuk memicu reminder
* Teks reminder beda dari teks awal, nadanya lebih halus tapi tetap jelas
* User bisa trigger reminder manual kapan saja, gak harus nunggu threshold

### 10. Dukungan QRIS Statis
**Problem**
Transfer manual butuh orang ngetik nomor rekening satu satu, padahal banyak yang lebih nyaman scan kode.

**Priority**
P2

**Proposed Solution**
Kalau tersedia QRIS statis, tambahkan sebagai opsi metode pembayaran di samping transfer bank, ditampilkan sebagai gambar kode yang bisa discan langsung dari link pembayaran atau template pesan WA.

**Acceptance Criteria**
* Kode QRIS bisa diupload dan ditampilkan di halaman pembayaran
* Pembuat bill bisa pilih metode default: transfer bank, QRIS, atau keduanya ditampilkan sekaligus

### 11. Riwayat atau Saldo Berjalan per Orang
**Problem**
Status paid/unpaid cuma keliatan per bill, gak ada tempat buat lihat total keseluruhan riwayat satu orang.

**Priority**
P2

**Proposed Solution**
Bikin halaman profil per orang yang menampilkan seluruh riwayat bill yang melibatkan orang itu, total yang sudah dibayar, dan total yang masih outstanding.

**Acceptance Criteria**
* Bisa buka satu nama dan lihat daftar semua bill yang melibatkan orang tersebut
* Ada ringkasan total paid dan total outstanding di halaman itu
* Data ini konsisten dengan yang ada di CSV export

### 12. Dukungan Bayar Sebagian
**Problem**
Status sekarang cuma paid atau unpaid, gak menangkap kondisi orang bayar setengah dulu sisanya menyusul.

**Priority**
P2

**Proposed Solution**
Ubah field status supaya bisa menyimpan jumlah yang sudah dibayar sejauh ini, bukan cuma boolean, dengan status turunan seperti unpaid, partially paid, dan paid berdasarkan perbandingan jumlah dibayar terhadap jumlah seharusnya.

**Acceptance Criteria**
* Sistem bisa mencatat lebih dari satu pembayaran untuk satu person share
* Status otomatis update jadi partially paid kalau total yang masuk belum mencapai jumlah penuh
* Sisa yang masih harus dibayar tetap jelas ditampilkan

### 13. Audit Trail Sederhana
**Problem**
Setelah delete dibuka di item 2, gak ada catatan siapa menghapus atau mengubah apa dan kapan, padahal ini berkaitan langsung dengan uang.

**Priority**
P1

**Proposed Solution**
Tambahkan log sederhana yang mencatat setiap aksi delete atau edit jumlah pada bill, minimal berisi siapa yang melakukan, aksi apa, dan kapan.

**Acceptance Criteria**
* Setiap delete atau edit jumlah pada bill tercatat di log terpisah
* Log bisa dilihat minimal oleh pembuat bill atau admin
* Log gak bisa dihapus dari sisi user biasa

### 14. Deteksi Bill Duplikat
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

## Risiko dan Pertanyaan Terbuka
* Apakah app ini memang mau tetap untuk circle kecil yang lo kenal, atau ada rencana buka lebih luas. Ini menentukan apakah item 1 itu P0 atau P2, dan seberapa serius soal keamanan data rekening di item 5 perlu digarap.
* Untuk item 6, perlu diputuskan dari awal apakah hasil validasi AI boleh langsung mengubah status jadi paid, atau selalu butuh konfirmasi manual minimal di versi pertama.
