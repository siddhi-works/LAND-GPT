"""Land Stack Assistant: answers questions about one parcel, grounded strictly in the parcel's
retrieved Land Stack data (registry entry, canonical records, validation findings).

Requires an Anthropic API key in ``ANTHROPIC_API_KEY`` (or ``ANTHROPIC_AUTH_TOKEN``).
Model: ``LANDSTACK_ASSISTANT_MODEL`` (default ``claude-opus-5-5``).
When no credential is configured the assistant reports that it is unavailable; it never
fabricates an answer.
"""
from __future__ import annotations

import json
import os
from typing import Any

from .portal import native_label
from .service import LandStackService

DEFAULT_MODEL = "claude-opus-5-5"
_FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"}  # models that accept server-side refusal fallbacks

SYSTEM_PROMPT = """You are the Land Stack Assistant used by citizens and revenue officers in Maharashtra, Uttar Pradesh and Gujarat.

You answer questions about ONE land parcel using ONLY the JSON inside <parcel_context>. That context was retrieved from the Land Stack interoperability layer: the ULPIN registry, canonical records from the connected state systems (each with its source system, native table and record key), and findings from the deterministic cross-source validation engine (rule id, severity, compared values and sources).

Rules:
- Use only facts present in the context. If something is not in the context, say it is not available in the connected records. Never guess owners, areas, dates, amounts or legal outcomes.
- Keep state terminology as it appears (7/12, 8A, Ferfar, Khatauni, Khasra, Namantaran, BhuNaksha, VF 6, VF 7/12, VF 8A, Property Card).
- When explaining a flag, name the rule id, the sources that were compared and the values from each source.
- Cite the records you rely on in square brackets using their source table and key, e.g. [eferfar.ferfar FF-2038-0313] or [rule GIS-001].
- Be concise and plain; use short paragraphs or a short list. No legal advice: describe what the records show and which office handles the relevant process."""


def configured() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def model() -> str:
    return os.environ.get("LANDSTACK_ASSISTANT_MODEL", DEFAULT_MODEL)


def status() -> dict[str, Any]:
    return {
        "configured": configured(),
        "model": model(),
        "required_env": "ANTHROPIC_API_KEY",
        "optional_env": ["LANDSTACK_ASSISTANT_MODEL"],
        "grounding": "registry entry + canonical records + validation findings for the selected ULPIN",
    }


def context(svc: LandStackService, ulpin: str) -> dict[str, Any]:
    """Deterministic, compact grounding context for one parcel (also shown to the user)."""
    b = svc.bundle(ulpin)
    rep = svc.verification(ulpin)
    i = b.identity

    def rec(r, **fields):
        p = r.provenance
        return {"source": f"{p.source_table} {'/'.join(str(v) for v in p.record_key.values())}",
                "record_type": r.native_record_type, "source_system": p.source_system, **fields}

    records = []
    for lr in b.land_records:
        records.append(rec(lr, concept="land_record", record_class=lr.record_class,
                           holders=[h.en for h in lr.holders], area_ha=lr.area.value_ha if lr.area else None,
                           land_use=lr.land_use, status=lr.record_status))
    for r in b.registrations:
        records.append(rec(r, concept="registration", document_no=r.document_no, document_type=r.document_type,
                           registration_date=str(r.registration_date), transferee=[c.en for c in r.claimants],
                           transferor=[c.en for c in r.executants], consideration_inr=r.consideration_inr))
    for m in b.mutations:
        records.append(rec(m, concept="mutation", mutation_no=m.mutation_no, register=m.register_name, kind=m.kind,
                           kind_label=m.kind_label.en if m.kind_label else None, status=m.status,
                           application_date=str(m.application_date), linked_document=m.linked_document_no))
    for e in b.encumbrances:
        records.append(rec(e, concept="encumbrance", type=e.encumbrance_type, reference=e.reference_no,
                           holder=e.holder.en if e.holder else None, status=e.status,
                           litigation_flag=e.litigation_flag, court_case=e.court_case_reference))
    for p in b.planning:
        records.append(rec(p, concept="planning", zone=p.zone_code, permitted_use=p.permitted_use, restriction=p.restriction))
    for bp in b.building_permissions:
        records.append(rec(bp, concept="building_permission", permission_no=bp.permission_no, use=bp.building_use,
                           built_up_sqm=bp.built_up_area_sqm, status=bp.status))
    for t in b.property_tax:
        records.append(rec(t, concept="property_tax", year=t.assessment_year, assessed_inr=t.assessed_value_inr,
                           demand_inr=t.demand_inr, outstanding_inr=t.outstanding_inr, status=t.status))
    for u in b.utilities:
        records.append(rec(u, concept="utilities", service=u.service, status=u.status, provider=u.provider))
    for e in b.environmental_restrictions:
        records.append(rec(e, concept="environmental_restriction", type=e.restriction_label, status=e.status))
    for g in b.geometry:
        records.append(rec(g, concept="geometry", computed_area_ha=g.computed_area.value_ha if g.computed_area else None,
                           method=g.computed_area.method if g.computed_area else None, vertices=g.vertex_count))
    for cm in b.cadastral_maps:
        records.append(rec(cm, concept="geometry", map_ref=cm.map_ref, map_area_ha=cm.map_area.value_ha if cm.map_area else None))

    return {
        "ulpin": i.ulpin,
        "state": i.state_name,
        "jurisdiction": i.jurisdiction.model_dump(exclude={"state_code"}),
        "native_identifier": native_label(b),
        "registry": {"land_record_area_ha": i.land_record_area.value_ha if i.land_record_area else None,
                     "declared_gis_area_ha": i.declared_gis_area.value_ha if i.declared_gis_area else None,
                     "context": i.context},
        "records": records,
        "validation": {
            "as_of": str(rep.as_of), "risk_level": rep.risk_level, "checks": rep.summary["checks"],
            "findings": [{"rule": f.rule_id, "name": f.rule_name, "severity": f.severity, "status": f.status,
                          "explained_by": f.explained_by, "message": f.message, "expectation": f.expectation,
                          "metrics": f.metrics,
                          "compared": [{"source": f"{o.source_table}", "record_type": o.native_record_type,
                                        "field": o.field, "value": o.value} for o in f.observations]}
                         for f in rep.findings],
            "passed_rules": [c.rule_id for c in rep.checks if c.outcome == "pass"],
        },
    }


class AssistantUnavailable(RuntimeError):
    pass


def anthropic_complete(system: str, messages: list[dict[str, Any]], effort: str = "medium") -> dict[str, Any]:
    """One Messages API call. ``messages`` alternate user/assistant and end with a user turn.
    Raises AssistantUnavailable on missing/invalid credentials or service errors."""
    if not configured():
        raise AssistantUnavailable("No Anthropic credential is configured. Set ANTHROPIC_API_KEY on the API server.")
    import anthropic

    m = model()
    kwargs: dict[str, Any] = dict(
        model=m,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        output_config={"effort": effort},
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=messages,
    )
    client = anthropic.Anthropic()
    try:
        if m in _FALLBACK_MODELS:
            response = client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs)
        else:
            response = client.messages.create(**kwargs)
    except anthropic.AuthenticationError as e:
        raise AssistantUnavailable("The configured Anthropic credential was rejected.") from e
    except anthropic.RateLimitError as e:
        raise AssistantUnavailable("The assistant is rate limited; try again shortly.") from e
    except anthropic.APIStatusError as e:
        raise AssistantUnavailable(f"The assistant service returned an error ({e.status_code}).") from e
    except anthropic.APIConnectionError as e:
        raise AssistantUnavailable("The assistant service could not be reached.") from e

    if response.stop_reason == "refusal":
        text = "The assistant declined to answer this question."
    else:
        text = "".join(block.text for block in response.content if block.type == "text").strip()
    return {"text": text, "model": response.model, "stop_reason": response.stop_reason,
            "usage": {"input_tokens": response.usage.input_tokens, "output_tokens": response.usage.output_tokens}}


def ask(svc: LandStackService, ulpin: str, question: str) -> dict[str, Any]:
    if not configured():
        raise AssistantUnavailable("The Land Stack Assistant is not configured. Set ANTHROPIC_API_KEY on the API server.")
    ctx = context(svc, ulpin)
    ctx_json = json.dumps(ctx, ensure_ascii=False, sort_keys=True, default=str)
    r = anthropic_complete(SYSTEM_PROMPT, [{"role": "user", "content": f"<parcel_context>\n{ctx_json}\n</parcel_context>\n\nQuestion: {question.strip()}"}])
    return {
        "ulpin": ctx["ulpin"],
        "question": question,
        "answer": r["text"],
        "model": r["model"],
        "stop_reason": r["stop_reason"],
        "grounding": {"records": [x["source"] for x in ctx["records"]],
                      "rules": [f["rule"] for f in ctx["validation"]["findings"]]},
        "usage": r["usage"],
    }
