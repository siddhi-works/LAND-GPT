# Gujarat Land Stack DB Layer v3

Synthetic Gujarat prototype, designed from Gujarat-specific source terminology.

Source grouping:
e-Dhara → VF6, 7/12, 8A
City Survey → Property Card
Registration & Stamps → registered documents
Planning → zoning
Building Approval → development/local planning authority
Rights & Liabilities → encumbrance/litigation
Urban Local Body → property tax
Power Distribution → electricity
Water Services → water
Environmental Controls → restrictions

15 parcels: 10 clean + 5 messy.

ULPIN is the central parcel identity. The ULPINs are synthetic 14-digit values for the prototype.

Gujarati + English are stored mainly for names and important land-domain terminology.

Run:
python generator/generate_gujarat.py

## Spatial geometry
Each parcel uses a synthetic irregular cadastral-style GeoJSON Polygon with 7–8 boundary vertices. The same polygons are exported to `spatial/cadastral_parcels.geojson`. They are sample geometry, not official cadastral boundaries.
