"""Normalize the generated Anju sprite into the runtime's 4x4 transparent grid."""

from collections import deque
from pathlib import Path
import sys

from PIL import Image


def is_sheet_background(pixel):
    red, green, blue = pixel[:3]
    return min(red, green, blue) >= 208 and max(red, green, blue) - min(red, green, blue) <= 22


def remove_connected_background(image):
    rgba = image.convert("RGBA")
    if image.mode == "RGBA" and rgba.getpixel((0, 0))[3] < 8:
        return rgba
    width, height = rgba.size
    pixels = rgba.load()
    seen = bytearray(width * height)
    queue = deque()

    def seed(x, y):
        offset = y * width + x
        if not seen[offset] and is_sheet_background(pixels[x, y]):
            seen[offset] = 1
            queue.append((x, y))

    for x in range(width):
        seed(x, 0)
        seed(x, height - 1)
    for y in range(height):
        seed(0, y)
        seed(width - 1, y)

    while queue:
        x, y = queue.popleft()
        red, green, blue, _ = pixels[x, y]
        pixels[x, y] = (red, green, blue, 0)
        if x:
            seed(x - 1, y)
        if x + 1 < width:
            seed(x + 1, y)
        if y:
            seed(x, y - 1)
        if y + 1 < height:
            seed(x, y + 1)
    return rgba


def connected_components(alpha):
    width, height = alpha.size
    values = alpha.load()
    seen = bytearray(width * height)
    components = []
    for start_y in range(height):
        for start_x in range(width):
            offset = start_y * width + start_x
            if seen[offset] or values[start_x, start_y] < 20:
                continue
            seen[offset] = 1
            queue = deque([(start_x, start_y)])
            points = []
            while queue:
                x, y = queue.popleft()
                points.append((x, y))
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= nx < width and 0 <= ny < height:
                        index = ny * width + nx
                        if not seen[index] and values[nx, ny] >= 20:
                            seen[index] = 1
                            queue.append((nx, ny))
            components.append(points)
    return components


def extract_primary_poses(image):
    """Find the 16 complete character components instead of trusting generated cell edges."""
    components = sorted(connected_components(image.getchannel("A")), key=len, reverse=True)[:16]
    if len(components) != 16:
        raise ValueError(f"expected 16 primary poses, found {len(components)}")
    records = []
    source_pixels = image.load()
    for points in components:
        min_x = min(x for x, _ in points)
        max_x = max(x for x, _ in points)
        min_y = min(y for _, y in points)
        max_y = max(y for _, y in points)
        pose = Image.new("RGBA", (max_x - min_x + 1, max_y - min_y + 1), (0, 0, 0, 0))
        pose_pixels = pose.load()
        for x, y in points:
            pose_pixels[x - min_x, y - min_y] = source_pixels[x, y]
        records.append({"pose": pose, "cx": (min_x + max_x) / 2, "cy": (min_y + max_y) / 2})
    records.sort(key=lambda record: record["cy"])
    ordered = []
    for row in range(4):
        ordered.extend(sorted(records[row * 4:(row + 1) * 4], key=lambda record: record["cx"]))
    return [record["pose"] for record in ordered]


def build_sprite(source, target):
    source_image = remove_connected_background(Image.open(source))
    output = Image.new("RGBA", (1536, 1024), (0, 0, 0, 0))
    cell_width, cell_height = 384, 256
    poses = extract_primary_poses(source_image)

    for index, subject in enumerate(poses):
        row, column = divmod(index, 4)
        scale = min(300 / subject.width, 218 / subject.height)
        size = (max(1, round(subject.width * scale)), max(1, round(subject.height * scale)))
        subject = subject.resize(size, Image.Resampling.LANCZOS)
        x = column * cell_width + (cell_width - size[0]) // 2
        y = row * cell_height + (cell_height - size[1]) // 2
        output.alpha_composite(subject, (x, y))

    target.parent.mkdir(parents=True, exist_ok=True)
    output.save(target, optimize=True)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: build-anju-sprite-v2.py SOURCE TARGET")
    build_sprite(Path(sys.argv[1]), Path(sys.argv[2]))
