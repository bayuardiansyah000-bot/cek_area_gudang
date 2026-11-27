// Build statis untuk Vercel.
// Membaca source.html dan menyuntikkan konfigurasi dari Environment Variables.
// Service role key TIDAK pernah dipakai di sini.

const fs = require('fs');
const path = require('path');

const root = __dirname;
const templatePath = path.join(root, 'source.html');
const outputPath = path.join(root, 'index.html');

const backend = (process.env.BACKEND || 'supabase').trim();
const values = {
  __BACKEND__: backend,
  __SUPABASE_URL__: process.env.SUPABASE_URL || '',
  __SUPABASE_ANON_KEY__: process.env.SUPABASE_ANON_KEY || '',
  __SUPABASE_FUNCTION_URL__: process.env.SUPABASE_FUNCTION_URL || '',
};

if (!['appscript', 'supabase'].includes(backend)) {
  console.error('BACKEND harus "appscript" atau "supabase".');
  process.exit(1);
}

if (backend === 'supabase') {
  const missing = Object.keys(values).filter(k => k !== '__BACKEND__' && !values[k]);
  if (missing.length) {
    console.error('Environment Variable belum diisi: ' + missing.join(', '));
    console.error('Isi di Vercel → Project Settings → Environment Variables.');
    process.exit(1);
  }
}

let html = fs.readFileSync(templatePath, 'utf8');
Object.entries(values).forEach(([key, value]) => {
  if (!html.includes(key)) throw new Error('Placeholder tidak ditemukan: ' + key);
  html = html.split(key).join(value);
});

fs.writeFileSync(outputPath, html, 'utf8');
console.log('index.html dibuat dengan BACKEND=' + backend);
