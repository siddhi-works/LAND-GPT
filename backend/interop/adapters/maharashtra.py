"""Maharashtra adapter.

Native systems (from maharashtra/schema/maharashtra_schema.sql and research.md):
Mahabhulekh 7/12 + 8A (``bhulekh``), e-Ferfar mutations (``eferfar``), Registration &
Stamps documents (``registration``), City Survey Property Card (``property_card``) and
planning / building / encumbrance / tax / utilities / environment schemas.

Maharashtra specifics handled here: the native identifier *type* varies per parcel
(GAT_NO, KHASRA_NO, CTS_NO); 8A lists land-measurement numbers as a JSON array; e-Ferfar
records its initiating channel (registered document / order / e-Hakk); and utilities are a
single row carrying electricity, water and road-access status together.
"""
from __future__ import annotations

from ..canonical.model import (
    BuildingPermission,
    EnvironmentalRestriction,
    Encumbrance,
    LandRecord,
    Mutation,
    ParcelIdentifier,
    PlanningRecord,
    PropertyTax,
    Registration,
    UtilityService,
)
from ..normalize import to_date, to_float
from .base import REGISTRY_TABLE, SPATIAL_TABLE, RowContext, SourceSpec, StateAdapter


class MaharashtraAdapter(StateAdapter):
    state_code = "MH"
    state_name = "Maharashtra"
    language = "mr"
    sub_district_type = "taluka"
    specs = (
        SourceSpec(REGISTRY_TABLE, "MH.term.parcel_registry", "Parcel registry", ("ulpin",), ("parcel",)),
        SourceSpec(SPATIAL_TABLE, "MH.term.cadastral_polygon", "Cadastral parcel polygon", ("ulpin",), ("geometry",)),
        SourceSpec("bhulekh.record_712", "MH.term.satbara", "7/12", ("ulpin",), ("land_record", "ownership", "land_use")),
        SourceSpec("bhulekh.record_8a", "MH.term.8a", "8A", ("ulpin",), ("land_record", "ownership")),
        SourceSpec("property_card.record", "MH.term.property_card", "Property Card", ("property_uid",), ("land_record", "ownership")),
        SourceSpec("eferfar.ferfar", "MH.term.ferfar", "Ferfar", ("ferfar_no",), ("mutation",)),
        SourceSpec("registration.document", "MH.term.registered_document", "Registered document", ("document_no",), ("registration", "ownership")),
        SourceSpec("planning.record", "MH.term.planning_record", "Planning record", ("ulpin", "plan_name"), ("planning",)),
        SourceSpec("building.permission", "MH.term.building_permission", "Building permission", ("permission_no",), ("building_permission",)),
        SourceSpec("encumbrance.record", "MH.term.encumbrance_record", "Encumbrance record", ("reference_no",), ("encumbrance", "litigation")),
        SourceSpec("property_tax.record", "MH.term.property_tax", "Property tax record", ("property_id",), ("property_tax",)),
        SourceSpec("utilities.connection", "MH.term.utilities", "Utility connection", ("utility_id",), ("utilities",)),
        SourceSpec("environment.restriction", "MH.term.environment", "Environmental restriction", ("environment_id",), ("environmental_restriction",)),
    )

    # -- registry -----------------------------------------------------------------------
    def primary_identifier(self, ctx: RowContext) -> ParcelIdentifier:
        return ctx.ident(ctx.get("native_identifier_type"), ctx.get("native_identifier"), ctx.get("native_part"))

    def registry_accounts(self, ctx: RowContext) -> list[ParcelIdentifier]:
        acct = ctx.ident("KHATA_NO", ctx.get("khata_no"))
        return [acct] if acct else []

    # -- land records -------------------------------------------------------------------
    def land_records(self, ulpin: str) -> list[LandRecord]:
        out: list[LandRecord] = []
        for ctx in self.contexts("bhulekh.record_712", ulpin):
            ident = ctx.ident(ctx.get("land_identifier_type"), ctx.get("survey_gat_khasra_no"), ctx.get("survey_part"))
            acct = ctx.ident("KHATA_NO", ctx.get("khata_no"))
            fields = dict(
                record_class="record_of_rights",
                holders=[ctx.text("khatedar_name_en", "khatedar_name_mr")],
                area=ctx.area("total_area", "area_unit"),
                land_use=ctx.term("land_use", "land_use_en", "land_use_mr"),
                land_use_label=ctx.text("land_use_en", "land_use_mr"),
                record_status=ctx.term("record_status", "record_status"),
                encumbrance_noted=None,  # 7/12 rows in this dataset carry no other-rights column
                parcel_identifiers=[ident] if ident else [],
                account_identifiers=[acct] if acct else [],
                jurisdiction=ctx.jurisdiction("district", "taluka", "village"),
            )
            out.append(LandRecord(**fields, **ctx.envelope()))
        for ctx in self.contexts("bhulekh.record_8a", ulpin):
            idents = [
                ctx.ident(n.get("type"), n.get("number"), n.get("part"))
                for n in (ctx.get("land_measurement_numbers") or [])
            ]
            acct = ctx.ident("KHATA_NO", ctx.get("khata_no"))
            fields = dict(
                record_class="holding_account",
                holders=[ctx.text("khatedar_name_en", "khatedar_name_mr")],
                area=ctx.area("total_area", "area_unit"),
                record_status=ctx.term("record_status", "record_status"),
                parcel_identifiers=[i for i in idents if i],
                account_identifiers=[acct] if acct else [],
            )
            out.append(LandRecord(**fields, **ctx.envelope()))
        for ctx in self.contexts("property_card.record", ulpin):
            ident = ctx.ident("CTS_NO", ctx.get("cts_no"))
            fields = dict(
                record_class="urban_property_record",
                holders=[ctx.text("holder_name_en", "holder_name_mr")],
                area=ctx.area("area_value", "area_unit"),
                record_status=ctx.term("record_status", "record_status"),
                parcel_identifiers=[ident] if ident else [],
                jurisdiction=ctx.jurisdiction("district", None, "village_peth"),
            )
            out.append(LandRecord(**fields, **ctx.envelope()))
        return out

    # -- registration & mutation ----------------------------------------------------------
    def registrations(self, ulpin: str) -> list[Registration]:
        out = []
        for ctx in self.contexts("registration.document", ulpin):
            fields = dict(
                document_no=ctx.get("document_no"),
                document_type=ctx.term("document_type", "document_type"),
                document_type_label=ctx.text("document_type"),
                transaction_type=ctx.term("transaction_type", "transaction_type"),
                registration_date=to_date(ctx.get("registration_date")),
                sub_registrar_office=ctx.get("sub_registrar_office"),
                executants=[t for t in [ctx.text("seller_name_en", "seller_name_mr")] if t],
                claimants=[t for t in [ctx.text("buyer_name_en", "buyer_name_mr")] if t],
                consideration_inr=to_float(ctx.get("consideration_value")),
                status=ctx.term("registration_status", "registration_status"),
            )
            out.append(Registration(**fields, **ctx.envelope()))
        return out

    def mutations(self, ulpin: str) -> list[Mutation]:
        out = []
        for ctx in self.contexts("eferfar.ferfar", ulpin):
            ident = ctx.ident(ctx.get("land_identifier_type"), ctx.get("survey_gat_khasra_no"))
            fields = dict(
                mutation_no=ctx.get("ferfar_no"),
                register_name="Ferfar",
                kind=ctx.term("mutation_kind", "mutation_type_en", "mutation_type_mr"),
                kind_label=ctx.text("mutation_type_en", "mutation_type_mr"),
                basis=ctx.term("mutation_basis", "mutation_source_type"),
                application_no=ctx.get("application_no"),
                application_date=to_date(ctx.get("application_date")),
                status=ctx.term("mutation_status", "status_en", "status_mr"),
                status_label=ctx.text("status_en", "status_mr"),
                linked_document_no=ctx.get("document_no"),
                parcel_identifiers=[ident] if ident else [],
            )
            out.append(Mutation(**fields, **ctx.envelope()))
        return out

    # -- rights, planning, services --------------------------------------------------------
    def encumbrances(self, ulpin: str) -> list[Encumbrance]:
        return [self._encumbrance(c, type_native="encumbrance_type_mr", holder_native="holder_name_mr")
                for c in self.contexts("encumbrance.record", ulpin)]

    def planning(self, ulpin: str) -> list[PlanningRecord]:
        return [self._planning(c, plan_field="plan_name", zone_native="zone_name_mr")
                for c in self.contexts("planning.record", ulpin)]

    def building_permissions(self, ulpin: str) -> list[BuildingPermission]:
        out = []
        for ctx in self.contexts("building.permission", ulpin):
            fields = dict(
                permission_no=ctx.get("permission_no"),
                application_no=ctx.get("application_no"),
                authority=ctx.get("authority"),
                building_use=ctx.term("land_use", "building_use"),
                built_up_area_sqm=to_float(ctx.get("built_up_area_sqm")),
                approval_date=to_date(ctx.get("approval_date")),
                status=ctx.term("building_status", "status"),
            )
            out.append(BuildingPermission(**fields, **ctx.envelope()))
        return out

    def property_tax(self, ulpin: str) -> list[PropertyTax]:
        out = []
        for ctx in self.contexts("property_tax.record", ulpin):
            fields = dict(
                account_id=str(ctx.get("property_id")),
                assessment_year=ctx.get("assessment_year"),
                assessed_value_inr=to_float(ctx.get("assessed_value")),
                demand_inr=to_float(ctx.get("tax_amount")),
                paid_inr=to_float(ctx.get("paid_amount")),
                outstanding_inr=to_float(ctx.get("outstanding_amount")),
                status=ctx.term("tax_status", "status"),
            )
            out.append(PropertyTax(**fields, **ctx.envelope()))
        return out

    def utilities(self, ulpin: str) -> list[UtilityService]:
        """One native row -> three canonical services, each keeping the same provenance."""
        out = []
        spec = self.spec("utilities.connection")
        for row in self.rows("utilities.connection", ulpin):
            for service, field in (("electricity", "electricity_status"), ("water", "water_status"),
                                   ("road_access", "road_access")):
                if row.data.get(field) is None:
                    continue
                ctx = RowContext(self, spec, row, suffix=f"#{service}")
                status = ctx.term("utility_status", field)
                out.append(UtilityService(service=service, status=status, **ctx.envelope()))
        return out

    def environmental_restrictions(self, ulpin: str) -> list[EnvironmentalRestriction]:
        return [self._environment(c, authority_field=None) for c in self.contexts("environment.restriction", ulpin)]
