"""
OTEF coordinate transformation utilities
Handles ITM (EPSG:2039) to pixel coordinate conversions
"""

MODEL_BOUNDS = {
    'west': 101471.66,
    'south': 557880.98,
    'east': 194632.48,
    'north': 621404.56,
    'image_width': 1534,
    'image_height': 1046,
    'pixel_size': 60.73
}

def itm_to_pixel(x, y):
    """Convert ITM coordinates to model image pixel coordinates"""
    bounds = MODEL_BOUNDS
    px = ((x - bounds['west']) / (bounds['east'] - bounds['west'])) * bounds['image_width']
    py = ((bounds['north'] - y) / (bounds['north'] - bounds['south'])) * bounds['image_height']
    return (px, py)

def pixel_to_itm(px, py):
    """Convert model image pixel coordinates to ITM"""
    bounds = MODEL_BOUNDS
    x = bounds['west'] + (px / bounds['image_width']) * (bounds['east'] - bounds['west'])
    y = bounds['north'] - (py / bounds['image_height']) * (bounds['north'] - bounds['south'])
    return (x, y)

def bbox_itm_to_pixel(itm_bbox):
    """Convert ITM bounding box to pixel bounding box"""
    x_min, y_min, x_max, y_max = itm_bbox
    px_min, py_max = itm_to_pixel(x_min, y_min)
    px_max, py_min = itm_to_pixel(x_max, y_max)
    return [px_min, py_min, px_max, py_max]


