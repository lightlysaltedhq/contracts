#!/usr/bin/env python3
"""Measure a categorical or ordinal palette. Takes the colours as arguments; contains none.

    python3 scripts/validate_palette.py categorical --colors C1 C2 C3 --surface S
    python3 scripts/validate_palette.py ordinal     --colors B1 B2 B3 B4 B5 --surface S

    exit 0 = every ENFORCED check passed · 1 = at least one failed · 2 = bad usage

WHY THIS EXISTS
---------------
Chart colours are the one part of a design system that can be WRONG rather than merely different.
A surface can be any colour you like; a five-series categorical palette cannot, because two series
a reader cannot tell apart is a defect in the data, not a matter of taste. The properties are
objective and cheap to measure — and every system that does not measure them ships a palette that
was checked by looking at it, which is exactly the check that misses a deuteranope's view of it.

This instrument was reconstructed rather than moved. The system it is calibrated against recorded
its verdicts ("secondary-700 fell UNDER the chroma floor", "all five sat outside the dark
lightness band", "worst CVD ΔE 10.5") in source comments, but the tool that produced those numbers
existed in no repository — it was run once, by hand, and the numbers outlived it. That is how a
measurement becomes folklore: the figures are quoted, the instrument is gone, and nobody can rerun
it when the palette moves. So it lives here, where every implementation can reach it.

EVERY CHECK ALWAYS RUNS. THE ONLY QUESTION IS WHETHER IT CAN FAIL THE RUN.
-------------------------------------------------------------------------
All three deficiencies are simulated on every run and every number is printed. `--cvd` selects
which ones are ENFORCED — it never selects what executes, and it may not be empty. There is no
flag that removes a measurement from the output, because the first version of this tool had one
(`--cvd ""` exited 0 with every CVD check silently gone) and a tool built because a green gate once
meant nothing may not ship a way to make a gate green by not looking.

For the same reason an advisory check that misses its floor is reported as **MISS**, is named in
the summary line, and appears in `advisoryFailures` in `--json`. Advisory means "this does not set
the exit code". It has never meant "this passed".

  PASS: 7 enforced checks met · 1 advisory check BELOW floor (separation, tritan (all pairs))

THE METHOD
----------
ΔE          OKLab Euclidean distance × 100. Not CIEDE2000: OKLab is already perceptually uniform
            enough for a threshold check, it is the space the ramps are derived in, and ×100 puts
            the numbers on the scale the recorded figures use.
CVD         Machado, Oliveira & Fernandes (2009), "A Physiologically-based Model for Simulation of
            Color Vision Deficiency", at severity 1.0 for deutan / protan / tritan. Applied in
            LINEAR sRGB, then clamped and re-encoded — the same order the derivation's gamut test
            uses, and the order that matters at the boundary. Severity 1.0 only: a floor should be
            set against the worst case, and a partial-severity table would invite tuning a palette
            until it passes at 0.6.
CONTRAST    WCAG 2.x, from the shared implementation in oklch.py.

WHAT THE THRESHOLDS ARE
-----------------------
Defaults, not mandates. Every one is a flag, and the honest use of this tool is to set your own
against your own surfaces and then keep them.

  --min-de 15        Two categorical series ΔE 15 apart are comfortably distinct at mark size.
  --min-cvd-de 10    The same judgement under simulated deficiency, relaxed because simulation
                     compresses everything. Enforced for deutan and protan by default.
  --chroma-floor     RECONSTRUCTED, not recorded — see the flag's help text and the README.
  --min-contrast 3   WCAG 2.x non-text contrast for graphical objects. A 2px line under 3:1 on its
                     own card is not reliably visible; below it, the mark needs a direct label.
  --l-spread 0.12    Categorical series should sit at roughly ONE lightness, or the darker ones
                     read as more important than the lighter ones. This is the check that
                     honestly fails a "five slots from three hues" set, because slots 4-5 of such
                     a set can only be lightness variants.
  --min-dl 0.06      Ordinal: adjacent bands need a lightness step, because an ordinal ramp is
                     read by lightness first and hue second.

Tritan is measured and printed always, and is ADVISORY by default rather than enforced. The reason
is not that it matters less: the blue-yellow axis collapses so far under simulation that any
palette holding both a blue and a green measures low, and the mitigation there is lightness, shape
and labelling rather than hue — a hue floor would only push palettes away from blue-and-green,
which is not a fix. Enforce it with `--cvd deutan,protan,tritan`. A worked example: the reference
implementation's own three-hue categorical set measures deutan 10.4 / protan 13.0 / tritan 5.2,
and it shipped — its recorded verdict was computed over deutan and protan only, which is exactly
the kind of unstated assumption a vanished instrument leaves behind.

WHAT IT DOES NOT DO
-------------------
It does not choose colours, propose replacements, or search a ramp for a better set. It measures
what you hand it. Choosing is a design decision with a brand behind it, and this repository holds
no brands.
"""
import argparse
import itertools
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oklch import (_lin_to_srgb, _srgb_to_lin, contrast_ratio, hex_to_oklch,  # noqa: E402
                   hex_to_rgb, rgb_to_hex, rgb_to_oklab)

# Machado-Oliveira-Fernandes 2009, severity 1.0. Row-major 3x3 over LINEAR sRGB.
CVD_MATRICES = {
    'deutan': ((0.367322, 0.860646, -0.227968),
               (0.280085, 0.672501, 0.047413),
               (-0.011820, 0.042940, 0.968881)),
    'protan': ((0.152286, 1.052583, -0.204868),
               (0.114503, 0.786281, 0.099216),
               (-0.003882, -0.048116, 1.051998)),
    'tritan': ((1.255528, -0.076749, -0.178779),
               (-0.078411, 0.930809, 0.147602),
               (0.004733, 0.691367, 0.303900)),
}
# Always simulated, always reported. Deliberately not configurable.
SIMULATED = ('deutan', 'protan', 'tritan')
DEFAULT_ENFORCED = ('deutan', 'protan')

# The chroma floor is a RECONSTRUCTION and must be labelled as one everywhere it appears.
CHROMA_FLOOR = 0.10
CHROMA_FLOOR_NOTE = (
    'RECONSTRUCTED, not recorded. The reference implementation recorded the VERDICT '
    '("secondary-700 fell under the chroma floor") and never the floor itself. All the record '
    'constrains it to is the half-open interval (0.098154, 0.115033] — above the rung it rejected, '
    'at or below the least chromatic rung it shipped. 0.10 sits in that interval and reproduces '
    'the verdict; it is not otherwise validated, and it is thin on both sides. Set your own.')


def simulate(hex_c, kind):
    """Simulate a colour vision deficiency. Linear in, clamp, transfer back out."""
    r, g, b = (_srgb_to_lin(c) for c in hex_to_rgb(hex_c))
    m = CVD_MATRICES[kind]
    out = [sum(m[i][j] * (r, g, b)[j] for j in range(3)) for i in range(3)]
    return rgb_to_hex(*(_lin_to_srgb(max(0.0, min(1.0, v))) for v in out))


def delta_e(a, b):
    """OKLab Euclidean distance × 100."""
    la, aa, ba = rgb_to_oklab(*hex_to_rgb(a))
    lb, ab, bb = rgb_to_oklab(*hex_to_rgb(b))
    return 100 * ((la - lb) ** 2 + (aa - ab) ** 2 + (ba - bb) ** 2) ** 0.5


def _cvd_floor(kind, args):
    """(floor, enforced) for a deficiency.

    The floor exists either way. An advisory check still has something to miss, and pretending
    otherwise is precisely how a miss becomes a pass.
    """
    floor = args.min_tritan_de if kind == 'tritan' and args.min_tritan_de is not None \
        else args.min_cvd_de
    return floor, kind in args.enforced


def _pairs(n, mode):
    if mode == 'adjacent':
        return [(i, i + 1) for i in range(n - 1)]
    return list(itertools.combinations(range(n), 2))


class Report:
    """A check is one of three things, and the summary line may never conflate them.

      enforced       met or not; sets the exit code.
      advisory       has a floor and is measured against it, but does not set the exit code. A
                     miss prints MISS and is named in the summary.
      informational  has no floor at all, so there is nothing it can miss.
    """

    def __init__(self):
        self.checks = []

    def add(self, name, ok, detail, worst=None, enforced=True, informational=False):
        if informational:
            kind, ok = 'informational', True
        else:
            kind = 'enforced' if enforced else 'advisory'
        self.checks.append({'check': name, 'kind': kind, 'pass': bool(ok),
                            'detail': detail, 'worst': worst})

    def _of(self, kind, passed):
        return [c for c in self.checks if c['kind'] == kind and c['pass'] is passed]

    @property
    def enforced_failures(self): return self._of('enforced', False)

    @property
    def advisory_failures(self): return self._of('advisory', False)

    @property
    def n_enforced(self): return len([c for c in self.checks if c['kind'] == 'enforced'])

    def summary(self):
        adv = self.advisory_failures
        tail = ''
        if adv:
            tail = (f' · {len(adv)} advisory check{"s" if len(adv) > 1 else ""} BELOW floor ('
                    + '; '.join(c['check'] for c in adv) + ')')
        bad = self.enforced_failures
        if bad:
            return (f'FAIL: {len(bad)} of {self.n_enforced} enforced checks failed{tail}. '
                    'The palette is the thing to change — not the thresholds, unless you can say '
                    'why the threshold was wrong.')
        if adv:
            return (f'PASS: {self.n_enforced} enforced checks met{tail}. Nothing failed the run '
                    'and something did miss its floor; both of those are facts about this '
                    'palette, and only you know which matters for what you are shipping.')
        return f'PASS: {self.n_enforced} enforced checks met · no advisory misses.'

    MARK = {('enforced', True): 'PASS', ('enforced', False): 'FAIL',
            ('advisory', True): ' ok ', ('advisory', False): 'MISS',
            ('informational', True): 'INFO'}

    def render(self, header, labels, colors, surface):
        lines = [header, '']
        lines.append(f'  surface   {surface}   L {hex_to_oklch(surface)[0]:.3f}')
        lines.append(f'  {"slot":<14}{"colour":<10}{"L":>7}{"C":>8}{"H":>8}{"vs surface":>12}')
        for lb, c in zip(labels, colors):
            L, C, H = hex_to_oklch(c)
            lines.append(f'  {lb:<14}{c:<10}{L:>7.3f}{C:>8.4f}{H:>8.1f}'
                         f'{contrast_ratio(c, surface):>11.2f}:1')
        lines.append('')
        for c in self.checks:
            suffix = '' if c['kind'] == 'enforced' else f'   [{c["kind"]}]'
            lines.append(f'  [{self.MARK[(c["kind"], c["pass"])]}] {c["check"]}{suffix}')
            for d in c['detail']:
                lines.append(f'         {d}')
        lines.append('')
        lines.append(self.summary())
        return '\n'.join(lines)


# ══════════════════════════════════════════════════════════════════════════════
# CATEGORICAL — slots that encode IDENTITY (which series)
# ══════════════════════════════════════════════════════════════════════════════
def check_categorical(colors, surface, labels, args):
    R = Report()

    # 1. lightness spread
    Ls = [hex_to_oklch(c)[0] for c in colors]
    spread = max(Ls) - min(Ls)
    R.add('lightness spread', spread <= args.l_spread,
          [f'observed {spread:.4f}, limit {args.l_spread}',
           'Categorical slots encode identity, not rank. A wide lightness spread makes the '
           'darker slots read as more important — and is the signature of slots that are '
           'lightness variants of an earlier hue rather than hues of their own.'],
          worst=round(spread, 4))

    # 2. explicit lightness band, only when one is supplied
    if args.l_band:
        lo, hi = args.l_band
        outside = [(lb, round(L, 3)) for lb, L in zip(labels, Ls) if not (lo <= L <= hi)]
        R.add('lightness band', not outside,
              [f'band [{lo}, {hi}]'] +
              (['outside: ' + ', '.join(f'{lb} L={L}' for lb, L in outside)] if outside
               else ['every slot inside the band']))

    # 3. chroma floor
    Cs = [hex_to_oklch(c)[1] for c in colors]
    under = [(lb, round(C, 4)) for lb, C in zip(labels, Cs) if C < args.chroma_floor]
    R.add('chroma floor', not under,
          [f'floor {args.chroma_floor}, observed min {min(Cs):.4f}',
           f'floor provenance: {CHROMA_FLOOR_NOTE}'] +
          (['under: ' + ', '.join(f'{lb} C={C}' for lb, C in under)] if under
           else ['every slot holds its hue']),
          worst=round(min(Cs), 4))

    # 4. separation, normal vision
    pairs = _pairs(len(colors), args.pairs)
    if pairs:
        d = {(i, j): delta_e(colors[i], colors[j]) for i, j in pairs}
        worst = min(d, key=d.get)
        R.add(f'separation, normal vision ({args.pairs} pairs)',
              d[worst] >= args.min_de,
              [f'floor {args.min_de}, worst {d[worst]:.1f} '
               f'({labels[worst[0]]} | {labels[worst[1]]})'],
              worst=round(d[worst], 2))

        # 5. separation under simulated deficiency — ALL THREE, always
        for kind in SIMULATED:
            floor, enforced = _cvd_floor(kind, args)
            sim = [simulate(c, kind) for c in colors]
            dd = {(i, j): delta_e(sim[i], sim[j]) for i, j in pairs}
            w = min(dd, key=dd.get)
            R.add(f'separation, {kind} ({args.pairs} pairs)', dd[w] >= floor,
                  [f'floor {floor}, worst {dd[w]:.1f} ({labels[w[0]]} | {labels[w[1]]})'],
                  worst=round(dd[w], 2), enforced=enforced)

    # 6. mark contrast
    ratios = [contrast_ratio(c, surface) for c in colors]
    low = [(lb, round(r, 2)) for lb, r in zip(labels, ratios) if r < args.min_contrast]
    R.add('mark contrast vs surface', not low,
          [f'floor {args.min_contrast}:1, worst {min(ratios):.2f}:1'] +
          (['under: ' + ', '.join(f'{lb} {r}:1' for lb, r in low),
            'A mark below the floor is not reliably visible on its own. It is legal only where '
            'the mark carries a direct label or a legend row — say so in the token, do not '
            'lower the floor.'] if low else ['every mark visible on this surface']),
          worst=round(min(ratios), 2))
    return R


# ══════════════════════════════════════════════════════════════════════════════
# ORDINAL — a ramp that encodes ORDER (which band)
# ══════════════════════════════════════════════════════════════════════════════
def check_ordinal(colors, surface, labels, args):
    R = Report()
    Ls = [hex_to_oklch(c)[0] for c in colors]

    # 1. monotonic lightness — an ordinal ramp is read by lightness first
    direction = args.direction
    if direction == 'auto':
        direction = 'ascending' if Ls[-1] > Ls[0] else 'descending'
    if direction == 'ascending':
        breaks = [i for i in range(len(Ls) - 1) if Ls[i + 1] <= Ls[i]]
    else:
        breaks = [i for i in range(len(Ls) - 1) if Ls[i + 1] >= Ls[i]]
    R.add(f'monotonic lightness ({direction})', not breaks,
          [' '.join(f'{L:.3f}' for L in Ls)] +
          (['reverses at ' + ', '.join(f'{labels[i]}|{labels[i+1]}' for i in breaks),
            'A ramp that turns back on itself stops being an order. Readers decode a band '
            'series by lightness before they decode it by hue.']
           if breaks else ['ordered end to end']))

    # 2. adjacent lightness step
    dls = [abs(Ls[i + 1] - Ls[i]) for i in range(len(Ls) - 1)]
    thin = [(i, round(v, 4)) for i, v in enumerate(dls) if v < args.min_dl]
    R.add('adjacent lightness step', not thin,
          [f'floor {args.min_dl}, observed ' + ' '.join(f'{v:.4f}' for v in dls)] +
          (['thin: ' + ', '.join(f'{labels[i]}|{labels[i+1]} ΔL={v}' for i, v in thin)]
           if thin else ['every boundary reads']),
          worst=round(min(dls), 4) if dls else None)

    # 3. adjacent ΔE, normal and simulated — ALL THREE deficiencies, always
    des = [delta_e(colors[i], colors[i + 1]) for i in range(len(colors) - 1)]
    thin = [(i, round(v, 2)) for i, v in enumerate(des) if v < args.min_de]
    R.add('adjacent separation, normal vision', not thin,
          [f'floor {args.min_de}, observed ' + ' '.join(f'{v:.1f}' for v in des)] +
          (['thin: ' + ', '.join(f'{labels[i]}|{labels[i+1]} ΔE={v}' for i, v in thin)]
           if thin else ['every boundary separates']),
          worst=round(min(des), 2) if des else None)
    for kind in SIMULATED:
        floor, enforced = _cvd_floor(kind, args)
        sim = [simulate(c, kind) for c in colors]
        d = [delta_e(sim[i], sim[i + 1]) for i in range(len(sim) - 1)]
        thin = [(i, round(v, 2)) for i, v in enumerate(d) if v < floor]
        R.add(f'adjacent separation, {kind}', not thin,
              [f'floor {floor}, observed ' + ' '.join(f'{v:.1f}' for v in d)] +
              (['thin: ' + ', '.join(f'{labels[i]}|{labels[i+1]} ΔE={v}' for i, v in thin)]
               if thin else ['every boundary survives simulation']),
              worst=round(min(d), 2) if d else None, enforced=enforced)

    # 4. hue coherence — informational. A band ramp should read as ONE family fading out.
    hues = [hex_to_oklch(c)[2] for c in colors]
    span = max(hues) - min(hues)
    R.add('hue spread', True,
          [f'{span:.1f}° across the ramp',
           'A sequential ramp reads best as one family losing chroma, not as a march through '
           "the wheel. Reported with no floor: a low-chroma step's hue is nearly powerless, so "
           'a large number here can be an artefact rather than a fault.'],
          worst=round(span, 1), informational=True)

    # 5. contrast — informational unless a floor is supplied, by design
    ratios = [contrast_ratio(c, surface) for c in colors]
    has_floor = args.min_contrast_ordinal is not None
    low = [(lb, round(r, 2)) for lb, r in zip(labels, ratios)
           if has_floor and r < args.min_contrast_ordinal]
    R.add('contrast vs surface', not low,
          [' '.join(f'{r:.2f}:1' for r in ratios),
           'The faint end of an ordinal ramp is MEANT to recede toward the surface — that is '
           'what "faintest" is — so no floor applies unless you supply --min-contrast-ordinal. '
           'The identity a receding band loses is carried by the legend, which is why a band '
           'series is never a standalone mark.'] +
          (['under: ' + ', '.join(f'{lb} {r}:1' for lb, r in low)] if low else []),
          worst=round(min(ratios), 2), informational=not has_floor)
    return R


# ══════════════════════════════════════════════════════════════════════════════
def main(argv=None):
    p = argparse.ArgumentParser(
        prog='validate_palette.py',
        description='Measure a categorical or ordinal palette. Colours are arguments; this tool '
                    'holds none. Every check always runs; --cvd selects only what is ENFORCED.',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='mode', required=True)

    def common(sp):
        sp.add_argument('--colors', '--colours', dest='colors', nargs='+', required=True,
                        metavar='HEX', help='the slots, in order')
        sp.add_argument('--surface', required=True, metavar='HEX',
                        help='the surface the marks are drawn on (the CARD, not the page, if they '
                             'differ — a mark is judged against what is actually behind it)')
        sp.add_argument('--labels', nargs='+', default=None,
                        help='names for the slots, for readable output')
        sp.add_argument('--cvd', default=','.join(DEFAULT_ENFORCED),
                        help='which deficiencies are ENFORCED (default: '
                             f'{",".join(DEFAULT_ENFORCED)}). All of {"/".join(SIMULATED)} are '
                             'simulated and reported on every run regardless; this flag only '
                             'decides which can fail it. May not be empty — there is no way to '
                             'stop a measurement being taken.')
        sp.add_argument('--min-de', type=float, default=None)
        sp.add_argument('--min-cvd-de', type=float, default=None,
                        help='floor for deutan and protan')
        sp.add_argument('--min-tritan-de', type=float, default=None,
                        help='floor for tritan (defaults to --min-cvd-de). Measured against it '
                             'either way; --cvd decides whether missing it fails the run.')
        sp.add_argument('--min-contrast', type=float, default=3.0)
        sp.add_argument('--json', action='store_true', help='machine-readable report on stdout')

    c = sub.add_parser('categorical', help='slots that encode IDENTITY (which series)')
    common(c)
    c.add_argument('--pairs', choices=('all', 'adjacent'), default='all',
                   help='all: every pair must separate — required for scatter, choropleth, small '
                        'multiples. adjacent: consecutive slots only — the honest bar for '
                        'stacked/grouped bars and multi-line, WITH direct labels or an '
                        'identifying legend.')
    c.add_argument('--l-spread', type=float, default=0.12)
    c.add_argument('--l-band', type=float, nargs=2, default=None, metavar=('LO', 'HI'),
                   help='optional explicit OKLCH lightness band every slot must sit inside')
    c.add_argument('--chroma-floor', type=float, default=CHROMA_FLOOR,
                   help=f'OKLCH chroma floor (default {CHROMA_FLOOR}). {CHROMA_FLOOR_NOTE}')

    o = sub.add_parser('ordinal', help='a ramp that encodes ORDER (which band)')
    common(o)
    o.add_argument('--min-dl', type=float, default=0.06)
    o.add_argument('--direction', choices=('auto', 'ascending', 'descending'), default='auto')
    o.add_argument('--min-contrast-ordinal', type=float, default=None,
                   help='apply a contrast floor too. Absent by default: a tail is meant to '
                        'recede, so there is no floor rather than a floor nobody enforces.')

    args = p.parse_args(argv)
    if args.min_de is None:
        args.min_de = 15.0 if args.mode == 'categorical' else 6.0
    if args.min_cvd_de is None:
        args.min_cvd_de = 10.0 if args.mode == 'categorical' else 6.0

    colors = [c if c.startswith('#') else '#' + c for c in args.colors]
    surface = args.surface if args.surface.startswith('#') else '#' + args.surface
    labels = args.labels or [str(i + 1) for i in range(len(colors))]
    if len(labels) != len(colors):
        p.error(f'{len(labels)} labels for {len(colors)} colours')
    if len(colors) < 2:
        p.error('at least two colours are needed to measure a separation')

    enforced = [k.strip() for k in args.cvd.split(',') if k.strip()]
    if not enforced:
        p.error('--cvd may not be empty. It selects which deficiencies are ENFORCED, not which '
                'are measured — every one of ' + '/'.join(SIMULATED) + ' is simulated and '
                'reported on every run. To stop one failing the run, set a floor you can defend '
                '(--min-cvd-de 0) rather than removing the measurement.')
    for k in enforced:
        if k not in CVD_MATRICES:
            p.error(f'unknown deficiency {k!r} — known: {", ".join(SIMULATED)}')
    args.enforced = enforced

    if args.mode == 'categorical':
        R = check_categorical(colors, surface, labels, args)
        head = f'CATEGORICAL — {len(colors)} slots, {args.pairs} pairs'
    else:
        R = check_ordinal(colors, surface, labels, args)
        head = f'ORDINAL — {len(colors)} bands'

    if args.json:
        print(json.dumps({
            'mode': args.mode, 'colors': colors, 'surface': surface, 'labels': labels,
            'simulated': list(SIMULATED), 'enforced': enforced,
            'checks': R.checks,
            'enforcedFailures': [c['check'] for c in R.enforced_failures],
            'advisoryFailures': [c['check'] for c in R.advisory_failures],
            'summary': R.summary(),
            'pass': not R.enforced_failures}, indent=2))
    else:
        print(R.render(head, labels, colors, surface))
    return 1 if R.enforced_failures else 0


if __name__ == '__main__':
    sys.exit(main())
