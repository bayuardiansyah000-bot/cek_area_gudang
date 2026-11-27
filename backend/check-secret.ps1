$ErrorActionPreference = 'Stop'

$secure = Read-Host 'Masukkan SUPABASE_SECRET_KEY (sb_secret_...)' -AsSecureString
$plain = [System.Net.NetworkCredential]::new('', $secure).Password
if (-not $plain) { throw 'Kunci tidak boleh kosong.' }

$url = 'https://avnbnwdlnybshwfznpul.supabase.co/rest/v1/app_meta?select=section&limit=1'
$out = & curl.exe -s -o - -w "`nSTATUS:%{http_code}" -H "apikey: $plain" $url

if ($out -match 'STATUS:200') {
  'OK: kunci ini bisa membaca app_meta.'
} elseif ($out -match 'permission denied') {
  'GAGAL: kunci dikenal, tetapi service_role belum diberi GRANT. Jalankan schema.sql yang sudah diperbarui.'
} elseif ($out -match 'STATUS:401') {
  'GAGAL: kunci tidak dikenal / bukan kunci project ini.'
} else {
  'HASIL: ' + $out
}
