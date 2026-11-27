// ============================================================
// ETL: Apps Script (Code-Excel.gs) -> Supabase
// Jalankan: node etl.js <url-gas> <url-supabase> <service-role-key>
//
// Catatan:
// - PIN tidak dikirim oleh GET Apps Script (sengaja disembunyikan).
//   Masukkan PIN manual lewat SQL/Edge Function setelah ETL, atau
//   siapkan file pin.json berisi { "Nama Bagian": "1234" }.
// - Foto lama dari Google Drive tidak bisa diunggah ulang otomatis
//   oleh script ini. Jalankan migrate-photos.js lebih dulu; ETL akan
//   membaca photo-map.json dan mengganti fileId/URL ke Storage Supabase
//   supaya cleanup 30 hari bekerja. Tanpa photo-map.json, URL lama
//   tetap disimpan apa adanya.
// ============================================================

const fs = require('fs');
const path = require('path');

const gasUrl = process.argv[2];
const supabaseUrl = process.argv[3];
const serviceKey = process.argv[4];
const pinPath = process.argv[5];

if (!gasUrl || !supabaseUrl || !serviceKey) {
  console.error('Usage: node etl.js <url-gas> <url-supabase> <service-role-key> [pin.json]');
  process.exit(1);
}

let pins = {};
if (pinPath && fs.existsSync(pinPath)) {
  pins = JSON.parse(fs.readFileSync(pinPath, 'utf8'));
}

const photoMapPath = path.join(__dirname, 'photo-map.json');
let photoMap = {};
if (fs.existsSync(photoMapPath)) {
  photoMap = JSON.parse(fs.readFileSync(photoMapPath, 'utf8'))
    .reduce((acc, row) => {
      if (row.fileId && row.newUrl) acc[row.fileId] = row.newUrl;
      return acc;
    }, {});
  console.log('Peta foto ditemukan: ' + Object.keys(photoMap).length + ' file.');
}

function migratePhoto(photo) {
  if (!photo || !photo.fileId || !photoMap[photo.fileId]) return photo;
  const newUrl = photoMap[photo.fileId];
  const marker = '/object/public/foto_item/';
  const idx = newUrl.indexOf(marker);
  const fileId = idx === -1 ? photo.fileId : decodeURIComponent(newUrl.slice(idx + marker.length));
  return { ...photo, fileId, view: newUrl, thumb: newUrl };
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch (_err) { throw new Error('Respons bukan JSON: ' + text.slice(0, 300)); }
  if (!res.ok || json.ok === false) throw new Error(json.error || 'HTTP ' + res.status);
  return json;
}

function str(v) { return v === undefined || v === null ? '' : String(v).trim(); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function iso(v) {
  if (!v) return new Date().toISOString();
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
function wibDate(v) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(v));
  const get = t => parts.find(p => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function authHeaders(key) {
  // Kunci baru (sb_publishable_... / sb_secret_...) bukan JWT.
  // Kirim lewat header apikey saja. Kunci legacy (eyJ...) boleh Bearer.
  if (/^sb_/.test(key)) return { apikey: key };
  return { apikey: key, Authorization: 'Bearer ' + key };
}

async function sb(table, method, body) {
  const url = supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + table;
  const res = await fetch(url, {
    method,
    headers: {
      ...authHeaders(serviceKey),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(table + ': ' + text.slice(0, 300));
  return text ? JSON.parse(text) : [];
}

function splitLabel(label) {
  const parts = str(label).split('·').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 3) return { lokasi: parts[0], sub: parts[1], nama: parts.slice(2).join(' · ') };
  if (parts.length === 2) return { lokasi: '', sub: parts[0], nama: parts[1] };
  return { lokasi: '', sub: '', nama: str(label) };
}

(async () => {
  console.log('Membaca data dari Apps Script...');
  const src = await fetchJson(gasUrl + '?t=' + Date.now());

  const sections = Array.isArray(src.sections) ? src.sections : [];
  const items = Array.isArray(src.items) ? src.items : [];
  const logs = Array.isArray(src.logs) ? src.logs : [];

  console.log('Bagian: ' + sections.length + ', item: ' + items.length + ', log: ' + logs.length);

  await sb('app_meta?on_conflict=section', 'POST', sections.map((s, i) => ({
    section: str(s.name),
    pin: str(pins[str(s.name)]),
    sort_order: num(s.sortOrder ?? i),
  })));

  const masterRows = [];
  items.forEach(item => {
    const split = splitLabel(item.label);
    (Array.isArray(item.floors) ? item.floors : []).forEach(floor => {
      masterRows.push({
        id_item: str(item.id),
        section: str(item.section),
        floor: num(floor) || 1,
        label: str(item.label),
        grup_pengecekan: 'Per Divisi',
        lokasi_ruko: split.lokasi,
        sub_area: split.sub,
        nama_pengecekan: split.nama,
        status: 'AKTIF',
        sort_order: masterRows.length,
      });
    });
  });
  for (let i = 0; i < masterRows.length; i += 200) {
    await sb('master_checklist?on_conflict=id_item,floor', 'POST', masterRows.slice(i, i + 200));
  }

  const logRows = [];
  const repairRows = [];
  logs.forEach(log => {
    const idLog = str(log.id);
    const idSesi = str((log.items[0] || {}).idSesi) || crypto.randomUUID();
    const time = iso(log.time);
    const tanggal = wibDate(time);
    (Array.isArray(log.items) ? log.items : []).forEach((it, i) => {
      const photo = (() => {
        try {
          const p = typeof it.photo === 'string' ? JSON.parse(it.photo) : it.photo || null;
          return migratePhoto(p);
        } catch (_err) { return null; }
      })();
      const hasil = str(it.val).toUpperCase() === 'NG' ? 'NG' : 'OK';
      const repairs = Array.isArray(it.repairs) ? it.repairs : [];
      logRows.push({
        id_log: idLog,
        id_sesi: idSesi,
        section: str(log.section),
        floor: num(log.floor),
        shift: str(log.shift) || 'Shift 1',
        tanggal,
        timestamp: iso(it.time || time),
        nama_petugas: str(it.officer) || str(log.officer) || '-',
        id_item: str(it.id),
        grup_pengecekan: 'Per Divisi',
        lokasi_ruko: '',
        sub_area: '',
        nama_pengecekan: str(it.label) || str(it.id),
        hasil_cek: hasil,
        catatan: str(it.note ?? log.note),
        url_foto: photo ? str(photo.view || photo.thumb) : '',
        status_tindak_lanjut: repairs.length ? 'CLOSED' : (hasil === 'NG' ? 'OPEN' : 'CLOSED'),
        pic_penyelesai: repairs.length ? str(repairs[repairs.length - 1].officer) : '-',
        waktu_selesai: repairs.length ? iso(repairs[repairs.length - 1].time) : null,
        url_foto_perbaikan: '-',
        app_area: str(it.area) || str(log.area),
        app_note: str(it.note ?? log.note),
        app_photo_json: photo,
        app_revised_at: log.revisedAt ? iso(log.revisedAt) : null,
        app_revision_count: num(log.revisionCount),
      });
      repairs.forEach(r => {
        const rphoto = (() => {
          try {
            const p = typeof r.photo === 'string' ? JSON.parse(r.photo) : r.photo || null;
            return migratePhoto(p);
          } catch (_err) { return null; }
        })();
        repairRows.push({
          log_id: idLog,
          item_id: str(it.id),
          section: str(log.section),
          floor: num(log.floor),
          id_sesi: idSesi,
          waktu_perbaikan: iso(r.time),
          petugas: str(r.officer) || '-',
          catatan: str(r.note) || '-',
          foto_json: rphoto,
          log_ok_id: str(r.logOkId),
        });
      });
    });
  });

  console.log('Menulis ' + logRows.length + ' baris log dan ' + repairRows.length + ' perbaikan...');
  for (let i = 0; i < logRows.length; i += 200) {
    await sb('log_inspeksi?on_conflict=id_log,id_item', 'POST', logRows.slice(i, i + 200));
  }
  if (repairRows.length) {
    for (let i = 0; i < repairRows.length; i += 200) {
      await sb('perbaikan?on_conflict=log_id,item_id,waktu_perbaikan,petugas', 'POST', repairRows.slice(i, i + 200));
    }
  }

  console.log('ETL selesai.');
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
