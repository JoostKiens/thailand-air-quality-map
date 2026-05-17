-- Add 'Diesel' as a valid fuel_type for power plants
alter table power_plants drop constraint if exists power_plants_fuel_type_check;
alter table power_plants add constraint power_plants_fuel_type_check
  check (fuel_type in ('Coal', 'Gas', 'Oil', 'Diesel'));
