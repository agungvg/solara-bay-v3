#!/usr/bin/env python3
"""Solara Bay — post-process captured screenshots so they pop.

Reads the raw 1280x720 PNGs from out/raw/, enhances each one (sharpen,
colour, contrast, a touch of brightness to kill dullness), and writes:
  screenshots/<name>.jpg  — enhanced, quality tuned to stay under the
                            262,144 B entry cap
  review-png/<name>.png   — enhanced PNG mirror (Lyso reviews PNGs; his
                            phone renders JPGs green)

Usage: python3 enhance_shots.py
Exits non-zero if any output is not 1280x720 or any JPG is over the cap.
"""

import os
import sys

from PIL import Image, ImageEnhance

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.join(ROOT, "out", "raw")
JPG_DIR = os.path.join(ROOT, "screenshots")
PNG_DIR = os.path.join(ROOT, "review-png")

JPG_CAP = 262144
SHOTS = ["1-start", "2-play", "3-chase", "4-mission", "5-face"]

# Enhancement recipe: crisp edges, richer colour, more punch, dullness out.
SHARPNESS = 1.6
COLOUR = 1.25
CONTRAST = 1.15
BRIGHTNESS = 1.05


def enhance(img):
    """Apply the pop recipe to a PIL image, return the enhanced image."""
    img = ImageEnhance.Sharpness(img).enhance(SHARPNESS)
    img = ImageEnhance.Color(img).enhance(COLOUR)
    img = ImageEnhance.Contrast(img).enhance(CONTRAST)
    img = ImageEnhance.Brightness(img).enhance(BRIGHTNESS)
    return img


def save_jpg_under_cap(img, path):
    """Save as JPEG, stepping quality down until it fits under the cap."""
    quality = 88
    while quality >= 55:
        img.save(path, "JPEG", quality=quality, optimize=True)
        size = os.path.getsize(path)
        if size <= JPG_CAP:
            return quality, size
        quality -= 4
    raise RuntimeError(f"{path} still over cap at quality 55: {os.path.getsize(path)} B")


def main():
    os.makedirs(JPG_DIR, exist_ok=True)
    os.makedirs(PNG_DIR, exist_ok=True)
    failures = []
    for name in SHOTS:
        raw = os.path.join(RAW_DIR, name + ".png")
        if not os.path.exists(raw):
            failures.append(f"{name}: raw capture missing at {raw}")
            continue
        img = Image.open(raw).convert("RGB")
        if img.size != (1280, 720):
            failures.append(f"{name}: raw is {img.size}, expected 1280x720")
            continue
        done = enhance(img)
        png_path = os.path.join(PNG_DIR, name + ".png")
        done.save(png_path, "PNG", optimize=True)
        jpg_path = os.path.join(JPG_DIR, name + ".jpg")
        quality, jpg_size = save_jpg_under_cap(done, jpg_path)
        png_size = os.path.getsize(png_path)
        print(f"{name}: jpg {jpg_size} B (q{quality}), png {png_size} B — enhanced")
        # PIL-verify the outputs are really 1280x720.
        for path in (jpg_path, png_path):
            with Image.open(path) as check:
                if check.size != (1280, 720):
                    failures.append(f"{name}: {path} is {check.size}, expected 1280x720")
    if failures:
        print("ENHANCE FAILURES:")
        for f in failures:
            print("  " + f)
        return 1
    print("enhance: all 5 shots enhanced, 1280x720 verified, JPGs under cap")
    print(
        f"enhance recipe: sharpness {SHARPNESS}x, colour {COLOUR}x, "
        f"contrast {CONTRAST}x, brightness {BRIGHTNESS}x"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
