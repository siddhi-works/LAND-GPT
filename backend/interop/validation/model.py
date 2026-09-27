"""Validation result model: findings keep rule, compared sources, values, severity/status and provenance."""
from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Severity = Literal["critical", "high", "medium", "low", "info"]
SEVERITY_RANK: dict[str, int] = {"critical": 5, "high": 4, "medium": 3, "low": 2, "info": 1}

FindingKind = Literal["inconsistency", "risk_flag", "missing_link", "data_quality"]


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True)


class RuleSpec(_Frozen):
    rule_id: str
    name: str
    category: str
    kind: FindingKind
    default_severity: Severity
    description: str
    compares: list[str] = Field(description="Canonical concepts / sources the rule compares")


class Observation(_Frozen):
    """One compared value and exactly where it came from."""

    record_id: str
    state_code: str
    source_system: str
    source_table: str
    native_record_type: str
    locator: str
    field: str
    value: Any


class Finding(_Frozen):
    finding_id: str
    rule_id: str
    rule_name: str
    category: str
    kind: FindingKind
    severity: Severity
    status: Literal["open", "explained"] = "open"
    explained_by: list[str] = Field(default_factory=list)
    ulpin: str
    state_code: str
    message: str
    expectation: str
    observations: list[Observation]
    metrics: dict[str, Any] = Field(default_factory=dict)
    related_keys: list[str] = Field(default_factory=list)


class CheckResult(_Frozen):
    rule_id: str
    rule_name: str
    outcome: Literal["pass", "fail", "not_applicable"]
    detail: str
    finding_ids: list[str] = Field(default_factory=list)


class VerificationReport(_Frozen):
    ulpin: str
    state_code: str
    as_of: date
    engine_version: str
    glossary_version: str
    risk_level: Severity | Literal["none"]
    summary: dict[str, Any]
    checks: list[CheckResult]
    findings: list[Finding]
