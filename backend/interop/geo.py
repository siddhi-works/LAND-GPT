"""Minimal, dependency-free planar/spherical geometry for cadastral polygons.

Only what the validation engine needs: geodesic polygon area, point-in-polygon,
ring validity and polygon intersection. Coordinates are GeoJSON [lon, lat] (WGS84).
"""
from __future__ import annotations

import math
from typing import Sequence

Ring = Sequence[Sequence[float]]

# WGS84 semi-major axis, as used by common GeoJSON area implementations (e.g. turf.js).
EARTH_RADIUS_M = 6378137.0
AREA_METHOD = "spherical-excess ring area on a sphere of radius 6378137 m (WGS84 semi-major axis)"


def ring_area_m2(ring: Ring) -> float:
    """Unsigned area of a closed lon/lat ring in square metres."""
    if len(ring) < 4:
        return 0.0
    total = 0.0
    for i in range(len(ring) - 1):
        lon1, lat1 = math.radians(ring[i][0]), math.radians(ring[i][1])
        lon2, lat2 = math.radians(ring[i + 1][0]), math.radians(ring[i + 1][1])
        total += (lon2 - lon1) * (2 + math.sin(lat1) + math.sin(lat2))
    return abs(total * EARTH_RADIUS_M * EARTH_RADIUS_M / 2.0)


def polygon_area_ha(geometry: dict) -> float | None:
    """Area in hectares of a GeoJSON Polygon (outer ring minus holes). None if unsupported."""
    if not geometry or geometry.get("type") != "Polygon":
        return None
    rings = geometry.get("coordinates") or []
    if not rings:
        return None
    area = ring_area_m2(rings[0]) - sum(ring_area_m2(r) for r in rings[1:])
    return area / 10_000.0


def point_in_ring(point: Sequence[float], ring: Ring) -> bool:
    x, y = point[0], point[1]
    inside = False
    for i in range(len(ring) - 1):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[i + 1][0], ring[i + 1][1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def _orient(a, b, c) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _on_segment(a, b, c) -> bool:
    return min(a[0], b[0]) <= c[0] <= max(a[0], b[0]) and min(a[1], b[1]) <= c[1] <= max(a[1], b[1])


def segments_intersect(p1, p2, q1, q2) -> bool:
    d1, d2 = _orient(q1, q2, p1), _orient(q1, q2, p2)
    d3, d4 = _orient(p1, p2, q1), _orient(p1, p2, q2)
    if ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0)) and d1 and d2 and d3 and d4:
        return True
    return (
        (d1 == 0 and _on_segment(q1, q2, p1))
        or (d2 == 0 and _on_segment(q1, q2, p2))
        or (d3 == 0 and _on_segment(p1, p2, q1))
        or (d4 == 0 and _on_segment(p1, p2, q2))
    )


def ring_problems(ring: Ring) -> list[str]:
    """Structural problems of a single polygon ring (empty list if valid)."""
    problems: list[str] = []
    if len(ring) < 4:
        return [f"ring has {len(ring)} positions; at least 4 required"]
    if list(ring[0]) != list(ring[-1]):
        problems.append("ring is not closed (first position differs from last)")
    n = len(ring) - 1
    for i in range(n):
        for j in range(i + 1, n):
            if j == i + 1 or (i == 0 and j == n - 1):
                continue  # adjacent edges share a vertex
            if segments_intersect(ring[i], ring[i + 1], ring[j], ring[j + 1]):
                problems.append(f"ring self-intersects (edges {i} and {j})")
                return problems
    return problems


def bbox(ring: Ring) -> tuple[float, float, float, float]:
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def _segments_cross_strictly(p1, p2, q1, q2) -> bool:
    d1, d2 = _orient(q1, q2, p1), _orient(q1, q2, p2)
    d3, d4 = _orient(p1, p2, q1), _orient(p1, p2, q2)
    return d1 * d2 < 0 and d3 * d4 < 0


def _on_boundary(point, ring: Ring) -> bool:
    for i in range(len(ring) - 1):
        if _orient(ring[i], ring[i + 1], point) == 0 and _on_segment(ring[i], ring[i + 1], point):
            return True
    return False


def rings_overlap(a: Ring, b: Ring) -> bool:
    """True if two simple rings share interior area.

    Parcels that only share a boundary edge or vertex (normal for adjacent cadastral
    parcels) do not overlap. Detects: proper edge crossings, a vertex of one ring strictly
    inside the other, and identical rings.
    """
    ax0, ay0, ax1, ay1 = bbox(a)
    bx0, by0, bx1, by1 = bbox(b)
    if ax1 <= bx0 or bx1 <= ax0 or ay1 <= by0 or by1 <= ay0:
        return False
    for i in range(len(a) - 1):
        for j in range(len(b) - 1):
            if _segments_cross_strictly(a[i], a[i + 1], b[j], b[j + 1]):
                return True
    if any(point_in_ring(p, b) and not _on_boundary(p, b) for p in a[:-1]):
        return True
    if any(point_in_ring(p, a) and not _on_boundary(p, a) for p in b[:-1]):
        return True
    return {tuple(p) for p in a} == {tuple(p) for p in b}


def outer_ring(geometry: dict | None) -> Ring | None:
    if not geometry or geometry.get("type") != "Polygon" or not geometry.get("coordinates"):
        return None
    return geometry["coordinates"][0]


def geometries_equal(g1: dict | None, g2: dict | None, tol: float = 1e-9) -> bool:
    if not g1 or not g2 or g1.get("type") != g2.get("type"):
        return False
    r1, r2 = g1.get("coordinates") or [], g2.get("coordinates") or []
    if len(r1) != len(r2):
        return False
    for ring1, ring2 in zip(r1, r2):
        if len(ring1) != len(ring2):
            return False
        for p, q in zip(ring1, ring2):
            if abs(p[0] - q[0]) > tol or abs(p[1] - q[1]) > tol:
                return False
    return True
