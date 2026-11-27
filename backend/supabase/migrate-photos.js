// ============================================================
// MIGRASI FOTO LAMA: Google Drive -> Supabase Storage `foto_item`
// Jalankan: node migrate-photos.js <file-json-dari-apps-script> <url-supabase> <service-role-key>
//
// File JSON dihasilkan oleh fungsi Apps Script `exportPhotoManifest_`:
// [{ fileId, fileName, viewUrl, logId, itemId, repairId }, ...]
//
// Untuk file Google Drive yang private, script ini memakai URL `uc?id=`
// dan service role tidak bisa mengambilnya. Pastikan foto lama bersifat
// "Anyone with the link" atau unduh manual lalu taruh di folder `files/`
// dengan nama sesuai `fileName`.
// ============================================================

const fs = require('fs');
const path = require('path');

const manifestPath = process.argv[2];
const supabaseUrl = process.argv[3];
const serviceKey = process.argv[4];

if (!manifestPath || !supabaseUrl || !serviceKey) {
  console.error('Usage: node migrate-photos.js <manifest.json> <url-supabase> <service-role-key>');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

async function upload(pathName, bytes, mime) {
  const url = supabaseUrl.replace(/\/$/, '') + '/storage/v1/object/foto_item/' + pathName;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      ...(/^sb_/.test(serviceKey) ? {} : { Authorization: 'Bearer ' + serviceKey }),
      'Content-Type': mime,
      'x-upsert': 'true',
    },
    body: bytes,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(pathName + ': ' + text.slice(0, 200));
  return supabaseUrl.replace(/\/$/, '') + '/storage/v1/object/public/foto_item/' + pathName;
}

(async () => {
  let ok = 0;
  let fail = 0;
  for (const row of manifest) {
    try {
      const local = path.join(__dirname, 'files', path.basename(row.fileName || row.fileId));
      let bytes;
      if (fs.existsSync(local)) {
        bytes = fs.readFileSync(local);
      } else if (row.viewUrl) {
        const res = await fetch(row.viewUrl);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        bytes = Buffer.from(await res.arrayBuffer());
      } else {
        throw new Error('Tidak ada sumber foto');
      }
      const publicUrl = await upload(row.fileId, bytes, row.mimeType || 'image/jpeg');
      row.newUrl = publicUrl;
      ok++;
      console.log('OK   ' + row.fileId);
    } catch (err) {
      fail++;
      console.log('GAGAL ' + row.fileId + ': ' + err.message);
    }
  }
  fs.writeFileSync(path.join(__dirname, 'photo-map.json'), JSON.stringify(manifest, null, 2));
  console.log('Selesai: ' + ok + ' berhasil, ' + fail + ' gagal. Lihat photo-map.json.');
})();
