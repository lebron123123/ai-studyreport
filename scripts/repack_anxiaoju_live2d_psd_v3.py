"""Repack extracted Live2D layers with psd-tools for Cubism compatibility."""

from pathlib import Path
import sys


ROOT = Path(r"C:\Users\HP\Desktop\ai-studyreport-local")
VENDOR = ROOT / "tools" / "vendor" / "psd-tools"
sys.path.insert(0, str(VENDOR))

from PIL import Image  # noqa: E402
from psd_tools import PSDImage  # noqa: E402
from psd_tools.api.layers import PixelLayer  # noqa: E402


SOURCE_DIR = ROOT / "outputs" / "pet-live2d-source" / "安小居" / "layers-v1"
OUTPUT = ROOT / "outputs" / "pet-live2d-source" / "安小居" / "安小居_Live2D分层导入_v4_Cubism英文图层.psd"
SIZE = (1254, 1254)

# Bottom-to-top order. Every PNG is full-canvas RGBA and retains the approved
# anchor's exact pixels, allowing a future part to be replaced independently.
ORDER = [
    "屋顶",
    "主体脸部",
    "左腿鞋",
    "右腿鞋",
    "左臂",
    "右臂",
    "中央尖角",
    "左眼白补底",
    "右眼白补底",
    "左眼球",
    "右眼球",
    "左眉",
    "右眉",
    "嘴",
]

# Cubism can import the Unicode-named PNG files, but PSDs written by third-party
# libraries may expose mojibake layer names. Stable ASCII IDs keep rigging and
# later web-export mappings readable without changing any source pixels.
DISPLAY_NAMES = {
    "屋顶": "Roof",
    "主体脸部": "BodyFace",
    "左腿鞋": "LegShoe_L",
    "右腿鞋": "LegShoe_R",
    "左臂": "Arm_L_Interactive",
    "右臂": "Arm_R_Interactive",
    "中央尖角": "CenterTip",
    "左眼白补底": "EyeWhite_L",
    "右眼白补底": "EyeWhite_R",
    "左眼球": "Iris_L_Tracking",
    "右眼球": "Iris_R_Tracking",
    "左眉": "Brow_L",
    "右眉": "Brow_R",
    "嘴": "Mouth",
}


def main():
    psd = PSDImage.new(mode="RGB", size=SIZE, color=(0, 0, 0), depth=8)
    for name in ORDER:
        image = Image.open(SOURCE_DIR / f"{name}.png").convert("RGBA")
        display_name = DISPLAY_NAMES[name]
        layer = PixelLayer.frompil(image, psd, name=display_name, top=0, left=0)
        psd.append(layer)
    psd.save(OUTPUT, encoding="utf-8")

    # Re-open and composite as an independent structural/visual validation.
    check = PSDImage.open(OUTPUT)
    composite = check.composite(force=True)
    composite.save(OUTPUT.with_name("安小居_Live2D分层预览_v4.png"))
    print("LIVE2D_PSD_V4_DONE")
    print(OUTPUT)
    print("layers", len(check), "size", check.size, "mode", check.color_mode)


if __name__ == "__main__":
    main()
