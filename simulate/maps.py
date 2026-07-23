import numpy as np
from shapely.geometry import Polygon, Point

def get_garden_maps():
    """Returns a list of 10 different garden shapes as Shapely Polygons (units in meters)."""
    maps = []

    # 1. Simple Square (10x10m)
    maps.append(Polygon([(0, 0), (10, 0), (10, 10), (0, 10)]))

    # 2. L-Shaped Garden
    maps.append(Polygon([(0, 0), (12, 0), (12, 5), (5, 5), (5, 12), (0, 12)]))

    # 3. U-Shaped Garden
    maps.append(Polygon([(0, 0), (15, 0), (15, 15), (10, 15), (10, 5), (5, 5), (5, 15), (0, 15)]))

    # 4. T-Shaped Garden
    maps.append(Polygon([(0, 5), (5, 5), (5, 0), (10, 0), (10, 5), (15, 5), (15, 10), (0, 10)]))

    # 5. Irregular Hexagon
    maps.append(Polygon([(2, 0), (8, 0), (12, 4), (10, 10), (4, 12), (0, 6)]))

    # 6. Narrow Corridor Garden
    maps.append(Polygon([(0, 0), (20, 0), (20, 3), (12, 3), (12, 8), (10, 8), (10, 3), (0, 3)]))

    # 7. The "Bite" Garden (Square with a chunk missing)
    maps.append(Polygon([(0, 0), (10, 0), (10, 10), (7, 10), (7, 7), (3, 7), (3, 10), (0, 10)]))

    # 8. Large Irregular
    maps.append(Polygon([(0, 0), (18, 2), (15, 15), (5, 18), (-2, 10)]))

    # 9. Zig-Zag Garden
    maps.append(Polygon([(0, 0), (5, 0), (5, 5), (10, 5), (10, 0), (15, 0), (15, 10), (0, 10)]))

    # 10. Garden with an Island (represented as a polygon with a hole)
    # Note: For simplicity in the simulator, we'll treat the hole as an obstacle.
    # Outer: 12x12, Inner: 4x4
    exterior = [(0, 0), (12, 0), (12, 12), (0, 12)]
    interiors = [[(4, 4), (8, 4), (8, 8), (4, 8)]]
    maps.append(Polygon(exterior, interiors))

    # 11. Thin U-shape with one big square arm
    maps.append(Polygon([(0, 15), (1, 15), (1, 1), (10, 1), (10, 10), (20, 10), (20, 0), (0, 0), (0, 15)]))

    return maps

if __name__ == "__main__":
    # Test print
    gardens = get_garden_maps()
    for i, g in enumerate(gardens):
        print(f"Garden {i+1} Area: {g.area:.2f} m2")
