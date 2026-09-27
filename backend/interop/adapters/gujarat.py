"""Gujarat adapter.

Native systems (from gujarat/schema/gujarat_schema.sql and README.md): e-Dhara VF 7/12,
VF 8A and VF 6 mutation register (``e_dhara``), City Survey Property Card
(``city_survey``), Registration & Stamps (``registration_stamps``), planning, building
approval, rights & liabilities, ULB tax, power distribution, water services and
environmental controls.

Gujarat specifics: parcels are keyed by revenue Survey No. + sub-division and a Record of
Rights No.; VF 7/12 has an explicit other-rights note; Property Cards use a City Survey
No. — a *different* numbering scheme that is never compared with the Survey No.
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


class GujaratAdapter(StateAdapter):
    state_code = "GJ"
    state_name = "Gujarat"
    language = "gu"
    sub_district_type = "taluka"
    specs = (
        SourceSpec(REGISTRY_TABLE, "GJ.term.parcel_registry", "Parcel registry", ("ulpin",), ("parcel",)),
        SourceSpec(SPATIAL_TABLE, "GJ.term.cadastral_polygon", "Cadastral parcel polygon", ("ulpin",), ("geometry",)),
        SourceSpec("e_dhara.vf7_12", "GJ.term.vf7_12", "VF 7/12", ("ulpin",), ("land_record", "ownership", "land_use", "encumbrance")),
        SourceSpec("e_dhara.vf8a", "GJ.term.vf8a", "VF 8A", ("ulpin",), ("land_record", "ownership")),
        SourceSpec("e_dhara.vf6_mutation", "GJ.term.vf6", "VF 6", ("vf6_entry_no",), ("mutation",)),
        SourceSpec("city_survey.property_card", "GJ.term.property_card", "Property Card", ("property_card_no",), ("land_record", "ownership")),
        SourceSpec("registration_stamps.document", "GJ.term.registered_document", "Registered document", ("document_no",), ("registration", "ownership")),
        SourceSpec("planning.record", "GJ.term.planning", "Planning record", ("ulpin", "plan_reference"), ("planning",)),
        SourceSpec("building_approval.plan_permission", "GJ.term.building_approval", "Building Plan Approval", ("approval_no",), ("building_permission",)),
        SourceSpec("rights_liabilities.encumbrance", "GJ.term.encumbrance", "Encumbrance record", ("encumbrance_id",), ("encumbrance", "litigation")),
        SourceSpec("urban_local_body.property_tax", "GJ.term.property_tax", "ULB property tax", ("property_tax_id",), ("property_tax",)),
        SourceSpec("power_distribution.connection", "GJ.term.electricity", "Power connection", ("utility_id",), ("utilities",)),
        SourceSpec("water_services.connection", "GJ.term.water", "Water connection", ("utility_id",), ("utilities",)),
        SourceSpec("environmental_controls.restriction", "GJ.term.environment", "Environmental restriction", ("environment_id",), ("environmental_restriction",)),
    )

    # -- registry -----------------------------------------------------------------------
    def primary_identifier(self, ctx: RowContext) -> ParcelIdentifier:
        return ctx.ident("SURVEY_NO", ctx.get("survey_no"), ctx.get("sub_division"))

    def registry_accounts(self, ctx: RowContext) -> list[ParcelIdentifier]:
        acct = ctx.ident("ROR_NO", ctx.get("record_of_rights_no"))
        return [acct] if acct else []

    # -- land records -------------------------------------------------------------------
    def land_records(self, ulpin: str) -> list[LandRecord]:
        out: list[LandRecord] = []
        for ctx in self.contexts("e_dhara.vf7_12", ulpin):
            ident = ctx.ident("SURVEY_NO", ctx.get("survey_no"), ctx.get("sub_division"))
            acct = ctx.ident("ROR_NO", ctx.get("record_of_rights_no"))
            note = ctx.get("other_rights_note")
            fields = dict(
                record_class="record_of_rights",
                holders=[ctx.text("khatedar_name_en", "khatedar_name_gu")],
                area=ctx.area("area_value", "area_unit"),
                land_use=ctx.term("land_use", "land_class_en", "land_class_gu"),
                land_use_label=ctx.text("land_class_en", "land_class_gu"),
                record_status=ctx.term("record_status", "record_status"),
                # VF 7/12 carries an explicit other-rights column: empty means nothing annotated.
                encumbrance_noted=bool(note and str(note).strip()),
                parcel_identifiers=[ident] if ident else [],
                account_identifiers=[acct] if acct else [],
                jurisdiction=ctx.jurisdiction("district", "taluka", "village"),
            )
            out.append(LandRecord(**fields, **ctx.envelope()))
        for ctx in self.contexts("e_dhara.vf8a", ulpin):
            idents = [
                ctx.ident("SURVEY_NO", n.get("survey_no"), n.get("sub_division"))
                for n in (ctx.get("land_measurement_numbers") or [])
            ]
            acct = ctx.ident("ROR_NO", ctx.get("record_of_rights_no"))
            fields = dict(
                record_class="holding_account",
                holders=[ctx.text("holder_name_en", "holder_name_gu")],
                area=ctx.area("total_holding_area", "area_unit"),
                record_status=ctx.term("record_status", "record_status"),
                parcel_identifiers=[i for i in idents if i],
                account_identifiers=[acct] if acct else [],
            )
            out.append(LandRecord(**fields, **ctx.envelope()))
        for ctx in self.contexts("city_survey.property_card", ulpin):
            ident = ctx.ident("CITY_SURVEY_NO", ctx.get("city_survey_no"))
            fields = dict(
                record_class="urban_property_record",
                holders=[ctx.text("holder_name_en", "holder_name_gu")],
                area=ctx.area("area_value", "area_unit"),
                record_status=ctx.term("record_status", "record_status"),
                parcel_identifiers=[ident] if ident else [],
                jurisdiction=ctx.jurisdiction("district", "taluka", None),
            )
            out.append(LandRecord(**fields, **ctx.envelope()))
        return out

    # -- registration & mutation ----------------------------------------------------------
    def registrations(self, ulpin: str) -> list[Registration]:
        out = []
        for ctx in self.contexts("registration_stamps.document", ulpin):
            fields = dict(
                document_no=ctx.get("document_no"),
                document_type=ctx.term("document_type", "document_type_en", "document_type_gu"),
                document_type_label=ctx.text("document_type_en", "document_type_gu"),
                transaction_type=ctx.term("transaction_type", "transaction_type"),
                registration_date=to_date(ctx.get("registration_date")),
                sub_registrar_office=ctx.get("sub_registrar_office"),
                executants=[t for t in [ctx.text("seller_name_en", "seller_name_gu")] if t],
                claimants=[t for t in [ctx.text("buyer_name_en", "buyer_name_gu")] if t],
                consideration_inr=to_float(ctx.get("consideration_value")),
                status=ctx.term("registration_status", "status"),
                jurisdiction=ctx.jurisdiction("district", "taluka", None),
            )
            out.append(Registration(**fields, **ctx.envelope()))
        return out

    def mutations(self, ulpin: str) -> list[Mutation]:
        out = []
        for ctx in self.contexts("e_dhara.vf6_mutation", ulpin):
            ident = ctx.ident("SURVEY_NO", ctx.get("survey_no"), ctx.get("sub_division"))
            acct = ctx.ident("ROR_NO", ctx.get("record_of_rights_no"))
            fields = dict(
                mutation_no=ctx.get("vf6_entry_no"),
                register_name="VF 6",
                kind=ctx.term("mutation_kind", "mutation_type_en", "mutation_type_gu"),
                kind_label=ctx.text("mutation_type_en", "mutation_type_gu"),
                application_no=ctx.get("application_no"),
                application_date=to_date(ctx.get("application_date")),
                status=ctx.term("mutation_status", "status_en", "status_gu"),
                status_label=ctx.text("status_en", "status_gu"),
                linked_document_no=ctx.get("linked_document_no"),
                parcel_identifiers=[ident] if ident else [],
                account_identifiers=[acct] if acct else [],
            )
            out.append(Mutation(**fields, **ctx.envelope()))
        return out

    # -- rights, planning, services --------------------------------------------------------
    def encumbrances(self, ulpin: str) -> list[Encumbrance]:
        return [self._encumbrance(c, type_native="encumbrance_type_gu", holder_native="holder_name_gu")
                for c in self.contexts("rights_liabilities.encumbrance", ulpin)]

    def planning(self, ulpin: str) -> list[PlanningRecord]:
        return [self._planning(c, plan_field="plan_reference", zone_native="zone_name_gu")
                for c in self.contexts("planning.record", ulpin)]

    def building_permissions(self, ulpin: str) -> list[BuildingPermission]:
        out = []
        for ctx in self.contexts("building_approval.plan_permission", ulpin):
            fields = dict(
                permission_no=ctx.get("approval_no"),
                application_no=ctx.get("application_no"),
                authority=ctx.get("department_or_authority"),
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
        for table, service in (("power_distribution.connection", "electricity"), ("water_services.connection", "water")):
            for ctx in self.contexts(table, ulpin):
                fields = dict(
                    service=service,
                    provider=ctx.get("provider"),
                    distribution_company=ctx.get("distribution_company"),
                    account_no=ctx.get("consumer_account_no"),
                    status=ctx.term("utility_status", "connection_status"),
                    supply_category=ctx.get("supply_category"),
                )
                out.append(UtilityService(**fields, **ctx.envelope()))
        return out

    def environmental_restrictions(self, ulpin: str) -> list[EnvironmentalRestriction]:
        return [self._environment(c, authority_field="source_authority")
                for c in self.contexts("environmental_controls.restriction", ulpin)]
