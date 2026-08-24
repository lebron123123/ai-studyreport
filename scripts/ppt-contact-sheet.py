"""Build numbered contact sheets from a directory of rendered PPT slide images."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def natural_key(path: Path) -> tuple:
    return tuple(int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", path.name))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_dir")
    parser.add_argument("output_prefix")
    parser.add_argument("--cols", type=int, default=4)
    parser.add_argument("--rows", type=int, default=4)
    args = parser.parse_args()

    source = Path(args.input_dir)
    images = sorted(
        (p for p in source.iterdir() if p.suffix.lower() in {".png", ".jpg", ".jpeg"}),
        key=natural_key,
    )
    if not images:
        raise SystemExit(f"No rendered slide images found in {source}")

    thumb_w, thumb_h = 320, 180
    label_h, gap = 30, 14
    per_sheet = args.cols * args.rows
    font = ImageFont.load_default()

    for sheet_no, start in enumerate(range(0, len(images), per_sheet), 1):
        chunk = images[start : start + per_sheet]
        canvas_w = gap + args.cols * (thumb_w + gap)
        canvas_h = gap + args.rows * (thumb_h + label_h + gap)
        canvas = Image.new("RGB", (canvas_w, canvas_h), "#eef3f7")
        draw = ImageDraw.Draw(canvas)
        for offset, path in enumerate(chunk):
            row, col = divmod(offset, args.cols)
            x = gap + col * (thumb_w + gap)
            y = gap + row * (thumb_h + label_h + gap)
            with Image.open(path) as slide:
                rendered = slide.convert("RGB")
                rendered.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
                px = x + (thumb_w - rendered.width) // 2
                py = y + (thumb_h - rendered.height) // 2
                canvas.paste(rendered, (px, py))
            draw.rectangle((x, y, x + thumb_w, y + thumb_h), outline="#9fb3c4", width=1)
            slide_no = start + offset + 1
            draw.text((x + 6, y + thumb_h + 7), f"{slide_no:03d}  {path.name}", fill="#183b56", font=font)

        out = Path(f"{args.output_prefix}-{sheet_no:02d}.jpg")
        out.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(out, "JPEG", quality=92)

    print(f"Created {(len(images) + per_sheet - 1) // per_sheet} contact sheets for {len(images)} slides")


if __name__ == "__main__":
    main()
