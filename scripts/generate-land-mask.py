"""
Generate a land mask for the PM2.5 grid layer covering the full viewport bbox.

Downloads Natural Earth 50m land polygons (coastline-based, not country borders),
clips to the viewport bbox [89,1,114,30], unions into a single geometry, simplifies
at 0.01° tolerance, and writes the result as a GeoJSON FeatureCollection.

Run once from the repo root:
    pip install -r scripts/requirements.txt
    python scripts/generate-land-mask.py

Output: packages/frontend/src/data/sea-land-mask.json
"""

import json
import sys
from pathlib import Path

import requests
from shapely.geometry import box, shape, mapping
from shapely.ops import unary_union

URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector"
    "/master/geojson/ne_50m_land.geojson"
)
# Must match viewport MAX_BOUNDS in MapView.tsx
CLIP_BBOX = (89, 1, 114, 30)  # west, south, east, north
SIMPLIFY_TOLERANCE = 0.01  # degrees (~1 km); matches screen resolution at zoom 5-7
OUTPUT = Path(__file__).parent.parent / "packages/frontend/src/data/sea-land-mask.json"


def count_vertices(geom) -> int:
    """Count total coordinate pairs in a Shapely geometry."""
    coords = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
    total = 0
    for poly in coords:
        total += len(poly.exterior.coords)
        for interior in poly.interiors:
            total += len(interior.coords)
    return total


def main() -> None:
    print(f"Downloading NE 50m land polygons from Natural Earth…")
    resp = requests.get(URL, timeout=120)
    resp.raise_for_status()
    data = resp.json()
    print(f"  Downloaded {len(resp.content) / 1024:.0f} KB, {len(data['features'])} features total")

    clip_box = box(*CLIP_BBOX)

    # Clip each feature to the viewport bbox and collect non-empty results
    clipped = []
    for feature in data["features"]:
        geom = shape(feature["geometry"])
        if geom.intersects(clip_box):
            intersection = geom.intersection(clip_box)
            if not intersection.is_empty:
                clipped.append(intersection)
    print(f"  Features intersecting bbox {CLIP_BBOX}: {len(clipped)}")

    if not clipped:
        print("ERROR: no land features found within bbox", file=sys.stderr)
        sys.exit(1)

    # Union into a single polygon
    print("Merging with unary_union…")
    merged = unary_union(clipped)
    vertices_before = count_vertices(merged)
    print(f"  Merged geometry type: {merged.geom_type}")
    print(f"  Vertices before simplification: {vertices_before:,}")

    # Simplify
    simplified = merged.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)
    vertices_after = count_vertices(simplified)
    reduction = (1 - vertices_after / vertices_before) * 100
    print(f"  Vertices after  simplification: {vertices_after:,}  ({reduction:.0f}% reduction)")

    # Write as GeoJSON FeatureCollection with a single Feature
    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": mapping(simplified),
                "properties": {},
            }
        ],
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w") as f:
        json.dump(geojson, f, separators=(",", ":"))

    size_kb = OUTPUT.stat().st_size / 1024
    print(f"\nWrote {OUTPUT}  ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
