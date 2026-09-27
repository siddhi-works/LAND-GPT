"""Where each state's native tables live in the supplied filesystem dataset.

This is JSON-store configuration only. It maps each state's relational table name (from
``<state>/schema/<state>_schema.sql``) to the file — and, for multi-table files, the
top-level key — that holds its rows. ``spatial.cadastral_parcels`` is the GeoJSON layer;
its features are exposed as rows ``{**properties, "geometry": geometry}``, the natural
shape of a PostGIS table.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TableLocation:
    file: str
    key: str | None = None  # top-level key inside the file; None = file is a list
    geojson: bool = False


@dataclass(frozen=True)
class StateLayout:
    state_code: str
    directory: str
    tables: dict[str, TableLocation]


SPATIAL = TableLocation("spatial/cadastral_parcels.geojson", "features", geojson=True)

STATE_LAYOUTS: dict[str, StateLayout] = {
    "MH": StateLayout(
        "MH",
        "maharashtra",
        {
            "core.parcel_registry": TableLocation("seed/parcels.json"),
            "spatial.cadastral_parcels": SPATIAL,
            "bhulekh.record_712": TableLocation("seed/land_records.json", "record_712"),
            "bhulekh.record_8a": TableLocation("seed/land_records.json", "record_8a"),
            "eferfar.ferfar": TableLocation("seed/mutations.json"),
            "registration.document": TableLocation("seed/registrations.json"),
            "property_card.record": TableLocation("seed/property_cards.json"),
            "planning.record": TableLocation("seed/planning.json"),
            "building.permission": TableLocation("seed/building_permissions.json"),
            "encumbrance.record": TableLocation("seed/encumbrances.json"),
            "property_tax.record": TableLocation("seed/property_tax.json"),
            "utilities.connection": TableLocation("seed/utilities.json"),
            "environment.restriction": TableLocation("seed/environment.json"),
        },
    ),
    "UP": StateLayout(
        "UP",
        "uttar_pradesh",
        {
            "core.parcel_registry": TableLocation("seed/parcels.json"),
            "spatial.cadastral_parcels": SPATIAL,
            "revenue_land_records.khatauni": TableLocation("seed/land_records.json", "khatauni"),
            "revenue_land_records.khasra": TableLocation("seed/land_records.json", "khasra"),
            "revenue_mutation.namantaran": TableLocation("seed/mutations.json"),
            "stamps_registration.deed": TableLocation("seed/registrations.json"),
            "revenue_cadastral.bhu_naksha": TableLocation("seed/bhu_naksha.json"),
            "urban_planning.record": TableLocation("seed/planning.json"),
            "housing_authority.building_plan_approval": TableLocation("seed/building_permissions.json"),
            "urban_local_body.property_tax": TableLocation("seed/property_tax.json"),
            "power_distribution.electricity_connection": TableLocation("seed/utilities.json", "electricity_uppcl"),
            "water_services.connection": TableLocation("seed/utilities.json", "water_local_body"),
            "rights_liabilities.encumbrance": TableLocation("seed/encumbrances.json"),
            "environmental_controls.restriction": TableLocation("seed/environment.json"),
        },
    ),
    "GJ": StateLayout(
        "GJ",
        "gujarat",
        {
            "core.parcel_registry": TableLocation("seed/parcels.json"),
            "spatial.cadastral_parcels": SPATIAL,
            "e_dhara.vf7_12": TableLocation("seed/land_records.json", "vf7_12"),
            "e_dhara.vf8a": TableLocation("seed/land_records.json", "vf8a"),
            "e_dhara.vf6_mutation": TableLocation("seed/mutations.json"),
            "city_survey.property_card": TableLocation("seed/property_cards.json"),
            "registration_stamps.document": TableLocation("seed/registrations.json"),
            "planning.record": TableLocation("seed/planning.json"),
            "building_approval.plan_permission": TableLocation("seed/building_permissions.json"),
            "rights_liabilities.encumbrance": TableLocation("seed/encumbrances.json"),
            "urban_local_body.property_tax": TableLocation("seed/property_tax.json"),
            "power_distribution.connection": TableLocation("seed/utilities.json", "electricity"),
            "water_services.connection": TableLocation("seed/utilities.json", "water"),
            "environmental_controls.restriction": TableLocation("seed/environment.json"),
        },
    ),
}
