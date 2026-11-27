-- ============================================================
-- CEK AREA KERJA — SKEMA SUPABASE
-- Compatible dengan payload JSON Apps Script v7.
-- Jalankan lewat SQL Editor Supabase (service role / owner).
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. TABEL
-- ------------------------------------------------------------

create table if not exists public.master_checklist (
  id bigint generated always as identity primary key,
  id_item text not null,
  section text not null,
  floor integer not null check (floor > 0),
  label text not null,
  grup_pengecekan text not null default 'Per Divisi',
  lokasi_ruko text,
  sub_area text,
  nama_pengecekan text,
  status text not null default 'AKTIF',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id_item, floor)
);

create table if not exists public.app_meta (
  section text primary key,
  pin text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.log_inspeksi (
  id bigint generated always as identity primary key,
  id_log text not null,
  id_sesi uuid not null,
  section text not null,
  floor integer not null,
  shift text not null default 'Shift 1',
  tanggal date not null,
  "timestamp" timestamptz not null default now(),
  nama_petugas text not null,
  id_item text not null,
  grup_pengecekan text,
  lokasi_ruko text,
  sub_area text,
  nama_pengecekan text,
  hasil_cek text not null check (hasil_cek in ('OK', 'NG')),
  catatan text,
  url_foto text,
  status_tindak_lanjut text not null default 'OPEN',
  pic_penyelesai text,
  waktu_selesai timestamptz,
  url_foto_perbaikan text,
  app_area text,
  app_note text,
  app_photo_json jsonb,
  app_revised_at timestamptz,
  app_revision_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id_log, id_item)
);

create index if not exists log_inspeksi_group_idx
  on public.log_inspeksi (id_sesi, section, floor, tanggal);
create index if not exists log_inspeksi_log_idx
  on public.log_inspeksi (id_log);
create index if not exists log_inspeksi_item_idx
  on public.log_inspeksi (id_item);

create table if not exists public.perbaikan (
  id uuid primary key default gen_random_uuid(),
  log_id text not null,
  item_id text not null,
  section text not null,
  floor integer not null,
  id_sesi uuid,
  waktu_perbaikan timestamptz not null,
  petugas text not null,
  catatan text not null,
  foto_json jsonb,
  log_ok_id text,
  created_at timestamptz not null default now(),
  unique (log_id, item_id, waktu_perbaikan, petugas)
);

create index if not exists perbaikan_log_item_idx
  on public.perbaikan (log_id, item_id, waktu_perbaikan);
create index if not exists perbaikan_item_idx
  on public.perbaikan (item_id);

-- ------------------------------------------------------------
-- 2. VIEW UNTUK FRONTEND
--    PIN sengaja tidak pernah diekspos.
-- ------------------------------------------------------------

create or replace view public.v_sections with (security_barrier = true) as
select
  s.section as "name",
  (coalesce(m.pin, '') <> '') as "hasPin",
  coalesce(m.sort_order, 900) as "sortOrder"
from (select distinct section from public.master_checklist) s
left join public.app_meta m on m.section = s.section
order by 3, 1;

create or replace view public.v_items with (security_barrier = true) as
select
  m.id_item as id,
  min(m.section) as section,
  min(m.label) as label,
  array_agg(distinct m.floor order by m.floor) as floors
from public.master_checklist m
where m.status = 'AKTIF'
group by m.id_item
order by min(m.section), min(m.label);

create or replace view public.v_log_groups with (security_barrier = true) as
with master_items as (
  select id_item, min(label) as label
  from public.master_checklist
  group by id_item
),
group_rows as (
  select
    l.id_log,
    l.id_sesi,
    l.section,
    l.floor,
    (array_agg(l.app_area order by l.id))[1] as area,
    (array_agg(l.nama_petugas order by l.id))[1] as officer,
    (array_agg(coalesce(l.app_note, l.catatan, '') order by l.id))[1] as note,
    min(l."timestamp") as group_time,
    min(l.shift) as shift,
    max(l.app_revised_at) as revised_at,
    max(l.app_revision_count) as revision_count
  from public.log_inspeksi l
  group by l.id_log, l.id_sesi, l.section, l.floor
),
with_items as (
  select
    g.*,
    i.items
  from group_rows g
  left join lateral (
    select jsonb_agg(s.obj order by s.rn) as items
    from (
      select
        row_number() over (order by l.id) as rn,
        jsonb_build_object(
          'id', l.id_item,
          'label', coalesce(
            mi.label,
            concat_ws(' · ', nullif(l.lokasi_ruko, ''), nullif(l.sub_area, ''), l.nama_pengecekan),
            l.id_item
          ),
          'val', l.hasil_cek,
          'photo', l.app_photo_json,
          'area', coalesce(l.app_area, ''),
          'officer', coalesce(l.nama_petugas, ''),
          'note', coalesce(l.app_note, l.catatan, ''),
          'time', to_char(l."timestamp" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'repairs', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', p.id::text,
                'idSesi', coalesce(p.id_sesi::text, ''),
                'logId', p.log_id,
                'section', p.section,
                'floor', p.floor,
                'itemId', p.item_id,
                'time', to_char(p.waktu_perbaikan at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                'officer', p.petugas,
                'note', p.catatan,
                'photo', p.foto_json,
                'logOkId', coalesce(nullif(p.log_ok_id, ''), next_ok.id_log, ''),
                'createdAt', to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
              )
              order by p.waktu_perbaikan, p.created_at
            )
            from public.perbaikan p
            where p.log_id = l.id_log and p.item_id = l.id_item
          ), '[]'::jsonb),
          'repairCount', (
            select count(*) from public.perbaikan p
            where p.log_id = l.id_log and p.item_id = l.id_item
          ),
          'lastRepairAt', coalesce((
            select to_char(max(p.waktu_perbaikan) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            from public.perbaikan p
            where p.log_id = l.id_log and p.item_id = l.id_item
          ), ''),
          'repairStatus', case
            when exists (
              select 1 from public.perbaikan p
              where p.log_id = l.id_log and p.item_id = l.id_item
            ) then 'SELESAI'
            when l.hasil_cek = 'NG' then 'OPEN'
            else ''
          end
        ) as obj
      from public.log_inspeksi l
      left join master_items mi on mi.id_item = l.id_item
      left join lateral (
        select l2.id_log
        from public.log_inspeksi l2
        where l2.section = l.section
          and l2.floor = l.floor
          and l2.id_item = l.id_item
          and l2.hasil_cek = 'OK'
          and l2."timestamp" > l."timestamp"
        order by l2."timestamp"
        limit 1
      ) next_ok on true
      where l.id_log = g.id_log
    ) s
  ) i on true
),
final as (
  select
    w.id_log as id,
    w.section,
    w.floor,
    coalesce(w.area, '') as area,
    coalesce(w.officer, '') as officer,
    coalesce(w.note, '') as note,
    coalesce(w.items, '[]'::jsonb) as items,
    coalesce(jsonb_path_query_array(coalesce(w.items, '[]'::jsonb), '$[*] ? (@.val == "NG").label'), '[]'::jsonb) as ng_items,
    to_char(w.group_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as time,
    case when w.revised_at is null then null
      else to_char(w.revised_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    end as revised_at,
    coalesce(w.revision_count, 0) as revision_count,
    coalesce(w.shift, 'Shift 1') as shift
  from with_items w
)
select
  id,
  section,
  floor,
  area,
  officer,
  note,
  items,
  (jsonb_array_length(ng_items) > 0) as "hasIssue",
  jsonb_array_length(ng_items) as "ngCount",
  ng_items as "ngItems",
  time,
  revised_at as "revisedAt",
  revision_count as "revisionCount",
  shift
from final
order by time desc;

create or replace view public.v_meta with (security_barrier = true) as
select
  (select count(distinct id_log) from public.log_inspeksi) as "logCount",
  coalesce((
    select to_char(max("timestamp") at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    from public.log_inspeksi
  ), '') as "lastLogTime",
  (select count(distinct section) from public.master_checklist) as "sectionCount",
  (select count(distinct id_item) from public.master_checklist where status = 'AKTIF') as "itemCount",
  (select count(*) from public.perbaikan) as "repairCount",
  coalesce((
    select to_char(max(waktu_perbaikan) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    from public.perbaikan
  ), '') as "lastRepairTime",
  (
    select md5(coalesce(string_agg(
      s."name" || '|' || s."hasPin"::text || '|' || s."sortOrder"::text,
      ',' order by s."name"
    ), ''))
    from public.v_sections s
  ) as "sectionsStamp",
  (
    select md5(coalesce(string_agg(
      i.id || '|' || i.section || '|' || array_to_string(i.floors, ',') || '|' || i.label,
      ',' order by i.section, i.id
    ), ''))
    from public.v_items i
  ) as "itemsStamp";

-- ------------------------------------------------------------
-- 3. RLS — klien hanya boleh baca view, tidak pernah tabel dasar
-- ------------------------------------------------------------

alter table public.master_checklist enable row level security;
alter table public.app_meta enable row level security;
alter table public.log_inspeksi enable row level security;
alter table public.perbaikan enable row level security;

revoke all on public.master_checklist from anon, authenticated;
revoke all on public.app_meta from anon, authenticated;
revoke all on public.log_inspeksi from anon, authenticated;
revoke all on public.perbaikan from anon, authenticated;

-- Edge Function memakai role service_role lewat secret key.
-- Project baru tidak selalu memberi grant otomatis, jadi berikan eksplisit.
grant all on public.master_checklist to service_role;
grant all on public.app_meta to service_role;
grant all on public.log_inspeksi to service_role;
grant all on public.perbaikan to service_role;
grant usage, select on sequence public.master_checklist_id_seq to service_role;
grant usage, select on sequence public.log_inspeksi_id_seq to service_role;

grant select on public.v_sections to service_role;
grant select on public.v_items to service_role;
grant select on public.v_log_groups to service_role;
grant select on public.v_meta to service_role;

grant select on public.v_sections to anon, authenticated;
grant select on public.v_items to anon, authenticated;
grant select on public.v_log_groups to anon, authenticated;
grant select on public.v_meta to anon, authenticated;

-- ------------------------------------------------------------
-- 4. STORAGE
-- ------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'foto_item',
  'foto_item',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "foto_item publik dibaca" on storage.objects;
create policy "foto_item publik dibaca"
  on storage.objects for select
  using (bucket_id = 'foto_item');

grant all on storage.objects to service_role;
grant all on storage.buckets to service_role;

-- Tidak ada policy INSERT/UPDATE/DELETE untuk anon.
-- Semua unggahan/ penghapusan foto memakai service role dari Edge Function.
