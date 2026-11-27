-- ============================================================
-- OPSIONAL: penjadwalan otomatis cleanup foto 30 hari via pg_cron
-- Jalankan hanya jika ekstensi pg_cron tersedia di project Supabase.
-- ============================================================

create extension if not exists pg_cron with schema extensions;

select cron.unschedule('hapus-foto-30-hari')
where exists (
  select 1 from cron.job where jobname = 'hapus-foto-30-hari'
);

select cron.schedule(
  'hapus-foto-30-hari',
  '0 0 * * *',
  $cron$select public.cleanup_old_photos(30)$cron$
);
