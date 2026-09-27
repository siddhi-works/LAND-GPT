"""Officer sessions, jurisdiction-scoped work queues and the Land Stack action/audit log.

Work items are *derived* from connected state records (pending Ferfar / Namantaran / VF 6
entries) and from validation findings. Officer actions are recorded in an in-process audit
log of the Land Stack interoperability layer; the state systems of record (e-Ferfar, UP
Bhulekh, e-Dhara) are never written to. The log is not persisted across restarts.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import threading
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from .portal import native_label
from .service import LandStackService
from .validation.model import SEVERITY_RANK

ROSTER_PATH = Path(__file__).with_name("officers.json")

# State-specific mutation processing, as verified from the official systems.
MUTATION_PROCESS = {
    "MH": {"register": "Ferfar (e-Ferfar)", "statute": "MLRC 1966, s.150", "notice_days": 15,
           "stages": ["Entry recorded by Talathi", "Notice served / objection period", "Certification by Mandal Adhikari", "7/12 & 8A updated"],
           "certifier": "Mandal Adhikari (Circle Officer)"},
    "UP": {"register": "Namantaran (RCCMS / Tehsil Mutation)", "statute": "UP Revenue Code 2006, s.34", "notice_days": None,
           "stages": ["Application registered", "Lekhpal / Revenue Inspector report", "Tehsildar order", "Khatauni updated"],
           "certifier": "Tehsildar"},
    "GJ": {"register": "VF 6 (e-Dhara)", "statute": "Gujarat Land Revenue Code, s.135-D", "notice_days": 30,
           "stages": ["Entry at e-Dhara Kendra & Dy. Mamlatdar verification", "135-D notice served by Talati (30 days)", "Certification & S-form approval", "VF 7/12 & VF 8A updated"],
           "certifier": "Mamlatdar / competent authority"},
}

ACTION_LABELS = {
    "record_note": "Mutation note recorded", "issue_notice": "Notice issued", "register_objection": "Objection registered (disputed)",
    "certify": "Certified", "reject": "Rejected", "return": "Returned for correction", "forward": "Forwarded",
    "verify_discrepancy": "Discrepancy reviewed", "call_report": "Lekhpal report called", "order_mutation": "Mutation ordered",
    "verify_entry": "Entry verified (biometric)", "generate_135d": "135-D notice generated", "approve_s_form": "S-form approved",
    "serve_notice": "Notice served", "record_acknowledgement": "Acknowledgement recorded",
}
ACTION_STATUS = {
    "certify": "certified", "order_mutation": "certified", "reject": "rejected", "return": "returned", "forward": "forwarded",
    "verify_discrepancy": "reviewed", "register_objection": "disputed", "issue_notice": "notice_served",
    "serve_notice": "notice_served", "generate_135d": "notice_generated", "verify_entry": "entry_verified",
    "approve_s_form": "s_form_approved", "record_acknowledgement": "notice_served", "call_report": "report_called",
    "record_note": "in_process",
}


class AuthError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


@dataclass
class Session:
    token: str
    officer: dict
    role: dict
    started: str


@dataclass
class Workflow:
    svc: LandStackService
    roster: dict = field(default_factory=lambda: json.loads(ROSTER_PATH.read_text(encoding="utf-8")))
    sessions: dict[str, Session] = field(default_factory=dict)
    log: list[dict] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    # -- auth -------------------------------------------------------------------------------
    def accounts(self) -> list[dict]:
        out = []
        for o in self.roster["officers"]:
            r = self.roster["roles"][o["role"]]
            out.append({"username": o["username"], "name": o["name"], "designation": r["title"],
                        "designation_native": r["title_native"], "login_category": o["login_category"],
                        "office": o["office"], "state": r["state"], "jurisdiction": o["jurisdiction"]})
        return out

    def login(self, username: str, password: str) -> Session:
        officer = next((o for o in self.roster["officers"] if o["username"] == username), None)
        digest = hashlib.sha256((password or "").encode()).hexdigest()
        if officer is None or not hmac.compare_digest(digest, self.roster["password_sha256"]):
            raise AuthError(401, "INVALID_CREDENTIALS", "Invalid user ID or password")
        s = Session(secrets.token_urlsafe(24), officer, self.roster["roles"][officer["role"]],
                    datetime.now(timezone.utc).isoformat(timespec="seconds"))
        with self._lock:
            self.sessions[s.token] = s
        self._audit(s, "login", None, None, f"Signed in via {officer['login_category']}")
        return s

    def session(self, authorization: str | None) -> Session:
        token = (authorization or "").removeprefix("Bearer ").strip()
        s = self.sessions.get(token)
        if not s:
            raise AuthError(401, "NOT_AUTHENTICATED", "Officer sign-in required")
        return s

    def logout(self, s: Session) -> None:
        self._audit(s, "logout", None, None, "Signed out")
        with self._lock:
            self.sessions.pop(s.token, None)

    @staticmethod
    def profile(s: Session) -> dict:
        return {"username": s.officer["username"], "name": s.officer["name"], "designation": s.role["title"],
                "designation_native": s.role["title_native"], "department": s.officer["department"],
                "office": s.officer["office"], "login_category": s.officer["login_category"],
                "state": s.role["state"], "level": s.role["level"], "jurisdiction": s.officer["jurisdiction"],
                "actions": s.role["actions"], "process": MUTATION_PROCESS[s.role["state"]], "signed_in": s.started}

    # -- scope ------------------------------------------------------------------------------
    @staticmethod
    def in_scope(s: Session, b) -> bool:
        j, jur = b.identity.jurisdiction, s.officer["jurisdiction"]
        return (b.identity.state_code == jur["state"]
                and jur.get("district") in (None, j.district)
                and jur.get("sub_district") in (None, j.sub_district)
                and jur.get("village") in (None, j.village))

    def scoped_bundles(self, s: Session):
        return [b for b in self.svc.bundles(s.role["state"]) if self.in_scope(s, b)]

    def require_scope(self, s: Session, ulpin: str):
        b = self.svc.bundle(ulpin)
        if not self.in_scope(s, b):
            raise AuthError(403, "OUT_OF_JURISDICTION", f"ULPIN {b.identity.ulpin} is outside your jurisdiction")
        return b

    # -- work items -----------------------------------------------------------------------------
    def _status(self, item_id: str, default: str) -> tuple[str, list[dict]]:
        hist = [e for e in self.log if e.get("item_id") == item_id]
        return (ACTION_STATUS.get(hist[-1]["action"], default) if hist else default), hist

    def _mutation_stage(self, state: str, m, as_of: date) -> tuple[str, int | None]:
        p = MUTATION_PROCESS[state]
        days = (as_of - m.application_date).days if m.application_date else None
        if m.status == "finalized":
            return p["stages"][3], days
        if state == "UP":
            return p["stages"][1] if (days or 0) < 30 else p["stages"][2], days
        if p["notice_days"] and days is not None and days < p["notice_days"]:
            return f"{p['stages'][1]} — {p['notice_days'] - days} days left", days
        return p["stages"][2], days

    def items(self, s: Session, include_completed: bool = True) -> list[dict]:
        as_of = self.svc.settings.as_of
        out = []
        for b in self.scoped_bundles(s):
            i = b.identity
            base = {"ulpin": i.ulpin, "state_code": i.state_code, "district": i.jurisdiction.district,
                    "sub_district": i.jurisdiction.sub_district, "village": i.jurisdiction.village,
                    "native_label": native_label(b)}
            rep = self.svc.verification(i.ulpin)
            for m in b.mutations:
                stage, days = self._mutation_stage(i.state_code, m, as_of)
                item_id = f"MUT:{i.state_code}:{m.mutation_no}"
                default = "pending" if m.status == "pending" else "completed"
                if default == "completed" and not include_completed:
                    continue
                status, hist = self._status(item_id, default)
                linked = [f for f in rep.findings
                          if any(o.record_id.endswith(f":{m.mutation_no}") for o in f.observations)
                          or (m.linked_document_no and f"document:{m.linked_document_no}" in f.related_keys)]
                reg = next((r for r in b.registrations if r.document_no == m.linked_document_no), None)
                out.append({**base, "item_id": item_id, "type": "mutation", "reference": m.mutation_no,
                            "register": m.register_name, "title": f"{m.register_name} {m.mutation_no} — {m.kind_label.en if m.kind_label else m.kind}",
                            "kind": m.kind, "source_status": m.status_label.model_dump() if m.status_label else m.status,
                            "stage": stage, "days_pending": days if m.status == "pending" else None,
                            "application_date": str(m.application_date) if m.application_date else None,
                            "document_no": m.linked_document_no, "document_registered": str(reg.registration_date) if reg else None,
                            "severity": max((f.severity for f in linked), key=lambda x: SEVERITY_RANK[x], default=None),
                            "finding_ids": [f.finding_id for f in linked], "status": status, "history": hist,
                            "allowed_actions": s.role["actions"]["mutation"] if m.status == "pending" else []})
            material = [f for f in rep.findings if SEVERITY_RANK[f.severity] >= 3]
            if material:
                item_id = f"VER:{i.ulpin}"
                status, hist = self._status(item_id, "pending")
                top = max(material, key=lambda f: SEVERITY_RANK[f.severity])
                out.append({**base, "item_id": item_id, "type": "verification", "reference": top.rule_id,
                            "title": top.rule_name.replace("_", " ").capitalize(), "stage": "Cross-source discrepancy review",
                            "days_pending": None, "severity": top.severity, "finding_ids": [f.finding_id for f in material],
                            "finding_count": len(material), "status": status, "history": hist,
                            "allowed_actions": s.role["actions"]["verification"]})
        out.sort(key=lambda x: (x["status"] not in ("pending", "returned", "disputed", "report_called", "notice_served", "notice_generated", "entry_verified", "in_process", "s_form_approved"),
                                -SEVERITY_RANK.get(x["severity"] or "info", 0), -(x["days_pending"] or 0), x["item_id"]))
        return out

    def act(self, s: Session, item_id: str, action: str, remarks: str = "", to: str | None = None) -> dict:
        item = next((x for x in self.items(s) if x["item_id"] == item_id), None)
        if item is None:
            raise AuthError(404, "ITEM_NOT_FOUND", f"No work item {item_id} in your jurisdiction")
        if action not in item["allowed_actions"]:
            raise AuthError(403, "ACTION_NOT_PERMITTED", f"'{action}' is not permitted for {s.role['title']} on this item")
        if action in ("return", "reject", "register_objection") and not remarks.strip():
            raise AuthError(422, "REMARKS_REQUIRED", "Remarks are required for this action")
        return self._audit(s, action, item_id, item["ulpin"], remarks, to)

    def _audit(self, s: Session, action: str, item_id: str | None, ulpin: str | None, remarks: str = "", to: str | None = None) -> dict:
        entry = {"seq": len(self.log) + 1, "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                 "officer": s.officer["username"], "officer_name": s.officer["name"], "designation": s.role["title"],
                 "office": s.officer["office"], "state": s.role["state"], "action": action,
                 "action_label": ACTION_LABELS.get(action, action.capitalize()), "item_id": item_id, "ulpin": ulpin,
                 "remarks": remarks, "to": to,
                 "note": None if action in ("login", "logout") else "Recorded in Land Stack workflow; the state system of record is not modified."}
        with self._lock:
            self.log.append(entry)
        return entry

    def audit(self, s: Session, ulpin: str | None = None) -> list[dict]:
        rows = [e for e in self.log if e["state"] == s.role["state"] and (ulpin is None or e["ulpin"] == ulpin)]
        return list(reversed(rows))
