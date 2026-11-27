# Panduan pasang Supabase + deploy Vercel

Ikuti urutan ini dari awal. Ganti nilai dalam tanda `<...>` dengan nilai project kamu.

---

## 1. Siapkan project Supabase

1. Buka https://supabase.com/dashboard → **New project**.
2. Isi nama project, password database, dan pilih region **Singapore** (terdekat dari Indonesia).
3. Tunggu sampai status project **Active**.
4. Buka **Project Settings → API**. Catat:
   - **Project URL** → `https://<ref>.supabase.co`
   - **anon public key** → dipakai frontend/Vercel
   - **service_role key** → RAHASIA, hanya dipakai ETL dan Edge Function
5. Project ref ada di URL dashboard: `https://supabase.com/dashboard/project/<ref>`.

---

## 2. Jalankan schema SQL

Buka **SQL Editor** di dashboard Supabase, jalankan file ini satu per satu:

1. `C:\Users\MSI-14\Downloads\cekarea-supabase\supabase\schema.sql`
2. `C:\Users\MSI-14\Downloads\cekarea-supabase\supabase\cleanup.sql`
3. Opsional: `C:\Users\MSI-14\Downloads\cekarea-supabase\supabase\cleanup-cron.sql`
   (aktifkan ekstensi `pg_cron` bila belum tersedia)

Setelah ini, tabel, view, RLS, dan bucket `foto_item` sudah terbentuk.

---

## 3. Deploy Edge Function `cek-api`

Supabase CLI diperlukan. Di PowerShell Windows, jika `npx` diblokir execution policy, pakai `npx.cmd` atau jalankan ini dulu:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
```

Lalu:

```powershell
cd "C:\Users\MSI-14\Downloads\cekarea-supabase"
npx.cmd supabase@latest login
npx.cmd supabase@latest link --project-ref <ref>
npx.cmd supabase@latest secrets set ADMIN_PASSWORD="password-admin-anda"
npx.cmd supabase@latest functions deploy cek-api
```

`SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` otomatis tersedia di Edge Function.
Jangan pernah mengirim service role key ke browser atau Vercel.

Setelah deploy, coba di browser:

```
https://<ref>.supabase.co/functions/v1/cek-api
```

Harus merespons JSON error/OK, bukan 404.

---

## 4. Migrasi data lama (opsional tapi disarankan)

Jika masih bisa mengakses GAS URL lama:

```powershell
cd "C:\Users\MSI-14\Downloads\cekarea-supabase"

# Jika ada foto lama, jalankan dulu migrate-photos.js,
# lalu pastikan photo-map.json ada di folder supabase.

node supabase/etl.js "<GAS_URL>" "<SUPABASE_URL>" "<SERVICE_ROLE_KEY>" pin.json
```

Buat `pin.json` berisi PIN lama per bagian, misalnya:

```json
{
  "Inbound": "1234",
  "Outbound": "5678",
  "B2B": "9012"
}
```

PIN lama tidak bisa diambil dari GET karena memang sengaja disembunyikan.
Kalau tidak punya catatan PIN, isi manual lewat tabel `app_meta` di SQL Editor:

```sql
insert into public.app_meta (section, pin, sort_order)
values ('Inbound', '1234', 1)
on conflict (section) do update set pin = excluded.pin;
```

---

## 5. Deploy HTML ke Vercel

Folder yang di-deploy:

```
C:\Users\MSI-14\Downloads\deploy-vercel
```

Isinya:

- `source.html` — salinan aplikasi dengan placeholder konfigurasi
- `build.js` — menyuntikkan env var saat build
- `vercel.json` — perintah build statis
- `package.json`
- `.env.example`

### Cara A — lewat GitHub (disarankan)

1. Push folder `deploy-vercel` ke repository GitHub baru.
2. Buka https://vercel.com/new → Import repository tersebut.
3. Set **Root Directory** = `deploy-vercel`.
4. Di **Environment Variables**, tambahkan:

| Nama | Nilai |
|---|---|
| `BACKEND` | `supabase` |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | anon public key |
| `SUPABASE_FUNCTION_URL` | `https://<ref>.supabase.co/functions/v1/cek-api` |

5. Klik **Deploy**. Vercel menjalankan `node build.js` dan menyajikan `index.html`.

### Cara B — Vercel CLI lokal

```powershell
cd "C:\Users\MSI-14\Downloads\deploy-vercel"
$env:BACKEND="supabase"
$env:SUPABASE_URL="https://<ref>.supabase.co"
$env:SUPABASE_ANON_KEY="anon-key-anda"
$env:SUPABASE_FUNCTION_URL="https://<ref>.supabase.co/functions/v1/cek-api"
npx.cmd vercel --prod
```

Env var di PowerShell itu hanya untuk build lokal. Untuk deploy berikutnya, tetap simpan vals di dashboard Vercel.

---

## 6. Uji setelah deploy

Buka URL Vercel, lalu cek:

1. Tab `Cek`, `Riwayat`, `Rekap`, `Laporan`, `Kelola` tampil.
2. Pilih bagian + lantai, isi area/petugas, simpan sebagian item.
3. Item tersimpan hilang dari daftar `Cek`.
4. Buka `Riwayat` → detail → `Catat Perbaikan` pada item NG.
5. Foto bisa diunggah.
6. Tunggu ±60 detik, polling meta tidak error.
7. `Download Laporan` menghasilkan JPG.

---

## Rollback darurat

Kembali ke backend Apps Script tanpa mengubah kode:

1. Di Vercel → Environment Variables, ubah `BACKEND` menjadi `appscript`.
2. Redeploy.
3. Pastikan Apps Script Web App masih aktif dan `ADMIN_PASSWORD` terpasang di Script Properties.

---

## Catatan penting

- `service_role` **hanya** di Supabase secrets/ETL, bukan di Vercel.
- Bucket `foto_item` awalnya public dengan path acak; RLS mencegah klien menulis langsung.
- Semua tulis/PIN/foto lewat Edge Function `cek-api`.
- Retensi foto 30 hari dijalankan oleh `cleanup.sql`;Riwayat tetap tersimpan.
- Zona waktu aplikasi `Asia/Jakarta`; timestamp di database ISO UTC.
