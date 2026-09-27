-- Maharashtra Land Stack synthetic DB
-- PostgreSQL. Synthetic prototype; not a government schema.

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS bhulekh;
CREATE SCHEMA IF NOT EXISTS eferfar;
CREATE SCHEMA IF NOT EXISTS registration;
CREATE SCHEMA IF NOT EXISTS property_card;
CREATE SCHEMA IF NOT EXISTS planning;
CREATE SCHEMA IF NOT EXISTS building;
CREATE SCHEMA IF NOT EXISTS encumbrance;
CREATE SCHEMA IF NOT EXISTS property_tax;
CREATE SCHEMA IF NOT EXISTS utilities;
CREATE SCHEMA IF NOT EXISTS environment;

CREATE TABLE core.parcel_registry (
    ulpin TEXT PRIMARY KEY,
    prototype_ref TEXT UNIQUE NOT NULL,
    state TEXT NOT NULL,
    context TEXT NOT NULL,
    district TEXT NOT NULL,
    taluka TEXT NOT NULL,
    village TEXT NOT NULL,
    native_identifier_type TEXT NOT NULL,
    native_identifier TEXT NOT NULL,
    native_part TEXT,
    khata_no TEXT,
    geometry_ref TEXT NOT NULL,
  geometry_geojson JSONB,
    centroid_lat NUMERIC(9,6),
    centroid_lon NUMERIC(9,6),
    geometry_area_hectare NUMERIC(14,6),
    land_record_area_hectare NUMERIC(14,6),
    quality_class TEXT NOT NULL CHECK (quality_class IN ('clean','messy'))
);

CREATE TABLE bhulekh.record_712 (
    ulpin TEXT PRIMARY KEY REFERENCES core.parcel_registry(ulpin),
    district TEXT NOT NULL, taluka TEXT NOT NULL, village TEXT NOT NULL,
    land_identifier_type TEXT NOT NULL, survey_gat_khasra_no TEXT NOT NULL, survey_part TEXT,
    khata_no TEXT, khatedar_name_mr TEXT NOT NULL, khatedar_name_en TEXT NOT NULL,
    total_area NUMERIC(14,3) NOT NULL, khatedar_area NUMERIC(14,3) NOT NULL,
    area_unit TEXT NOT NULL, land_use_mr TEXT, land_use_en TEXT,
    assessment NUMERIC(14,2), record_status TEXT NOT NULL
);

CREATE TABLE bhulekh.record_8a (
    ulpin TEXT PRIMARY KEY REFERENCES core.parcel_registry(ulpin),
    khata_no TEXT, khatedar_name_mr TEXT, khatedar_name_en TEXT,
    land_measurement_numbers JSONB NOT NULL,
    total_area NUMERIC(14,3), cultivable_area NUMERIC(14,3), non_cultivable_area NUMERIC(14,3),
    area_unit TEXT, land_revenue NUMERIC(14,2), record_status TEXT
);

CREATE TABLE eferfar.ferfar (
    ferfar_no TEXT PRIMARY KEY,
    ulpin TEXT REFERENCES core.parcel_registry(ulpin),
    application_no TEXT, mutation_source_type TEXT NOT NULL,
    mutation_type_mr TEXT, mutation_type_en TEXT,
    application_date DATE, status_mr TEXT, status_en TEXT,
    land_identifier_type TEXT, survey_gat_khasra_no TEXT, document_no TEXT
);

CREATE TABLE registration.document (
    document_no TEXT PRIMARY KEY,
    ulpin TEXT REFERENCES core.parcel_registry(ulpin),
    sub_registrar_office TEXT, document_type TEXT, transaction_type TEXT,
    registration_date DATE,
    seller_name_mr TEXT, seller_name_en TEXT,
    buyer_name_mr TEXT, buyer_name_en TEXT,
    consideration_value NUMERIC(18,2), registration_status TEXT
);

CREATE TABLE property_card.record (
    property_uid TEXT PRIMARY KEY,
    ulpin TEXT REFERENCES core.parcel_registry(ulpin),
    cts_no TEXT NOT NULL, district TEXT, city_survey_office TEXT, village_peth TEXT,
    holder_name_mr TEXT, holder_name_en TEXT,
    area_value NUMERIC(14,3), area_unit TEXT, tenure_type TEXT, record_status TEXT
);

CREATE TABLE planning.record (
    planning_id BIGSERIAL PRIMARY KEY,
    ulpin TEXT REFERENCES core.parcel_registry(ulpin),
    planning_authority TEXT, plan_name TEXT, zone_code TEXT,
    zone_name_mr TEXT, zone_name_en TEXT, permitted_use TEXT, restriction_status TEXT
);

CREATE TABLE building.permission (
    permission_no TEXT PRIMARY KEY,
    ulpin TEXT REFERENCES core.parcel_registry(ulpin),
    application_no TEXT, authority TEXT, building_use TEXT,
    built_up_area_sqm NUMERIC(14,2), approval_date DATE, status TEXT
);

CREATE TABLE encumbrance.record (
    encumbrance_id BIGSERIAL PRIMARY KEY,
    ulpin TEXT REFERENCES core.parcel_registry(ulpin),
    encumbrance_type_mr TEXT, encumbrance_type_en TEXT, reference_no TEXT,
    holder_name_mr TEXT, holder_name_en TEXT, status TEXT,
    litigation_flag BOOLEAN NOT NULL DEFAULT FALSE, court_case_reference TEXT
);

CREATE TABLE property_tax.record (
    property_id TEXT PRIMARY KEY,
    ulpin TEXT REFERENCES core.parcel_registry(ulpin),
    assessment_year TEXT, assessed_value NUMERIC(18,2),
    tax_amount NUMERIC(14,2), paid_amount NUMERIC(14,2),
    outstanding_amount NUMERIC(14,2), status TEXT
);

CREATE TABLE utilities.connection (
    utility_id TEXT PRIMARY KEY,
    ulpin TEXT REFERENCES core.parcel_registry(ulpin),
    electricity_status TEXT, water_status TEXT, road_access TEXT
);

CREATE TABLE environment.restriction (
    environment_id TEXT PRIMARY KEY,
    ulpin TEXT REFERENCES core.parcel_registry(ulpin),
    restriction_type TEXT, zone_name TEXT, status TEXT
);
