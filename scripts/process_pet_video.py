"""Offline green-screen pet-video normalization and identity stabilization.

Usage:
  python scripts/process_pet_video.py INPUT.mp4 REFERENCE.png OUTPUT_DIR

The script keeps the original input untouched. It writes RGBA PNG frames and a
green-background contact sheet. Encoding is intentionally handled by ffmpeg so
the same processed frames can produce both transparent WebM and MP4 fallback.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np


def green_background_mask(image: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    b, g, r = cv2.split(image)
    return (
        (hsv[:, :, 0] >= 35)
        & (hsv[:, :, 0] <= 92)
        & (hsv[:, :, 1] >= 48)
        & (g.astype(np.float32) > r.astype(np.float32) * 1.08)
        & (g.astype(np.float32) > b.astype(np.float32) * 0.90)
    )


def subject_alpha(image: np.ndarray, eye_anchor: tuple[float, float] | None = None) -> np.ndarray:
    foreground = (~green_background_mask(image)).astype(np.uint8)
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(foreground, 8)
    if count <= 1:
        return foreground.astype(np.float32)
    candidates = list(range(1, count))
    if eye_anchor:
        ex, ey = eye_anchor
        candidates.sort(key=lambda i: math.hypot(centroids[i][0] - ex, centroids[i][1] - ey))
        chosen = candidates[0]
        if stats[chosen, cv2.CC_STAT_AREA] < 10000:
            chosen = max(candidates, key=lambda i: stats[i, cv2.CC_STAT_AREA])
    else:
        chosen = max(candidates, key=lambda i: stats[i, cv2.CC_STAT_AREA])
    mask = (labels == chosen).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    return cv2.GaussianBlur(mask, (0, 0), 1.2).astype(np.float32) / 255.0


def blue_fur_mask(image: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    b, g, r = cv2.split(image)
    return (
        (alpha > 0.72)
        & (hsv[:, :, 0] >= 88)
        & (hsv[:, :, 0] <= 128)
        & (hsv[:, :, 1] >= 28)
        & (hsv[:, :, 2] >= 62)
        & (b.astype(np.int16) - r.astype(np.int16) >= 12)
    )


def lab_stats(image: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB).astype(np.float32)
    pixels = lab[mask]
    if len(pixels) < 100:
        raise RuntimeError("Not enough blue-fur pixels for color matching")
    return pixels.mean(axis=0), np.maximum(pixels.std(axis=0), 1.0)


def match_blue_fur(
    image: np.ndarray,
    alpha: np.ndarray,
    source_mean: np.ndarray,
    source_std: np.ndarray,
    target_mean: np.ndarray,
    target_std: np.ndarray,
) -> np.ndarray:
    mask = blue_fur_mask(image, alpha)
    if mask.sum() < 100:
        return image
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB).astype(np.float32)
    ratio = np.clip(target_std / source_std, 0.72, 1.35)
    mapped = (lab - source_mean) * ratio + target_mean
    # Preserve local shading while moving the generated fur toward the approved palette.
    strength = np.zeros(mask.shape, np.float32)
    strength[mask] = 0.82
    strength = cv2.GaussianBlur(strength, (0, 0), 1.1)[:, :, None]
    lab = lab * (1.0 - strength) + mapped * strength
    return cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)


def detect_eye_pair(image: np.ndarray) -> tuple[float, float, float, float] | None:
    h, w = image.shape[:2]
    x0, x1 = int(w * 0.43), int(w * 0.91)
    y0, y1 = int(h * 0.18), int(h * 0.66)
    roi = image[y0:y1, x0:x1]
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    dark = ((gray < 96) & (hsv[:, :, 1] > 38)).astype(np.uint8) * 255
    dark = cv2.morphologyEx(dark, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, _, stats, centroids = cv2.connectedComponentsWithStats(dark, 8)
    parts = []
    for i in range(1, count):
        x, y, width, height, area = stats[i]
        if 280 <= area <= 2400 and 18 <= width <= 75 and 18 <= height <= 75:
            parts.append((float(centroids[i][0] + x0), float(centroids[i][1] + y0), float(area)))
    best = None
    best_score = float("inf")
    for i, left in enumerate(parts):
        for right in parts[i + 1 :]:
            a, b = sorted((left, right), key=lambda item: item[0])
            separation = b[0] - a[0]
            y_delta = abs(b[1] - a[1])
            if not 55 <= separation <= 135 or y_delta > 24:
                continue
            center_x = (a[0] + b[0]) / 2
            center_y = (a[1] + b[1]) / 2
            score = y_delta * 4 + abs(separation - 90) + abs(center_x - w * 0.70) * 0.15 + abs(center_y - h * 0.49) * 0.08
            if score < best_score:
                best_score = score
                best = (center_x, center_y, separation, math.degrees(math.atan2(b[1] - a[1], separation)))
    return best


def rolling_median(values: list[tuple[float, float, float, float]], radius: int = 2) -> list[tuple[float, float, float, float]]:
    result = []
    for index in range(len(values)):
        window = np.array(values[max(0, index - radius) : min(len(values), index + radius + 1)], np.float32)
        result.append(tuple(float(v) for v in np.median(window, axis=0)))
    return result


def build_reference_head(reference: np.ndarray) -> tuple[np.ndarray, np.ndarray, tuple[float, float], float]:
    # Legacy coordinates: recalibrate against the new action-specific reference before reuse.
    x0, y0, x1, y1 = 600, 345, 1055, 830
    patch = reference[y0:y1, x0:x1].copy()
    alpha = subject_alpha(patch)
    yy, xx = np.mgrid[0 : patch.shape[0], 0 : patch.shape[1]]
    # Lock only the identity-critical facial core. Keeping the generated ears,
    # outer head fur and neck avoids a visible "pasted head / collar" seam.
    cx, cy, rx, ry = 275.0, 292.0, 175.0, 175.0
    distance = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
    ellipse = np.clip((1.07 - distance) / 0.18, 0.0, 1.0).astype(np.float32)
    alpha *= ellipse
    # Pull the matte inward before feathering so chroma-green fringe is not
    # carried into the composite. Do not alter RGB channels at the matte edge:
    # doing so can turn pale blue fur into a visible magenta outline.
    alpha_u8 = np.round(alpha * 255).astype(np.uint8)
    alpha_u8 = cv2.erode(alpha_u8, np.ones((3, 3), np.uint8), iterations=1)
    alpha = cv2.GaussianBlur(alpha_u8, (0, 0), 1.6).astype(np.float32) / 255.0
    reference_eye_center = (875.5 - x0, 610.0 - y0)
    reference_eye_distance = 121.0
    return patch, alpha, reference_eye_center, reference_eye_distance


def overlay_reference_head(
    frame: np.ndarray,
    patch: np.ndarray,
    patch_alpha: np.ndarray,
    patch_eye_center: tuple[float, float],
    patch_eye_distance: float,
    target: tuple[float, float, float, float],
) -> tuple[np.ndarray, np.ndarray]:
    h, w = frame.shape[:2]
    center_x, center_y, eye_distance, angle = target
    scale = float(np.clip(eye_distance / patch_eye_distance, 0.64, 0.82))
    transform = cv2.getRotationMatrix2D(patch_eye_center, angle, scale)
    transformed_anchor = transform @ np.array([patch_eye_center[0], patch_eye_center[1], 1.0])
    transform[0, 2] += center_x - transformed_anchor[0]
    transform[1, 2] += center_y - transformed_anchor[1]
    warped_patch = cv2.warpAffine(patch, transform, (w, h), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT)
    warped_alpha = cv2.warpAffine(patch_alpha, transform, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    warped_alpha = np.clip(warped_alpha[:, :, None], 0.0, 1.0)
    composited = np.clip(frame.astype(np.float32) * (1.0 - warped_alpha) + warped_patch.astype(np.float32) * warped_alpha, 0, 255).astype(np.uint8)
    return composited, warped_alpha[:, :, 0]


def create_contact_sheet(frames: list[np.ndarray], output: Path) -> None:
    selected = np.linspace(0, len(frames) - 1, 8).astype(int)
    thumbs = [cv2.resize(frames[i], (320, 320), interpolation=cv2.INTER_AREA) for i in selected]
    rows = [np.hstack(thumbs[:4]), np.hstack(thumbs[4:])]
    cv2.imwrite(str(output), np.vstack(rows))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    frame_dir = args.output_dir / "rgba-frames"
    frame_dir.mkdir(exist_ok=True)

    reference = cv2.imread(str(args.reference))
    if reference is None:
        raise RuntimeError(f"Cannot read reference image: {args.reference}")
    reference_alpha = subject_alpha(reference)
    reference_blue = blue_fur_mask(reference, reference_alpha)
    target_mean, target_std = lab_stats(reference, reference_blue)
    head_patch, head_alpha, head_eye_center, head_eye_distance = build_reference_head(reference)

    capture = cv2.VideoCapture(str(args.input))
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 24.0)
    raw_frames = []
    anchors = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        raw_frames.append(frame)
        anchors.append(detect_eye_pair(frame))
    capture.release()
    if not raw_frames:
        raise RuntimeError("No video frames decoded")

    valid = [anchor for anchor in anchors if anchor is not None]
    if len(valid) < len(anchors) * 0.8:
        raise RuntimeError(f"Eye tracking unstable: {len(valid)}/{len(anchors)} frames")
    fallback = valid[0]
    filled = []
    for anchor in anchors:
        if anchor is not None:
            fallback = anchor
        filled.append(fallback)
    smoothed = rolling_median(filled)

    sampled_lab = []
    for frame, anchor in zip(raw_frames[::4], smoothed[::4]):
        alpha = subject_alpha(frame, (anchor[0], anchor[1]))
        mask = blue_fur_mask(frame, alpha)
        lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB).astype(np.float32)
        sampled_lab.append(lab[mask])
    video_pixels = np.concatenate([pixels for pixels in sampled_lab if len(pixels)], axis=0)
    source_mean = video_pixels.mean(axis=0)
    source_std = np.maximum(video_pixels.std(axis=0), 1.0)

    previews = []
    for index, (frame, anchor) in enumerate(zip(raw_frames, smoothed)):
        alpha = subject_alpha(frame, (anchor[0], anchor[1]))
        corrected = match_blue_fur(frame, alpha, source_mean, source_std, target_mean, target_std)
        stabilized, stabilized_head_alpha = overlay_reference_head(corrected, head_patch, head_alpha, head_eye_center, head_eye_distance, anchor)
        alpha = np.maximum(alpha, stabilized_head_alpha)
        rgba = cv2.cvtColor(stabilized, cv2.COLOR_BGR2BGRA)
        rgba[:, :, 3] = np.round(alpha * 255).astype(np.uint8)
        cv2.imwrite(str(frame_dir / f"frame-{index:04d}.png"), rgba)
        green = np.full_like(stabilized, (0, 255, 0))
        blend = alpha[:, :, None]
        preview = np.clip(stabilized * blend + green * (1.0 - blend), 0, 255).astype(np.uint8)
        previews.append(preview)

    create_contact_sheet(previews, args.output_dir / "processed-contact-sheet.png")
    metadata = {
        "input": str(args.input),
        "reference": str(args.reference),
        "fps": fps,
        "frames": len(raw_frames),
        "duration": len(raw_frames) / fps,
        "eye_tracking_success": len(valid) / len(anchors),
        "source_lab_mean": source_mean.round(3).tolist(),
        "target_lab_mean": target_mean.round(3).tolist(),
    }
    (args.output_dir / "processing-report.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False))


if __name__ == "__main__":
    main()
