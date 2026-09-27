-- Gujarat Land Stack synthetic DB layer
-- State-specific grouping for Gujarat.

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS e_dhara;
CREATE SCHEMA IF NOT EXISTS city_survey;
CREATE SCHEMA IF NOT EXISTS registration_stamps;
CREATE SCHEMA IF NOT EXISTS planning;
CREATE SCHEMA IF NOT EXISTS building_approval;
CREATE SCHEMA IF NOT EXISTS rights_liabilities;
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
  taluka TEXT NOT NULL,
  village TEXT NOT NULL,
  survey_no TEXT NOT NULL,
  sub_division TEXT,
  record_of_rights_no TEXT,
  geometry_ref TEXT NOT NULL,
  geometry_geojson JSONB,
  centroid_lat NUMERIC(9,6),
  centroid_lon NUMERIC(9,6),
  geometry_area_hectare NUMERIC(14,6),
  land_record_area_hectare NUMERIC(14,6),
  quality_class TEXT NOT NULL CHECK (quality_class IN ('clean','messy'))
);

CREATE TABLE e_dhara.vf7_12 (
  ulpin TEXT PRIMARY KEY REFERENCES core.parcel_registry(ulpin),
  district TEXT NOT NULL, taluka TEXT NOT NULL, village TEXT NOT NULL,
  survey_no TEXT NOT NULL, sub_division TEXT, record_of_rights_no TEXT,
  khatedar_name_gu TEXT NOT NULL, khatedar_name_en TEXT NOT NULL,
  area_value NUMERIC(14,3) NOT NULL, area_unit TEXT NOT NULL,
  land_class_gu TEXT, land_class_en TEXT, assessment NUMERIC(14,2),
  other_rights_note TEXT, record_status TEXT NOT NULL
);

CREATE TABLE e_dhara.vf8a (
  ulpin TEXT PRIMARY KEY REFERENCES core.parcel_registry(ulpin),
  record_of_rights_no TEXT,
  holder_name_gu TEXT NOT NULL, holder_name_en TEXT NOT NULL,
  land_measurement_numbers JSONB NOT NULL,
  total_holding_area NUMERIC(14,3), area_unit TEXT,
  land_revenue NUMERIC(14,2), record_status TEXT
);

CREATE TABLE e_dhara.vf6_mutation (
  vf6_entry_no TEXT PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  application_no TEXT, mutation_type_gu TEXT, mutation_type_en TEXT,
  application_date DATE, survey_no TEXT, sub_division TEXT,
  record_of_rights_no TEXT, linked_document_no TEXT,
  status_gu TEXT, status_en TEXT
);

CREATE TABLE city_survey.property_card (
  property_card_no TEXT PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  city_survey_no TEXT NOT NULL, district TEXT, taluka TEXT,
  ward_no TEXT, sheet_no TEXT,
  holder_name_gu TEXT, holder_name_en TEXT,
  area_value NUMERIC(14,3), area_unit TEXT, record_status TEXT
);

CREATE TABLE registration_stamps.document (
  document_no TEXT PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  district TEXT, taluka TEXT, sub_registrar_office TEXT,
  document_type_gu TEXT, document_type_en TEXT, transaction_type TEXT,
  registration_date DATE,
  seller_name_gu TEXT, seller_name_en TEXT,
  buyer_name_gu TEXT, buyer_name_en TEXT,
  consideration_value NUMERIC(18,2), status TEXT
);

CREATE TABLE planning.record (
  planning_id BIGSERIAL PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  planning_authority TEXT, plan_reference TEXT, zone_code TEXT,
  zone_name_gu TEXT, zone_name_en TEXT, permitted_use TEXT, restriction_status TEXT
);

CREATE TABLE building_approval.plan_permission (
  approval_no TEXT PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  application_no TEXT, department_or_authority TEXT, service TEXT,
  building_use TEXT, built_up_area_sqm NUMERIC(14,2),
  approval_date DATE, status TEXT
);

CREATE TABLE rights_liabilities.encumbrance (
  encumbrance_id TEXT PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  encumbrance_type_gu TEXT, encumbrance_type_en TEXT, reference_no TEXT,
  holder_name_gu TEXT, holder_name_en TEXT, status TEXT,
  litigation_flag BOOLEAN DEFAULT FALSE, court_case_reference TEXT
);

CREATE TABLE urban_local_body.property_tax (
  property_tax_id TEXT PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  local_body TEXT, assessment_year TEXT, assessed_value NUMERIC(18,2),
  tax_demand NUMERIC(14,2), amount_paid NUMERIC(14,2),
  outstanding_amount NUMERIC(14,2), status TEXT
);

CREATE TABLE power_distribution.connection (
  utility_id TEXT PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  service_type TEXT, provider TEXT, distribution_company TEXT,
  consumer_account_no TEXT, connection_status TEXT, supply_category TEXT
);

CREATE TABLE water_services.connection (
  utility_id TEXT PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  service_type TEXT, provider TEXT, distribution_company TEXT,
  consumer_account_no TEXT, connection_status TEXT, supply_category TEXT
);

CREATE TABLE environmental_controls.restriction (
  environment_id TEXT PRIMARY KEY,
  ulpin TEXT REFERENCES core.parcel_registry(ulpin),
  source_authority TEXT, restriction_type TEXT, zone_name TEXT, status TEXT
);
