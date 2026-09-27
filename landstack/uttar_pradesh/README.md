# Uttar Pradesh Land Stack DB Layer v3

Uttar Pradesh only. Synthetic prototype data.

The state model intentionally differs from Maharashtra:
- Revenue land records: Khatauni + Khasra
- Revenue mutation: Namantaran / Varasat
- Revenue cadastral: BhuNaksha
- Stamp & Registration: IGRSUP
- Urban planning: Development Authority / planning source
- Housing Department / development authority: Building Plan Approval
- Urban local body: Property Tax
- UPPCL / DISCOM: Electricity
- Local urban water service
- Rights/liabilities: Encumbrance
- Environmental controls

There is NO Property Card dataset because it is not part of this UP land-record model.

15 parcels:
10 clean + 5 messy.

ULPIN is the central interoperability key. Source identifiers remain separate.

Run:
python generator/generate_uttar_pradesh.py

## Spatial geometry
Each parcel uses a synthetic irregular cadastral-style GeoJSON Polygon with 7–8 boundary vertices. The same polygons are exported to `spatial/cadastral_parcels.geojson`. They are sample geometry, not official cadastral boundaries.
