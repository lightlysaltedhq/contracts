"""OKLab / OKLCH conversions and the contract's ramp derivation — Björn Ottosson's matrices.

Promoted into Base at v2.0.0 from ls-design-system/scripts/oklch.py, unchanged in behaviour. It
lived in a brand's repo for one reason only — it was written there first — and every line of it is
pure maths over coordinates. A third implementation had no way to reach it except by copying the
file, which is how two implementations of a spec become two spellings of a spec.

ZERO COLOUR VALUES. Every function here takes the colours it operates on as arguments. The two
constants that look like exceptions are not: WHITE and BLACK are the achromatic poles of the
space, (L=1, C=0) and (L=0, C=0), and they carry the CSS Color 5 keyword names because this file
implements `color-mix(in oklch, A p%, white)` — the syntax, not a palette. Nothing here decides
what colour anything is.

Also implements CSS `color-mix(in oklch, ...)` and the `oklch(from X L C h)` relative syntax, so a
build step can pre-resolve at build time what a browser would compute at paint time.
"""
import math
from types import MappingProxyType

def _srgb_to_lin(c): return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4
def _lin_to_srgb(c): return 12.92*c if c <= 0.0031308 else 1.055*(c**(1/2.4))-0.055

def hex_to_rgb(h):
    h=h.strip().lstrip('#')
    if len(h)==3: h=''.join(x*2 for x in h)
    return tuple(int(h[i:i+2],16)/255 for i in (0,2,4))

def rgb_to_hex(r,g,b):
    f=lambda v: max(0,min(255,round(v*255)))
    return '#%02X%02X%02X'%(f(r),f(g),f(b))

def rgb_to_oklab(r,g,b):
    r,g,b = _srgb_to_lin(r),_srgb_to_lin(g),_srgb_to_lin(b)
    l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b
    m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b
    s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b
    l_,m_,s_ = (math.copysign(abs(v)**(1/3),v) for v in (l,m,s))
    return (0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_,
            1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_,
            0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_)

def oklab_to_rgb(L,a,b):
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l,m,s = l_**3, m_**3, s_**3
    r =  4.0767416621*l - 3.3077115913*m + 0.2309699292*s
    g = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s
    bb= -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    return tuple(_lin_to_srgb(max(0.0,min(1.0,v))) for v in (r,g,bb))

def oklab_to_oklch(L,a,b):
    C = math.hypot(a,b); H = math.degrees(math.atan2(b,a)) % 360
    return (L,C,H)

def oklch_to_oklab(L,C,H):
    h=math.radians(H); return (L, C*math.cos(h), C*math.sin(h))

def hex_to_oklch(h):
    return oklab_to_oklch(*rgb_to_oklab(*hex_to_rgb(h)))

def oklch_to_hex(L,C,H):
    return rgb_to_hex(*oklab_to_rgb(*oklch_to_oklab(L,C,H)))

# The achromatic poles of the space, in OKLCH. C=0 makes the hue powerless (CSS Color 5 §12.2),
# which is why a mix toward either of these carries the OTHER operand's hue through unchanged.
# Coordinates, not palette values — see the module docstring.
WHITE=(1.0,0.0,0.0); BLACK=(0.0,0.0,0.0)

def color_mix_oklch(hex_a, pct_a, other):
    """color-mix(in oklch, A pct%, other) — other is 'white'|'black'|hex.
    Per CSS Color 5: a component with C=0 has a powerless hue, so hue carries from A."""
    La,Ca,Ha = hex_to_oklch(hex_a)
    if other=='white': Lb,Cb,Hb = WHITE
    elif other=='black': Lb,Cb,Hb = BLACK
    else: Lb,Cb,Hb = hex_to_oklch(other)
    p = pct_a; q = 1.0-p
    L = p*La + q*Lb
    C = p*Ca + q*Cb
    H = Ha if Cb==0 else (Hb if Ca==0 else _hue_shorter(Ha,Hb,p))
    return oklch_to_hex(L,C,H)

def _hue_shorter(h1,h2,p):
    d=((h2-h1+180)%360)-180
    return (h1 + (1-p)*d) % 360

def mix_toward_light(hex_a, pct_a):
    """Mix a colour toward the light pole in OKLCH, keeping its hue.

    The repair a status role needs to stay legible when the surface under it inverts: lightness
    rises, chroma falls proportionally, hue does not move. Named for what it DOES rather than for
    what it mixes with, so that callers state a direction rather than a colour."""
    return color_mix_oklch(hex_a, pct_a, 'white')

def mix_toward_dark(hex_a, pct_a):
    """The mirror of mix_toward_light — toward the dark pole, hue held."""
    return color_mix_oklch(hex_a, pct_a, 'black')

def oklch_from(hex_src, L, C):
    """oklch(from <src> L C h) — take hue from src, set explicit L and C."""
    _,_,H = hex_to_oklch(hex_src)
    return oklch_to_hex(L,C,H)

# ══════════════════════════════════════════════════════════════════════════
# Gamut-mapped ramp derivation — implements contract/derivation.json, and is
# pinned by contract/vectors.json's 165 frozen assertions.
#
# The two details that make a re-implementation drift, both specified by the
# contract and reproduced exactly here: the gamut test runs on LINEAR rgb
# (before the sRGB transfer), and rounding is half to even on the binary64
# scaled channel (half away from zero until 3.0.0, D39), written as a
# comparison rather than floor(x + 0.5).
#
# The `salt_` prefix is historical — this maths was lifted from salt's PHP,
# which was its reference implementation before the contract was extracted.
# Salt is not upstream of anything; the contract is. The names are kept
# because two shipping implementations import them, and the unprefixed
# aliases below are what new code should use.
# ══════════════════════════════════════════════════════════════════════════

def oklch_to_linear_rgb(L, C, H):
    """OKLCH -> unclamped LINEAR sRGB. The gamut test runs HERE, before the transfer function."""
    h = math.radians(H)
    a = C*math.cos(h); b = C*math.sin(h)
    l_ = L + 0.3963377774*a + 0.2158037573*b
    m_ = L - 0.1055613458*a - 0.0638541728*b
    s_ = L - 0.0894841775*a - 1.2914855480*b
    l, m, s = l_**3, m_**3, s_**3
    return (4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
            -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
            -0.0041960863*l - 0.7034186147*m + 1.7076147010*s)

def _in_gamut(rgb, eps=1e-6):
    return all(-eps <= c <= 1.0+eps for c in rgb)

def _round_half_even(x):
    """Half to even, for the non-negative channel values here (derivation.json step 5, D39).

    Written as the comparison it is. floor(x + 0.5) is not this rule even away from ties: at
    0.49999999999999994 the addition itself rounds up to 1. y - floor(y) is exact for every
    binary64 below 2^52, so the comparison sees the value the spec rounds."""
    f = math.floor(x)
    d = x - f
    if d > 0.5 or (d == 0.5 and f % 2):
        f += 1
    return int(f)

def salt_oklch_to_hex(L, C, H):
    """OKLCH -> '#rrggbb', gamut-mapping by chroma reduction (20-iter binary search).
    Chroma-reduction, not per-channel clamping: clamping shifts hue and lightness."""
    C = max(0.0, C)
    rgb = oklch_to_linear_rgb(L, C, H)
    if not _in_gamut(rgb):
        lo, hi = 0.0, C
        for _ in range(20):
            mid = (lo + hi) / 2.0
            if _in_gamut(oklch_to_linear_rgb(L, mid, H)): lo = mid
            else: hi = mid
        rgb = oklch_to_linear_rgb(L, lo, H)
    return quantise(rgb)


def quantise(rgb):
    """Step 5 of the derivation on its own: LINEAR sRGB channels -> '#rrggbb'. Clamp, transfer,
    clamp, scale by 255 in binary64, round half to even. contract/vectors.json#quantise pins
    it with channels whose scaled value is an exact tie, which no hex seed can produce."""
    out = '#'
    for c in rgb:
        srgb = _lin_to_srgb(max(0.0, min(1.0, c)))
        out += '%02x' % _round_half_even(max(0.0, min(1.0, srgb)) * 255.0)
    return out

_SALT_LADDER = {50:0.97, 100:0.94, 200:0.88, 300:0.80, 400:0.70, 500:0.62,
                600:0.53, 700:0.45, 800:0.37, 900:0.28, 950:0.20}

def salt_derive_ramp(base_hex):
    """Derive an 11-step tonal ramp (50..950) from one base colour.
    contract/derivation.json is the spec; contract/vectors.json is the proof."""
    _, C, H = hex_to_oklch(base_hex)
    ramp = {}
    for step, L in _SALT_LADDER.items():
        if step <= 500:   taper = 0.25 + 0.75 * (step - 50) / (500 - 50)
        elif step >= 600: taper = 0.25 + 0.75 * (950 - step) / (950 - 600)
        else:             taper = 1.0
        ramp[step] = salt_oklch_to_hex(L, C * taper, H)
    return ramp

def _relative_luminance(hex_c):
    r, g, b = hex_to_rgb(hex_c)
    lin = [(c/12.92 if c <= 0.03928 else ((c+0.055)/1.055)**2.4) for c in (r, g, b)]
    return 0.2126*lin[0] + 0.7152*lin[1] + 0.0722*lin[2]

def contrast_ratio(a, b):
    """WCAG 2.x contrast ratio between two hexes."""
    la, lb = _relative_luminance(a), _relative_luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)

def text_on(bg_hex, candidates, fallbacks=None, min_ratio=4.5):
    """The first candidate that clears `min_ratio` against `bg_hex`; failing that, the
    best-contrasting member of the fallback pool.

    THE CANDIDATES ARE ARGUMENTS, and that is the whole design. Both shipping implementations
    happen to choose between a near-white and a near-black from their own ramps — pinning those
    would smuggle two palette values into a contract that holds none. What is shared is the
    RULE (prefer a palette colour that passes; otherwise take the best available); what is never
    shared is which colours those are. See contract/vocabulary.json#contrast.

    TOTAL over any non-empty pool, and deliberately so. The earlier form destructured exactly two
    fallbacks (`lo, hi = fallbacks`), so a palette offering one, three, or none crashed with an
    unpacking error raised from inside a colour function — a failure naming neither the palette
    nor the role. Ties resolve to the earlier entry, which keeps a caller's preference order
    meaningful.
    """
    for cand in candidates:
        if contrast_ratio(cand, bg_hex) >= min_ratio:
            return cand
    pool = list(fallbacks) if fallbacks else list(candidates)
    if not pool:
        raise ValueError(
            'text_on needs at least one candidate or fallback to choose from. It picks the most '
            'legible colour you offer it; it cannot invent one, because inventing one is exactly '
            'the palette decision this module refuses to make.')
    return max(pool, key=lambda c: contrast_ratio(c, bg_hex))

# Unprefixed aliases — what new code should import.
derive_ramp = salt_derive_ramp
gamut_mapped_hex = salt_oklch_to_hex

# Read-only. The ladder is the derivation spec's output shape (contract/derivation.json), pinned
# by 165 frozen vectors — so a live handle onto the module's own dict let any importer move a rung
# for every later caller in the process, with the vectors still passing wherever they had already
# been checked. A proxy makes that a TypeError at the point of the mistake.
LADDER = MappingProxyType(_SALT_LADDER)


if __name__ == '__main__':
    # Self-test over a generated coordinate sweep. Deliberately no literals: a file whose entire
    # premise is "holds no colours" cannot carry a fixture list of hexes, so the fixtures are
    # computed from ranges instead.
    sweep = ['#%02X%02X%02X' % (r, g, b)
             for r in range(0, 256, 17) for g in range(0, 256, 51) for b in range(0, 256, 85)]
    drift = sum(1 for h in sweep if oklch_to_hex(*hex_to_oklch(h)).upper() != h)
    print(f'round-trip hex -> OKLCH -> hex: {drift} drift(s) over {len(sweep)} sweep points')

    steps = sorted(_SALT_LADDER)
    bad = [h for h in sweep
           if not all(hex_to_oklch(salt_derive_ramp(h)[a])[0]
                      >= hex_to_oklch(salt_derive_ramp(h)[b])[0] - 1e-9
                      for a, b in zip(steps, steps[1:]))]
    print(f'derived ladders monotonic in L: {len(sweep) - len(bad)}/{len(sweep)}')
    print('the real proof is contract/vectors.json — run scripts/audit_vectors.py')
