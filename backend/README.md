# Migrasi Backend ke Supabase

Folder ini berisi schema, Edge Function, dan script migrasi untuk menggantikan
backend Apps Script (`Code-Excel.gs`) dengan Supabase. Frontend tetap
`cekarea-online5.html` dengan flag `BACKEND = "appscript" | "supabase"`.

## Arsitektur

- **Baca**: frontend memanggil view REST Supabase (`v_sections`, `v_items`,
  `v_log_groups`, `v_meta`) memakai **anon key**.
- **Tulis**: semua operasi tulis, verifikasi PIN, dan unggah foto lewat Edge
  Function `cek-api` dengan **service role key**.
- **PIN**: tidak pernah dikirim ke klien. Tabel `app_meta` tidak bisa dibaca
  oleh anon/authenticated (RLS + revoke).
- **Foto**: bucket `foto_item` (public, path acak). Penulisan hanya lewat Edge
  Function. Retensi 30 hari dihapus permanen oleh `cleanup.sql`, entri Riwayat
  tetap ada.
- **Zona waktu**: `Asia/Jakarta`; timestamp disimpan ISO UTC.

## Urutan pasang

1. Buat project Supabase. Simpan Project URL, anon key, service role key.
2. Jalankan `supabase/schema.sql` di SQL Editor.
3. Deploy Edge Function. Di Windows bisa pakai helper:
   ```powershell
   .\setup-supabase.ps1 -ProjectRef "<ref>" -AdminPassword "password-admin-anda"
   ```
   Atau manual:
   ```bash
   supabase functions deploy cek-api
   ```
   Set secrets:
   ```bash
   supabase secrets set ADMIN_PASSWORD='...'
   ```
   `SUPABASE_URL` otomatis tersedia di Edge Function. Untuk kunci tulis,
   function membaca `SECRET_KEY` terlebih dahulu, lalu `APP_SECRET_KEY`,
   `SB_SECRET_KEY`, `SUPABASE_SECRET_KEY`, dan `SUPABASE_SERVICE_ROLE_KEY`.
   CLI Supabase **melarang** nama secret yang diawali `SUPABASE_`, jadi simpan
   kunci `sb_secret_...` dengan nama `SECRET_KEY`:

   ```bash
   supabase secrets set SECRET_KEY='sb_secret_...'
   ```

   Gunakan helper `deploy-function-secret.cmd` agar otomatis. `ADMIN_PASSWORD`
   **wajib**, tanpa default.
4. Isi konstanta di `cekarea-online5.html`:
   ```js
   const BACKEND = "supabase";
   const SUPABASE_URL = "https://xxx.supabase.co";
   const SUPABASE_ANON_KEY = "...";
   const SUPABASE_FUNCTION_URL = "https://xxx.supabase.co/functions/v1/cek-api";
   ```
5. Migrasi foto lama dulu (lihat catatan di `migrate-photos.js`). Hasilnya
   `supabase/photo-map.json` dipakai ETL supaya `fileId` foto berubah ke path
   Storage Supabase. Tanpa itu, cleanup 30 hari akan menganggap foto lama
   sudah hilang dan menghapus tautannya.
6. Jalankan ETL:
   ```bash
   node supabase/etl.js <GAS_URL> <SUPABASE_URL> <SERVICE_ROLE_KEY> pin.json
   ```
   Di Windows bisa langsung double-click `run-etl.cmd`; file itu akan menanyakan
   kunci secret dan memakai GAS URL + Project URL yang sudah diisi.
   Untuk project baru, argumen ketiga boleh `sb_secret_...` yang diambil dari
   **Project Settings → API Keys**. Jangan pakai kunci yang sudah pernah
   dibagikan.
   `pin.json` berisi PIN lama per bagian, misalnya:
   ```json
   { "Inbound": "1234", "Outbound": "5678" }
   ```
   PIN lama tidak bisa diambil dari GET karena sengaja disembunyikan.
7. Jalankan `supabase/cleanup.sql`, lalu opsional `cleanup-cron.sql`.
8. Uji paralel: biarkan `BACKEND = "appscript"` di satu copy frontend dan
   `BACKEND = "supabase"` di copy lain. Bandingkan JSON GET dan alur tulis.
9. Cut-over dengan mengubah flag ke `"supabase"`.

## Kontrak JSON

`v_log_groups` menghasilkan struktur yang sama seperti Apps Script v7:

```json
{
  "id": "sesi|section|floor",
  "section": "B2B",
  "floor": 2,
  "area": "Ruko 4",
  "officer": "Petugas Satu",
  "note": "Catatan",
  "items": [
    {
      "id": "item-ng",
      "label": "Keran bocor",
      "val": "NG",
      "photo": null,
      "area": "Ruko 4",
      "officer": "Petugas Satu",
      "note": "Air menetes",
      "time": "2026-11-27T01:00:00.000Z",
      "repairs": [],
      "repairCount": 0,
      "lastRepairAt": "",
      "repairStatus": "OPEN"
    }
  ],
  "hasIssue": true,
  "ngCount": 1,
  "ngItems": ["Keran bocor"],
  "time": "2026-11-27T01:00:00.000Z",
  "revisedAt": null,
  "revisionCount": 0,
  "shift": "Shift 1"
}
```

`v_meta` menghasilkan `logCount`, `lastLogTime`, `sectionCount`, `itemCount`,
`repairCount`, `lastRepairTime`, `sectionsStamp`, `itemsStamp`.

## Action Edge Function

`addLog`, `updateLog`, `addRepair`, `uploadPhoto`, `verifySectionPin`,
`adminLogin`, `saveSection`, `deleteSection`, `saveItem`, `deleteItem`.

Semua response berbentuk `{ ok: true, version: 8, backend: "supabase", result }`
atau `{ ok: false, error: "..." }`.

## Catatan penting

- Jangan mengubah `Code.gs` atau `cekarea-online4.html`.
- `cekarea-online5.html` masih bisa rollback ke Apps Script kapan saja dengan
  `BACKEND = "appscript"`.
- edge function belum diuji terhadap project Supabase sungguhan karena
  kredensial belum tersedia. Tes lokal hanya memeriksa bentuk schema, view,
  dan kontrak fetch/POST.
