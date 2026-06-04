#!/usr/bin/env python3
"""
extract_layers.py — one-shot helper to dump each layer variant of the
headshot composer into a standalone SVG file under headshot-layers/.

The build_* functions in this script are the historical pixel-coordinate
source for the headshot layer geometry. Running this script renders each
variant once with SENTINEL palette dicts (recognizable strings instead of
hex colors), captures the emitted <rect> sequence, post-processes the
sentinels into {{template.tokens}}, and writes a tidy standalone SVG per
variant to headshot-layers/<layer>/<variant>.svg.

The resulting files are the runtime source of truth for layer geometry.
Both the JS composer (headshotComposer.js) and generate_headshots.py load
them at compose time and template-replace the tokens with the user's
chosen palette values.

When to re-run:
  - You changed a build_* function's rect coords below.
  - You added a new variant (add the build branch + the extract call at the
    bottom; the file lands on its own).

USAGE
-----
    cd frontend/src/assets
    python3 extract_layers.py

After running, regenerate the bundled SVG library with
  ./run_headshot_generator.sh -n 240
so the shipped headshots match the new geometry.
"""

import os
import sys


# ============================================================================
# Build functions — pixel-coordinate definitions for each layer variant
# ============================================================================
# These are the historical source for headshot layer geometry. They take
# generic palette dicts so they can be called with either real hex values
# (legacy use) or sentinel strings (extraction use).
# ============================================================================

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
    parts.append(rect(17, 15, 30, 2, hi))
    parts.append(rect(19, 17, 4, 2, hi))
    parts.append(rect(41, 17, 4, 2, hi))
    parts.append(rect(15, 20, 2, 8, sh))
    parts.append(rect(47, 20, 2, 8, sh))
    parts.append(rect(17, 33, 4, 4, sh))
    parts.append(rect(43, 33, 4, 4, sh))
    parts.append(rect(19, 29, 4, 3, hi))
    parts.append(rect(41, 29, 4, 3, hi))
    _layer_close(parts)


def build_stubble(parts, skin, has_stubble):
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
        parts.append(rect(15, 16, 2, 3, sh))
        parts.append(rect(47, 16, 2, 3, sh))
    elif style == "wavy":
        parts.append(rect(19, 5, 26, 3, b))
        parts.append(rect(16, 8, 32, 3, hi))
        parts.append(rect(15, 11, 34, 3, b))
        parts.append(rect(14, 14, 36, 3, hi))
        parts.append(rect(21, 4, 22, 1, hi))
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
        parts.append(rect(26, 6, 3, 6, hi))
        parts.append(rect(20, 6, 26, 1, hi))
        parts.append(rect(14, 17, 2, 5, b))
        parts.append(rect(48, 17, 2, 5, b))
    elif style == "curly":
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
    _layer_open(parts, 'neck')
    parts.append(rect(24, 45, 16, 3, skin["sh"]))
    parts.append(rect(24, 45, 16, 1, skin["deep"]))
    parts.append(rect(26, 45, 12, 1, skin["deep"]))
    _layer_close(parts)


def build_headband(parts, color):
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


# ============================================================================
# Extraction — dump each variant to its own SVG file with token placeholders
# ============================================================================

# Sentinel palettes — recognizable strings the builders will write into rect
# fill attrs in place of real hex colors. Post-process replaces these with
# {{template.tokens}} that the runtime composers fill in.
SKIN = {'base': '@SKIN_BASE@', 'hi': '@SKIN_HI@', 'sh': '@SKIN_SH@', 'deep': '@SKIN_DEEP@'}
HAIR = {'base': '@HAIR_BASE@', 'hi': '@HAIR_HI@', 'sh': '@HAIR_SH@'}
BROW = {'base': '@BROW_BASE@', 'hi': '@BROW_HI@', 'sh': '@BROW_SH@'}
EYE  = {'iris': '@EYE_IRIS@',  'pupil': '@EYE_PUPIL@'}
LIP  = '@LIP@'

TOKEN_MAP = {
    '@SKIN_BASE@':  '{{skin.base}}',
    '@SKIN_HI@':    '{{skin.hi}}',
    '@SKIN_SH@':    '{{skin.sh}}',
    '@SKIN_DEEP@':  '{{skin.deep}}',
    '@HAIR_BASE@':  '{{hair.base}}',
    '@HAIR_HI@':    '{{hair.hi}}',
    '@HAIR_SH@':    '{{hair.sh}}',
    '@BROW_BASE@':  '{{brow.base}}',
    '@BROW_HI@':    '{{brow.hi}}',
    '@BROW_SH@':    '{{brow.sh}}',
    '@EYE_IRIS@':   '{{eye.iris}}',
    '@EYE_PUPIL@':  '{{eye.pupil}}',
    '@LIP@':        '{{lip}}',
}


def tokenize(text):
    for sentinel, token in TOKEN_MAP.items():
        text = text.replace(sentinel, token)
    return text


def extract(layer_id, variant_name, builder, *args):
    """Run a builder, capture the rects (stripping its <g data-layer> wrapper),
    tokenize, and write a standalone SVG to headshot-layers/<layer>/<variant>.svg.
    """
    parts = []
    builder(parts, *args)
    # Builders wrap their rects in <g data-layer="...">; the runtime composer
    # re-applies that wrapper at compose time with the right metadata for the
    # active config, so we strip it here. Anything not a <g> open/close becomes
    # a rect that goes in the file.
    rects = [p for p in parts if not (p.startswith('<g data-layer') or p == '</g>')]
    body = '\n  '.join(tokenize(p) for p in rects)
    svg = (
        '<svg width="64" height="64" viewBox="0 0 64 64" '
        'xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">\n  '
        + body
        + '\n</svg>\n'
    )
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'headshot-layers', layer_id)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f'{variant_name}.svg')
    with open(out_path, 'w') as f:
        f.write(svg)
    print(f'wrote {layer_id}/{variant_name}.svg  ({len(rects)} rects)')


def main():
    for style in ['short', 'fade', 'wavy', 'side_part', 'curly', 'buzz', 'afro']:
        fname = style.replace('_', '-')
        extract('hair', fname, build_hair, HAIR, style, 'sentinel')

    for jaw, name in [(0, 'narrow'), (1, 'medium'), (2, 'wide')]:
        extract('face', name, build_face, SKIN, jaw, 'sentinel')

    extract('stubble', 'default', build_stubble, SKIN, True)

    extract('headband', 'white', build_headband, 'white')
    extract('headband', 'black', build_headband, 'black')

    for thick, t_name in [(1, 'thin'), (2, 'thick')]:
        for angle in ['flat', 'up', 'down']:
            extract('eyebrows', f'{t_name}-{angle}', build_eyebrows, BROW, thick, angle, 'sentinel')

    for shape in ['round', 'almond']:
        extract('eyes', shape, build_eyes, SKIN, EYE, shape, 'sentinel')

    for shape in ['narrow', 'medium', 'broad']:
        extract('nose', shape, build_nose, SKIN, shape)

    for fullness in ['thin', 'full']:
        extract('mouth', fullness, build_mouth, SKIN, LIP, fullness, 'sentinel')

    extract('neck', 'default', build_neck, SKIN)


if __name__ == '__main__':
    main()
