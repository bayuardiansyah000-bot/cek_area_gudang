-- ============================================================
-- RETENSI FOTO 30 HARI
-- File di Storage dihapus permanen. Baris Riwayat/perbaikan tetap ada,
-- hanya tautan fotonya yang dikosongkan.
-- ============================================================

create or replace function public.cleanup_old_photos(retention_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  cutoff timestamptz := now() - make_interval(days => retention_days);
  rec record;
  hapus integer := 0;
begin
  for rec in
    select id
    from storage.objects
    where bucket_id = 'foto_item'
      and created_at < cutoff
  loop
    delete from storage.objects where id = rec.id;
    hapus := hapus + 1;
  end loop;

  update public.log_inspeksi
  set app_photo_json = null,
      url_foto = null,
      updated_at = now()
  where app_photo_json is not null
    and nullif(app_photo_json->>'fileId', '') is not null
    and not exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'foto_item'
        and o.name = app_photo_json->>'fileId'
    );

  update public.perbaikan
  set foto_json = null
  where foto_json is not null
    and nullif(foto_json->>'fileId', '') is not null
    and not exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'foto_item'
        and o.name = foto_json->>'fileId'
    );

  return hapus;
end;
$$;

-- EXECUTE secara default diberikan ke PUBLIC, jadi harus dicabut juga.
revoke all on function public.cleanup_old_photos(integer) from public;
revoke all on function public.cleanup_old_photos(integer) from anon, authenticated;
grant execute on function public.cleanup_old_photos(integer) to service_role;

-- Uji manual:
-- select public.cleanup_old_photos(30);

-- Otomatis via pg_cron (jika ekstensi tersedia di project):
-- create extension if not exists pg_cron with schema extensions;
-- select cron.schedule(
--   'hapus-foto-30-hari',
--   '0 0 * * *',
--   $$select public.cleanup_old_photos(30)$$
-- );
