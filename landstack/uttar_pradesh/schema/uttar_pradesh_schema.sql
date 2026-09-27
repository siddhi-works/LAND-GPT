-- Uttar Pradesh Land Stack synthetic DB layer
-- Source grouping intentionally differs from Maharashtra.

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS revenue_land_records;
CREATE SCHEMA IF NOT EXISTS revenue_mutation;
CREATE SCHEMA IF NOT EXISTS revenue_cadastral;
CREATE SCHEMA IF NOT EXISTS stamps_registration;
CREATE SCHEMA IF NOT EXISTS urban_planning;
CREATE SCHEMA IF NOT EXISTS housing_authority;
CREATE SCHEMA IF NOT EXISTS urban_local_body;
CREATE SCHEMA IF NOT EXISTS power_distribution;
CREATE SCHEMA IF NOT EXISTS water_services;
CREATE SCHEMA IF NOT EXISTS environmental_controls;

CREATE TABLE core.parcel_registry (
  ulpin TEXT PRIMARY KEY,
  prototype_ref TEXT UNIQUE NOT NULL,
  state TEXT NOT NULL,
  context TEXT NOT NULL,
  district TEXT NOT NULL,
  tehsil TEXT NOT NULL,
  village TEXT NOT NULL,
  gatta_khasra_no TEXT NOT NULL,
  sub_division TEXT,
  khata_no TEXT,
  geometry_ref TEXT NOT NULL,
  geometry_geojson JSONB,
  centroid_lat NUMERIC(9,6),
  centroid_lon NUMERIC(9,6),
  geometry_area_hectare NUMERIC(14,6),
  land_record_area_hectare NUMERIC(14,6),
  quality_class TEXT NOT NULL CHECK (quality_class IN ('clean','messy'))
);

CREATE TABLE revenue_land_records.khatauni (
  ulpin TEXT PRIMARY KEY REFERENCES core.parcel_registry(ulpin),
  district TEXT NOT NULL, tehsil TEXT NOT NULL, village TEXT NOT NULL,
  khata_no TEXT, gatta_khasra_no TEXT NOT NULL, sub_division TEXT,
  khatedar_name_hi TEXT NOT NULL, khatedar_name_en TEXT NOT NULL,
  area_value NUMERIC(14,3) NOT NULL, area_unit TEXT NOT NULL,
  land_class_hi TEXT, land_class_en TEXT,
  possession_status TEXT, transfer_restriction BOOLEAN DEFAULT FALSE,
  record_status TEXT NOT NULL
);

CREATE TABLE revenue_land_records.khasra (
  khasra_id TEXT PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  district TEXT, tehsil TEXT, village TEXT, khasra_no TEXT, sub_division TEXT,
  area_value NUMERIC(14,3), area_unit TEXT,
  crop_status_hi TEXT, crop_status_en TEXT, record_status TEXT
);

CREATE TABLE revenue_mutation.namantaran (
  mutation_no TEXT PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  application_no TEXT, process_type_hi TEXT, process_type_en TEXT,
  application_date DATE, khasra_no TEXT, khata_no TEXT,
  linked_document_no TEXT, status_hi TEXT, status_en TEXT, order_no TEXT
);

CREATE TABLE stamps_registration.deed (
  document_no TEXT PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  district TEXT, tehsil TEXT, sub_registrar_office TEXT,
  document_type_hi TEXT, document_type_en TEXT, transaction_type TEXT,
  registration_date DATE,
  seller_name_hi TEXT, seller_name_en TEXT,
  buyer_name_hi TEXT, buyer_name_en TEXT,
  consideration_value NUMERIC(18,2), stamp_duty NUMERIC(18,2),
  registration_fee NUMERIC(18,2), status TEXT
);

CREATE TABLE revenue_cadastral.bhu_naksha (
  map_ref TEXT PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  district TEXT, tehsil TEXT, village TEXT, plot_no TEXT, sub_division TEXT,
  map_area NUMERIC(14,3), area_unit TEXT, map_status TEXT, layers JSONB
);

CREATE TABLE urban_planning.record (
  planning_id BIGSERIAL PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  planning_authority TEXT, plan_reference TEXT, zone_code TEXT,
  zone_name_hi TEXT, zone_name_en TEXT, permitted_use TEXT, restriction_status TEXT
);

CREATE TABLE housing_authority.building_plan_approval (
  approval_no TEXT PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  application_no TEXT, department TEXT, approving_authority TEXT,
  service TEXT, building_use TEXT, built_up_area_sqm NUMERIC(14,2),
  approval_date DATE, status TEXT
);

CREATE TABLE urban_local_body.property_tax (
  property_tax_id TEXT PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  local_body TEXT, assessment_year TEXT, assessed_value NUMERIC(18,2),
  tax_demand NUMERIC(14,2), amount_paid NUMERIC(14,2),
  outstanding_amount NUMERIC(14,2), status TEXT
);

CREATE TABLE power_distribution.electricity_connection (
  utility_id TEXT PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  provider TEXT, discom TEXT, consumer_account_no TEXT,
  connection_status TEXT, supply_category TEXT
);

CREATE TABLE water_services.connection (
  water_connection_id TEXT PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  provider TEXT, connection_status TEXT, connection_number TEXT
);

CREATE TABLE environmental_controls.restriction (
  environment_id TEXT PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  source_authority TEXT, restriction_type TEXT, zone_name TEXT, status TEXT
);

CREATE SCHEMA IF NOT EXISTS rights_liabilities;
CREATE TABLE rights_liabilities.encumbrance (
  encumbrance_id TEXT PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  encumbrance_type_hi TEXT, encumbrance_type_en TEXT, reference_no TEXT,
  holder_name_hi TEXT, holder_name_en TEXT, status TEXT,
  litigation_flag BOOLEAN DEFAULT FALSE, court_case_reference TEXT
);
