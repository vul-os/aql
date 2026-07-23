from shapely.geometry import Polygon
import matplotlib.pyplot as plt

def plot_polygon(poly, title):
    x, y = poly.exterior.xy
    plt.figure(figsize=(8, 8))
    plt.plot(x, y)
    plt.fill(x, y, alpha=0.3)
    plt.title(title)
    plt.axis('equal')
    plt.grid(True)
    plt.show()
    # Since I can't see the plot, I'll just print the points
    print(f"Points for {title}:")
    for p in list(poly.exterior.coords):
        print(p)

# (0, 15) -> (2, 15) -> (2, 2) -> (10, 2) -> (10, 12) -> (20, 12) -> (20, 0) -> (0, 0) -> (0, 15)
poly = Polygon([(0, 15), (2, 15), (2, 2), (10, 2), (10, 12), (20, 12), (20, 0), (0, 0), (0, 15)])
plot_polygon(poly, "Thin U with Big Square Arm")
