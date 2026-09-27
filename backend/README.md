# Land Stack — interoperability backend

> Federate the data, standardize the meaning — not the underlying state systems.

Connects the Maharashtra, Uttar Pradesh and Gujarat prototype land systems in `../landstack/`
(read-only source of truth) through a canonical semantic layer and a versioned API.

```
State data (each state's own tables)          landstack/<state>/seed, spatial
  → SourceStore (read-only; JSON today, PostgreSQL later)   interop/sources/
  → State adapter (native fields, terms, identifiers)       interop/adapters/
  → Canonical Land Model (+ provenance, native row)         interop/canonical/
  → Semantic glossary (deterministic term resolution)       interop/glossary/glossary.json
  → Normalization (units, statuses, kinds, schemes)         adapters + interop/normalize.py
  → Validation engine (runs on canonical bundles)           interop/validation/
  → Unified API /v1                                         interop/api/
```

## Run

```bash
# from the repository root (Python 3.12 venv at .venv)
.venv\Scripts\python -m pytest backend
.venv\Scripts\python -m uvicorn interop.api.app:create_app --factory --app-dir backend --port 8000
```

Environment: `LANDSTACK_DATA_ROOT` (default `<repo>/landstack`), `LANDSTACK_AS_OF` (evaluation
date for lag calculations; default today). OpenAPI at `/docs`.

## Web portal (citizen + officer)

The API also serves the portal in `../frontend/` (buildless ES modules + Leaflet) at `/`; the API index is at `/v1`.
Open `http://127.0.0.1:8000/` after starting uvicorn.

* Citizen: landing → GIS land map (`#/map`) → parcel panel → Unified Land Profile (`#/parcel/{ulpin}`).
* Officer: `#/officer/login` — accounts per state/role/jurisdiction are defined in `interop/officers.json`
  (shared password `LandStack@2026`). Workflow actions and the audit log are held in memory by
  `interop/workflow.py`; source records are never modified.
* Portal endpoints: `/v1/gis/parcels`, `/v1/admin/hierarchy`, `/v1/search`, `/v1/validation/findings`,
  `/v1/reports/summary`, `/v1/officer/*`, `/v1/assistant/*`.
* Land Stack Assistant: set `ANTHROPIC_API_KEY` (optional `LANDSTACK_ASSISTANT_MODEL`, default
  `claude-opus-5`). Without a key the assistant reports that it is not configured; its grounding data is
  always viewable at `/v1/parcels/{ulpin}/assistant-context`.

## Key design decisions

* **State systems stay different.** Adapters address each state's *own* relational table names from
  `<state>/schema/*.sql` (`bhulekh.record_712`, `revenue_mutation.namantaran`, `e_dhara.vf6_mutation`…).
  There is no merged database; the ULPIN registry only indexes where each parcel lives.
* **PostgreSQL-ready.** `SourceStore` (`fetch(state, table, where)`) is the only seam. `JsonSourceStore`
  maps those table names to files (`sources/json_layout.py`); a Postgres store implements the same
  protocol per state database. Tests prove adapters run unchanged on another store implementation.
* **Never modify, never fabricate.** Stores return copies; canonical records embed the untouched
  `native` row and a `provenance` (state, source system, authority, native table, record key, JSON-pointer
  locator, file fingerprint). A canonical field is filled only from a native field, a glossary mapping or
  a unit conversion. A test hashes the whole dataset before/after a full pipeline + API run.
* **Deterministic glossary.** Exact match after NFKC/casefold/whitespace normalization on the English or
  native-script value; state-scoped entries before `*`; en/native disagreement → `conflict`, no match →
  `unmapped` (both surfaced by rule DQ-002). Integrity is checked at load.
* **Explainable validation.** Each rule reports `pass | fail | not_applicable` per parcel with a reason;
  findings carry rule, severity, status (`open`/`explained`), the compared values and each value's
  source locator. `OWN-002` owner mismatches are marked *explained* by a `MUT-001` pending mutation on
  the same document.

## Validation rules (`GET /v1/validation/rules`)

| Area | Rules |
|---|---|
| Ownership | OWN-001 holders agree across land records · OWN-002 registered transferee vs recorded holder |
| Registration ↔ mutation | MUT-001 lag (pending linked mutation) · MUT-002 mutation applied before registration · MUT-003 mutation kind vs document type (glossary matrix) · LNK-001 cited document exists/same ULPIN · LNK-002 registered transfer without mutation |
| Area / GIS | AREA-001 textual areas agree · AREA-002 BhuNaksha map area vs record · GIS-001 polygon area vs record · GIS-002 declared vs computed · GIS-003 registry vs spatial layer · GIS-004 validity/centroid/vertices · GIS-005 overlap · GIS-006 geometry linked |
| Identity | ID-001 survey/gat/khasra/CTS number (same scheme only) · ID-002 khata/ROR no. · ID-003 jurisdiction |
| Rights | ENC-001 active encumbrance · LIT-001 litigation · ENC-002 finalized charge release vs active charge · ENC-003 charge not on VF 7/12 other-rights · ENC-004 charge mutation without register entry |
| Planning | PLN-001 building use vs zoning · PLN-002 record land use vs zoning · PLN-003 building use vs record land use · PLN-004 planning restriction · ENV-001 environmental restriction · ENV-002 building approved under restriction |
| Tax / value | TAX-001 arrears · TAX-002 arithmetic/status · VAL-001 consideration vs assessed value |
| Coverage / DQ | COV-001 declared vs actual source systems (MH) · COV-002 record of rights present · DQ-001 non-Latin script in romanized fields · DQ-002 glossary resolution |

Tolerances are in `interop/config.py` (textual area 0.001 ha, GIS 5 % / 20 % high, lag 90 days,
consideration ratio 0.1–10).

## Known limitations

* Synthetic prototype data; litigation exists only as a flag on encumbrance rows, so no case
  status/forum is exposed. No mortgage/release deeds exist, so charge mutations are only checked
  against the encumbrance register.
* Area is computed on a sphere (WGS84 semi-major axis); the dataset's declared GIS areas are a
  consistent ~0.9 % lower, well inside tolerance.
* `validation/sha256_manifest.json` files in the dataset predate the geometry update and no longer
  match; the store fingerprints files itself (exposed in `/v1/health`).
* ULPIN collisions are detected and reported (409) rather than resolved.
