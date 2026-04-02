-- Run in Supabase SQL editor after 001_initial.sql.
-- Enables ON CONFLICT DO NOTHING for idempotent measurement upserts.
create unique index if not exists measurements_sensor_id_measured_at_idx
  on measurements (sensor_id, measured_at);
