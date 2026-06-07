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

Each layer's geometry lives in a standalone SVG file under
headshot-layers/<layer>/<variant>.svg with {{token}} color placeholders. This
generator loads those files and templates in the active palette per headshot.
The JS runtime composer (headshotComposer.js) does the same — both stay in
sync via the shared layer library. To regenerate the layer files themselves
from the original pixel-coordinate source, run `python3 extract_layers.py`.

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
import re
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
# Layer file loader — same library the JS composer uses
# ----------------------------------------------------------------------------
# Layer geometry lives in headshot-layers/<layer>/<variant>.svg with
# {{token}} placeholders. We cache the parsed inner content per (layer,
# variant) since a single library run touches the same files repeatedly.
_LAYER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'headshot-layers')
_layer_cache = {}

BROW_THICK_NAMES = {1: 'thin', 2: 'thick'}

# Face variants are integer-keyed in config (jaw_width 0..N) but the actual
# filename behind each integer is whatever's on disk in `headshot-layers/face/`.
# Built dynamically so renaming/replacing variants (e.g. `medium` → `slim`)
# in the admin editor doesn't strand the Python generator looking for a file
# that no longer exists — which silently produced transparent face layers.
#
# Falls back to the canonical narrow / medium / wide ordering when the
# folder is empty or missing, so a fresh checkout still works.
_FACE_FALLBACK = ['narrow', 'medium', 'wide']

def _build_jaw_names():
    folder = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          'headshot-layers', 'face')
    if not os.path.isdir(folder):
        names = _FACE_FALLBACK
    else:
        names = sorted(
            fn[:-4] for fn in os.listdir(folder) if fn.endswith('.svg')
        )
        if not names:
            names = _FACE_FALLBACK
    return {i: name for i, name in enumerate(names)}

JAW_NAMES = _build_jaw_names()

# Eyebrow variants are combined `<thickness>-<angle>` filenames (e.g.
# `thin-flat`, `thick-up`). Same idea as JAW_NAMES — scan disk so any
# admin-added eyebrow variant joins the random pool automatically. The
# filename is treated as opaque (no parsing needed) and the full string
# is stored in config so the composer can render it directly. Falls back
# to the canonical 6-variant set if the folder is empty.
_BROW_FALLBACK = [
    'thin-flat', 'thin-up', 'thin-down',
    'thick-flat', 'thick-up', 'thick-down',
]

def _scan_brow_variants():
    folder = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          'headshot-layers', 'eyebrows')
    if not os.path.isdir(folder):
        return list(_BROW_FALLBACK)
    names = sorted(fn[:-4] for fn in os.listdir(folder) if fn.endswith('.svg'))
    return names if names else list(_BROW_FALLBACK)

# Reverse-map a brow filename back into the canonical thickness/angle pair
# so the metadata attributes on the <g data-layer="eyebrows"> wrapper stay
# in lock-step with what the JS-side parseSvgConfig expects. Unrecognized
# thickness slugs fall through to thickness=1 ('thin') — fine for the
# bundled SVG since face content is already baked in.
_BROW_THICK_LOOKUP = {'thin': 1, 'thick': 2}

def _split_brow_name(name):
    if '-' not in name:
        return (1, name)
    thick, angle = name.split('-', 1)
    return (_BROW_THICK_LOOKUP.get(thick, 1), angle)


def _load_layer(layer_id, variant_key):
    """Return the inner rect content of a layer file (between <svg> and
    </svg>), normalized to one element per line with no leading whitespace.
    Returns '' when the variant has no file (off-state layers)."""
    if variant_key is None:
        return ''
    cache_key = f'{layer_id}/{variant_key}'
    if cache_key in _layer_cache:
        return _layer_cache[cache_key]
    path = os.path.join(_LAYER_DIR, layer_id, f'{variant_key}.svg')
    try:
        with open(path) as f:
            content = f.read()
    except FileNotFoundError:
        print(f'WARNING: missing layer file {path}', file=sys.stderr)
        _layer_cache[cache_key] = ''
        return ''
    m = re.search(r'<svg[^>]*>([\s\S]*?)</svg>', content)
    inner = m.group(1) if m else content
    inner = '\n'.join(line.strip() for line in inner.split('\n') if line.strip())
    _layer_cache[cache_key] = inner
    return inner


def _apply_tokens(text, tokens):
    """Replace every {{key}} placeholder with tokens[key]; leave unknown keys
    as-is so missing tokens surface as visible diff rather than silent black."""
    return re.sub(
        r'\{\{([^}]+)\}\}',
        lambda m: tokens.get(m.group(1).strip(), m.group(0)),
        text,
    )


# --- piece-group fill resolution -------------------------------------------
# Admin-edited variants wrap their rects in <g data-piece="..." ...> groups
# carrying either `data-color-token="X"` (palette slot lookup) or
# `data-color="#hex"` (literal). The inner rects omit fill and inherit from
# the group. Python's compose has to inject that group-level fill itself
# (mirroring headshotComposer.js::_resolvePieceFills); otherwise the SVG
# falls back to default black and every piece-wrapped variant renders all
# black in the bundled procedural pool.
_PIECE_GROUP_RE = re.compile(r'<g\b([^>]*?)data-piece="[^"]*"([^>]*?)>')
_FILL_PRESENT_RE = re.compile(r'\sfill="[^"]*"')
_COLOR_TOKEN_RE = re.compile(r'data-color-token="([^"]+)"')
_COLOR_LITERAL_RE = re.compile(r'data-color="([^"]+)"')


def _resolve_piece_fills(text, tokens):
    def replace(match):
        full = match.group(0)
        attrs = (match.group(1) or '') + (match.group(2) or '')
        # If the group already has an explicit fill, respect it.
        if _FILL_PRESENT_RE.search(attrs):
            return full
        token_match = _COLOR_TOKEN_RE.search(attrs)
        if token_match:
            hex_color = tokens.get(token_match.group(1).strip())
            if hex_color:
                return full[:-1] + f' fill="{hex_color}">'
            return full
        literal_match = _COLOR_LITERAL_RE.search(attrs)
        if literal_match:
            return full[:-1] + f' fill="{literal_match.group(1)}">'
        return full
    return _PIECE_GROUP_RE.sub(replace, text)


def _layer_attrs(layer_id, attrs):
    """Build the data-* attribute string for a layer's wrapping <g>."""
    attr_str = f' data-layer="{layer_id}"'
    for k, v in attrs.items():
        if v is None:
            continue
        attr_str += f' data-{k.replace("_", "-")}="{v}"'
    return attr_str


def _render_layer(layer_id, variant_key, tokens, attrs):
    """Compose one layer's <g>...</g> block. variant_key=None produces an
    empty wrapper (used for off-state layers so the editor can still toggle).

    Two-pass resolution mirrors the JS composer: 1) rect-level {{tokens}}
    for legacy + literal-hex rect variants; 2) group-level fill injection
    for Phase 2 admin-edited <g data-piece> wrappers. Without step 2 the
    piece-wrapped variants render all black in the bundled pool."""
    attr_str = _layer_attrs(layer_id, attrs)
    if variant_key is None:
        return f'<g{attr_str}>\n</g>'
    inner = _load_layer(layer_id, variant_key)
    if not inner:
        return f'<g{attr_str}>\n</g>'
    inner = _apply_tokens(inner, tokens)
    inner = _resolve_piece_fills(inner, tokens)
    return f'<g{attr_str}>\n{inner}\n</g>'


_FREE_LAYERS_DIR = _LAYER_DIR  # alias; only the Free folder feeds the random pool

# Hardcoded fallbacks if the Free folder is somehow empty for a layer. Lets
# the script still produce something rather than crashing mid-batch.
_FALLBACK_VARIANTS = {
    'hair':     ['short'],
    'eyes':     ['round'],
    'nose':     ['medium'],
    'mouth':    ['thin'],
    'headband': ['white'],
    'neck':     ['default'],
    'stubble':  ['default'],
}


def _scan_layer_variants(layer_id):
    """List the variant config-keys present in the Free folder for a layer.
    Filenames use hyphens (side-part.svg); config uses underscores (side_part).
    Returns a sorted list, or the layer's hardcoded fallback if the folder
    is empty or missing."""
    folder = os.path.join(_FREE_LAYERS_DIR, layer_id)
    if not os.path.isdir(folder):
        return list(_FALLBACK_VARIANTS.get(layer_id, []))
    names = []
    for fn in os.listdir(folder):
        if not fn.endswith('.svg'):
            continue
        names.append(fn[:-4].replace('-', '_'))
    if not names:
        return list(_FALLBACK_VARIANTS.get(layer_id, []))
    return sorted(names)


def _build_tokens(config):
    """Flatten the active palettes into a dot-keyed lookup the layer files
    reference (skin.base, hair.sh, eye.iris, ...)."""
    skin = SKIN_TONES[config['skin']]
    hair = HAIR_COLORS[config['hair']]
    brow = HAIR_COLORS.get(config['brow'], hair)
    eye = EYE_COLORS[config['eye']]
    return {
        'skin.base':  skin['base'],
        'skin.hi':    skin['hi'],
        'skin.sh':    skin['sh'],
        'skin.deep':  skin['deep'],
        'hair.base':  hair['base'],
        'hair.hi':    hair['hi'],
        'hair.sh':    hair['sh'],
        'brow.base':  brow['base'],
        'brow.hi':    brow['hi'],
        'brow.sh':    brow['sh'],
        'eye.iris':   eye['iris'],
        'eye.pupil':  eye['pupil'],
        'lip':        LIP_COLORS[config['lip']],
    }


# ----------------------------------------------------------------------------
# Compose one SVG from a config dict. Mirror of composeSvg() in
# headshotComposer.js — same layer order, same viewBox, same wrapping <g>s,
# same metadata attributes. Round-trips byte-for-byte with the JS composer.
# ----------------------------------------------------------------------------
def compose_svg(config):
    tokens = _build_tokens(config)
    headband = config['headband']
    has_stubble = config['has_stubble']

    parts = [
        '<svg width="500" height="500" viewBox="70 -30 500 500" '
        'xmlns="http://www.w3.org/2000/svg">',
        '<g shape-rendering="crispEdges">',
        '<g transform="scale(10)">',
    ]

    hair_file = config['hair_style'].replace('_', '-')
    face_file = JAW_NAMES[config['jaw_width']]
    # Brow file: trust the explicit `brow_file` field when set (lets the
    # randomizer pick an admin-added variant whose thickness slug isn't
    # in `BROW_THICK_NAMES`); fall back to composing thickness+angle for
    # legacy configs without the field.
    brow_file = config.get('brow_file') or \
        f"{BROW_THICK_NAMES.get(config['brow_thickness'], 'thin')}-{config['brow_angle']}"

    # Stacking order mirrors headshotComposer.js exactly: later push = painted
    # on top. Headband sits on top of hair; hair sits on top of every face-
    # level feature so bangs/fringes/volume overlap the forehead, brows, and
    # shoulders rather than being clipped behind them.
    parts.append(_render_layer('face', face_file, tokens,
        {'skin': config['skin'], 'jaw': config['jaw_width']}))
    stubble_style = config.get('stubble_style', 'default' if has_stubble else 'none')
    parts.append(_render_layer('stubble',
        None if stubble_style == 'none' else stubble_style, tokens,
        {
            'style': stubble_style,
            'enabled': 'true' if stubble_style != 'none' else 'false',
        }))
    parts.append(_render_layer('eyebrows', brow_file, tokens, {
        'thickness': config['brow_thickness'],
        'angle': config['brow_angle'],
        'color': config['brow'],
    }))
    parts.append(_render_layer('eyes', config['eye_shape'], tokens,
        {'shape': config['eye_shape'], 'color': config['eye']}))
    parts.append(_render_layer('nose', config['nose_shape'], tokens,
        {'shape': config['nose_shape']}))
    parts.append(_render_layer('mouth', config['mouth_fullness'], tokens,
        {'fullness': config['mouth_fullness'], 'color': config['lip']}))
    neck_style = config.get('neck_style', 'default')
    parts.append(_render_layer('neck', neck_style, tokens, {'style': neck_style}))
    parts.append(_render_layer('hair', hair_file, tokens,
        {'style': config['hair_style'], 'color': config['hair']}))
    parts.append(_render_layer('headband',
        None if headband == 'none' else headband, tokens,
        {'style': headband}))

    parts += ['</g>', '</g>', '</svg>']
    return '\n'.join(parts)


# ----------------------------------------------------------------------------
# Randomize one config, then compose. viewBox = (70, -30, 500, 500) crops
# tight to the rendered content; the inner scale(10) maps the 64-unit layer
# files into the SVG's pixel space.
# ----------------------------------------------------------------------------
def random_headshot_svg(rng, ethnicity=None, headband_chance=0.11):
    if ethnicity is None:
        ethnicity = rng.choice(list(ETHNICITY_PROFILES.keys()))
    profile = ETHNICITY_PROFILES[ethnicity]

    skin_name = rng.choice(profile['skins'])
    hair_name = rng.choice(profile['hairs'])
    eye_name = rng.choice(list(EYE_COLORS.keys()))
    lip_name = rng.choice(list(LIP_COLORS.keys()))

    # String-keyed variant lists are scanned from the Free folder so any new
    # variants the admin promoted via the Headshot Forge auto-appear here
    # (and any variants currently demoted to Paid drop out cleanly). The
    # integer-keyed and angle-keyed lists stay hardcoded — see the JS
    # composer for the same rationale.
    headband_pool = _scan_layer_variants('headband')
    headband = 'none'
    if rng.random() < headband_chance and headband_pool:
        headband = rng.choice(headband_pool)

    config = {
        'skin': skin_name,
        'hair': hair_name,
        'brow': hair_name,  # default eyebrow color follows hair until user edits
        'eye': eye_name,
        'lip': lip_name,
        # Pick from whatever face files actually exist on disk (via the
        # dynamic JAW_NAMES map). Hardcoding [0, 1, 2] left half the pool
        # generating transparent faces when the admin renamed `medium`.
        'jaw_width': rng.choice(list(JAW_NAMES.keys())),
        'hair_style': rng.choice(_scan_layer_variants('hair')),
        'eye_shape': rng.choice(_scan_layer_variants('eyes')),
        'nose_shape': rng.choice(_scan_layer_variants('nose')),
        'mouth_fullness': rng.choice(_scan_layer_variants('mouth')),
        # Neck variants ship as bundled headshots — scan the folder so any
        # new neck files (e.g. v-neck, turtleneck) immediately enter the
        # procedural pool without code edits. Falls back to 'default' only
        # when the folder is empty / missing.
        'neck_style': rng.choice(_scan_layer_variants('neck')),
        # Stubble: 55% clean-shaven; remaining 45% randomly picks from the
        # actual stubble files on disk (so newly-added variants enter the
        # pool automatically without rebalancing).
        'stubble_style': 'none' if rng.random() >= 0.45 else rng.choice(_scan_layer_variants('stubble')),
        'has_stubble': False,  # back-compat field; the renderer derives the real state from stubble_style
        'headband': headband,
    }
    config['has_stubble'] = config['stubble_style'] != 'none'
    # Eyebrows: pick a full filename from disk and back-fill the canonical
    # thickness/angle pair for metadata + back-compat with consumers that
    # branch on the integer thickness.
    brow_name = rng.choice(_scan_brow_variants())
    brow_thickness, brow_angle = _split_brow_name(brow_name)
    config['brow_file'] = brow_name
    config['brow_thickness'] = brow_thickness
    config['brow_angle'] = brow_angle

    svg = compose_svg(config)
    meta = {
        'ethnicity': ethnicity,
        'hair_style': config['hair_style'],
        'jaw': config['jaw_width'],
        'eye_shape': config['eye_shape'],
        'nose': config['nose_shape'],
        'mouth': config['mouth_fullness'],
        'stubble': config['has_stubble'],
        'headband': config['headband'],
    }
    return svg, meta


# ----------------------------------------------------------------------------
# Render SVG -> cropped, squared, transparent PNG (only when --png is set)
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
