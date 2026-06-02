#!/usr/bin/env python3
"""
Pixel-art basketball player headshot generator.

Builds randomized 64x64-grid pixel headshots (neck up, transparent background)
as SVG files, following a fixed framework with randomized:
  - skin tone (ethnicity-flavored palettes)
  - head / jaw shape
  - hairstyle + hair color
  - eyebrows, eye shape, eye color
  - nose shape
  - mouth
  - optional white or black headband

USAGE
-----
    python3 generate_headshots.py                 # 10 headshots -> ./headshots/
    python3 generate_headshots.py -n 50           # 50 headshots
    python3 generate_headshots.py -o out_dir      # custom output directory
    python3 generate_headshots.py -s 1234         # fixed random seed (reproducible)
    python3 generate_headshots.py --headband-chance 0.5   # override default 11% headband rate
    python3 generate_headshots.py --png           # also rasterize to PNG (legacy)

By default, only .svg files are written. The frontend bundles them via
import.meta.glob('@/assets/headshots/*.svg') and the user-customizable headshot
editor parses the SVG directly. Pass --png to also emit rasterized PNGs for
any external use that needs bitmap output.

REQUIREMENTS
------------
    No dependencies for SVG output. PNG output (--png) requires:
        pip install cairosvg pillow
"""

import argparse
import os
import random
import sys

# cairosvg + Pillow are only needed when --png is passed. Defer their import
# so the SVG-only happy path runs in a stock Python environment.
cairosvg = None
Image = None


def _load_png_deps():
    """Import cairosvg + Pillow on demand (PNG output path only)."""
    global cairosvg, Image
    try:
        import cairosvg as _cairosvg
    except ImportError:
        sys.exit("Missing dependency for --png: cairosvg. Install with: pip install cairosvg pillow")
    try:
        from PIL import Image as _Image
    except ImportError:
        sys.exit("Missing dependency for --png: pillow. Install with: pip install cairosvg pillow")
    cairosvg = _cairosvg
    Image = _Image


# ----------------------------------------------------------------------------
# PALETTES
# ----------------------------------------------------------------------------
# Each skin palette: base, highlight (lighter), shadow (darker), deep (darkest)
SKIN_TONES = {
    "dark":   {"base": "#6e4326", "hi": "#85553a", "sh": "#5a3620", "deep": "#472a18"},
    "brown":  {"base": "#8a5a3c", "hi": "#9c6647", "sh": "#7a4e33", "deep": "#5e3a23"},
    "olive":  {"base": "#b88457", "hi": "#c89668", "sh": "#a5734a", "deep": "#8a5c38"},
    "tan":    {"base": "#cda07a", "hi": "#dcb591", "sh": "#b88863", "deep": "#9c7350"},
    "fair":   {"base": "#e8c1a0", "hi": "#f2d2b6", "sh": "#d2a380", "deep": "#c99a76"},
    "pale":   {"base": "#f0d2bc", "hi": "#f8e2d2", "sh": "#dcb8a0", "deep": "#c9a488"},
}

# Hair colors: base + highlight + shadow
HAIR_COLORS = {
    "black":     {"base": "#2a2018", "hi": "#3a2e22", "sh": "#1c140e"},
    "dark_brown":{"base": "#3a2817", "hi": "#4a3320", "sh": "#2b1d12"},
    "brown":     {"base": "#5a3d22", "hi": "#6e4d2e", "sh": "#46301a"},
    "light_brown":{"base":"#7a5634", "hi": "#917046", "sh": "#634428"},
    "blonde":    {"base": "#c79a44", "hi": "#e6c878", "sh": "#a87e30"},
    "dirty_blonde":{"base":"#9c7c44","hi": "#c0a060", "sh": "#806434"},
    "auburn":    {"base": "#6e3a22", "hi": "#8a4d30", "sh": "#562c18"},
    "red":       {"base": "#9c4a26", "hi": "#bd6038", "sh": "#7c3818"},
    "gray":      {"base": "#8a8a8a", "hi": "#a8a8a8", "sh": "#6e6e6e"},
}

EYE_COLORS = {
    "dark_brown": {"iris": "#3a2414", "pupil": "#160d06"},
    "brown":      {"iris": "#5a3a26", "pupil": "#1c1208"},
    "hazel":      {"iris": "#7a6030", "pupil": "#2a1e0e"},
    "blue":       {"iris": "#4a7fb0", "pupil": "#16263a"},
    "green":      {"iris": "#5a8a5a", "pupil": "#1e2e1e"},
    "gray":       {"iris": "#8a98a0", "pupil": "#2a3236"},
}

LIP_COLORS = {
    "warm":  "#8a4a3c",
    "rose":  "#a05a4a",
    "blush": "#b5715e",
    "deep":  "#7a4438",
    "clay":  "#9c5848",
}

# Loose pairing of skin tone -> plausible hair colors (kept broad, still randomized)
ETHNICITY_PROFILES = {
    "black":    {"skins": ["dark", "brown"],            "hairs": ["black", "dark_brown"]},
    "latino":   {"skins": ["olive", "tan", "brown"],    "hairs": ["black", "dark_brown", "brown"]},
    "white":    {"skins": ["fair", "pale", "tan"],      "hairs": ["blonde", "dirty_blonde", "brown",
                                                                  "light_brown", "auburn", "red", "black"]},
    "asian":    {"skins": ["tan", "olive", "fair"],     "hairs": ["black", "dark_brown"]},
    "mixed":    {"skins": ["brown", "olive", "tan"],    "hairs": ["black", "dark_brown", "brown", "dirty_blonde"]},
}


# ----------------------------------------------------------------------------
# SVG building helpers
# ----------------------------------------------------------------------------
# Each layer is wrapped in a <g data-layer="..." ...> with palette-key names
# (NOT hex codes) so the JS editor can round-trip parse → mutate → recompose
# without losing the user's choices. The Python and JS composers must agree
# on these attribute names.
def rect(x, y, w, h, fill):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}"/>'


def _layer_open(parts, layer_id, **attrs):
    attr_str = ''.join(f' data-{k.replace("_", "-")}="{v}"' for k, v in attrs.items() if v is not None)
    parts.append(f'<g data-layer="{layer_id}"{attr_str}>')


def _layer_close(parts):
    parts.append('</g>')


def build_face(parts, skin, jaw_width, skin_name):
    """jaw_width: 0 narrow, 1 medium, 2 wide. Affects lower-face span."""
    b, hi, sh, deep = skin["base"], skin["hi"], skin["sh"], skin["deep"]
    # narrower jaw insets the lower face
    inset = {0: 1, 1: 0, 2: 0}[jaw_width]
    low_x = 17 + inset
    low_w = 30 - 2 * inset
    chin_x = 20 + inset + (1 if jaw_width == 0 else 0)
    chin_w = low_w - 2 * (chin_x - low_x)

    _layer_open(parts, 'face', skin=skin_name, jaw=jaw_width)
    parts.append(rect(17, 15, 30, 20, b))
    parts.append(rect(15, 18, 2, 13, b))
    parts.append(rect(47, 18, 2, 13, b))
    parts.append(rect(low_x, 35, low_w, 7, b))
    parts.append(rect(chin_x, 42, max(chin_w, 12), 3, sh))
    # forehead highlight
    parts.append(rect(17, 15, 30, 2, hi))
    parts.append(rect(19, 17, 4, 2, hi))
    parts.append(rect(41, 17, 4, 2, hi))
    # temple/cheek shadow
    parts.append(rect(15, 20, 2, 8, sh))
    parts.append(rect(47, 20, 2, 8, sh))
    parts.append(rect(17, 33, 4, 4, sh))
    parts.append(rect(43, 33, 4, 4, sh))
    # cheek warmth
    parts.append(rect(19, 29, 4, 3, hi))
    parts.append(rect(41, 29, 4, 3, hi))
    _layer_close(parts)


def build_stubble(parts, skin, has_stubble):
    # Always emit the wrapper so the editor can find the layer and toggle it on.
    _layer_open(parts, 'stubble', enabled='true' if has_stubble else 'false')
    if has_stubble:
        sh, deep = skin["sh"], skin["deep"]
        parts.append(rect(18, 38, 28, 2, sh))
        parts.append(rect(22, 40, 20, 2, deep))
    _layer_close(parts)


def build_hair(parts, hair, style, hair_name):
    b, hi, sh = hair["base"], hair["hi"], hair["sh"]
    _layer_open(parts, 'hair', style=style, color=hair_name)
    if style == "short":
        parts.append(rect(18, 7, 28, 3, b))
        parts.append(rect(16, 10, 32, 3, hi))
        parts.append(rect(15, 13, 34, 2, b))
        parts.append(rect(14, 15, 36, 1, sh))
        parts.append(rect(14, 16, 2, 4, b))
        parts.append(rect(48, 16, 2, 4, b))
    elif style == "fade":
        parts.append(rect(19, 8, 26, 3, b))
        parts.append(rect(17, 11, 30, 3, hi))
        parts.append(rect(16, 14, 32, 2, b))
        # tight sides
        parts.append(rect(15, 16, 2, 3, sh))
        parts.append(rect(47, 16, 2, 3, sh))
    elif style == "wavy":
        parts.append(rect(19, 5, 26, 3, b))
        parts.append(rect(16, 8, 32, 3, hi))
        parts.append(rect(15, 11, 34, 3, b))
        parts.append(rect(14, 14, 36, 3, hi))
        parts.append(rect(21, 4, 22, 1, hi))
        # wave flecks
        parts.append(rect(22, 6, 3, 2, hi))
        parts.append(rect(30, 5, 3, 2, hi))
        parts.append(rect(38, 6, 3, 2, hi))
        parts.append(rect(14, 17, 2, 6, b))
        parts.append(rect(48, 17, 2, 6, b))
    elif style == "side_part":
        parts.append(rect(18, 6, 28, 3, b))
        parts.append(rect(16, 9, 32, 3, hi))
        parts.append(rect(15, 12, 34, 3, b))
        parts.append(rect(14, 15, 36, 2, sh))
        parts.append(rect(20, 5, 24, 1, hi))
        parts.append(rect(26, 6, 3, 6, hi))   # part highlight
        parts.append(rect(20, 6, 26, 1, hi))
        parts.append(rect(14, 17, 2, 5, b))
        parts.append(rect(48, 17, 2, 5, b))
    elif style == "curly":
        # clumpy top
        for cx in range(16, 46, 4):
            parts.append(rect(cx, 5, 4, 4, b if (cx // 4) % 2 else hi))
        parts.append(rect(15, 9, 34, 4, b))
        parts.append(rect(14, 13, 36, 3, hi))
        parts.append(rect(14, 16, 2, 5, b))
        parts.append(rect(48, 16, 2, 5, b))
    elif style == "buzz":
        parts.append(rect(17, 10, 30, 3, b))
        parts.append(rect(16, 12, 32, 2, hi))
        parts.append(rect(15, 13, 34, 2, sh))
    else:  # afro / tall
        parts.append(rect(16, 3, 32, 5, b))
        parts.append(rect(14, 6, 36, 4, hi))
        parts.append(rect(13, 9, 38, 4, b))
        parts.append(rect(13, 13, 38, 3, hi))
        parts.append(rect(13, 16, 3, 6, b))
        parts.append(rect(48, 16, 3, 6, b))
    _layer_close(parts)


def build_eyebrows(parts, hair, thickness, angle, hair_name):
    """thickness: 1 thin, 2 thick. angle: 'flat','up','down'. Initial color
    matches hair; the editor can override via the eyebrows layer's color
    picker (stamped here so the JS parser can round-trip it)."""
    color = hair["sh"] if hair["base"] != "#2a2018" else "#1c140e"
    w = 8 if thickness == 1 else 9
    lx, rx = (20, 36) if thickness == 1 else (19, 36)
    _layer_open(parts, 'eyebrows', thickness=thickness, angle=angle, color=hair_name)
    parts.append(rect(lx, 21, w, thickness, color))
    parts.append(rect(rx, 21, w, thickness, color))
    if angle == "up":
        parts.append(rect(lx, 20, 3, 1, color))
        parts.append(rect(rx + w - 3, 20, 3, 1, color))
    elif angle == "down":
        parts.append(rect(lx + w - 3, 20, 3, 1, color))
        parts.append(rect(rx, 20, 3, 1, color))
    else:
        parts.append(rect(lx, 20, 3, 1, hair["hi"]))
        parts.append(rect(rx + w - 3, 20, 3, 1, hair["hi"]))
    _layer_close(parts)


def build_eyes(parts, skin, eye, shape, eye_name):
    """shape: 'round' or 'almond'."""
    iris, pupil = eye["iris"], eye["pupil"]
    sh = skin["sh"]
    _layer_open(parts, 'eyes', shape=shape, color=eye_name)
    eh = 4 if shape == "round" else 3
    ey = 24 if shape == "round" else 25
    parts.append(rect(20, ey, 8, eh, "#ffffff"))
    parts.append(rect(36, ey, 8, eh, "#ffffff"))
    parts.append(rect(23, ey, 3, eh, iris))
    parts.append(rect(38, ey, 3, eh, iris))
    parts.append(rect(24, ey, 2, 2, pupil))
    parts.append(rect(39, ey, 2, 2, pupil))
    parts.append(rect(24, ey, 1, 1, "#ffffff"))
    parts.append(rect(39, ey, 1, 1, "#ffffff"))
    if shape == "almond":
        parts.append(rect(20, 24, 8, 1, skin["deep"]))
        parts.append(rect(36, 24, 8, 1, skin["deep"]))
    parts.append(rect(20, ey + eh, 8, 1, sh))
    parts.append(rect(36, ey + eh, 8, 1, sh))
    _layer_close(parts)


def build_nose(parts, skin, shape):
    """shape: 'narrow','medium','broad'. Color derives from skin."""
    b, hi, sh, deep = skin["base"], skin["hi"], skin["sh"], skin["deep"]
    _layer_open(parts, 'nose', shape=shape)
    if shape == "narrow":
        parts.append(rect(31, 27, 2, 7, sh))
        parts.append(rect(30, 33, 4, 1, deep))
        parts.append(rect(33, 28, 1, 5, hi))
        parts.append(rect(29, 34, 2, 1, deep))
        parts.append(rect(33, 34, 2, 1, deep))
    elif shape == "broad":
        parts.append(rect(30, 28, 4, 6, sh))
        parts.append(rect(29, 33, 6, 2, deep))
        parts.append(rect(33, 29, 1, 4, hi))
        parts.append(rect(28, 34, 2, 1, deep))
        parts.append(rect(34, 34, 2, 1, deep))
        parts.append(rect(31, 33, 2, 2, b))
    else:  # medium
        parts.append(rect(31, 27, 2, 6, sh))
        parts.append(rect(30, 32, 4, 2, deep))
        parts.append(rect(33, 28, 1, 4, hi))
        parts.append(rect(29, 33, 2, 1, deep))
        parts.append(rect(33, 33, 2, 1, deep))
    _layer_close(parts)


def build_mouth(parts, skin, lip, fullness, lip_name):
    """fullness: 'thin' or 'full'."""
    hi = skin["hi"]
    _layer_open(parts, 'mouth', fullness=fullness, color=lip_name)
    if fullness == "full":
        parts.append(rect(27, 38, 10, 1, "#8a4a3c"))
        parts.append(rect(28, 39, 8, 2, lip))
        parts.append(rect(29, 37, 6, 1, hi))
    else:
        parts.append(rect(27, 37, 10, 1, "#5e3a23"))
        parts.append(rect(28, 38, 8, 1, lip))
        parts.append(rect(29, 36, 6, 1, hi))
    parts.append(rect(27, 40, 10, 2, skin["sh"]))
    _layer_close(parts)


def build_neck(parts, skin):
    # Neck has no editable params — color follows the face's skin.
    _layer_open(parts, 'neck')
    parts.append(rect(24, 45, 16, 3, skin["sh"]))
    parts.append(rect(24, 45, 16, 1, skin["deep"]))
    parts.append(rect(26, 45, 12, 1, skin["deep"]))
    _layer_close(parts)


def build_headband(parts, color):
    """color: 'white', 'black', or None. Sits across forehead."""
    # Always emit the wrapper so the editor can toggle the headband on/off.
    style = color if color else 'none'
    _layer_open(parts, 'headband', style=style)
    if color is not None:
        if color == "white":
            main, edge = "#f4f4f4", "#cfcfcf"
        else:
            main, edge = "#222222", "#000000"
        parts.append(rect(14, 13, 36, 4, main))
        parts.append(rect(14, 13, 36, 1, edge))
        parts.append(rect(14, 16, 36, 1, edge))
        parts.append(rect(14, 13, 2, 4, edge))
        parts.append(rect(48, 13, 2, 4, edge))
    _layer_close(parts)


# ----------------------------------------------------------------------------
# Compose one randomized SVG
# ----------------------------------------------------------------------------
def random_headshot_svg(rng, ethnicity=None, headband_chance=0.11):
    if ethnicity is None:
        ethnicity = rng.choice(list(ETHNICITY_PROFILES.keys()))
    profile = ETHNICITY_PROFILES[ethnicity]

    # Keep the palette KEY (e.g. "dark", "black") alongside the dict so each
    # build_* function can stamp it into the layer's data-* attributes.
    skin_name = rng.choice(profile["skins"])
    skin = SKIN_TONES[skin_name]
    hair_name = rng.choice(profile["hairs"])
    hair = HAIR_COLORS[hair_name]
    eye_name = rng.choice(list(EYE_COLORS.keys()))
    eye = EYE_COLORS[eye_name]
    lip_name = rng.choice(list(LIP_COLORS.keys()))
    lip = LIP_COLORS[lip_name]

    jaw_width = rng.choice([0, 1, 2])
    hair_style = rng.choice(["short", "fade", "wavy", "side_part", "curly", "buzz", "afro"])
    brow_thick = rng.choice([1, 2])
    brow_angle = rng.choice(["flat", "up", "down"])
    eye_shape = rng.choice(["round", "almond"])
    nose_shape = rng.choice(["narrow", "medium", "broad"])
    mouth_full = rng.choice(["thin", "full"])
    has_stubble = rng.random() < 0.45

    headband = None
    if rng.random() < headband_chance:
        headband = rng.choice(["white", "black"])

    # viewBox is cropped tight to the content rather than the full 64-unit grid
    # the rects are drawn in. After scale(10), content lives at SVG coords
    # roughly x=130-510, y=30-480. Cropping to (70, -30, 500, 500):
    #   - 60 units of side padding either side (was 130) — tighter horizontally
    #   - 60 units above the head before content (was 30) — head sits ~30 SVG
    #     units lower than in the old framing
    #   - bottom clips ~30 units of the neck strip, mostly hidden under any
    #     downstream circular avatar crop anyway
    parts = ['<svg width="500" height="500" viewBox="70 -30 500 500" '
             'xmlns="http://www.w3.org/2000/svg">',
             '<g shape-rendering="crispEdges">', '<g transform="scale(10)">']

    build_hair(parts, hair, hair_style, hair_name)
    build_face(parts, skin, jaw_width, skin_name)
    build_stubble(parts, skin, has_stubble)
    build_headband(parts, headband)   # drawn over hair/forehead
    build_eyebrows(parts, hair, brow_thick, brow_angle, hair_name)
    build_eyes(parts, skin, eye, eye_shape, eye_name)
    build_nose(parts, skin, nose_shape)
    build_mouth(parts, skin, lip, mouth_full, lip_name)
    build_neck(parts, skin)

    parts += ["</g>", "</g>", "</svg>"]
    meta = {
        "ethnicity": ethnicity, "hair_style": hair_style,
        "jaw": jaw_width, "eye_shape": eye_shape, "nose": nose_shape,
        "mouth": mouth_full, "stubble": has_stubble, "headband": headband or "none",
    }
    return "\n".join(parts), meta


# ----------------------------------------------------------------------------
# Render SVG -> cropped, squared, transparent PNG
# ----------------------------------------------------------------------------
def render_png(svg, out_path, canvas=450, pad=10):
    png_bytes = cairosvg.svg2png(bytestring=svg.encode(),
                                 output_width=640, output_height=640)
    tmp = out_path + ".raw.png"
    with open(tmp, "wb") as f:
        f.write(png_bytes)
    im = Image.open(tmp).convert("RGBA")
    bbox = im.getbbox()
    if bbox:
        l = max(0, bbox[0] - pad); t = max(0, bbox[1] - pad)
        r = min(im.width, bbox[2] + pad); b = min(im.height, bbox[3] + pad)
        im = im.crop((l, t, r, b))
    w, h = im.size
    if w > canvas or h > canvas:
        sc = min(canvas / w, canvas / h)
        im = im.resize((int(w * sc), int(h * sc)), Image.NEAREST)
        w, h = im.size
    sq = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    sq.paste(im, ((canvas - w) // 2, (canvas - h) // 2))
    sq.save(out_path)
    os.remove(tmp)


# ----------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Generate randomized pixel-art basketball headshots.")
    ap.add_argument("-n", "--num", type=int, default=10, help="how many to generate (default 10)")
    ap.add_argument("-o", "--out", default="headshots", help="output directory (default ./headshots)")
    ap.add_argument("-s", "--seed", type=int, default=None, help="random seed for reproducibility")
    ap.add_argument("--size", type=int, default=450, help="square canvas size in px (default 450)")
    ap.add_argument("--headband-chance", type=float, default=0.11,
                    help="probability 0-1 a player wears a headband (default 0.11)")
    ap.add_argument("--ethnicity", default=None,
                    choices=list(ETHNICITY_PROFILES.keys()),
                    help="force a single ethnicity profile (default: randomized)")
    ap.add_argument("--png", action="store_true",
                    help="also rasterize each headshot to PNG (requires cairosvg + pillow)")
    args = ap.parse_args()

    if args.png:
        _load_png_deps()

    rng = random.Random(args.seed)
    os.makedirs(args.out, exist_ok=True)

    suffix = ".svg + .png" if args.png else ".svg"
    print(f"Generating {args.num} headshot(s) -> {args.out}/  ({suffix})")
    for i in range(1, args.num + 1):
        svg, meta = random_headshot_svg(rng, args.ethnicity, args.headband_chance)
        name = f"headshot_{i:03d}_{meta['ethnicity']}"
        with open(os.path.join(args.out, name + ".svg"), "w") as f:
            f.write(svg)
        if args.png:
            render_png(svg, os.path.join(args.out, name + ".png"), canvas=args.size)
        tags = (f"{meta['ethnicity']}, {meta['hair_style']} hair, {meta['eye_shape']} eyes, "
                f"{meta['nose']} nose, {meta['mouth']} mouth, headband: {meta['headband']}")
        print(f"  [{i:>3}/{args.num}] {name}  ({tags})")

    print("Done.")


if __name__ == "__main__":
    main()
