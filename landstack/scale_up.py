"""
Scale the Maharashtra, Uttar Pradesh and Gujarat Land Stack datasets from 15 to 100 parcels.

Usage (from the ``landstack`` folder):

    python scale_up.py

What it does
------------
* Keeps P001–P015 exactly as they are (every original JSON row, GeoJSON feature and SQL line
  is written back unchanged).
* Generates P016–P100 for each state, deterministically (fixed seeds; re-running produces
  byte-identical files, and any previously generated P016+ rows are replaced, not duplicated).
* New rows follow each state's own seed schema, identifier formats and native-script
  vocabulary (7/12, 8A, Ferfar / Khatauni, Khasra, Namantaran, BhuNaksha / VF 7/12, VF 8A,
  VF 6 ...), so the backend adapters and glossary read them without any change.
* Parcels are placed in the villages already present in each state's registry, as irregular
  7–8 vertex cadastral polygons that do not overlap any other parcel.
* Most new parcels are internally consistent. The rest carry controlled issues injected as
  *data only* — owner mismatch, area mismatch, registration-to-mutation lag, encumbrance +
  litigation, GIS area/geometry mismatch, partial linked records and combinations. The
  ``issue`` label on the registry row is a dataset fixture; detecting the issue is left to
  the validation engine.

All values are synthetic prototype data (ULPINs are synthetic 14-digit values).
"""
from __future__ import annotations

import hashlib
import json
import math
import random
import re
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ORIGINAL = 15
TARGET = 100
# Reference date for relative dates (registration-to-mutation lag). Matches the backend's
# evaluation date for the dataset.
AS_OF = date(2026, 9, 28)
EARTH_RADIUS_M = 6378137.0
M_PER_DEG = 111_320.0

# ---------------------------------------------------------------------------------------
# scenario plan (85 new parcels per state)
# ---------------------------------------------------------------------------------------
PENDING = "PENDING"  # replaced by the state's own label (PENDING_MUTATION / _NAMANTARAN / _VF6)
SCENARIOS: list[tuple[tuple[str, ...], int]] = [
    ((), 56),                                            # consistent parcels
    (("OWNER_MISMATCH",), 4),
    (("AREA_MISMATCH",), 4),
    ((PENDING,), 6),                                     # registration-to-mutation lag
    (("ENCUMBRANCE_LITIGATION",), 4),
    (("GIS_AREA_MISMATCH",), 3),
    (("GIS_GEOMETRY_MISMATCH",), 2),
    (("PARTIAL_LINKAGE",), 3),
    (("OWNER_MISMATCH", "ENCUMBRANCE_LITIGATION"), 1),   # combined issues
    ((PENDING, "AREA_MISMATCH"), 1),
    (("GIS_AREA_MISMATCH", "ENCUMBRANCE_LITIGATION"), 1),
]
assert sum(c for _, c in SCENARIOS) == TARGET - ORIGINAL

# Days between registration and the dataset reference date for pending mutations
# (below and above the 90-day escalation threshold).
PENDING_LAGS = [34, 58, 77, 126, 214, 392, 161]


# ---------------------------------------------------------------------------------------
# small utilities
# ---------------------------------------------------------------------------------------
def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def save(path: Path, data) -> None:
    # Same serialization as the supplied seed files (2-space indent, UTF-8, no trailing newline).
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def rng_for(state: str, n: int, salt: str) -> random.Random:
    return random.Random(f"landstack:{state}:P{n:03d}:{salt}")


def ref(n: int) -> str:
    return f"P{n:03d}"


def is_original(row_ref: str | None) -> bool:
    return bool(row_ref) and int(row_ref[1:]) <= ORIGINAL


def ring_area_m2(ring) -> float:
    """Spherical-excess ring area (same method the backend uses for GIS checks)."""
    total = 0.0
    for i in range(len(ring) - 1):
        lon1, lat1 = math.radians(ring[i][0]), math.radians(ring[i][1])
        lon2, lat2 = math.radians(ring[i + 1][0]), math.radians(ring[i + 1][1])
        total += (lon2 - lon1) * (2 + math.sin(lat1) + math.sin(lat2))
    return abs(total * EARTH_RADIUS_M * EARTH_RADIUS_M / 2.0)


def point_in_ring(x: float, y: float, ring) -> bool:
    inside = False
    for i in range(len(ring) - 1):
        (x1, y1), (x2, y2) = ring[i], ring[i + 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def offset(lon: float, lat: float, east_m: float, north_m: float) -> tuple[float, float]:
    return (lon + east_m / (M_PER_DEG * math.cos(math.radians(lat))), lat + north_m / M_PER_DEG)


def distance_m(a, b) -> float:
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((a[0] - b[0]) * M_PER_DEG * math.cos(lat), (a[1] - b[1]) * M_PER_DEG)


def cadastral_polygon(center, area_ha: float, rnd: random.Random, vertices: int):
    """Irregular star-shaped (hence simple) polygon of exactly ``area_ha`` around ``center``."""
    step = 2 * math.pi / vertices
    start = rnd.uniform(0, 2 * math.pi)
    angles = [start + i * step + rnd.uniform(-0.28, 0.28) * step for i in range(vertices)]
    radii = [rnd.uniform(0.80, 1.22) for _ in range(vertices)]
    stretch = rnd.uniform(0.85, 1.18)  # plots are rarely round

    def build(scale: float):
        pts = []
        for a, r in zip(angles, radii):
            east, north = math.cos(a) * r * scale * stretch, math.sin(a) * r * scale / stretch
            lon, lat = offset(center[0], center[1], east, north)
            pts.append([round(lon, 7), round(lat, 7)])
        return pts + [pts[0]]

    scale = math.sqrt(area_ha * 10_000 / math.pi)
    for _ in range(4):
        ring = build(scale)
        scale *= math.sqrt(area_ha * 10_000 / ring_area_m2(ring))
    return build(scale)


def max_radius(center, ring) -> float:
    return max(distance_m(center, p) for p in ring[:-1])


def money(v: float, step: int = 100) -> float:
    return float(round(v / step) * step)


# ---------------------------------------------------------------------------------------
# people
# ---------------------------------------------------------------------------------------
NAMES = {
    "MH": (
        [("Sandeep", "संदीप"), ("Mangal", "मंगल"), ("Priya", "प्रिया"), ("Vinayak", "विनायक"), ("Amol", "अमोल"),
         ("Kavita", "कविता"), ("Rajesh", "राजेश"), ("Sneha", "स्नेहा"), ("Akshay", "अक्षय"), ("Pranav", "प्रणव"),
         ("Ashwini", "अश्विनी"), ("Madhuri", "माधुरी"), ("Pooja", "पूजा"), ("Neha", "नेहा"), ("Asha", "आशा"),
         ("Rohit", "रोहित"), ("Vinod", "विनोद"), ("Suresh", "सुरेश"), ("Ganesh", "गणेश"), ("Sunita", "सुनीता"),
         ("Anil", "अनिल"), ("Vaishali", "वैशाली"), ("Prakash", "प्रकाश"), ("Swati", "स्वाती"), ("Mahesh", "महेश"),
         ("Rupali", "रुपाली"), ("Nitin", "नितीन"), ("Sachin", "सचिन"), ("Yogesh", "योगेश"), ("Manisha", "मनीषा"),
         ("Tukaram", "तुकाराम"), ("Savita", "सविता"), ("Dnyaneshwar", "ज्ञानेश्वर"), ("Shubhangi", "शुभांगी")],
        [("Patil", "पाटील"), ("Jadhav", "जाधव"), ("Shinde", "शिंदे"), ("Deshmukh", "देशमुख"), ("More", "मोरे"),
         ("Kamble", "कांबळे"), ("Pawar", "पवार"), ("Joshi", "जोशी"), ("Sawant", "सावंत"), ("Bhoyar", "भोयर"),
         ("Kulkarni", "कुलकर्णी"), ("Naik", "नाईक"), ("Gaikwad", "गायकवाड"), ("Chavan", "चव्हाण"), ("Kadam", "कदम"),
         ("Salunkhe", "साळुंखे"), ("Bhosale", "भोसले"), ("Thorat", "थोरात"), ("Mane", "माने"), ("Wagh", "वाघ"),
         ("Deshpande", "देशपांडे"), ("Mhatre", "म्हात्रे"), ("Kale", "काळे"), ("Nikam", "निकम"), ("Shelar", "शेलार")],
    ),
    "UP": (
        [("Seema", "सीमा"), ("Ram", "राम"), ("Sunita", "सुनीता"), ("Ajay", "अजय"), ("Vinod", "विनोद"),
         ("Pooja", "पूजा"), ("Manish", "मनीष"), ("Anjali", "अंजली"), ("Nikhil", "निखिल"), ("Radha", "राधा"),
         ("Amit", "अमित"), ("Ravi", "रवि"), ("Suresh", "सुरेश"), ("Deepak", "दीपक"), ("Neha", "नेहा"),
         ("Vikas", "विकास"), ("Kiran", "किरण"), ("Rajendra", "राजेन्द्र"), ("Sarita", "सरिता"), ("Ashok", "अशोक"),
         ("Geeta", "गीता"), ("Mukesh", "मुकेश"), ("Priyanka", "प्रियंका"), ("Santosh", "संतोष"), ("Rekha", "रेखा"),
         ("Arvind", "अरविंद"), ("Kamlesh", "कमलेश"), ("Shalini", "शालिनी"), ("Rakesh", "राकेश"), ("Anita", "अनीता"),
         ("Brijesh", "बृजेश"), ("Shivani", "शिवानी")],
        [("Verma", "वर्मा"), ("Singh", "सिंह"), ("Yadav", "यादव"), ("Tiwari", "तिवारी"), ("Kumar", "कुमार"),
         ("Sharma", "शर्मा"), ("Awasthi", "अवस्थी"), ("Nishad", "निषाद"), ("Srivastava", "श्रीवास्तव"),
         ("Chaudhary", "चौधरी"), ("Mishra", "मिश्रा"), ("Agrawal", "अग्रवाल"), ("Rawat", "रावत"), ("Rajput", "राजपूत"),
         ("Pandey", "पाण्डेय"), ("Shukla", "शुक्ला"), ("Dubey", "दुबे"), ("Gupta", "गुप्ता"), ("Maurya", "मौर्य"),
         ("Pal", "पाल"), ("Kushwaha", "कुशवाहा"), ("Tripathi", "त्रिपाठी"), ("Saxena", "सक्सेना"), ("Tyagi", "त्यागी")],
    ),
    "GJ": (
        [("Sandeep", "સંદીપ"), ("Hitesh", "હિતેશ"), ("Meena", "મીના"), ("Kiran", "કિરણ"), ("Jayesh", "જયેશ"),
         ("Reena", "રીના"), ("Mahesh", "મહેશ"), ("Pooja", "પૂજા"), ("Manan", "મનન"), ("Asha", "આશા"),
         ("Rahul", "રાહુલ"), ("Mihir", "મિહિર"), ("Suresh", "સુરેશ"), ("Vijay", "વિજય"), ("Neelam", "નીલમ"),
         ("Vinod", "વિનોદ"), ("Kajal", "કાજલ"), ("Bhavesh", "ભાવેશ"), ("Hetal", "હેતલ"), ("Nilesh", "નિલેશ"),
         ("Dhara", "ધરા"), ("Paresh", "પરેશ"), ("Komal", "કોમલ"), ("Jignesh", "જીગ્નેશ"), ("Falguni", "ફાલ્ગુની"),
         ("Ketan", "કેતન"), ("Bhavna", "ભાવના"), ("Chirag", "ચિરાગ"), ("Alpesh", "અલ્પેશ"), ("Nayna", "નયના")],
        [("Patel", "પટેલ"), ("Parmar", "પરમાર"), ("Joshi", "જોશી"), ("Shah", "શાહ"), ("Desai", "દેસાઈ"),
         ("Rathod", "રાઠોડ"), ("Jadeja", "જાડેજા"), ("Rathva", "રાઠવા"), ("Chaudhary", "ચૌધરી"), ("Thakkar", "ઠક્કર"),
         ("Solanki", "સોલંકી"), ("Mehta", "મહેતા"), ("Vasava", "વસાવા"), ("Chauhan", "ચૌહાણ"), ("Prajapati", "પ્રજાપતિ"),
         ("Bhatt", "ભટ્ટ"), ("Makwana", "મકવાણા"), ("Vaghela", "વાઘેલા"), ("Pandya", "પંડ્યા"), ("Trivedi", "ત્રિવેદી"),
         ("Dave", "દવે"), ("Gohil", "ગોહિલ"), ("Barot", "બારોટ")],
    ),
}


def person(state: str, rnd: random.Random, avoid: set[str] = frozenset()) -> tuple[str, str]:
    first, last = NAMES[state]
    while True:
        (fe, fn), (le, ln) = rnd.choice(first), rnd.choice(last)
        en = f"{fe} {le}"
        if en not in avoid:
            return en, f"{fn} {ln}"


# ---------------------------------------------------------------------------------------
# state generator
# ---------------------------------------------------------------------------------------
class StateGen:
    code = ""
    folder = ""
    sub_key = ""               # taluka / tehsil
    pending_label = ""
    lang = ""                  # native-name suffix: mr / hi / gu
    area_mismatch_rule = ""
    # (file, key) -> list of rows; key None = the file is a list
    tables: list[tuple[str, str | None]] = []
    sql_tables: dict[tuple[str, str | None], str] = {}
    rural_anchors: tuple[str, ...] = ()
    mixed_anchors: tuple[str, ...] = ()
    urban_anchors: tuple[str, ...] = ()
    clean_excluded_anchors: tuple[str, ...] = ()  # localities whose source rows carry their own caveats

    def __init__(self):
        self.dir = ROOT / self.folder
        self.seed = self.dir / "seed"
        self.parcels_all = load(self.seed / "parcels.json")
        self.parcels = [p for p in self.parcels_all if is_original(p["prototype_ref"])]
        assert len(self.parcels) == ORIGINAL, f"{self.code}: expected P001–P015"
        self.original_ulpins = {p["ulpin"] for p in self.parcels}
        self.by_ref = {p["prototype_ref"]: p for p in self.parcels}
        self.data: dict[tuple[str, str | None], list[dict]] = {}
        for file, key in self.tables:
            doc = load(self.seed / file)
            rows = doc if key is None else doc[key]
            self.data[(file, key)] = [r for r in rows if r["ulpin"] in self.original_ulpins]
        self.new_rows: dict[tuple[str, str | None], list[dict]] = {t: [] for t in self.tables}
        self.new_parcels: list[dict] = []
        self.new_features: list[dict] = []
        # occupied footprints: (center, radius_m) of every polygon in the state
        self.footprints = []
        for p in self.parcels:
            c = (p["centroid"]["lon"], p["centroid"]["lat"])
            self.footprints.append((c, max_radius(c, p["geometry"]["coordinates"][0])))
        self.used_survey = {(p["district"], p[self.sub_key], p["village"], self.survey_of(p)) for p in self.parcels}
        self.used_accounts = {self.account_of(p) for p in self.parcels}

    # -- per-state hooks ---------------------------------------------------------------
    def survey_of(self, p: dict) -> str: raise NotImplementedError
    def account_of(self, p: dict) -> str | None: raise NotImplementedError
    def parcel_row(self, plan: dict) -> dict: raise NotImplementedError
    def records(self, plan: dict) -> None: raise NotImplementedError

    def add(self, table: tuple[str, str | None], row: dict) -> None:
        self.new_rows[table].append(row)

    # -- plan ----------------------------------------------------------------------------
    def scenario_list(self) -> list[tuple[str, ...]]:
        out = []
        for labels, count in SCENARIOS:
            out += [tuple(self.pending_label if l == PENDING else l for l in labels)] * count
        random.Random(f"landstack:{self.code}:scenarios").shuffle(out)
        return out

    def choose_profile(self, labels: tuple[str, ...], rnd: random.Random) -> str:
        if "GIS_GEOMETRY_MISMATCH" in labels:
            return "rural"
        x = rnd.random()
        return "rural" if x < 0.60 else "mixed" if x < 0.82 else "urban"

    def choose_anchor(self, profile: str, labels: tuple[str, ...], rnd: random.Random) -> dict:
        pool = {"rural": self.rural_anchors, "mixed": self.mixed_anchors, "urban": self.urban_anchors}[profile]
        if not labels:
            pool = tuple(a for a in pool if a not in self.clean_excluded_anchors) or pool
        return self.by_ref[rnd.choice(pool)]

    def unique_survey(self, anchor: dict, rnd: random.Random, lo: int, hi: int) -> str:
        key = (anchor["district"], anchor[self.sub_key], anchor["village"])
        while True:
            s = str(rnd.randint(lo, hi))
            if (*key, s) not in self.used_survey:
                self.used_survey.add((*key, s))
                return s

    def unique_account(self, make) -> str:
        while True:
            a = make()
            if a not in self.used_accounts:
                self.used_accounts.add(a)
                return a

    def place(self, anchor: dict, area_ha: float, rnd: random.Random, vertices: int, extra_m: float = 0.0):
        """Put a new parcel next to the anchor parcel's village without touching any other polygon."""
        a = (anchor["centroid"]["lon"], anchor["centroid"]["lat"])
        ra = max_radius(a, anchor["geometry"]["coordinates"][0])
        rn = math.sqrt(area_ha * 10_000 / math.pi) * 1.22 * 1.18 + extra_m
        gap = rnd.uniform(14, 34)
        for k in range(400):
            angle = rnd.uniform(0, 2 * math.pi)
            dist = ra + rn + gap + k * 9.0 + rnd.uniform(0, 25)
            c = offset(a[0], a[1], math.cos(angle) * dist, math.sin(angle) * dist)
            c = (round(c[0], 4), round(c[1], 4))  # registry centroids carry 4 decimals
            if all(distance_m(c, fc) >= rn + fr + 12 for fc, fr in self.footprints):
                ring = cadastral_polygon(c, area_ha, rnd, vertices)
                reach = max_radius(c, ring) + extra_m
                if point_in_ring(c[0], c[1], ring) and all(
                        distance_m(c, fc) >= reach + fr + 12 for fc, fr in self.footprints):
                    self.footprints.append((c, reach))
                    return c, ring
        raise RuntimeError(f"{self.code}: could not place a parcel near {anchor['prototype_ref']}")

    def plan(self, n: int, labels: tuple[str, ...], taken_ulpins: set[str]) -> dict:
        rnd = rng_for(self.code, n, "plan")
        profile = self.choose_profile(labels, rnd)
        anchor = self.choose_anchor(profile, labels, rnd)
        ulpin = make_ulpin(self.code, n, taken_ulpins)
        if profile == "urban":
            area = round(rnd.uniform(0.08, 0.26), 3)
        elif profile == "mixed":
            area = round(rnd.uniform(0.25, 0.95), 2)
        else:
            area = round(rnd.uniform(0.45, 3.4), 2)
        vertices = rnd.choice([7, 8])
        geom_area = area
        if "GIS_AREA_MISMATCH" in labels:
            geom_area = round(area * (1 + rnd.choice([-1, 1]) * rnd.uniform(0.09, 0.26)), 3 if profile == "urban" else 2)
        shift = rnd.uniform(7, 12) if "GIS_GEOMETRY_MISMATCH" in labels else 0.0
        center, ring = self.place(anchor, geom_area, rnd, vertices, extra_m=shift)
        spatial_ring = ring
        if shift:
            ang = rnd.uniform(0, 2 * math.pi)
            spatial_ring = [[round(v, 7) for v in offset(x, y, math.cos(ang) * shift, math.sin(ang) * shift)]
                            for x, y in ring]
            assert point_in_ring(center[0], center[1], spatial_ring)

        people = rng_for(self.code, n, "people")
        buyer = person(self.code, people)
        seller = person(self.code, people, avoid={buyer[0]})
        owner_mismatch = "OWNER_MISMATCH" in labels
        pending = self.pending_label in labels
        partial = None
        if "PARTIAL_LINKAGE" in labels:  # alternate the two partial-linkage variants
            self.partial_count = getattr(self, "partial_count", 0) + 1
            partial = "missing_mutation" if self.partial_count % 2 else "missing_registration"
        recorded_holder = seller if (owner_mismatch or pending or partial == "missing_mutation") else buyer

        # dates
        if pending:
            lag = PENDING_LAGS[n % len(PENDING_LAGS)]
            reg_date = AS_OF - timedelta(days=lag)
        else:
            reg_date = date(2023, 1, 9) + timedelta(days=rnd.randint(0, 1240))
        app_date = reg_date + timedelta(days=rnd.randint(4, 24))
        doc_type = "Gift Deed" if rnd.random() < 0.18 else "Sale Deed"

        return dict(
            n=n, ref=ref(n), ulpin=ulpin, labels=labels, profile=profile, anchor=anchor, rnd=rnd,
            quality_class="messy" if labels else "clean", issue="+".join(labels) if labels else None,
            district=anchor["district"], sub=anchor[self.sub_key], village=anchor["village"], context=anchor["context"],
            area=area, geom_area=geom_area, center=center, registry_ring=ring, spatial_ring=spatial_ring,
            vertices=vertices, buyer=buyer, seller=seller, holder=recorded_holder,
            pending=pending, owner_mismatch=owner_mismatch, partial=partial,
            area_mismatch="AREA_MISMATCH" in labels, encumbrance="ENCUMBRANCE_LITIGATION" in labels,
            reg_date=reg_date, app_date=app_date, doc_type=doc_type,
        )

    # -- common row pieces ----------------------------------------------------------------
    def geometry(self, ring) -> dict:
        return {"type": "Polygon", "coordinates": [ring]}

    def feature(self, plan: dict) -> dict:
        template = self.template_feature
        props = {}
        for k in template["properties"]:
            props[k] = {
                "prototype_ref": plan["ref"], "ulpin": plan["ulpin"], "state": self.state_name,
                "district": plan["district"], "village": plan["village"], "quality_class": plan["quality_class"],
                "issue": plan["issue"],
            }.get(k, plan["sub"] if k == self.sub_key else None)
        return {"type": "Feature", "properties": props, "geometry": self.geometry(plan["spatial_ring"])}

    def consideration(self, plan: dict) -> float:
        rnd = plan["rnd"]
        if plan["profile"] == "urban":
            rate = rnd.uniform(1.1e7, 2.0e7)
        elif plan["profile"] == "mixed":
            rate = rnd.uniform(1.9e6, 3.4e6)
        else:
            rate = rnd.uniform(0.85e6, 1.55e6)
        return money(plan["area"] * rate)

    def assessed(self, plan: dict, consideration: float) -> int:
        return int(round(consideration / plan["rnd"].uniform(1.15, 2.3), -4))

    def tax_amounts(self, plan: dict, assessed: int, arrears: bool) -> tuple[float, float, float, str]:
        demand = round(assessed * 0.004, 1)
        if arrears:
            paid = round(demand * plan["rnd"].choice([0.5, 0.6, 0.7]), 1)
            return demand, paid, round(demand - paid, 1), "partially_paid"
        return demand, demand, 0.0, "paid"

    # -- run ---------------------------------------------------------------------------
    def generate(self, taken_ulpins: set[str]) -> None:
        self.template_feature = load(self.dir / "spatial" / "cadastral_parcels.geojson")["features"][0]
        for i, labels in enumerate(self.scenario_list()):
            plan = self.plan(ORIGINAL + 1 + i, labels, taken_ulpins)
            self.records(plan)
            self.new_parcels.append(self.parcel_row(plan))
            self.new_features.append(self.feature(plan))

    def write(self) -> None:
        save(self.seed / "parcels.json", self.parcels + self.new_parcels)
        by_file: dict[str, list[tuple[str | None, list]]] = {}
        for (file, key) in self.tables:
            by_file.setdefault(file, []).append((key, self.data[(file, key)] + self.new_rows[(file, key)]))
        for file, parts in by_file.items():
            if parts[0][0] is None:
                save(self.seed / file, parts[0][1])
            else:
                doc = load(self.seed / file)
                for key, rows in parts:
                    doc[key] = rows
                save(self.seed / file, doc)
        spatial_path = self.dir / "spatial" / "cadastral_parcels.geojson"
        spatial = load(spatial_path)
        spatial["features"] = [f for f in spatial["features"] if f["properties"]["ulpin"] in self.original_ulpins]
        spatial["features"] += self.new_features
        save(spatial_path, spatial)
        self.write_sql()

    # -- PostgreSQL seed ------------------------------------------------------------------
    def write_sql(self) -> None:
        path = self.seed / f"{self.folder}_seed.sql"
        lines = path.read_text(encoding="utf-8").split("\n")
        ulpin_re = re.compile(r"'(\d{14})'")

        def original(line: str) -> bool:
            return any(u in self.original_ulpins for u in ulpin_re.findall(line))

        header, groups, order, geometry_header, updates = [], {}, [], [], []
        columns: dict[str, str] = {}
        in_geometry = False
        for line in lines:
            m = re.match(r"INSERT INTO (\S+) \(([^)]*)\) VALUES", line)
            if m:
                table = m.group(1)
                columns.setdefault(table, m.group(2))
                if table not in groups:
                    groups[table] = []
                    order.append(table)
                if original(line):
                    groups[table].append(line)
            elif line.startswith("UPDATE core.parcel_registry"):
                if original(line):
                    updates.append(line)
            elif line.startswith("-- Synthetic irregular cadastral geometry"):
                in_geometry = True
                geometry_header.append(line)
            elif not order:
                header.append(line)
            elif in_geometry and line.strip():
                geometry_header.append(line)

        def literal(v) -> str:
            if v is None:
                return "NULL"
            if isinstance(v, bool):
                return "TRUE" if v else "FALSE"
            if isinstance(v, (int, float)):
                return repr(v)
            if isinstance(v, (list, dict)):
                v = json.dumps(v, ensure_ascii=False)
            return "'" + str(v).replace("'", "''") + "'"

        def insert(table: str, row: dict) -> str:
            cols = columns[table].split(",")
            vals = []
            for c in cols:
                if c in ("centroid_lat", "centroid_lon"):
                    vals.append(literal(row["centroid"][c.split("_")[1]]))
                else:
                    vals.append(literal(row.get(c)))
            return f"INSERT INTO {table} ({columns[table]}) VALUES ({','.join(vals)});"

        new_by_table: dict[str, list[str]] = {t: [] for t in order}
        new_by_table["core.parcel_registry"] = [insert("core.parcel_registry", p) for p in self.new_parcels]
        for key, table in self.sql_tables.items():
            new_by_table[table] += [insert(table, r) for r in self.new_rows[key]]
        out = list(header)
        for table in order:
            out += groups[table] + new_by_table[table]
        out += ["", *geometry_header]
        out += updates
        out += [f"UPDATE core.parcel_registry SET geometry_geojson = '{json.dumps(p['geometry'])}'::jsonb "
                f"WHERE ulpin = '{p['ulpin']}';" for p in self.new_parcels]
        path.write_text("\n".join(out) + "\n", encoding="utf-8")


def make_ulpin(state: str, n: int, taken: set[str]) -> str:
    k = 0
    while True:
        h = int(hashlib.sha256(f"landstack-ulpin:{state}:P{n:03d}:{k}".encode()).hexdigest(), 16)
        u = str(10**13 + h % (9 * 10**13))
        if u not in taken:
            taken.add(u)
            return u
        k += 1


# ---------------------------------------------------------------------------------------
# Maharashtra — Mahabhulekh 7/12 + 8A, e-Ferfar, IGR registration, City Survey Property Card
# ---------------------------------------------------------------------------------------
LAND_USE = {
    "MH": {"Agricultural": "शेती", "Residential": "निवासी", "Commercial": "व्यावसायिक"},
    "UP": {"Agricultural": "कृषि", "Residential": "आवासीय", "Commercial": "व्यावसायिक"},
    "GJ": {"Agricultural": "કૃષિ", "Residential": "રહેણાંક", "Commercial": "વાણિજ્યિક"},
}
ZONE = {  # permitted use -> (zone_code, zone name en, zone name native)
    "MH": {"Agricultural": ("AG", "Agricultural", "शेती"), "Residential": ("R1", "Residential", "निवासी"),
           "Commercial": ("C1", "Commercial", "व्यावसायिक")},
    "UP": {"Agricultural": ("AG", "Agricultural Zone", "कृषि क्षेत्र"), "Residential": ("R1", "Residential Zone", "आवासीय क्षेत्र"),
           "Commercial": ("C1", "Commercial Zone", "व्यावसायिक क्षेत्र")},
    "GJ": {"Agricultural": ("AG", "Agricultural Zone", "કૃષિ ઝોન"), "Residential": ("R1", "Residential Zone", "રહેણાંક ઝોન"),
           "Commercial": ("C1", "Commercial Zone", "વાણિજ્યિક ઝોન")},
}
DOC_NATIVE = {
    "UP": {"Sale Deed": "विक्रय विलेख", "Gift Deed": "दान विलेख"},
    "GJ": {"Sale Deed": "વેચાણ દસ્તાવેજ", "Gift Deed": "ભેટ દસ્તાવેજ"},
}


def land_use_for(plan: dict) -> str:
    if plan["profile"] == "rural":
        return "Agricultural"
    return "Commercial" if plan["rnd"].random() < 0.2 else "Residential"


class Maharashtra(StateGen):
    code, folder, state_name, sub_key, lang = "MH", "maharashtra", "Maharashtra", "taluka", "mr"
    pending_label = "PENDING_MUTATION"
    T712, T8A = ("land_records.json", "record_712"), ("land_records.json", "record_8a")
    TMUT, TREG, TPC = ("mutations.json", None), ("registrations.json", None), ("property_cards.json", None)
    TPLN, TBLD, TENC = ("planning.json", None), ("building_permissions.json", None), ("encumbrances.json", None)
    TTAX, TUTL, TENV = ("property_tax.json", None), ("utilities.json", None), ("environment.json", None)
    tables = [T712, T8A, TMUT, TREG, TPC, TPLN, TBLD, TENC, TTAX, TUTL, TENV]
    sql_tables = {T712: "bhulekh.record_712", T8A: "bhulekh.record_8a", TMUT: "eferfar.ferfar",
                  TREG: "registration.document", TPC: "property_card.record", TPLN: "planning.record",
                  TBLD: "building.permission", TENC: "encumbrance.record", TTAX: "property_tax.record",
                  TUTL: "utilities.connection", TENV: "environment.restriction"}
    SYSTEM = {T712: "bhulekh", T8A: "bhulekh", TMUT: "eferfar", TREG: "registration", TPC: "property_card",
              TPLN: "planning", TBLD: "building", TENC: "encumbrance", TTAX: "property_tax", TUTL: "utilities",
              TENV: "environment"}
    rural_anchors = ("P001", "P002", "P003", "P004", "P005", "P006", "P007", "P011", "P013", "P015", "P014")
    mixed_anchors = ("P008", "P012")
    urban_anchors = ("P009", "P010")
    clean_excluded_anchors = ("P014",)  # coastal locality: CRZ review applies

    def survey_of(self, p): return p["native_identifier"]
    def account_of(self, p): return (p["district"], p["taluka"], p["village"], p["khata_no"])

    def plan(self, n, labels, taken):
        plan = super().plan(n, labels, taken)
        rnd, a = plan["rnd"], plan["anchor"]
        # e-Ferfar's conveyance entry in the glossary is the Registered Sale (खरेदीखत) entry.
        plan["doc_type"] = "Sale Deed"
        if plan["profile"] == "urban":
            plan.update(id_type="CTS_NO", survey=self.unique_survey(a, rnd, 120, 2600), part=None, khata=None)
        else:
            plan.update(id_type=a["native_identifier_type"] if a["native_identifier_type"] != "CTS_NO" else "GAT_NO",
                        survey=self.unique_survey(a, rnd, 5, 640), part=rnd.choice(["1", "2", "3", "4", None]))
            plan["khata"] = self.unique_account(
                lambda: (a["district"], a["taluka"], a["village"], str(rnd.randint(5, 420))))[3]
        plan["land_use"] = land_use_for(plan)
        return plan

    def records(self, p: dict) -> None:
        rnd, n, u, lu = p["rnd"], p["n"], p["ulpin"], p["land_use"]
        holder_en, holder_mr = p["holder"]
        rec_area = p["area"]
        urban = p["profile"] == "urban"
        if not urban:
            self.add(self.T712, {
                "ulpin": u, "district": p["district"], "taluka": p["sub"], "village": p["village"],
                "land_identifier_type": p["id_type"], "survey_gat_khasra_no": p["survey"], "survey_part": p["part"],
                "khata_no": p["khata"], "khatedar_name_mr": holder_mr, "khatedar_name_en": holder_en,
                "total_area": rec_area, "khatedar_area": rec_area, "area_unit": "hectare",
                "land_use_mr": LAND_USE["MH"][lu], "land_use_en": lu,
                "assessment": round(1200 + 950 * rec_area, 1), "record_status": "active"})
            a8 = rec_area
            if p["area_mismatch"]:
                a8 = round(rec_area + rnd.choice([-1, 1]) * rnd.uniform(0.02, 0.14), 2)
            self.add(self.T8A, {
                "ulpin": u, "khata_no": p["khata"], "khatedar_name_mr": holder_mr, "khatedar_name_en": holder_en,
                "land_measurement_numbers": [{"type": p["id_type"], "number": p["survey"], "part": p["part"]}],
                "total_area": a8, "cultivable_area": round(a8 * 0.95, 3), "non_cultivable_area": round(a8 * 0.05, 3),
                "area_unit": "hectare", "land_revenue": round(890 + 400 * a8, 1), "record_status": "active"})
        else:
            sqm = int(round(rec_area * 10_000))
            card_sqm = sqm
            if p["area_mismatch"]:
                card_sqm = int(round(sqm * (1 + rnd.choice([-1, 1]) * rnd.uniform(0.06, 0.15))))
            self.add(self.TPC, {
                "property_uid": str(rnd.randint(10**10, 10**11 - 1)), "ulpin": u, "cts_no": p["survey"],
                "district": p["district"], "city_survey_office": f"{p['sub']} City Survey Office",
                "village_peth": p["village"], "holder_name_mr": holder_mr, "holder_name_en": holder_en,
                "area_value": card_sqm, "area_unit": "sqm", "tenure_type": "Occupancy Class I", "record_status": "active"})

        consideration = self.consideration(p)
        doc_no = f"REG-MH-{p['reg_date'].year}-{n:04d}"
        if p["partial"] != "missing_registration":
            self.add(self.TREG, {
                "document_no": doc_no, "ulpin": u, "sub_registrar_office": f"{p['sub']} Sub Registrar Office",
                "document_type": p["doc_type"], "transaction_type": p["doc_type"].split()[0],
                "registration_date": p["reg_date"].isoformat(), "seller_name_mr": p["seller"][1],
                "seller_name_en": p["seller"][0], "buyer_name_mr": p["buyer"][1], "buyer_name_en": p["buyer"][0],
                "consideration_value": consideration, "registration_status": "registered"})
        if p["partial"] != "missing_mutation":
            self.add(self.TMUT, {
                "ferfar_no": f"FF-{p['app_date'].year}-{1000 + n}", "ulpin": u,
                "application_no": f"EH-{p['app_date'].year}-{8000 + n}",
                "mutation_source_type": "registered_document",
                "mutation_type_mr": "खरेदीखत", "mutation_type_en": "Registered Sale",
                "application_date": p["app_date"].isoformat(),
                "status_mr": "प्रलंबित" if p["pending"] else "निकाली", "status_en": "Pending" if p["pending"] else "Disposed",
                "land_identifier_type": p["id_type"], "survey_gat_khasra_no": p["survey"], "document_no": doc_no})

        # encumbrance history / active charge
        if p["encumbrance"]:
            charge_date = max(p["app_date"], p["reg_date"]) + timedelta(days=rnd.randint(30, 200))
            self.add(self.TMUT, {
                "ferfar_no": f"FF-{charge_date.year}-{2000 + n}", "ulpin": u,
                "application_no": f"EH-{charge_date.year}-{9000 + n}", "mutation_source_type": "e_hakk",
                "mutation_type_mr": "बोजा", "mutation_type_en": "Charge / Encumbrance",
                "application_date": charge_date.isoformat(), "status_mr": "निकाली", "status_en": "Disposed",
                "land_identifier_type": p["id_type"], "survey_gat_khasra_no": p["survey"], "document_no": None})
            self.add(self.TENC, {
                "ulpin": u, "encumbrance_type_mr": "गहाणखत / बोजा", "encumbrance_type_en": "Mortgage / Charge",
                "reference_no": f"ENC-MH-{n:03d}-01", "holder_name_mr": "सिंथेटिक बँक", "holder_name_en": "Synthetic Bank",
                "status": "active", "litigation_flag": True, "court_case_reference": f"RCS-{n:03d}-{charge_date.year}"})
        elif not urban and rnd.random() < 0.15:
            self.add(self.TENC, {
                "ulpin": u, "encumbrance_type_mr": "बोजा", "encumbrance_type_en": "Charge",
                "reference_no": f"ENC-MH-{n:03d}-01", "holder_name_mr": "सिंथेटिक सहकारी बँक",
                "holder_name_en": "Synthetic Cooperative Bank", "status": "released", "litigation_flag": False,
                "court_case_reference": None})

        if urban or p["profile"] == "mixed" or rnd.random() < 0.7:
            code, zen, zmr = ZONE["MH"][lu]
            kind = "Development Plan" if p["profile"] != "rural" else "Regional Plan"
            self.add(self.TPLN, {
                "ulpin": u, "planning_authority": f"{p['district']} Planning Authority",
                "plan_name": f"{p['district']} {kind} (Synthetic)", "zone_code": code, "zone_name_mr": zmr,
                "zone_name_en": zen, "permitted_use": lu, "restriction_status": "none"})
        if p["profile"] != "rural":
            self.add(self.TBLD, {
                "permission_no": f"BP-MH-{n:03d}-{p['reg_date'].year}", "ulpin": u, "application_no": f"BPAPP-MH-{n:03d}",
                "authority": f"{p['district']} Local Planning Authority", "building_use": lu,
                "built_up_area_sqm": int(round(p["area"] * 10_000 * rnd.uniform(0.35, 0.6), -1)),
                "approval_date": (p["reg_date"] + timedelta(days=rnd.randint(60, 240))).isoformat(), "status": "approved"})
            assessed = self.assessed(p, consideration)
            demand, paid, outstanding, status = self.tax_amounts(p, assessed, arrears=bool(p["labels"]) and rnd.random() < 0.4)
            self.add(self.TTAX, {
                "property_id": f"PT-MH-{n:03d}", "ulpin": u, "assessment_year": "2025-26", "assessed_value": assessed,
                "tax_amount": demand, "paid_amount": paid, "outstanding_amount": outstanding, "status": status})
        if p["profile"] != "rural" or rnd.random() < 0.45:
            self.add(self.TUTL, {
                "utility_id": f"UTIL-MH-{n:03d}", "ulpin": u, "electricity_status": "connected",
                "water_status": "connected" if urban else rnd.choice(["available", "connected", "not_available"]),
                "road_access": "yes" if p["profile"] != "rural" else rnd.choice(["yes", "yes", "limited"])})
        if p["profile"] == "rural" and rnd.random() < 0.3:
            self.add(self.TENV, {"environment_id": f"ENV-MH-{n:03d}", "ulpin": u, "restriction_type": "None",
                                 "zone_name": "General", "status": "clear"})

    def parcel_row(self, p: dict) -> dict:
        systems = []
        present = {self.SYSTEM[t] for t, rows in self.new_rows.items() if any(r["ulpin"] == p["ulpin"] for r in rows)}
        if p["partial"] == "missing_registration":
            present.add("registration")  # catalogue still lists the registration feed
        for s in ("bhulekh", "eferfar", "registration", "property_card", "planning", "building", "encumbrance",
                  "property_tax", "utilities", "environment"):
            if s in present:
                systems.append(s)
        return {
            "prototype_ref": p["ref"], "ulpin": p["ulpin"], "state": "Maharashtra", "context": p["context"],
            "district": p["district"], "taluka": p["sub"], "village": p["village"],
            "native_identifier_type": p["id_type"], "native_identifier": p["survey"], "native_part": p["part"],
            "khata_no": p["khata"], "geometry_ref": f"synthetic-{p['ref'].lower()}",
            "centroid": {"lat": p["center"][1], "lon": p["center"][0]},
            "geometry": self.geometry(p["registry_ring"]),
            "geometry_area_hectare": p["geom_area"], "land_record_area_hectare": p["area"],
            "available_source_systems": systems, "quality_class": p["quality_class"], "issue": p["issue"],
            "geometry_type": "synthetic_cadastral_polygon", "boundary_vertices": p["vertices"],
        }


# ---------------------------------------------------------------------------------------
# Uttar Pradesh — Bhulekh Khatauni + Khasra, Namantaran (RCCMS), IGRSUP, BhuNaksha
# ---------------------------------------------------------------------------------------
UP_DISCOM = {
    "Lucknow": "Madhyanchal Vidyut Vitran Nigam Ltd.", "Ayodhya": "Madhyanchal Vidyut Vitran Nigam Ltd.",
    "Varanasi": "Purvanchal Vidyut Vitran Nigam Ltd.", "Prayagraj": "Purvanchal Vidyut Vitran Nigam Ltd.",
    "Gorakhpur": "Purvanchal Vidyut Vitran Nigam Ltd.", "Agra": "Dakshinanchal Vidyut Vitran Nigam Ltd.",
    "Mathura": "Dakshinanchal Vidyut Vitran Nigam Ltd.", "Jhansi": "Dakshinanchal Vidyut Vitran Nigam Ltd.",
    "Kanpur Nagar": "Dakshinanchal Vidyut Vitran Nigam Ltd.", "Meerut": "Paschimanchal Vidyut Vitran Nigam Ltd.",
    "Gautam Buddha Nagar": "Paschimanchal Vidyut Vitran Nigam Ltd.", "Ghaziabad": "Paschimanchal Vidyut Vitran Nigam Ltd.",
    "Saharanpur": "Paschimanchal Vidyut Vitran Nigam Ltd.", "Moradabad": "Paschimanchal Vidyut Vitran Nigam Ltd.",
}


class UttarPradesh(StateGen):
    code, folder, state_name, sub_key, lang = "UP", "uttar_pradesh", "Uttar Pradesh", "tehsil", "hi"
    pending_label = "PENDING_NAMANTARAN"
    TKT, TKS = ("land_records.json", "khatauni"), ("land_records.json", "khasra")
    TMUT, TREG, TBN = ("mutations.json", None), ("registrations.json", None), ("bhu_naksha.json", None)
    TPLN, TBLD, TTAX = ("planning.json", None), ("building_permissions.json", None), ("property_tax.json", None)
    TELE, TWAT = ("utilities.json", "electricity_uppcl"), ("utilities.json", "water_local_body")
    TENC, TENV = ("encumbrances.json", None), ("environment.json", None)
    tables = [TKT, TKS, TMUT, TREG, TBN, TPLN, TBLD, TTAX, TELE, TWAT, TENC, TENV]
    sql_tables = {TKT: "revenue_land_records.khatauni", TKS: "revenue_land_records.khasra",
                  TMUT: "revenue_mutation.namantaran", TREG: "stamps_registration.deed",
                  TBN: "revenue_cadastral.bhu_naksha", TPLN: "urban_planning.record",
                  TBLD: "housing_authority.building_plan_approval", TTAX: "urban_local_body.property_tax",
                  TELE: "power_distribution.electricity_connection", TWAT: "water_services.connection",
                  TENC: "rights_liabilities.encumbrance", TENV: "environmental_controls.restriction"}
    rural_anchors = ("P001", "P002", "P004", "P005", "P007", "P013", "P014", "P015", "P003", "P006")
    mixed_anchors = ("P008", "P011")
    urban_anchors = ("P009", "P010", "P012")
    clean_excluded_anchors = ("P003", "P006")  # registry village names held in Devanagari only

    def survey_of(self, p): return p["gatta_khasra_no"]
    def account_of(self, p): return p["khata_no"]

    def plan(self, n, labels, taken):
        plan = super().plan(n, labels, taken)
        rnd, a = plan["rnd"], plan["anchor"]
        plan.update(survey=self.unique_survey(a, rnd, 5, 780), part=rnd.choice(["1", "2", "3", None]),
                    khata=self.unique_account(lambda: f"{rnd.randint(1600, 9800):05d}"))
        plan["land_use"] = land_use_for(plan)
        return plan

    def records(self, p: dict) -> None:
        rnd, n, u, lu = p["rnd"], p["n"], p["ulpin"], p["land_use"]
        holder_en, holder_hi = p["holder"]
        rural = p["profile"] == "rural"
        loc = {"district": p["district"], "tehsil": p["sub"], "village": p["village"]}
        self.add(self.TKT, {
            "ulpin": u, **loc, "khata_no": p["khata"], "gatta_khasra_no": p["survey"], "sub_division": p["part"],
            "khatedar_name_hi": holder_hi, "khatedar_name_en": holder_en, "area_value": p["area"], "area_unit": "hectare",
            "land_class_hi": LAND_USE["UP"][lu], "land_class_en": lu, "possession_status": "recorded",
            "transfer_restriction": False, "record_status": "active"})
        khasra_area, map_area = p["area"], p["area"]
        if p["area_mismatch"]:
            delta = rnd.choice([-1, 1]) * rnd.uniform(0.09, 0.2)
            if rnd.random() < 0.5:
                map_area = round(p["area"] * (1 + delta), 3 if p["profile"] == "urban" else 2)
            else:
                khasra_area = round(p["area"] * (1 + delta), 3 if p["profile"] == "urban" else 2)
        self.add(self.TKS, {
            "khasra_id": f"KH-{n:04d}", "ulpin": u, **loc, "khasra_no": p["survey"], "sub_division": p["part"],
            "area_value": khasra_area, "area_unit": "hectare",
            "crop_status_hi": "खरीफ/रबी दर्ज" if rural else "फसल विवरण लागू नहीं",
            "crop_status_en": "Kharif/Rabi recorded" if rural else "Crop detail not applicable", "record_status": "active"})
        self.add(self.TBN, {
            "map_ref": f"BN-{n:04d}", "ulpin": u, **loc, "plot_no": p["survey"], "sub_division": p["part"],
            "map_area": map_area, "area_unit": "hectare", "map_status": "geo-referenced",
            "layers": ["vertices", "border_length", "labels"]})

        consideration = self.consideration(p)
        doc_no = f"UP-REG-{p['reg_date'].year}-{n:04d}"
        if p["partial"] != "missing_registration":
            self.add(self.TREG, {
                "document_no": doc_no, "ulpin": u, "district": p["district"], "tehsil": p["sub"],
                "sub_registrar_office": f"{p['sub']} Sub-Registrar Office",
                "document_type_hi": DOC_NATIVE["UP"][p["doc_type"]], "document_type_en": p["doc_type"],
                "transaction_type": p["doc_type"].split()[0], "registration_date": p["reg_date"].isoformat(),
                "seller_name_hi": p["seller"][1], "seller_name_en": p["seller"][0],
                "buyer_name_hi": p["buyer"][1], "buyer_name_en": p["buyer"][0], "consideration_value": consideration,
                "stamp_duty": round(consideration * 0.06, 1), "registration_fee": round(consideration * 0.01, 1),
                "status": "registered", "source_system": "IGRSUP"})
        if p["partial"] != "missing_mutation":
            self.add(self.TMUT, {
                "mutation_no": f"NAM-{p['app_date'].year}-{n:04d}", "ulpin": u,
                "application_no": f"NAMAPP-{p['app_date'].year}-{5100 + n}",
                "process_type_hi": "नामान्तरण", "process_type_en": "Namantaran",
                "application_date": p["app_date"].isoformat(), "khasra_no": p["survey"], "khata_no": p["khata"],
                "linked_document_no": doc_no, "status_hi": "लंबित" if p["pending"] else "निस्तारित",
                "status_en": "Pending" if p["pending"] else "Disposed",
                "order_no": None if p["pending"] else f"ORD-UP-{n:04d}"})

        if p["encumbrance"]:
            year = (p["reg_date"] + timedelta(days=rnd.randint(40, 220))).year
            self.add(self.TENC, {
                "encumbrance_id": f"ENC-UP-{n:03d}", "ulpin": u, "encumbrance_type_hi": "बंधक / भार",
                "encumbrance_type_en": "Mortgage / Charge", "reference_no": f"MTG-UP-{n:03d}",
                "holder_name_hi": "सिंथेटिक बैंक", "holder_name_en": "Synthetic Bank", "status": "active",
                "litigation_flag": True, "court_case_reference": f"RCCMS-{year}-{p['district'][:3].upper()}-{n:04d}"})
        elif rural and rnd.random() < 0.15:
            self.add(self.TENC, {
                "encumbrance_id": f"ENC-UP-{n:03d}", "ulpin": u, "encumbrance_type_hi": "बंधक",
                "encumbrance_type_en": "Mortgage", "reference_no": f"MTG-UP-{n:03d}",
                "holder_name_hi": "सिंथेटिक बैंक", "holder_name_en": "Synthetic Bank", "status": "released",
                "litigation_flag": False, "court_case_reference": None})

        if not rural or rnd.random() < 0.6:
            code, zen, zhi = ZONE["UP"][lu]
            self.add(self.TPLN, {
                "ulpin": u, "planning_authority": f"{p['district']} Development Authority",
                "plan_reference": f"{p['district']} Regional/Development Plan (Synthetic)", "zone_code": code,
                "zone_name_hi": zhi, "zone_name_en": zen, "permitted_use": lu, "restriction_status": "none"})
        if not rural:
            self.add(self.TBLD, {
                "approval_no": f"BP-UP-{n:03d}-{p['reg_date'].year}", "ulpin": u, "application_no": f"BPAPP-UP-{n:03d}",
                "department": "Housing Department", "approving_authority": f"{p['district']} Development Authority",
                "service": "Building Plan Approval", "building_use": lu,
                "built_up_area_sqm": int(round(p["area"] * 10_000 * rnd.uniform(0.35, 0.6), -1)),
                "approval_date": (p["reg_date"] + timedelta(days=rnd.randint(60, 240))).isoformat(), "status": "approved"})
            assessed = self.assessed(p, consideration)
            demand, paid, outstanding, status = self.tax_amounts(p, assessed, arrears=bool(p["labels"]) and rnd.random() < 0.4)
            self.add(self.TTAX, {
                "property_tax_id": f"ULB-TAX-{n:03d}", "ulpin": u, "local_body": f"{p['district']} Urban Local Body (Synthetic)",
                "assessment_year": "2025-26", "assessed_value": assessed, "tax_demand": demand, "amount_paid": paid,
                "outstanding_amount": outstanding, "status": status})
            self.add(self.TWAT, {
                "water_connection_id": f"WAT-{n:03d}", "ulpin": u, "provider": "Urban Water Supply / Local Body",
                "connection_status": rnd.choice(["connected", "connected", "connected", "pending"]),
                "connection_number": f"UPW{n:03d}{rnd.randint(100, 999)}"})
        if not rural or rnd.random() < 0.5:
            self.add(self.TELE, {
                "utility_id": f"ELEC-{n:03d}", "ulpin": u, "provider": "UPPCL", "discom": UP_DISCOM[p["district"]],
                "consumer_account_no": f"UPE{n:04d}{rnd.randint(1000, 9999)}", "connection_status": "connected",
                "supply_category": "agricultural" if rural else "domestic" if lu == "Residential" else "commercial"})
        if rural and rnd.random() < 0.2:
            self.add(self.TENV, {
                "environment_id": f"ENV-UP-{n:03d}", "ulpin": u,
                "source_authority": "Uttar Pradesh environmental authority (Synthetic)",
                "restriction_type": "None", "zone_name": "General", "status": "clear"})

    def parcel_row(self, p: dict) -> dict:
        return {
            "prototype_ref": p["ref"], "ulpin": p["ulpin"], "state": "Uttar Pradesh", "context": p["context"],
            "district": p["district"], "tehsil": p["sub"], "village": p["village"], "gatta_khasra_no": p["survey"],
            "sub_division": p["part"], "khata_no": p["khata"], "geometry_ref": f"synthetic-{p['ref'].lower()}",
            "centroid": {"lat": p["center"][1], "lon": p["center"][0]}, "geometry": self.geometry(p["registry_ring"]),
            "geometry_area_hectare": p["geom_area"], "land_record_area_hectare": p["area"],
            "quality_class": p["quality_class"], "issue": p["issue"], "geometry_type": "synthetic_cadastral_polygon",
            "boundary_vertices": p["vertices"],
        }


# ---------------------------------------------------------------------------------------
# Gujarat — e-Dhara VF 7/12, VF 8A, VF 6, City Survey Property Card, Garvi registration
# ---------------------------------------------------------------------------------------
GJ_DISCOM = {"Ahmedabad": "UGVCL", "Gandhinagar": "UGVCL", "Mehsana": "UGVCL", "Banaskantha": "UGVCL",
             "Vadodara": "MGVCL", "Anand": "MGVCL", "Panchmahal": "MGVCL", "Rajkot": "PGVCL", "Bhavnagar": "PGVCL",
             "Kutch": "PGVCL", "Surat": "DGVCL"}
GJ_CARD = {"Ahmedabad": "AHD", "Vadodara": "VAD", "Surat": "SRT", "Rajkot": "RJT", "Gandhinagar": "GNR"}


class Gujarat(StateGen):
    code, folder, state_name, sub_key, lang = "GJ", "gujarat", "Gujarat", "taluka", "gu"
    pending_label = "PENDING_VF6"
    T712, T8A = ("land_records.json", "vf7_12"), ("land_records.json", "vf8a")
    TMUT, TPC, TREG = ("mutations.json", None), ("property_cards.json", None), ("registrations.json", None)
    TPLN, TBLD, TENC = ("planning.json", None), ("building_permissions.json", None), ("encumbrances.json", None)
    TTAX, TELE, TWAT = ("property_tax.json", None), ("utilities.json", "electricity"), ("utilities.json", "water")
    TENV = ("environment.json", None)
    tables = [T712, T8A, TMUT, TPC, TREG, TPLN, TBLD, TENC, TTAX, TELE, TWAT, TENV]
    sql_tables = {T712: "e_dhara.vf7_12", T8A: "e_dhara.vf8a", TMUT: "e_dhara.vf6_mutation",
                  TPC: "city_survey.property_card", TREG: "registration_stamps.document", TPLN: "planning.record",
                  TBLD: "building_approval.plan_permission", TENC: "rights_liabilities.encumbrance",
                  TTAX: "urban_local_body.property_tax", TELE: "power_distribution.connection",
                  TWAT: "water_services.connection", TENV: "environmental_controls.restriction"}
    rural_anchors = ("P001", "P002", "P003", "P005", "P006", "P007", "P013", "P014", "P015")
    mixed_anchors = ("P004", "P008", "P011", "P012")
    urban_anchors = ("P009", "P010")

    def survey_of(self, p): return p["survey_no"]
    def account_of(self, p): return p["record_of_rights_no"]

    def plan(self, n, labels, taken):
        plan = super().plan(n, labels, taken)
        rnd, a = plan["rnd"], plan["anchor"]
        if plan["profile"] == "urban":
            plan.update(survey=self.unique_survey(a, rnd, 60, 980), part=None, khata=None,
                        city_survey=str(rnd.randint(100, 4800)))
        else:
            plan.update(survey=self.unique_survey(a, rnd, 5, 760), part=rnd.choice(["1", "2", "3", "4", None]),
                        khata=self.unique_account(lambda: f"{rnd.randint(1600, 9800):05d}"))
        plan["land_use"] = land_use_for(plan)
        return plan

    def records(self, p: dict) -> None:
        rnd, n, u, lu = p["rnd"], p["n"], p["ulpin"], p["land_use"]
        holder_en, holder_gu = p["holder"]
        urban = p["profile"] == "urban"
        active_charge_noted = p["encumbrance"] and rnd.random() < 0.5
        if not urban:
            self.add(self.T712, {
                "ulpin": u, "district": p["district"], "taluka": p["sub"], "village": p["village"],
                "survey_no": p["survey"], "sub_division": p["part"], "record_of_rights_no": p["khata"],
                "khatedar_name_gu": holder_gu, "khatedar_name_en": holder_en, "area_value": p["area"],
                "area_unit": "hectare", "land_class_gu": LAND_USE["GJ"][lu], "land_class_en": lu,
                "assessment": round(1100 + 900 * p["area"], 1),
                "other_rights_note": f"ગીરો / બોજો: સિન્થેટિક બેંક (MTG-GJ-{n:03d})" if active_charge_noted else None,
                "record_status": "active"})
            a8 = p["area"]
            if p["area_mismatch"]:
                a8 = round(p["area"] + rnd.choice([-1, 1]) * rnd.uniform(0.03, 0.15), 2)
            self.add(self.T8A, {
                "ulpin": u, "record_of_rights_no": p["khata"], "holder_name_gu": holder_gu, "holder_name_en": holder_en,
                "land_measurement_numbers": [{"survey_no": p["survey"], "sub_division": p["part"]}],
                "total_holding_area": a8, "area_unit": "hectare", "land_revenue": round(840 + 400 * a8, 1),
                "record_status": "active"})
        else:
            sqm = int(round(p["area"] * 10_000))
            if p["area_mismatch"]:
                sqm = int(round(sqm * (1 + rnd.choice([-1, 1]) * rnd.uniform(0.06, 0.15))))
            self.add(self.TPC, {
                "property_card_no": f"PC-{GJ_CARD.get(p['district'], p['district'][:3].upper())}-{p['city_survey']}",
                "ulpin": u, "city_survey_no": p["city_survey"], "district": p["district"], "taluka": p["sub"],
                "ward_no": str(rnd.randint(1, 40)), "sheet_no": f"{p['district'][0]}-{rnd.randint(1, 18)}",
                "holder_name_gu": holder_gu, "holder_name_en": holder_en, "area_value": sqm, "area_unit": "sqm",
                "record_status": "active"})

        consideration = self.consideration(p)
        doc_no = f"GUJ-REG-{n:04d}"
        if p["partial"] != "missing_registration":
            self.add(self.TREG, {
                "document_no": doc_no, "ulpin": u, "district": p["district"], "taluka": p["sub"],
                "sub_registrar_office": f"{p['sub']} Sub-Registrar Office",
                "document_type_gu": DOC_NATIVE["GJ"][p["doc_type"]], "document_type_en": p["doc_type"],
                "transaction_type": p["doc_type"].split()[0], "registration_date": p["reg_date"].isoformat(),
                "seller_name_gu": p["seller"][1], "seller_name_en": p["seller"][0],
                "buyer_name_gu": p["buyer"][1], "buyer_name_en": p["buyer"][0], "consideration_value": consideration,
                "status": "registered"})
        if p["partial"] != "missing_mutation":
            self.add(self.TMUT, {
                "vf6_entry_no": f"VF6-{p['app_date'].year}-{n:04d}", "ulpin": u,
                "application_no": f"EDH-{p['app_date'].year}-{5100 + n}",
                "mutation_type_gu": "હક હસ્તાંતરણ", "mutation_type_en": "Right Transfer",
                "application_date": p["app_date"].isoformat(), "survey_no": p["survey"], "sub_division": p["part"],
                "record_of_rights_no": p["khata"], "linked_document_no": doc_no,
                "status_gu": "બાકી" if p["pending"] else "પ્રમાણિત", "status_en": "Pending" if p["pending"] else "Certified"})

        if p["encumbrance"]:
            year = (p["reg_date"] + timedelta(days=rnd.randint(40, 220))).year
            self.add(self.TENC, {
                "encumbrance_id": f"ENC-GJ-{n:03d}", "ulpin": u, "encumbrance_type_gu": "ગીરો / બોજો",
                "encumbrance_type_en": "Mortgage / Charge", "reference_no": f"MTG-GJ-{n:03d}",
                "holder_name_gu": "સિન્થેટિક બેંક", "holder_name_en": "Synthetic Bank", "status": "active",
                "litigation_flag": True, "court_case_reference": f"RTS-APPEAL-{n:03d}-{year}"})
        elif not urban and rnd.random() < 0.15:
            self.add(self.TENC, {
                "encumbrance_id": f"ENC-GJ-{n:03d}", "ulpin": u, "encumbrance_type_gu": "બોજો",
                "encumbrance_type_en": "Charge", "reference_no": f"MTG-GJ-{n:03d}",
                "holder_name_gu": "સિન્થેટિક બેંક", "holder_name_en": "Synthetic Bank", "status": "released",
                "litigation_flag": False, "court_case_reference": None})

        if p["profile"] != "rural" or rnd.random() < 0.6:
            code, zen, zgu = ZONE["GJ"][lu]
            self.add(self.TPLN, {
                "ulpin": u, "planning_authority": f"{p['district']} Planning Authority",
                "plan_reference": f"{p['district']} Development/Regional Plan (Synthetic)", "zone_code": code,
                "zone_name_gu": zgu, "zone_name_en": zen, "permitted_use": lu, "restriction_status": "none"})
        if p["profile"] != "rural":
            self.add(self.TBLD, {
                "approval_no": f"BP-GJ-{n:03d}-{p['reg_date'].year}", "ulpin": u, "application_no": f"BPAPP-GJ-{n:03d}",
                "department_or_authority": "Development Authority / Local Planning Authority",
                "service": "Building Plan Approval", "building_use": lu,
                "built_up_area_sqm": int(round(p["area"] * 10_000 * rnd.uniform(0.35, 0.6), -1)),
                "approval_date": (p["reg_date"] + timedelta(days=rnd.randint(60, 240))).isoformat(), "status": "approved"})
            assessed = self.assessed(p, consideration)
            demand, paid, outstanding, status = self.tax_amounts(p, assessed, arrears=bool(p["labels"]) and rnd.random() < 0.4)
            self.add(self.TTAX, {
                "property_tax_id": f"ULB-TAX-GJ-{n:03d}", "ulpin": u,
                "local_body": f"{p['district']} Urban Local Body (Synthetic)", "assessment_year": "2025-26",
                "assessed_value": assessed, "tax_demand": demand, "amount_paid": paid,
                "outstanding_amount": outstanding, "status": status})
            self.add(self.TWAT, {
                "utility_id": f"WATER-GJ-{n:03d}", "ulpin": u, "service_type": "water",
                "provider": "Local Urban Body / Water Supply", "distribution_company": None,
                "consumer_account_no": f"WATGJ{n:03d}{rnd.randint(100, 999)}",
                "connection_status": rnd.choice(["connected", "connected", "connected", "pending"]),
                "supply_category": "domestic"})
        if p["profile"] != "rural" or rnd.random() < 0.5:
            self.add(self.TELE, {
                "utility_id": f"ELEC-GJ-{n:03d}", "ulpin": u, "service_type": "electricity",
                "provider": "Gujarat Urja Vikas Nigam Ltd.", "distribution_company": GJ_DISCOM[p["district"]],
                "consumer_account_no": f"GJE{n:04d}{rnd.randint(1000, 9999)}", "connection_status": "connected",
                "supply_category": "agricultural" if p["profile"] == "rural" else "domestic" if lu == "Residential" else "commercial"})
        if p["profile"] == "rural" and rnd.random() < 0.2:
            self.add(self.TENV, {
                "environment_id": f"ENV-GJ-{n:03d}", "ulpin": u,
                "source_authority": "Gujarat environmental authority (Synthetic)",
                "restriction_type": "None", "zone_name": "General", "status": "clear"})

    def parcel_row(self, p: dict) -> dict:
        return {
            "prototype_ref": p["ref"], "ulpin": p["ulpin"], "state": "Gujarat", "context": p["context"],
            "district": p["district"], "taluka": p["sub"], "village": p["village"], "survey_no": p["survey"],
            "sub_division": p["part"], "record_of_rights_no": p["khata"], "geometry_ref": f"synthetic-{p['ref'].lower()}",
            "centroid": {"lat": p["center"][1], "lon": p["center"][0]}, "geometry": self.geometry(p["registry_ring"]),
            "geometry_area_hectare": p["geom_area"], "land_record_area_hectare": p["area"],
            "quality_class": p["quality_class"], "issue": p["issue"], "geometry_type": "synthetic_cadastral_polygon",
            "boundary_vertices": p["vertices"],
        }


# ---------------------------------------------------------------------------------------
def main() -> None:
    gens = [Maharashtra(), UttarPradesh(), Gujarat()]
    taken = set().union(*(g.original_ulpins for g in gens))  # ULPINs are unique across all states
    for g in gens:
        g.generate(taken)
    for g in gens:
        g.write()
        labels = [p["issue"] for p in g.new_parcels if p["issue"]]
        print(f"{g.state_name}: {len(g.parcels) + len(g.new_parcels)} parcels "
              f"(P001–P015 unchanged; {len(g.new_parcels) - len(labels)} consistent + {len(labels)} with issues added)")


if __name__ == "__main__":
    main()
