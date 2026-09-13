# DUO — Split Bill

Baca foto struk, hitung bagian tiap orang, simpan hasilnya. AI cuma dipakai di
satu tempat: membaca struk jadi data terstruktur. Sisanya kode deterministik.

Spec lengkapnya ada di [`split_bill_app_spec.md`](./split_bill_app_spec.md) —
itu sumber kebenaran untuk semua keputusan desain. README ini cuma cara
menjalankannya.

## Prasyarat

**Bun, bukan Node.** Mesin ini nggak punya Node.js dan nggak butuh. Semua
perintah di bawah pakai `bun`.

Bun ada di `~/.bun/bin`. Kalau `bun --version` bilang "command not found",
tambahkan ke `PATH`:

```bash
export PATH="$PATH:$HOME/.bun/bin"
```

Biar permanen, tambahkan baris yang sama ke `~/.bashrc`.

> **Catatan:** hampir semua tutorial di internet nulis `npx ...`. Itu nggak akan
> jalan di sini. Ganti jadi `bunx ...`.

## Setup

### 1. Environment — satu file, tiga baris

```bash
cp .env.example .env.local
```

`.env.local` isi tiga nilai, dan itu udah cukup buat semuanya. **Nggak perlu
`export` apa pun, tiap run.** Bun otomatis baca file ini, jadi `bun run dev`
dan `bun run test:extract` langsung dapat nilainya.

| Baris | Dari mana |
|---|---|
| `VITE_SUPABASE_URL` | Supabase dashboard → Settings → API |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | idem, yang berawalan `sb_publishable_` |
| `GEMINI_API_KEY` | aistudio.google.com (Google AI Studio) |

### Kenapa aman nyampur dua jenis key di satu file

Bedanya **awalan `VITE_`**, dan itu bukan kosmetik:

- **`VITE_...`** → Vite nge-inject ke bundle browser. Kedua key Supabase emang
  dirancang publik; yang melindungi data adalah row level security, bukan
  kerahasiaan key-nya.
- **Tanpa `VITE_`** (kayak `GEMINI_API_KEY`) → **nggak pernah masuk bundle.**

Yang terakhir itu udah gue verifikasi, bukan asumsi: nilai canary ditaruh di
`.env.local` sebagai var non-`VITE_`, `bun run build`, lalu `dist/` di-grep —
**nggak ketemu**. Sementara publishable key ketemu, yang berarti grep-nya emang
jalan dan hasilnya bukan false negative.

> **Jangan pernah kasih awalan `VITE_` ke `GEMINI_API_KEY`.** Begitu dikasih,
> dia ikut ke bundle dan siapa pun yang buka devtools bisa nyolong.
>
> Dan jangan pernah taruh secret key Supabase (`sb_secret_...`) atau
> `service_role` di file ini. Dua-duanya melewati RLS sepenuhnya. Nggak ada
> bagian dari arsitektur ini yang butuh key tersebut.

### 2. Database

```bash
bunx supabase login
bunx supabase link --project-ref <project-ref>
bun run db:push      # jalanin semua migration yang belum kejalan
bun run db:types     # generate src/lib/database.types.ts
```

> **Migrasi WAJIB lewat `db push`, jangan lewat SQL Editor.**
>
> Tiga migrasi pertama project ini sempat dijalanin lewat SQL Editor, dan
> akibatnya `supabase_migrations.schema_migrations` kosong melompong — CLI
> nggak tau apa pun udah kejalan. `db push` berikutnya jadi nyoba ngejalanin
> ulang ketiganya dan gagal di nomor satu dengan "already exists".
>
> Sudah dibereskan pakai `supabase migration repair --status applied <versi>`,
> dan sekarang lokal dan remote sinkron. Jangan diulang: begitu SQL Editor
> dipakai lagi, masalah yang sama balik lagi.
>
> Cek kapan saja dengan `bunx supabase migration list`. Kalau kolom `remote`
> ada isinya buat tiap migrasi lokal, berarti sinkron.

`db:types` menghasilkan tipe dari schema asli di database. Setelah itu, pakai di
`src/lib/supabase.ts` seperti yang dijelaskan di komentar file itu. File yang
di-generate nggak bisa drift dari database, beda sama definisi schema yang
ditulis tangan.

### 3. Jalan

```bash
bun run dev
```

Buka di HP: dev server Vite diakses lewat IP LAN. Tambahkan ke Home Screen biar
jalan sebagai PWA (tanpa address bar).

## Perintah

| Perintah | Fungsi |
|---|---|
| `bun run dev` | Dev server |
| `bun run build` | Build produksi ke `dist/` |
| `bun test` | Test suite (52 test) |
| `bun run test:extract <foto>` | Uji ekstraksi struk pakai model asli, tanpa Supabase |
| `bun run check` | Type check (app, node config, dan test) |
| `bun run db:push` | Terapkan migration |
| `bun run db:types` | Regenerate tipe dari database |

## Struktur

```
split_bill_app_spec.md          Spec lengkap — sumber kebenaran
split_bill_app_spec.gsheets-archive.md   Desain lama (Google Sheets), diarsipkan

supabase/migrations/
  20260913050000_init.sql       Tabel, RLS, view, commit_bill(), storage

supabase/migrations/
  20260913050000_init.sql         Tabel, RLS, view, storage
  20260913060000_ref_code_client_side.sql   next_ref_code() + commit_bill()

supabase/functions/extract-receipt/
  index.ts                      Foto struk -> teks mentah dari model
  prompt.ts                     Model, prompt, dan bentuk output (spec § 8)

src/lib/
  split.ts                      Rumus split + gate 0-4  (spec § 6, § 9)
  split.test.ts                 Test, termasuk worked example dari spec
  normalize.ts                  Validasi + koersi output model jadi Extraction
  normalize.test.ts             Test, termasuk semua kasus jelek
  api.ts                        Semua panggilan ke server
  session.svelte.ts             State login
  draft.svelte.ts               State struk yang lagi diproses
  types.ts                      Tipe domain
  format.ts                     Rupiah + tanggal
  image.ts                      Downscale 1568px + HEIC -> JPEG
  supabase.ts                   Client

src/components/
  MoneyInput.svelte             Input rupiah yang tahan diketik

src/routes/
  SignIn.svelte                 Email + password
  Bills.svelte                  Saldo per orang + riwayat + tandai lunas
  Capture.svelte                Foto -> model -> Review
  Review.svelte                 Review & Assign (spec § 11) — layar terbesar
  Report.svelte                 Rekap bulanan + CSV + PDF
  Preview.svelte                DEV ONLY — layar Review pakai data palsu

public/
  manifest.webmanifest          Biar bisa di-Add to Home Screen
  icon-*.png, apple-touch-icon.png
```

## Ngutak-atik tampilan tanpa login

Tiga layar (Tagihan, Report, Review) baca dari database yang dikunci RLS, jadi
tanpa login semuanya cuma keliatan kosong. Untuk ngindarin ngerancang tampilan
sambil nebak, ada mode demo yang nge-serve data palsu:

```
#/preview           Review, ada item belum dibagi
#/preview?done      Review, lengkap — ada seksi Hasil
#/preview?fresh     Review, persis habis upload: belum ada orang, belum ada yang salah
#/preview?crowd     Review, 8 orang — buat ngecek wrapping chip
#/bills?demo        Tagihan, ada beberapa bill
#/report?demo       Report, ada dua bulan data
```

Semuanya cuma hidup di **build dev**. Fixture-nya di-strip dari produksi, dan
itu **diverifikasi** dengan grep ke `dist/` setelah build — bukan diasumsikan.

> **Jebakan yang pernah kejadian:** first attempt nulis `if (demoMode())`. Itu
> **nggak ke-strip**, karena bundler nggak bisa tau hasil pemanggilan fungsi.
> Yang bisa di-DCE cuma `import.meta.env.DEV` yang ditulis langsung di call
> site. Kalau nambah call site baru, tulis `import.meta.env.DEV && isDemo()` —
> dan **grep `dist/` buat mastiin**.

## Uji ekstraksi tanpa Supabase

Ini bagian paling berisiko dari seluruh aplikasi: bisa nggak modelnya baca struk
Indonesia beneran dengan benar. Bagian itu bisa dites **sebelum apa pun
di-deploy**, dan tanpa Supabase sama sekali.

Cukup satu perintah, nggak perlu `export` — key-nya udah kebaca dari `.env.local`:

```bash
bun run test:extract "C:/path/ke/foto-struk.jpg"
```

Script-nya pakai model, prompt, dan schema yang **sama persis** dengan yang
dipakai Edge Function (dua-duanya import dari
`supabase/functions/extract-receipt/prompt.ts`), jadi hasil tesnya berlaku buat
produksi. Yang dicek:

1. Gate 1 — aritmatika struk balance
2. Gate 2 — total item sama dengan subtotal tercetak
3. `computeSplit` semua-ke-satu-orang menghasilkan total struk persis
4. Kalau fotonya fixture yang udah dikenal, perbandingan persis sama bacaan manual

Fixture-nya ada di `scripts/test-extract.ts`. Tiap kali ada struk baru yang
dicek mata dan hasilnya bener, tambahin entry-nya — biar regresi model muncul
sebagai assertion yang gagal, bukan sebagai angka salah yang keliatan masuk akal.

## Deploy Edge Function

Pakai key yang sama dengan yang di `.env.local` — tinggal copy nilainya:

```bash
bunx supabase secrets set GEMINI_API_KEY=...
bunx supabase functions deploy extract-receipt
```

Key itu jadi secret di sisi server dan **nggak pernah nyampe ke browser**. Itu
satu-satunya alasan fungsi ini ada sebagai server function, padahal sisa
aplikasinya client-only. Fungsinya sendiri nggak nyentuh database sama sekali —
dia cuma nerima gambar, manggil model, balikin teks mentah. Semua parsing,
validasi, dan penulisan data terjadi di client.

> **Soal key:** ambil di **aistudio.google.com** (Google AI Studio), bagian
> *Get API key*. Gemini dipilih karena punya `responseSchema` — schema dipaksa
> di level API, jadi modelnya nggak bisa balikin field yang hilang atau JSON
> yang dibungkus markdown. Dua provider sebelumnya nggak punya itu.

## Status

| Fase | Isi | Status |
|---|---|---|
| 1 | Migration SQL: tabel, RLS, view, `commit_bill()` | ✅ **terverifikasi di Supabase** |
| 2 | Scaffold PWA (Vite + Svelte + TS) + rumus split + 52 test | ✅ selesai |
| 3 | Edge Function `extract-receipt` + normalizer | ✅ **terverifikasi lawan model asli & struk asli** |
| 4 | Migration 0002: `next_ref_code()` | ⬜ **perlu dijalanin di Supabase** |
| 5 | Deploy Edge Function + magic link auth | ⬜ butuh `supabase login` |
| 6 | UI Capture + Review & Assign (spec § 11) | ✅ ditulis, ⬜ belum dicoba di HP |
| 7 | List tagihan, toggle lunas, report + CSV | ⬜ |
| 8 | Verifikasi end-to-end di HP | ⬜ |

Fase 1 udah dieksekusi terhadap Postgres sungguhan: tabel, ketiga view, dan
`commit_bill()` semuanya ada dan merespons. `commit_bill` dites tanpa login dan
dengan benar menolak dengan `28000 not authenticated`, yang sekaligus
membuktikan body fungsinya jalan dan RLS-nya aktif.

Fase 3 diuji lawan foto struk HP yang asli (Lucky Cat, 26-05-2026) dan lolos
semuanya: 7 item kebaca lengkap, baris modifier `1 ICE` nggak jadi item palsu,
tanggal `DD-MM-YYYY` + jam kebaca bener, semua angka cocok sama bacaan manual,
dan kedua gate lolos.

**Tapi itu satu struk.** Satu sampel yang lolos artinya pipeline-nya bener,
bukan artinya modelnya bakal bener terus. Tiap kali ada struk baru yang dicek
mata dan hasilnya bener, tambahin fixture-nya di `scripts/test-extract.ts` —
biar regresi muncul sebagai assertion yang gagal, bukan sebagai angka salah yang
keliatan masuk akal.

## Tiga hal yang gampang bikin bingung nanti

1. **Nggak ada ORM.** Bukan karena lupa. ORM butuh koneksi Postgres langsung
   (connection string = password database), dan itu cuma bisa di server.
   Aplikasi ini jalan di browser. Kalau ada query yang udah nggak sepele,
   jadikan view atau RPC — bukan tambah query builder. Alasan lengkapnya di
   spec § 12.

2. **`security_invoker = true` di semua view itu wajib.** Tanpa itu, view jalan
   pakai privilege owner-nya dan melewati RLS, yang artinya semua orang bisa
   lihat tagihan semua orang. Gampang kelewat.

3. **Foto struk diupload ke Drive/Supabase sebagai HEIC kalau nggak dikonversi.**
   iPhone menyimpan foto sebagai HEIC, dan API vision nggak menerimanya. Harus
   di-downscale ke ~1568px dan di-encode ulang jadi JPEG sebelum dikirim.
