-- Rename aq_grid to cams_grid for naming consistency.
-- The table stores CAMS (Copernicus Atmosphere Monitoring Service) PM2.5 model data
-- fetched from the Open-Meteo Air Quality API. "cams_grid" is unambiguous and distinct
-- from the "measurements" table (OpenAQ station readings).

alter table aq_grid rename to cams_grid;
alter index aq_grid_date_idx rename to cams_grid_date_idx;
