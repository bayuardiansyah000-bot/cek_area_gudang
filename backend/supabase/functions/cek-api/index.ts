// ============================================================
// CEK AREA KERJA — EDGE FUNCTION "cek-api"
// Semua operasi tulis, PIN, dan foto memakai service role.
// Klien tidak pernah melihat PIN atau menulis ke tabel dasar.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
// Project baru memakai secret key (sb_secret_...), project lama memakai service_role.
// Nama yang diawali SUPABASE_ dilarang oleh CLI, jadi pakai SECRET_KEY saat set secret.
const serviceRoleKey =
  Deno.env.get("SECRET_KEY") ||
  Deno.env.get("APP_SECRET_KEY") ||
  Deno.env.get("SB_SECRET_KEY") ||
  Deno.env.get("SUPABASE_SECRET_KEY") ||
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  "";
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "SUPABASE_URL dan kunci secret/service role wajib disetel. " +
    "Jalankan: supabase secrets set SECRET_KEY='sb_secret_...'",
  );
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function str(v: any): string {
  return v === undefined || v === null ? "" : String(v).trim();
}
function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function isoNow(): string {
  return new Date().toISOString();
}
function isoOf(v: any): string {
  if (!v) return isoNow();
  const d = new Date(v);
  return isNaN(d.getTime()) ? isoNow() : d.toISOString();
}
function wibDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function normVal(v: any): "OK" | "NG" {
  const s = str(v).toUpperCase();
  if (!s) return "OK";
  if (s === "NG" || s.indexOf("TIDAK AMAN") !== -1 || s.indexOf("TIDAK") === 0) return "NG";
  return "OK";
}
function photoOf(v: any): any | null {
  if (!v) return null;
  try {
    const o = typeof v === "string" ? JSON.parse(v) : v;
    if (!o || typeof o !== "object") return null;
    return o;
  } catch (_err) {
    return null;
  }
}
function query<T>(result: { data: T | null; error: any }, label: string): T {
  if (result.error) throw new Error(label + ": " + result.error.message);
  return (result.data || []) as T;
}

const PBKDF2_ITERATIONS = 100_000;
const textEncoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !num(iterations) || !salt || !hash) return false;
  return sameBytes(await pbkdf2(password, fromBase64(salt), num(iterations)), fromBase64(hash));
}

async function requireAdmin(password: any): Promise<void> {
  const given = str(password);
  if (!given) throw new Error("Password admin salah.");
  const rows = query<any[]>(
    await db.from("app_settings").select("value").eq("key", "admin_password_hash").limit(1),
    "Gagal membaca password admin",
  );
  const storedHash = str(rows[0]?.value);
  if (storedHash) {
    if (!(await verifyPassword(given, storedHash))) throw new Error("Password admin salah.");
    return;
  }
  const expected = Deno.env.get("ADMIN_PASSWORD") || "";
  if (!expected) throw new Error("Password admin belum disetel. Atur ADMIN_PASSWORD di Edge Function.");
  if (!sameBytes(textEncoder.encode(given), textEncoder.encode(expected))) throw new Error("Password admin salah.");
}

async function changeAdminPassword(p: any): Promise<any> {
  await requireAdmin(p.password);
  const newPassword = str(p.newPassword);
  if (newPassword.length < 6 || newPassword.length > 64) {
    throw new Error("Password baru harus 6 sampai 64 karakter.");
  }
  query(
    await db.from("app_settings").upsert({
      key: "admin_password_hash",
      value: await hashPassword(newPassword),
      updated_at: isoNow(),
    }),
    "Gagal menyimpan password admin",
  );
  return { ok: true };
}

function photoPath(photo: any): string {
  const o = photoOf(photo);
  if (!o) return "";
  if (str(o.fileId) && !/^https?:/i.test(str(o.fileId))) return str(o.fileId);
  const match = str(o.view || o.thumb).match(/\/object\/public\/foto_item\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function purgeLogs(p: any): Promise<any> {
  await requireAdmin(p.password);
  if (str(p.confirm) !== "HAPUS") throw new Error("Konfirmasi hapus tidak valid.");

  const logs = query<any[]>(
    await db.from("log_inspeksi").select("id_log, app_photo_json"),
    "Gagal membaca log",
  );
  const repairs = query<any[]>(
    await db.from("perbaikan").select("foto_json"),
    "Gagal membaca perbaikan",
  );
  const paths = new Set<string>();
  logs.forEach((r) => { const path = photoPath(r.app_photo_json); if (path) paths.add(path); });
  repairs.forEach((r) => { const path = photoPath(r.foto_json); if (path) paths.add(path); });

  query(await db.from("perbaikan").delete().not("id", "is", null), "Gagal menghapus perbaikan");
  query(await db.from("log_inspeksi").delete().not("id", "is", null), "Gagal menghapus log");

  const allPaths = [...paths];
  let photosFailed = 0;
  for (let i = 0; i < allPaths.length; i += 100) {
    const chunk = allPaths.slice(i, i + 100);
    const { error } = await db.storage.from("foto_item").remove(chunk);
    if (error) photosFailed += chunk.length;
  }

  return {
    logs: new Set(logs.map((r) => str(r.id_log))).size,
    repairs: repairs.length,
    photos: allPaths.length - photosFailed,
    photosFailed,
  };
}

async function requireSectionPin(section: string, pin: any): Promise<void> {
  if (!section) throw new Error("Bagian wajib diisi.");
  const rows = query<any[]>(
    await db.from("app_meta").select("pin").eq("section", section).limit(1),
    "Gagal membaca PIN bagian",
  );
  const saved = str(rows[0]?.pin);
  if (saved && saved !== str(pin)) throw new Error("PIN bagian salah.");
}

async function logRows(logId: string): Promise<any[]> {
  return query<any[]>(
    await db.from("log_inspeksi").select("*").eq("id_log", logId).order("id"),
    "Gagal membaca log",
  );
}

function rowLabel(row: any): string {
  return [row.lokasi_ruko, row.sub_area, row.nama_pengecekan]
    .map((x) => str(x))
    .filter(Boolean)
    .join(" · ") || str(row.id_item);
}

function rowToItem(row: any): any {
  return {
    id: str(row.id_item),
    label: rowLabel(row),
    val: normVal(row.hasil_cek),
    photo: photoOf(row.app_photo_json),
    area: str(row.app_area),
    officer: str(row.nama_petugas),
    note: str(row.app_note || row.catatan),
    time: row.timestamp,
  };
}

function mergeItems(existingRows: any[], incoming: any[]): any[] {
  const map = new Map<string, any>();
  existingRows.forEach((r) => map.set(str(r.id_item), rowToItem(r)));
  incoming.forEach((it) => {
    const id = str(it.id);
    if (id) map.set(id, it);
  });
  return Array.from(map.values());
}

function buildRows(args: {
  items: any[];
  idLog: string;
  idSesi: string;
  section: string;
  floor: number;
  shift: string;
  tanggal: string;
  area: string;
  officer: string;
  note: string;
  time: string;
  revisedAt: string;
  revisionCount: number;
}): any[] {
  return args.items.map((it, i) => {
    const itemTime = isoOf(it.time || args.time);
    const photo = photoOf(it.photo);
    const hasil = normVal(it.val);
    const note = it.note !== undefined && it.note !== null ? str(it.note) : args.note;
    return {
      id_log: args.idLog,
      id_sesi: args.idSesi,
      section: args.section,
      floor: args.floor,
      shift: args.shift || "Shift 1",
      tanggal: wibDate(itemTime),
      timestamp: itemTime,
      nama_petugas: str(it.officer) || args.officer,
      id_item: str(it.id) || `item_${i + 1}`,
      grup_pengecekan: "Per Divisi",
      lokasi_ruko: "",
      sub_area: "",
      nama_pengecekan: str(it.label) || str(it.id),
      hasil_cek: hasil,
      catatan: note,
      url_foto: photo ? str(photo.view || photo.thumb) : "",
      status_tindak_lanjut: hasil === "NG" ? "OPEN" : "CLOSED",
      pic_penyelesai: "-",
      waktu_selesai: null,
      url_foto_perbaikan: "-",
      app_area: str(it.area) || args.area,
      app_note: note,
      app_photo_json: photo,
      app_revised_at: args.revisedAt || null,
      app_revision_count: num(args.revisionCount),
    };
  });
}

async function assertNotComplete(section: string, floor: number, date: string): Promise<void> {
  const existing = query<any[]>(
    await db
      .from("log_inspeksi")
      .select("id_item")
      .eq("section", section)
      .eq("floor", floor)
      .eq("tanggal", date),
    "Gagal memeriksa kelengkapan cek",
  );
  if (!existing.length) return;
  const master = query<any[]>(
    await db
      .from("v_items")
      .select("id")
      .eq("section", section)
      .contains("floors", [floor]),
    "Gagal membaca master checklist",
  );
  const ids = new Set<string>();
  existing.forEach((r) => ids.add(str(r.id_item)));
  if (master.length && master.every((m) => ids.has(str(m.id)))) {
    throw new Error("Bagian ini sudah dicek hari ini. Gunakan tombol Revisi di tab Riwayat.");
  }
}

async function addLog(p: any): Promise<any> {
  const section = str(p.section);
  const floor = num(p.floor);
  const area = str(p.area);
  const officer = str(p.officer);
  if (!section || !floor || !area || !officer) throw new Error("Data cek belum lengkap.");
  if (!Array.isArray(p.items) || !p.items.length) throw new Error("Item checklist kosong.");
  await requireSectionPin(section, p.pin);

  const incoming = p.items.map((it: any) => ({
    id: str(it.id),
    label: str(it.label),
    val: normVal(it.val),
    photo: photoOf(it.photo),
    area: str(it.area),
    officer: str(it.officer),
    note: str(it.note),
    time: str(it.time),
  }));
  const time = isoOf(incoming[0]?.time);
  const date = wibDate(time);

  const existing = query<any[]>(
    await db
      .from("log_inspeksi")
      .select("*")
      .eq("section", section)
      .eq("floor", floor)
      .eq("tanggal", date)
      .order("id"),
    "Gagal membaca log lama",
  );
  const merged = mergeItems(existing, incoming);
  await assertNotComplete(section, floor, date);

  const sid = str(existing[0]?.id_sesi) || crypto.randomUUID();
  const idLog = `${sid}|${section}|${floor}`;
  const baseTime = str(existing[0]?.timestamp) || time;
  const shift = str(existing[0]?.shift) || "Shift 1";
  const revisionCount = num(existing[0]?.app_revision_count);
  const otherLogIds = [...new Set(existing.map((r) => str(r.id_log)))].filter((id) => id && id !== idLog);

  query(
    await db
      .from("log_inspeksi")
      .delete()
      .eq("section", section)
      .eq("floor", floor)
      .eq("tanggal", date),
    "Gagal menghapus log lama",
  );

  const rows = buildRows({
    items: merged,
    idLog,
    idSesi: sid,
    section,
    floor,
    shift,
    tanggal: date,
    area: area || str(existing[0]?.app_area),
    officer: officer || str(existing[0]?.nama_petugas),
    note: str(p.note) || str(existing[0]?.app_note || existing[0]?.catatan),
    time: baseTime,
    revisedAt: str(existing[0]?.app_revised_at),
    revisionCount,
  });
  query(await db.from("log_inspeksi").insert(rows), "Gagal menyimpan log");
  if (otherLogIds.length) {
    query(
      await db.from("perbaikan").update({ log_id: idLog, id_sesi: sid }).in("log_id", otherLogIds),
      "Gagal memindahkan catatan perbaikan",
    );
  }

  return { id: idLog, time: baseTime, itemCount: merged.length, updated: existing.length > 0 };
}

async function updateLog(p: any): Promise<any> {
  const idLog = str(p.id);
  const rows = await logRows(idLog);
  if (!rows.length) throw new Error("Log tidak ditemukan: " + idLog);
  const first = rows[0];
  await requireSectionPin(str(first.section), p.pin);

  const area = str(p.area);
  const officer = str(p.officer);
  if (!area || !officer) throw new Error("Area dan nama petugas wajib diisi.");
  if (!Array.isArray(p.items) || !p.items.length) throw new Error("Item checklist kosong.");

  const incoming = p.items.map((it: any) => ({
    id: str(it.id),
    label: str(it.label),
    val: normVal(it.val),
    photo: photoOf(it.photo),
    area: str(it.area),
    officer: str(it.officer),
    note: str(it.note),
    time: str(it.time),
  }));
  const revisedAt = isoNow();

  query(
    await db.from("log_inspeksi").delete().eq("id_log", idLog),
    "Gagal menghapus log untuk revisi",
  );

  const newRows = buildRows({
    items: incoming,
    idLog,
    idSesi: str(first.id_sesi) || crypto.randomUUID(),
    section: str(first.section),
    floor: num(first.floor),
    shift: str(first.shift) || "Shift 1",
    tanggal: str(first.tanggal),
    area,
    officer,
    note: str(p.note),
    time: str(first.timestamp),
    revisedAt,
    revisionCount: num(first.app_revision_count) + 1,
  });
  query(await db.from("log_inspeksi").insert(newRows), "Gagal menyimpan revisi");

  return { id: idLog, revisedAt };
}

async function addRepair(p: any): Promise<any> {
  const logId = str(p.logId);
  const itemId = str(p.itemId);
  const officer = str(p.officer);
  const note = str(p.note);
  if (!logId || !itemId) throw new Error("Log atau item perbaikan tidak lengkap.");
  if (!officer) throw new Error("Nama petugas perbaikan wajib diisi.");
  if (!note) throw new Error("Catatan perbaikan wajib diisi.");

  const rows = await logRows(logId);
  if (!rows.length) throw new Error("Log tidak ditemukan: " + logId);
  const section = str(rows[0].section);
  await requireSectionPin(section, p.pin);

  const itemRow = rows.find((r) => str(r.id_item) === itemId);
  if (!itemRow) throw new Error("Item tidak ditemukan pada log ini.");
  if (normVal(itemRow.hasil_cek) !== "NG") throw new Error("Riwayat perbaikan hanya untuk item NG.");

  const time = isoOf(p.time);
  const photo = photoOf(p.photo);
  const repair = {
    log_id: logId,
    item_id: itemId,
    section,
    floor: num(itemRow.floor),
    id_sesi: itemRow.id_sesi,
    waktu_perbaikan: time,
    petugas: officer,
    catatan: note,
    foto_json: photo,
    log_ok_id: str(p.logOkId),
  };
  const inserted = query<any[]>(
    await db.from("perbaikan").insert(repair).select("*"),
    "Gagal menyimpan perbaikan",
  );

  query(
    await db
      .from("log_inspeksi")
      .update({
        status_tindak_lanjut: "CLOSED",
        pic_penyelesai: officer,
        waktu_selesai: time,
        url_foto_perbaikan: photo ? str(photo.view || photo.thumb) : "-",
        updated_at: isoNow(),
      })
      .eq("id_log", logId)
      .eq("id_item", itemId),
    "Gagal memperbarui status perbaikan",
  );

  const r = inserted[0] || repair;
  return {
    id: str(r.id),
    idSesi: str(r.id_sesi || itemRow.id_sesi),
    logId: logId,
    section,
    floor: num(r.floor || itemRow.floor),
    itemId: itemId,
    time: str(r.waktu_perbaikan || time),
    officer,
    note,
    photo,
    logOkId: str(r.log_ok_id),
    createdAt: str(r.created_at || isoNow()),
  };
}

async function uploadPhoto(p: any): Promise<any> {
  const section = str(p.section) || "umum";
  await requireSectionPin(section, p.pin);
  const base64 = str(p.base64).replace(/^data:[^;]+;base64,/, "");
  if (!base64) throw new Error("Foto kosong.");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch (_err) {
    throw new Error("Foto bukan base64 yang valid.");
  }
  const ext = str(p.mimeType) === "image/png" ? "png" : "jpg";
  const path = `${section}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  query(
    await db.storage.from("foto_item").upload(path, bytes, {
      contentType: str(p.mimeType) || "image/jpeg",
      upsert: false,
    }),
    "Gagal mengunggah foto",
  );
  const publicUrl = db.storage.from("foto_item").getPublicUrl(path).data.publicUrl;
  return { thumbUrl: publicUrl, viewUrl: publicUrl, fileId: path };
}

async function saveSection(p: any): Promise<any> {
  await requireAdmin(p.password);
  const name = str(p.name);
  if (!name) throw new Error("Nama bagian wajib diisi.");
  const oldName = str(p.oldName);
  const searchName = oldName || name;

  const current = query<any[]>(
    await db.from("app_meta").select("pin, sort_order").eq("section", searchName).limit(1),
    "Gagal membaca bagian",
  );
  if (p.isNew && current.length) throw new Error("Bagian sudah ada.");
  if (oldName && !current.length) throw new Error("Bagian lama tidak ditemukan.");

  const pin = p.pin === undefined || p.pin === null ? str(current[0]?.pin) : str(p.pin);
  const sortOrder = p.sortOrder === undefined || p.sortOrder === null
    ? num(current[0]?.sort_order)
    : num(p.sortOrder);

  if (oldName && oldName !== name) {
    query(await db.from("app_meta").delete().eq("section", oldName), "Gagal menghapus bagian lama");
    query(await db.from("master_checklist").update({ section: name }).eq("section", oldName), "Gagal mengubah master");
    query(await db.from("log_inspeksi").update({ section: name }).eq("section", oldName), "Gagal mengubah log");
    query(await db.from("perbaikan").update({ section: name }).eq("section", oldName), "Gagal mengubah perbaikan");
  }

  query(
    await db.from("app_meta").upsert({ section: name, pin, sort_order: sortOrder }),
    "Gagal menyimpan bagian",
  );
  return { ok: true };
}

async function deleteSection(p: any): Promise<any> {
  await requireAdmin(p.password);
  const name = str(p.name);
  if (!name) throw new Error("Nama bagian wajib diisi.");
  query(await db.from("app_meta").delete().eq("section", name), "Gagal menghapus PIN bagian");
  query(await db.from("master_checklist").delete().eq("section", name), "Gagal menghapus item bagian");
  // Log dan perbaikan sengaja dibiarkan supaya riwayat tidak hilang.
  return { ok: true };
}

function splitLabel(label: string): { lokasi: string; sub: string; nama: string } {
  const parts = label.split("·").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return { lokasi: parts[0], sub: parts[1], nama: parts.slice(2).join(" · ") };
  }
  if (parts.length === 2) return { lokasi: "", sub: parts[0], nama: parts[1] };
  return { lokasi: "", sub: "", nama: label };
}

async function saveItem(p: any): Promise<any> {
  await requireAdmin(p.password);
  const id = str(p.id);
  const oldId = str(p.oldId) || id;
  const section = str(p.section);
  const label = str(p.label);
  if (!id || !section || !label) throw new Error("ID, bagian, dan label item wajib diisi.");

  let floors = Array.isArray(p.floors)
    ? p.floors.map((n: any) => num(n)).filter((n: number) => n > 0)
    : [];
  if (!floors.length) floors = [1];
  floors = Array.from(new Set(floors)).sort((a, b) => a - b);

  const existing = query<any[]>(
    await db.from("master_checklist").select("id, grup_pengecekan").eq("id_item", oldId),
    "Gagal membaca item",
  );
  if (p.isNew && existing.length) throw new Error("ID item sudah ada.");
  if (!p.isNew && !existing.length) throw new Error("Item tidak ditemukan: " + oldId);

  query(
    await db.from("master_checklist").delete().eq("id_item", oldId),
    "Gagal menghapus item lama",
  );
  if (oldId !== id) {
    query(
      await db.from("log_inspeksi").update({ id_item: id }).eq("id_item", oldId),
      "Gagal mengubah id_item pada log",
    );
    query(
      await db.from("perbaikan").update({ item_id: id }).eq("item_id", oldId),
      "Gagal mengubah item pada perbaikan",
    );
  }

  const split = splitLabel(label);
  const rows = floors.map((floor, i) => ({
    id_item: id,
    section,
    floor,
    label,
    grup_pengecekan: str(existing[0]?.grup_pengecekan) || "Per Divisi",
    lokasi_ruko: split.lokasi,
    sub_area: split.sub,
    nama_pengecekan: split.nama,
    status: "AKTIF",
    sort_order: num(p.sortOrder) + i,
  }));
  query(await db.from("master_checklist").insert(rows), "Gagal menyimpan item");
  return { ok: true };
}

async function deleteItem(p: any): Promise<any> {
  await requireAdmin(p.password);
  const id = str(p.id);
  if (!id) throw new Error("ID item wajib diisi.");
  query(await db.from("master_checklist").delete().eq("id_item", id), "Gagal menghapus item");
  return { ok: true };
}

async function handle(action: string, payload: any, password: string): Promise<any> {
  switch (action) {
    case "verifySectionPin": {
      const section = str(payload.section);
      const pin = str(payload.pin);
      await requireSectionPin(section, pin);
      return { valid: true, required: true };
    }
    case "adminLogin":
      await requireAdmin(password);
      return { ok: true };
    case "addLog":
      return addLog(payload);
    case "updateLog":
      return updateLog(payload);
    case "addRepair":
      return addRepair(payload);
    case "uploadPhoto":
      return uploadPhoto(payload);
    case "saveSection":
      return saveSection({ ...payload, password });
    case "deleteSection":
      return deleteSection({ ...payload, password });
    case "saveItem":
      return saveItem({ ...payload, password });
    case "deleteItem":
      return deleteItem({ ...payload, password });
    case "changeAdminPassword":
      return changeAdminPassword({ ...payload, password });
    case "purgeLogs":
      return purgeLogs({ ...payload, password });
    default:
      throw new Error("Action tidak dikenal: " + action);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const body = await req.json();
    const result = await handle(str(body.action), body.payload || {}, str(body.password));
    return json({ ok: true, version: 8, backend: "supabase", result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, 400);
  }
});
