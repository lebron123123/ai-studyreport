"""Build a first-pass layered Live2D PSD from the approved An Xiaoju H1 anchor.

The script keeps every extracted pixel from the approved source unchanged.  Parts
are separated with disjoint masks so the visible stack recomposes to the source;
small white eye underlays are added below the movable irises for gaze movement.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(r"C:\Users\HP\Desktop\ai-studyreport-local")
SOURCE = ROOT / "outputs" / "pet-video-source" / "安小居" / "安小居基准待机.png"
OUT = ROOT / "outputs" / "pet-live2d-source" / "安小居"
LAYERS_DIR = OUT / "layers-v1"
PSD_PATH = OUT / "安小居_Live2D分层导入_v2_兼容Cubism.psd"
PREVIEW_PATH = OUT / "安小居_Live2D分层预览_v1.png"
GUIDE_PATH = OUT / "安小居_Live2D原图参考_v1.png"

VENDOR = ROOT / "tools" / "vendor" / "pytoshop"
sys.path.insert(0, str(VENDOR))

from pytoshop import enums  # noqa: E402
from pytoshop.user import nested_layers  # noqa: E402


def chroma_key(rgb: Image.Image) -> Image.Image:
    arr = np.asarray(rgb.convert("RGB"), dtype=np.float32)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    green_excess = np.maximum(g - np.maximum(r, b), 0.0)
    alpha = np.clip(255.0 - green_excess * 1.22, 0.0, 255.0)
    alpha[(g > 238) & (r < 40) & (b < 40)] = 0.0
    alpha[alpha < 12] = 0.0

    # Remove green spill by solving the foreground color against #00ff00.
    a = np.maximum(alpha / 255.0, 1e-4)
    out = np.empty_like(arr)
    out[..., 0] = np.clip(r / a, 0, 255)
    out[..., 2] = np.clip(b / a, 0, 255)
    out[..., 1] = np.clip((g - (1.0 - a) * 255.0) / a, 0, 255)
    rgba = np.dstack([out, alpha]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def shape_mask(size, kind, values, blur=1.0):
    mask = Image.new("L", size, 0)
    d = ImageDraw.Draw(mask)
    if kind == "polygon":
        d.polygon(values, fill=255)
    elif kind == "ellipse":
        d.ellipse(values, fill=255)
    elif kind == "rectangle":
        d.rectangle(values, fill=255)
    else:
        raise ValueError(kind)
    if blur:
        mask = mask.filter(ImageFilter.GaussianBlur(blur))
    return mask


def intersect(a, b):
    return ImageChops.multiply(a, b)


def subtract(a, b):
    return ImageChops.subtract(a, b)


def layer_from_mask(source_rgba, mask):
    layer = source_rgba.copy()
    layer.putalpha(intersect(source_rgba.getchannel("A"), mask))
    return layer


def bbox_crop(layer):
    bbox = layer.getbbox()
    if bbox is None:
        return layer, 0, 0
    return layer.crop(bbox), bbox[0], bbox[1]


def psd_image(name, rgba):
    crop, left, top = bbox_crop(rgba)
    arr = np.asarray(crop, dtype=np.uint8)
    channels = {
        enums.ChannelId.red: arr[..., 0],
        enums.ChannelId.green: arr[..., 1],
        enums.ChannelId.blue: arr[..., 2],
        enums.ChannelId.transparency: arr[..., 3],
    }
    return nested_layers.Image(
        name=name,
        top=int(top),
        left=int(left),
        channels=channels,
        color_mode=enums.ColorMode.rgb,
    )


def save_layer(name, image):
    image.save(LAYERS_DIR / f"{name}.png")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    LAYERS_DIR.mkdir(parents=True, exist_ok=True)
    src_rgb = Image.open(SOURCE).convert("RGB")
    src = chroma_key(src_rgb)
    width, height = src.size
    alpha = src.getchannel("A")

    # Masks are deliberately disjoint after priority subtraction. Coordinates
    # match the approved 1254x1254 H1 anchor, not the alternate mascot sheet.
    masks = {
        "屋顶": shape_mask(src.size, "polygon", [
            (625, 185), (920, 425), (920, 535), (885, 575),
            (625, 375), (370, 575), (330, 535), (330, 425),
        ], 1.4),
        "左臂": shape_mask(src.size, "polygon", [
            (275, 685), (305, 625), (350, 610), (395, 655),
            (410, 770), (370, 845), (300, 850), (260, 805),
        ], 1.4),
        "右臂": shape_mask(src.size, "polygon", [
            (855, 650), (900, 610), (950, 630), (982, 690),
            (995, 800), (955, 850), (885, 842), (845, 770),
        ], 1.4),
        "左腿鞋": shape_mask(src.size, "polygon", [
            (390, 800), (615, 800), (620, 1020), (375, 1020)
        ], 1.2),
        "右腿鞋": shape_mask(src.size, "polygon", [
            (615, 800), (860, 800), (875, 1020), (615, 1020)
        ], 1.2),
        "中央尖角": shape_mask(src.size, "polygon", [
            (625, 650), (755, 755), (755, 840), (690, 875),
            (625, 825), (560, 875), (495, 840), (495, 755)
        ], 1.1),
        "左眼球": shape_mask(src.size, "ellipse", (490, 510, 570, 628), 0.8),
        "右眼球": shape_mask(src.size, "ellipse", (687, 510, 767, 628), 0.8),
        "左眉": shape_mask(src.size, "ellipse", (470, 430, 580, 490), 0.7),
        "右眉": shape_mask(src.size, "ellipse", (675, 430, 785, 490), 0.7),
        "嘴": shape_mask(src.size, "ellipse", (585, 590, 675, 655), 0.7),
    }

    priority = [
        "左眼球", "右眼球", "左眉", "右眉", "嘴", "中央尖角",
        "左臂", "右臂", "左腿鞋", "右腿鞋", "屋顶",
    ]
    remaining = alpha.copy()
    extracted = {}
    for name in priority:
        part_mask = intersect(remaining, masks[name])
        extracted[name] = layer_from_mask(src, part_mask)
        remaining = subtract(remaining, part_mask)
    extracted["主体脸部"] = layer_from_mask(src, remaining)

    # Eye underlays appear only where the movable iris was removed. They let the
    # pupil translate a few pixels without exposing transparency.
    eye_underlays = {}
    for side, box in (("左", (490, 510, 570, 628)), ("右", (687, 510, 767, 628))):
        underlay = Image.new("RGBA", src.size, (0, 0, 0, 0))
        fill = Image.new("RGBA", src.size, (247, 249, 255, 255))
        m = shape_mask(src.size, "ellipse", box, 2.0)
        underlay = Image.composite(fill, underlay, m)
        eye_underlays[f"{side}眼白补底"] = underlay

    # Save individual transparent PNGs for later single-part replacement.
    for name, image in {**extracted, **eye_underlays}.items():
        save_layer(name, image)
    src.save(GUIDE_PATH)

    # Layer order is top-to-bottom. Keep layers flat: Cubism 5.3's PSD reader
    # rejects third-party group layers using Photoshop's pass-through blend mode.
    psd_layers = [
        psd_image("嘴", extracted["嘴"]),
        psd_image("右眉", extracted["右眉"]),
        psd_image("左眉", extracted["左眉"]),
        psd_image("右眼球_可跟随", extracted["右眼球"]),
        psd_image("左眼球_可跟随", extracted["左眼球"]),
        psd_image("右眼白补底", eye_underlays["右眼白补底"]),
        psd_image("左眼白补底", eye_underlays["左眼白补底"]),
        psd_image("中央尖角", extracted["中央尖角"]),
        psd_image("右臂_可互动", extracted["右臂"]),
        psd_image("左臂_可互动", extracted["左臂"]),
        psd_image("右腿鞋", extracted["右腿鞋"]),
        psd_image("左腿鞋", extracted["左腿鞋"]),
        psd_image("主体脸部", extracted["主体脸部"]),
        psd_image("屋顶", extracted["屋顶"]),
    ]

    psd = nested_layers.nested_layers_to_psd(
        psd_layers,
        enums.ColorMode.rgb,
        compression=enums.Compression.raw,
        depth=enums.ColorDepth.depth8,
        size=(width, height),
    )
    with open(PSD_PATH, "wb") as fd:
        psd.write(fd)

    # Reconstruction preview excludes the synthetic underlay where the original
    # iris already covers it, therefore it should visually match the keyed source.
    preview = Image.new("RGBA", src.size, (0, 0, 0, 0))
    for name in reversed(priority + ["主体脸部"]):
        preview.alpha_composite(extracted[name])
    preview.save(PREVIEW_PATH)

    print("LIVE2D_PSD_DONE")
    print(PSD_PATH)
    print(PREVIEW_PATH)


if __name__ == "__main__":
    main()
