# Maharashtra Land Stack DB Layer v1

Synthetic Maharashtra prototype data.

## Structure

- `schema/maharashtra_schema.sql` — PostgreSQL schemas/tables
- `seed/*.json` — separate source-system seed datasets
- `seed/maharashtra_seed.sql` — generated PostgreSQL inserts
- `generator/generate_maharashtra.py` — deterministic validation generator
- `research.md` — Maharashtra field/model research
- `validation/` — generated validation summary

## Central identity

ULPIN is the central parcel identity. Source identifiers remain separate:
Survey/Gat/Khasra, Survey Part, Khata No., CTS No., Property UID, Ferfar No. and Document No.

ULPIN values are synthetic 14-digit values for this prototype.

## Dataset

15 parcels:
- 10 clean
- 5 messy

Messy:
- P011 owner mismatch
- P012 area mismatch
- P013 pending mutation
- P014 active encumbrance + litigation
- P015 GIS/land-record area mismatch

## Run

From the `maharashtra` folder:

```bash
python generator/generate_maharashtra.py
```

The PostgreSQL schema and seed SQL are ready for loading into a Maharashtra database.

## Spatial geometry
Each parcel uses a synthetic irregular cadastral-style GeoJSON Polygon with 7–8 boundary vertices. The same polygons are exported to `spatial/cadastral_parcels.geojson`. They are sample geometry, not official cadastral boundaries.
