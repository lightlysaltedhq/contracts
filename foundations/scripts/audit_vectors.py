#!/usr/bin/env python3
"""Audit contract/vectors.json — is the frozen artifact well-formed, and does it still cover
both branches of the derivation?

    python3 scripts/audit_vectors.py        # exit 0 = sound, 1 = a claim is false

This exists because the vectors' `exercises` are CLAIMS, and claims rot. The first draft of them
was written from prose rather than measurement and was wrong about six of fifteen vectors, and the
prose that replaced it was wrong twice more (the light pole's "C=0 exactly", and a C=0.073 that
rounds to 0.072), because nothing read it. Since design-system decision D39 every claim is a
field, and this script recomputes each one from the spec, the same way check_type_scale.py holds
the typography vectors' claims (D33): a claim kind it does not know fails rather than being
skipped, a vector with no claims fails, and the census of claims is pinned, so a claim deleted
from one vector fails even when other vectors still carry its kind. `$what` is prose for a reader
and may carry no figure, because a figure in prose is a claim nobody checks.

Unlike freeze_vectors.py, this needs NOTHING outside this repo: it reads the frozen artifact and
recomputes from the spec in contract/derivation.json. That is the property that matters — the
contract has to be auditable on its own.
"""
import json, math, os, re, sys
from decimal import Decimal, ROUND_HALF_EVEN
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
C = lambda n: os.path.join(HERE, '..', 'contract', n)

# The coverage the fixture set is claimed to give. A gate, not a note: change the vectors and this
# fails loudly rather than letting coverage quietly drain away.
EXPECT_MAPPED, EXPECT_TOTAL = 55, 165

# Every claim kind this audit recomputes, and how many of each the fixture set carries. The census
# is the narrowing, as HEX_ALLOWED's count is in check_no_colours.py: a claim deleted from one
# vector changes a count and fails, even while another vector still carries the kind. Change the
# claims deliberately and change the number here deliberately.
CLAIM_CENSUS = {'oklch': 15, 'mapped': 15, 'chosenAt': 5, 'cusp': 2, 'clipsBy': 3, 'contrast': 1,
                'chromaRank': 2, 'hueIgnored': 2, 'exactZero': 1}
# The two every vector carries: where its seed sits, and which rungs it sends through the search.
EVERY_VECTOR = ('oklch', 'mapped')
# The quantise vectors (D39): step 5 alone, on channels whose scaled value is an exact tie.
# Exactly this many, carrying exactly this many ties (a census, as CLAIM_CENSUS is), and between
# them a claim that separates the rule from each way to get it wrong in SEPARATED.
EXPECT_QUANTISE, EXPECT_TIES, EXPECT_ORDERS = 2, 3, 1
# The ways to get step 5 wrong that a quantise claim must show at least once each. The last two
# are reorderings of the linear segment's two multiplications, which no tie separates, so an
# `order` claim does: a channel whose scaled value is one ulp past a tie in step 5's order and
# exactly on it in either reordering (review of PR #35, LOW 1).
SEPARATED = ('halfAwayFromZero', 'exactProduct', 'exactDecimal', 'constantsFirst', 'scaleFirst')


# ── the spec, re-implemented from contract/derivation.json (deliberately not imported from a
#    consumer — an audit that borrows the thing it audits proves nothing) ──
def _srgb_to_lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def _hex_to_oklch(h):
    h = h.strip().lstrip('#')
    r, g, b = (_srgb_to_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = (math.copysign(abs(v) ** (1 / 3), v) for v in (l, m, s))
    L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    return L, math.hypot(a, bb), math.degrees(math.atan2(bb, a)) % 360

def _linear_rgb(L, c, H):
    h = math.radians(H)
    a, b = c * math.cos(h), c * math.sin(h)
    l_, m_, s_ = L + 0.3963377774 * a + 0.2158037573 * b, L - 0.1055613458 * a - 0.0638541728 * b, L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    return (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)


def _lin_to_srgb(c): return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def _byte(y):
    """Half to even, for the non-negative channel values the spec produces (step 5 since 3.0.0,
    D39). Taken on the exact value of y, whether y is a binary64 or a Fraction, and written as the
    comparison it is rather than floor(y + 0.5), whose addition can itself round."""
    f = math.floor(y)
    d = y - f
    return f + 1 if d > Fraction(1, 2) or (d == Fraction(1, 2) and f % 2) else f


def _byte_away(y):
    """Half away from zero: the rule until 3.0.0, and what PHP's round() still does. Recomputed
    only to show a tie separates it from the rule."""
    f = math.floor(y)
    return f + 1 if y - f >= Fraction(1, 2) else f


def _in_gamut(rgb, eps):
    return all(-eps <= ch <= 1.0 + eps for ch in rgb)


def _hex(L, c, H, eps):
    """Steps 4 and 5 of the spec: gamut-map by a 20-iteration chroma search, then quantise."""
    rgb = _linear_rgb(L, c, H)
    if not _in_gamut(rgb, eps):
        lo, hi = 0.0, c
        for _ in range(20):
            mid = (lo + hi) / 2.0
            if _in_gamut(_linear_rgb(L, mid, H), eps): lo = mid
            else: hi = mid
        rgb = _linear_rgb(L, lo, H)
    return '#' + ''.join('%02x' % _byte(max(0.0, min(1.0, _lin_to_srgb(max(0.0, min(1.0, ch))))) * 255.0)
                         for ch in rgb)


def _max_chroma(L, H, eps):
    """The most chroma sRGB holds at (L, H), by bisection far past the spec's 20 iterations: this
    measures the gamut boundary, where the spec only needs a colour inside it."""
    lo, hi = 0.0, 0.5
    for _ in range(50):
        mid = (lo + hi) / 2.0
        if _in_gamut(_linear_rgb(L, mid, H), eps): lo = mid
        else: hi = mid
    return lo


def _cusp(H, eps):
    """The lightness at which the hue holds the most chroma. The boundary's chroma rises to one
    peak and falls, so a ternary search finds it."""
    a, b = 0.01, 0.999
    for _ in range(80):
        m1, m2 = a + (b - a) / 3, b - (b - a) / 3
        if _max_chroma(m1, H, eps) < _max_chroma(m2, H, eps): a = m1
        else: b = m2
    return (a + b) / 2


def _luminance(hx):
    """WCAG 2.x relative luminance, as contract/vocabulary.json#contrast measures it."""
    ch = [int(hx[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in ch]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def _rounds_to(x, written):
    """Does x, rounded half to even at the places `written` carries, read exactly `written`? A
    claim states a measurement at the precision it was measured to; the string says which."""
    if not isinstance(written, str) or not re.fullmatch(r'-?[0-9]+(\.[0-9]+)?', written):
        return False
    return str(Decimal(x).quantize(Decimal(written), rounding=ROUND_HALF_EVEN)) == written


def _prose_with_figures(v):
    """Every `$`-key on a vector whose text carries a digit. `$what` is the one this file writes,
    but any `$` key is prose to a reader, and a figure in any of them is a claim nothing checks
    (review of PR #35, LOW 3)."""
    return [k for k, x in v.items() if k.startswith('$')
            and re.search(r'[0-9]', x if isinstance(x, str) else json.dumps(x))]


def check_claims(doc, ladder, eps, taper, fails):
    """Recompute every vector's `exercises` from the spec. Nothing here reads a claim as true."""
    census = {}
    chroma = {v['seed']: _hex_to_oklch(v['seed'])[1] for v in doc['vectors']}
    ranked = sorted(chroma, key=lambda s: -chroma[s])
    for v in doc['vectors']:
        seed, ex = v['seed'], v.get('exercises')
        for k in _prose_with_figures(v):
            fails.append(f'{seed}: `{k}` carries a figure. Prose is for a reader and nothing checks '
                         'it; put the figure in `exercises`, where this audit recomputes it.')
        if not isinstance(ex, dict) or not ex:
            fails.append(f'{seed}: has no `exercises`. A vector that claims nothing proves nothing, '
                         'and nothing would notice it going.')
            continue
        for kind in EVERY_VECTOR:
            if kind not in ex:
                fails.append(f'{seed}: carries no `{kind}` claim, which every vector carries')
        L, c, H = _hex_to_oklch(seed)
        coords = {'L': L, 'C': c, 'H': H}
        for kind, claim in ex.items():
            census[kind] = census.get(kind, 0) + 1
            if kind == 'oklch':
                if not claim or set(claim) - set(coords) or \
                        not all(_rounds_to(coords[k], w) for k, w in claim.items()):
                    fails.append(f'{seed}: oklch {claim} does not recompute: the seed is '
                                 f'L={L!r} C={c!r} H={H!r}')
            elif kind == 'chosenAt':
                try:
                    got = _hex(float(claim['L']), float(claim['C']), float(claim['H']), eps)
                except (KeyError, TypeError, ValueError):
                    got = None
                if got != seed.lower() or set(claim) - {'L', 'C', 'H'}:
                    fails.append(f'{seed}: chosenAt {claim} derives {got}, where the claim is the seed '
                                 'from exactly L, C and H')
            elif kind == 'mapped':
                got = [s for s in sorted(ladder)
                       if not _in_gamut(_linear_rgb(ladder[s], c * taper(s), H), eps)]
                if claim != got:
                    fails.append(f'{seed}: mapped {claim} does not recompute: the chroma search '
                                 f'runs at {got}')
            elif kind == 'cusp':
                cusp = _cusp(H, eps)
                nearest = min(ladder, key=lambda s: abs(ladder[s] - cusp))
                if not _rounds_to(cusp, claim.get('L')) or \
                        ('nearestRung' in claim and claim['nearestRung'] != nearest) or \
                        set(claim) - {'L', 'nearestRung'}:
                    fails.append(f'{seed}: cusp {claim} does not recompute: the cusp is at '
                                 f'L={cusp:.5f}, nearest rung {nearest}')
            elif kind == 'clipsBy':
                s = claim.get('step')
                by = c * taper(s) - _max_chroma(ladder[s], H, eps) if s in ladder else None
                if by is None or by <= 0 or not _rounds_to(by, claim.get('C')) \
                        or set(claim) - {'step', 'C'}:
                    fails.append(f'{seed}: clipsBy {claim} does not recompute from exactly step and C: '
                                 f'step {s} clips by {by}')
            elif kind == 'contrast':
                lum = _luminance(seed.lower())
                poles = {'lightPole': (1.0 + 0.05) / (lum + 0.05), 'darkPole': (lum + 0.05) / 0.05}
                if not claim or set(claim) - set(poles) or \
                        not all(_rounds_to(poles[k], w) for k, w in claim.items()):
                    fails.append(f'{seed}: contrast {claim} does not recompute: '
                                 f'{ {k: round(x, 4) for k, x in poles.items()} }')
            elif kind == 'chromaRank':
                if claim != ranked.index(seed) + 1:
                    fails.append(f'{seed}: chromaRank {claim} does not recompute: it ranks '
                                 f'{ranked.index(seed) + 1} of {len(ranked)} by chroma')
            elif kind == 'hueIgnored':
                ramp = lambda h: [_hex(ladder[s], c * taper(s), h, eps) for s in sorted(ladder)]
                ignored = ramp(H) == ramp((H + 180.0) % 360.0) == ramp((H + 90.0) % 360.0)
                if claim is not ignored:
                    fails.append(f'{seed}: hueIgnored {claim} does not recompute: turning the hue '
                                 f'{"leaves" if ignored else "moves"} the ramp')
            elif kind == 'exactZero':
                if not claim or set(claim) - set(coords) or any(coords[k] != 0.0 for k in claim):
                    fails.append(f'{seed}: exactZero {claim} does not recompute: '
                                 f'{ {k: coords[k] for k in coords} }')
            else:
                fails.append(f'{seed}: claim kind {kind!r} is not one this audit recomputes, so it '
                             'is not a claim anyone checks')
    for kind in sorted(set(census) - set(CLAIM_CENSUS)):
        fails.append(f'`{kind}` is claimed and CLAIM_CENSUS does not count it')
    for kind, want in CLAIM_CENSUS.items():
        if want < 1:
            fails.append(f'CLAIM_CENSUS pins `{kind}` at {want}. Every kind this audit knows is carried '
                         'at least once, or the trap it exercises is untested.')
        if census.get(kind, 0) != want:
            fails.append(f'the vectors carry {census.get(kind, 0)} `{kind}` claim(s), and the census '
                         f'says {want}. A claim deleted or added changes this; if deliberate, '
                         'update CLAIM_CENSUS and say why.')
    return sum(census.values())


def check_quantise(doc, fails):
    """The rounding rule, which no seed can reach, recomputed on each quantise vector.

    A tie is only a tie in the arithmetic the spec names, so each is recomputed on three
    operands: the binary64 scaled channel in step 5's order (the one derivation.json names,
    `exactBinary64`), the exact product of the binary64 sRGB value and 255 before that
    multiplication rounds, and the exact product of the real numbers the channel and a decimal
    12.92 and 255 denote. Each channel must sit in the transfer function's linear segment: there the
    scaled value is two correctly rounded multiplications, so every conforming implementation
    computes the same binary64, where the power segment would make the tie depend on a maths
    library's pow()."""
    qs = doc.get('quantise')
    if not isinstance(qs, list) or len(qs) != EXPECT_QUANTISE:
        fails.append(f'quantise: {EXPECT_QUANTISE} vector(s) expected. Without them, nothing tells '
                     'half to even from half away from zero: no hex seed lands on a tie.')
        return 0
    n = orders = 0
    separates = set()
    for q in qs:
        qid, ex, rgb = q.get('id'), q.get('exercises'), q.get('linear')
        for k in _prose_with_figures(q):
            fails.append(f'quantise {qid}: `{k}` carries a figure; put it in `exercises`')
        if not isinstance(rgb, list) or len(rgb) != 3 or \
                not all(isinstance(c, float) and 0.0 <= c <= 1.0 for c in rgb):
            fails.append(f'quantise {qid}: `linear` is not three channels in [0, 1]')
            continue
        want = '#' + ''.join('%02x' % _byte(max(0.0, min(1.0, _lin_to_srgb(c))) * 255.0) for c in rgb)
        if q.get('hex') != want:
            fails.append(f'quantise {qid}: hex {q.get("hex")} does not recompute: step 5 gives {want}')
        if not isinstance(ex, dict) or not any(ex.get(k) for k in ('exactTie', 'order')):
            fails.append(f'quantise {qid}: carries no `exactTie` or `order` claim, so it exercises '
                         'nothing')
            continue
        for kind in ex:
            if kind not in ('exactTie', 'order'):
                fails.append(f'quantise {qid}: claim kind {kind!r} is not one this audit recomputes')
        for t in ex.get('order') or []:
            orders += 1
            i = 'rgb'.index(t.get('channel')) if t.get('channel') in ('r', 'g', 'b') else None
            if i is None:
                fails.append(f'quantise {qid}: order {t} names no channel')
                continue
            x = rgb[i]
            y = max(0.0, min(1.0, _lin_to_srgb(x))) * 255.0
            got = {'channel': t['channel'], 'binary64': str(Decimal(y)), 'rule': '%02x' % _byte(y),
                   'constantsFirst': '%02x' % _byte(255.0 * 12.92 * x),
                   'scaleFirst': '%02x' % _byte(x * 255.0 * 12.92)}
            if x > 0.0031308 or got != t or want[1 + 2 * i:3 + 2 * i] != t['rule']:
                fails.append(f'quantise {qid}: order {t} does not recompute: {got}'
                             + (', outside the linear segment' if x > 0.0031308 else ''))
            separates |= {k for k in ('constantsFirst', 'scaleFirst') if got[k] != got['rule']}
        for t in ex.get('exactTie') or []:
            n += 1
            i = 'rgb'.index(t.get('channel')) if t.get('channel') in ('r', 'g', 'b') else None
            if i is None:
                fails.append(f'quantise {qid}: exactTie {t} names no channel')
                continue
            x = rgb[i]
            srgb = max(0.0, min(1.0, _lin_to_srgb(x)))
            y = srgb * 255.0
            got = {'channel': t['channel'], 'binary64': str(Decimal(y)),
                   'halfEven': '%02x' % _byte(y), 'halfAwayFromZero': '%02x' % _byte_away(y),
                   'exactProduct': '%02x' % _byte(Fraction(srgb) * 255),
                   'exactDecimal': '%02x' % _byte(Fraction(x) * Fraction('12.92') * 255)}
            if x > 0.0031308 or Fraction(y) - math.floor(y) != Fraction(1, 2) or got != t \
                    or want[1 + 2 * i:3 + 2 * i] != t['halfEven']:
                fails.append(f'quantise {qid}: exactTie {t} does not recompute: {got}'
                             + (', outside the linear segment' if x > 0.0031308 else ''))
            separates |= {k for k in ('halfAwayFromZero', 'exactProduct', 'exactDecimal')
                          if got[k] != got['halfEven']}
    if n != EXPECT_TIES:
        fails.append(f'quantise: {n} exactTie claim(s), and the census says {EXPECT_TIES}. A tie deleted '
                     'or added changes this; if deliberate, update EXPECT_TIES and say why.')
    if orders != EXPECT_ORDERS:
        fails.append(f'quantise: {orders} order claim(s), and the census says {EXPECT_ORDERS}. A claim '
                     'deleted or added changes this; if deliberate, update EXPECT_ORDERS and say why.')
    for k in sorted(set(SEPARATED) - separates):
        fails.append(f'quantise: no claim separates the rule from {k}, so an implementation that '
                     'computes that way passes unseen')
    return n + orders


def main():
    spec = json.load(open(C('derivation.json')))['algorithm']
    ladder = {int(k): v for k, v in spec['2_ladder']['values'].items()}
    eps = spec['4_gamutMap']['gamutTest']['epsilon']
    doc = json.load(open(C('vectors.json')))
    fails, mapped_total, step_total = [], 0, 0

    def taper(step):
        if step <= 500: return 0.25 + 0.75 * (step - 50) / (500 - 50)
        if step >= 600: return 0.25 + 0.75 * (950 - step) / (950 - 600)
        return 1.0

    for v in doc['vectors']:
        seed, ramp = v['seed'], v['ramp']

        # well-formed: 11 steps, real lowercase hex, keys match the ladder exactly
        if sorted(int(k) for k in ramp) != sorted(ladder):
            fails.append(f'{seed}: ramp steps {sorted(ramp)} != ladder {sorted(ladder)}')
        for k, hx in ramp.items():
            if len(hx) != 7 or not hx.startswith('#') or hx != hx.lower() or \
                    any(ch not in '0123456789abcdef' for ch in hx[1:]):
                fails.append(f'{seed} step {k}: {hx!r} is not a lowercase #rrggbb')

        # lightness must fall monotonically across the ladder — the ramp has to actually BE a ramp
        Ls = [_hex_to_oklch(ramp[str(s)])[0] for s in sorted(ladder)]
        for i in range(len(Ls) - 1):
            if Ls[i + 1] > Ls[i] + 1e-6:
                fails.append(f'{seed}: lightness rises {sorted(ladder)[i]}->{sorted(ladder)[i+1]} '
                             f'({Ls[i]:.4f}->{Ls[i+1]:.4f}) — not a monotonic ramp')

        # coverage: how many steps take the chroma-reduction branch?
        _, c, H = _hex_to_oklch(seed)
        n = sum(1 for step, L in ladder.items()
                if not all(-eps <= ch <= 1.0 + eps for ch in _linear_rgb(L, c * taper(step), H)))
        mapped_total += n
        step_total += len(ladder)

    if step_total != EXPECT_TOTAL:
        fails.append(f'total steps {step_total} != expected {EXPECT_TOTAL}')
    if mapped_total != EXPECT_MAPPED:
        fails.append(f'gamut-mapped steps {mapped_total} != expected {EXPECT_MAPPED} — the fixture '
                     f'set\'s coverage changed. If deliberate, update EXPECT_MAPPED and say why.')
    q5 = spec['5_quantise']
    if q5.get('rounding') != 'halfEven' or q5.get('of') != 'exactBinary64':
        fails.append(f'derivation.json step 5 rounds {q5.get("rounding")!r} of {q5.get("of")!r}; this '
                     'audit recomputes every claim halfEven of exactBinary64 (D39), so it no longer '
                     'audits the spec')
    n_claims = check_claims(doc, ladder, eps, taper, fails)
    n_ties = check_quantise(doc, fails)
    if mapped_total == 0 or mapped_total == step_total:
        fails.append('the fixtures exercise only ONE branch of the derivation — the other is untested')

    print(f'{len(doc["vectors"])} vectors x 11 steps = {step_total} assertions')
    print(f'  gamut-mapped (chroma-reduction branch): {mapped_total}')
    print(f'  direct (no clipping):                   {step_total - mapped_total}')
    print(f'  claims recomputed from the spec:        {n_claims}')
    print(f'  quantise claims at step 5:              {n_ties} (exact ties and operation order)')
    if fails:
        print('\nFAIL:')
        for f in fails: print('   ', f)
        return 1
    print('\nPASS: artifact well-formed, every ramp monotonic, both branches exercised, every '
          'claim recomputed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
