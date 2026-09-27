"""Validation engine: runs every rule over a normalized parcel bundle and links explanations.

The engine is read-only with respect to sources: it consumes canonical bundles built by the
adapters and returns new result objects. Nothing is written anywhere.
"""
from __future__ import annotations

from datetime import date

from ..canonical.model import ParcelBundle
from ..config import ENGINE_VERSION, Tolerances
from ..geo import outer_ring
from ..glossary import Glossary
from .model import SEVERITY_RANK, CheckResult, Finding, RuleSpec, VerificationReport
from .rules import RULES, Evaluation, RuleContext, StateIndex

# (finding rule, explaining rule, shared related-key prefix): a finding of the first rule is
# "explained" by a finding of the second rule that shares a related key with that prefix.
EXPLANATIONS: tuple[tuple[str, str, str], ...] = (
    ("OWN-002", "MUT-001", "document:"),
)


def rule_specs() -> list[RuleSpec]:
    return [spec for spec, _ in RULES]


def build_state_index(bundles: list[ParcelBundle]) -> StateIndex:
    idx = StateIndex()
    for b in bundles:
        for r in b.registrations:
            idx.documents[r.document_no] = b.identity.ulpin
        for m in b.mutations:
            if m.linked_document_no:
                idx.mutation_document_refs.add(m.linked_document_no)
        for g in b.geometry[:1]:
            ring = outer_ring(g.geometry)
            if ring is not None:
                idx.rings[b.identity.ulpin] = ring
    return idx


def _link_explanations(findings: list[Finding]) -> list[Finding]:
    out = []
    for f in findings:
        explained_by = []
        for target, explainer, prefix in EXPLANATIONS:
            if f.rule_id != target:
                continue
            keys = {k for k in f.related_keys if k.startswith(prefix)}
            explained_by += [g.finding_id for g in findings
                             if g.rule_id == explainer and keys & set(g.related_keys)]
        out.append(f.model_copy(update={"status": "explained", "explained_by": explained_by}) if explained_by else f)
    return out


def _sort_key(f: Finding):
    return (-SEVERITY_RANK[f.severity], f.rule_id, f.finding_id)


def verify(bundle: ParcelBundle, *, glossary: Glossary, tolerances: Tolerances, as_of: date,
           index: StateIndex) -> VerificationReport:
    ctx = RuleContext(bundle=bundle, glossary=glossary, tolerances=tolerances, as_of=as_of, index=index)
    checks: list[CheckResult] = []
    findings: list[Finding] = []
    for spec, fn in RULES:
        ev = fn(Evaluation(spec, ctx))
        checks.append(ev.result())
        findings.extend(ev.findings)
    findings = sorted(_link_explanations(findings), key=_sort_key)

    by_severity = {s: sum(1 for f in findings if f.severity == s) for s in SEVERITY_RANK}
    by_kind: dict[str, int] = {}
    for f in findings:
        by_kind[f.kind] = by_kind.get(f.kind, 0) + 1
    risk = max(findings, key=lambda f: SEVERITY_RANK[f.severity]).severity if findings else "none"
    summary = {
        "findings": len(findings),
        "open": sum(1 for f in findings if f.status == "open"),
        "explained": sum(1 for f in findings if f.status == "explained"),
        "by_severity": by_severity,
        "by_kind": by_kind,
        "checks": {o: sum(1 for c in checks if c.outcome == o) for o in ("pass", "fail", "not_applicable")},
    }
    return VerificationReport(
        ulpin=bundle.identity.ulpin, state_code=bundle.identity.state_code, as_of=as_of,
        engine_version=ENGINE_VERSION, glossary_version=glossary.version, risk_level=risk,
        summary=summary, checks=checks, findings=findings,
    )
