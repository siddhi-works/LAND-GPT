"""Uttar Pradesh adapter.

Native systems (from uttar_pradesh/schema/uttar_pradesh_schema.sql and research.md):
UP Bhulekh Khatauni + Khasra (``revenue_land_records``), Namantaran/Varasat mutation
(``revenue_mutation``), BhuNaksha cadastral maps (``revenue_cadastral``), IGRSUP deeds
(``stamps_registration``), Development Authority planning (``urban_planning``), Housing
Department building plan approval (``housing_authority``), ULB tax, UPPCL electricity and
local-body water as separate systems, rights & liabilities, environmental controls.

There is deliberately no Property Card source for UP; nothing is synthesised for it.
UP specifics: the Khasra is a plot register without holders; Namantaran and Varasat share
one register but are different mutation kinds; BhuNaksha carries its own map area.
"""
from __future__ import annotations

from ..canonical.model import (
    BuildingPermission,
    CadastralMapRecord,
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
from ..normalize import norm_term, to_date, to_float
from .base import REGISTRY_TABLE, SPATIAL_TABLE, RowContext, SourceSpec, StateAdapter

SCHEME = "GATA_KHASRA_NO"


class UttarPradeshAdapter(StateAdapter):
    state_code = "UP"
    state_name = "Uttar Pradesh"
    language = "hi"
    sub_district_type = "tehsil"
    specs = (
        SourceSpec(REGISTRY_TABLE, "UP.term.parcel_registry", "Parcel registry", ("ulpin",), ("parcel",)),
        SourceSpec(SPATIAL_TABLE, "UP.term.cadastral_polygon", "Cadastral parcel polygon", ("ulpin",), ("geometry",)),
        SourceSpec("revenue_land_records.khatauni", "UP.term.khatauni", "Khatauni", ("ulpin",), ("land_record", "ownership", "land_use")),
        SourceSpec("revenue_land_records.khasra", "UP.term.khasra", "Khasra", ("khasra_id",), ("land_record",)),
        SourceSpec("revenue_mutation.namantaran", "UP.term.namantaran", "Namantaran", ("mutation_no",), ("mutation",)),
        SourceSpec("stamps_registration.deed", "UP.term.igrsup_deed", "IGRSUP deed", ("document_no",), ("registration", "ownership")),
        SourceSpec("revenue_cadastral.bhu_naksha", "UP.term.bhunaksha", "BhuNaksha map record", ("map_ref",), ("geometry",)),
        SourceSpec("urban_planning.record", "UP.term.planning", "Development Authority zoning", ("ulpin", "plan_reference"), ("planning",)),
        SourceSpec("housing_authority.building_plan_approval", "UP.term.building_plan_approval", "Building Plan Approval", ("approval_no",), ("building_permission",)),
        SourceSpec("urban_local_body.property_tax", "UP.term.property_tax", "ULB property tax", ("property_tax_id",), ("property_tax",)),
        SourceSpec("power_distribution.electricity_connection", "UP.term.electricity", "UPPCL connection", ("utility_id",), ("utilities",)),
        SourceSpec("water_services.connection", "UP.term.water", "Water connection", ("water_connection_id",), ("utilities",)),
        SourceSpec("rights_liabilities.encumbrance", "UP.term.encumbrance", "Encumbrance record", ("encumbrance_id",), ("encumbrance", "litigation")),
        SourceSpec("environmental_controls.restriction", "UP.term.environment", "Environmental restriction", ("environment_id",), ("environmental_restriction",)),
    )

    # -- registry -----------------------------------------------------------------------
    def primary_identifier(self, ctx: RowContext) -> ParcelIdentifier:
        return ctx.ident(SCHEME, ctx.get("gatta_khasra_no"), ctx.get("sub_division"))

    def registry_accounts(self, ctx: RowContext) -> list[ParcelIdentifier]:
        acct = ctx.ident("KHATA_NO", ctx.get("khata_no"))
        return [acct] if acct else []

    # -- land records -------------------------------------------------------------------
    def land_records(self, ulpin: str) -> list[LandRecord]:
        out: list[LandRecord] = []
        for ctx in self.contexts("revenue_land_records.khatauni", ulpin):
            ident = ctx.ident(SCHEME, ctx.get("gatta_khasra_no"), ctx.get("sub_division"))
            acct = ctx.ident("KHATA_NO", ctx.get("khata_no"))
            fields = dict(
                record_class="record_of_rights",
                holders=[ctx.text("khatedar_name_en", "khatedar_name_hi")],
                area=ctx.area("area_value", "area_unit"),
                land_use=ctx.term("land_use", "land_class_en", "land_class_hi"),
                land_use_label=ctx.text("land_class_en", "land_class_hi"),
                record_status=ctx.term("record_status", "record_status"),
                # transfer_restriction / possession_status stay in `native`: a transfer
                # restriction is not the same fact as an annotated encumbrance.
                encumbrance_noted=None,
                parcel_identifiers=[ident] if ident else [],
                account_identifiers=[acct] if acct else [],
                jurisdiction=ctx.jurisdiction("district", "tehsil", "village"),
            )
            out.append(LandRecord(**fields, **ctx.envelope()))
        for ctx in self.contexts("revenue_land_records.khasra", ulpin):
            ident = ctx.ident(SCHEME, ctx.get("khasra_no"), ctx.get("sub_division"))
            ctx.term("crop_status", "crop_status_en", "crop_status_hi")  # interpreted; kept in term_mappings
            fields = dict(
                record_class="plot_register",
                holders=[],  # the Khasra does not name holders
                area=ctx.area("area_value", "area_unit"),
                record_status=ctx.term("record_status", "record_status"),
                parcel_identifiers=[ident] if ident else [],
                jurisdiction=ctx.jurisdiction("district", "tehsil", "village"),
            )
            out.append(LandRecord(**fields, **ctx.envelope()))
        return out

    # -- registration & mutation ----------------------------------------------------------
    def registrations(self, ulpin: str) -> list[Registration]:
        out = []
        for ctx in self.contexts("stamps_registration.deed", ulpin):
            fields = dict(
                document_no=ctx.get("document_no"),
                document_type=ctx.term("document_type", "document_type_en", "document_type_hi"),
                document_type_label=ctx.text("document_type_en", "document_type_hi"),
                transaction_type=ctx.term("transaction_type", "transaction_type"),
                registration_date=to_date(ctx.get("registration_date")),
                sub_registrar_office=ctx.get("sub_registrar_office"),
                executants=[t for t in [ctx.text("seller_name_en", "seller_name_hi")] if t],
                claimants=[t for t in [ctx.text("buyer_name_en", "buyer_name_hi")] if t],
                consideration_inr=to_float(ctx.get("consideration_value")),
                stamp_duty_inr=to_float(ctx.get("stamp_duty")),
                registration_fee_inr=to_float(ctx.get("registration_fee")),
                status=ctx.term("registration_status", "status"),
                jurisdiction=ctx.jurisdiction("district", "tehsil", None),
            )
            out.append(Registration(**fields, **ctx.envelope()))
        return out

    def mutations(self, ulpin: str) -> list[Mutation]:
        out = []
        spec = self.spec("revenue_mutation.namantaran")
        for row in self.rows("revenue_mutation.namantaran", ulpin):
            # Namantaran and Varasat share one register; the record type follows the process.
            is_varasat = norm_term(row.data.get("process_type_en")) == "varasat"
            ctx = RowContext(self, spec, row,
                             term_id="UP.term.varasat" if is_varasat else "UP.term.namantaran",
                             native_record_type="Varasat" if is_varasat else "Namantaran")
            ident = ctx.ident(SCHEME, ctx.get("khasra_no"))
            acct = ctx.ident("KHATA_NO", ctx.get("khata_no"))
            fields = dict(
                mutation_no=ctx.get("mutation_no"),
                register_name="Namantaran",
                kind=ctx.term("mutation_kind", "process_type_en", "process_type_hi"),
                kind_label=ctx.text("process_type_en", "process_type_hi"),
                application_no=ctx.get("application_no"),
                application_date=to_date(ctx.get("application_date")),
                status=ctx.term("mutation_status", "status_en", "status_hi"),
                status_label=ctx.text("status_en", "status_hi"),
                linked_document_no=ctx.get("linked_document_no"),
                order_no=ctx.get("order_no"),
                parcel_identifiers=[ident] if ident else [],
                account_identifiers=[acct] if acct else [],
            )
            out.append(Mutation(**fields, **ctx.envelope()))
        return out

    # -- cadastral map ------------------------------------------------------------------
    def cadastral_maps(self, ulpin: str) -> list[CadastralMapRecord]:
        out = []
        for ctx in self.contexts("revenue_cadastral.bhu_naksha", ulpin):
            ident = ctx.ident(SCHEME, ctx.get("plot_no"), ctx.get("sub_division"))
            fields = dict(
                map_ref=ctx.get("map_ref"),
                plot_no=ctx.get("plot_no"),
                sub_division=ctx.get("sub_division"),
                map_area=ctx.area("map_area", "area_unit", basis="cadastral_map"),
                map_status=ctx.term("map_status", "map_status"),
                layers=list(ctx.get("layers") or []),
                parcel_identifiers=[ident] if ident else [],
                jurisdiction=ctx.jurisdiction("district", "tehsil", "village"),
            )
            out.append(CadastralMapRecord(**fields, **ctx.envelope()))
        return out

    # -- rights, planning, services --------------------------------------------------------
    def encumbrances(self, ulpin: str) -> list[Encumbrance]:
        return [self._encumbrance(c, type_native="encumbrance_type_hi", holder_native="holder_name_hi")
                for c in self.contexts("rights_liabilities.encumbrance", ulpin)]

    def planning(self, ulpin: str) -> list[PlanningRecord]:
        return [self._planning(c, plan_field="plan_reference", zone_native="zone_name_hi")
                for c in self.contexts("urban_planning.record", ulpin)]

    def building_permissions(self, ulpin: str) -> list[BuildingPermission]:
        out = []
        for ctx in self.contexts("housing_authority.building_plan_approval", ulpin):
            fields = dict(
                permission_no=ctx.get("approval_no"),
                application_no=ctx.get("application_no"),
                authority=ctx.get("approving_authority"),
                department=ctx.get("department"),
                service=ctx.get("service"),
                building_use=ctx.term("land_use", "building_use"),
                built_up_area_sqm=to_float(ctx.get("built_up_area_sqm")),
                approval_date=to_date(ctx.get("approval_date")),
                status=ctx.term("building_status", "status"),
            )
            out.append(BuildingPermission(**fields, **ctx.envelope()))
        return out

    def property_tax(self, ulpin: str) -> list[PropertyTax]:
        return [self._ulb_tax(c) for c in self.contexts("urban_local_body.property_tax", ulpin)]

    def utilities(self, ulpin: str) -> list[UtilityService]:
        out = []
        for ctx in self.contexts("power_distribution.electricity_connection", ulpin):
            fields = dict(
                service="electricity",
                provider=ctx.get("provider"),
                distribution_company=ctx.get("discom"),
                account_no=ctx.get("consumer_account_no"),
                status=ctx.term("utility_status", "connection_status"),
                supply_category=ctx.get("supply_category"),
            )
            out.append(UtilityService(**fields, **ctx.envelope()))
        for ctx in self.contexts("water_services.connection", ulpin):
            fields = dict(
                service="water",
                provider=ctx.get("provider"),
                account_no=ctx.get("connection_number"),
                status=ctx.term("utility_status", "connection_status"),
            )
            out.append(UtilityService(**fields, **ctx.envelope()))
        return out

    def environmental_restrictions(self, ulpin: str) -> list[EnvironmentalRestriction]:
        return [self._environment(c, authority_field="source_authority")
                for c in self.contexts("environmental_controls.restriction", ulpin)]
