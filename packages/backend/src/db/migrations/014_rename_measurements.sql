-- Rename measurements to station_readings for naming consistency.
-- Pairs with weather_readings: both tables store time-series readings,
-- one from physical monitoring stations (OpenAQ), one from the weather model (Open-Meteo).
-- "station_readings" is unambiguous — fires, CAMS, and weather data are also "measurements"
-- in the loose sense, so the old name was too generic.

alter table measurements rename to station_readings;

alter index measurements_pkey rename to station_readings_pkey;
alter index measurements_station_id_parameter_measured_at_idx rename to station_readings_station_id_parameter_measured_at_idx;
alter index measurements_parameter_measured_at_idx rename to station_readings_parameter_measured_at_idx;
alter index measurements_measured_at_idx rename to station_readings_measured_at_idx;
alter index measurements_station_param_time_idx rename to station_readings_station_param_time_idx;
alter index measurements_param_time_idx rename to station_readings_param_time_idx;
alter index measurements_sensor_id_measured_at_idx rename to station_readings_sensor_id_measured_at_idx;
alter table station_readings rename constraint measurements_station_id_fkey to station_readings_station_id_fkey;
