#!/usr/bin/env python3
"""Regenerate contract/vectors.json — the frozen reference ramps.

    python3 scripts/freeze_vectors.py [--check]

WHY THIS EXISTS, AND WHY IT IS NOT THE GATE
-------------------------------------------
Before Base, the two implementations proved themselves against EACH OTHER: ls-design-system's
Python ran salt's PHP as ground truth. A closed loop — each one's only evidence was the other's
agreement, and if both drifted together nothing would notice. Worse, the loop only closed when
both were present: CI without `php` or without ../salt verified nothing at all.

This script opens the loop exactly once. It runs BOTH implementations, asserts they agree, and
freezes the agreement into a flat artifact. From then on each implementation proves itself
against the artifact ALONE — no sibling checkout, no PHP runtime, no loop.

So: this script is provenance, run rarely and by hand. It is NOT the gate. The gate is each
consumer reading contract/vectors.json. If this script cannot run, nothing is blocked; if it
DISAGREES, something has drifted and the disagreement is the finding.

Re-freezing is a deliberate act. If an implementation disagrees with a frozen vector, the
implementation is wrong by definition — do not re-freeze to make a failure disappear. Re-freeze
only when the SPEC or the SEED CORPUS changes, and say so in the commit. A corpus change moves the
vectors an implementation is held to, so it ships in a major (CHANGELOG.md, 3.0.0).
"""
import json, os, re, subprocess, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(HERE, '..', 'contract', 'vectors.json')
PKG  = os.path.join(HERE, '..', 'package.json')
# The two implementations whose agreement is frozen. The Python one is this directory's own
# oklch.py. Until 25/09/2026 these paths still pointed where they did when the contract was its
# own repository (a sibling ls-design-system/, and salt/ beside it), so from foundations/ both
# resolved inside the design-system checkout and the script could not run at all. salt is the
# PHP one, a sibling checkout of the repository that holds foundations/.
PY   = HERE
PHP  = os.path.abspath(os.path.join(HERE, '..', '..', '..', 'salt', 'inc', 'colors.php'))

# Each vector earns its place by the MATHS it exercises, and says so in two parts: `$what`, one
# line of prose for a reader, which carries no figure; and `exercises`, the claims, as fields that
# scripts/audit_vectors.py recomputes from contract/derivation.json on every run (design-system
# decision D39, closing the first of the two items D26 left owed for 3.0.0). The prose notes these
# replace were wrong twice before anything read them, and a third time when this was written: the
# light pole's note said "C=0 exactly" (its chroma is 3.7e-8, float noise), and the mild blue that
# clips only at 50 claimed C=0.073, which rounds to 0.072. A figure now lives only where the audit reads it.
#
# None is a brand's value (design-system decision D26). Until this 3.0.0 set, five were: the
# Saltworks theme's three brand seeds and two of its slate neutrals, which put Lightly Salted's own
# palette into a public package as "fixtures". Each replacement was chosen at round OKLCH
# coordinates (its `chosenAt` claim) for the same kind of case, and the design system's
# check_conformance.py now fails if a vector seed is any theme's value. Two slots changed hue on
# purpose. The saturated blue's only property, clipping 50-600, is exercised identically by the
# blue primary below, so its slot went to yellow, the hue extreme the set lacked; and the orange's
# hole at 400 is reproduced exactly by a magenta, whose cusp sits at that rung. One seed that stays
# is a product DEFAULT rather than a brand: the unbranded neutral salt and salt-core start from. It
# names nobody's brand.
#
# Between them these 15 map 55 of 165 steps through the chroma-reduction search and leave 110 on
# the direct path, so a re-implementation that botches EITHER branch fails. The audit asserts that
# split, and that the `mapped` claims add up to it.
VECTORS = [
    ('#F8F929',
     'A yellow whose chroma fits while the ladder is light and runs out as it darkens: the whole '
     'dark half is gamut-mapped and none of the light half, the mirror image of the blue '
     'primary\'s clip range. Yellow\'s cusp sits near the top of the lightness range.',
     {'oklch': {'C': '0.200', 'H': '110'}, 'chosenAt': {'L': '0.95', 'C': '0.20', 'H': '110'},
      'mapped': [400, 500, 600, 700, 800, 900, 950], 'cusp': {'L': '0.967'}}),
    ('#6CFD95',
     'A green that clips only in the dark middle, with both ends direct. Green is wide in sRGB '
     'when light and narrow when dark, so this catches an implementation that assumes clipping '
     'is a light-end problem; unlike the yellow, the two darkest rungs fit again once the taper '
     'has cut the chroma.',
     {'oklch': {'C': '0.190', 'H': '150'}, 'chosenAt': {'L': '0.89', 'C': '0.19', 'H': '150'},
      'mapped': [500, 600, 700, 800]}),
    ('#FD26E0',
     'A magenta whose clip range has a hole at the rung beside its cusp. A non-contiguous clip '
     'range guards against short-circuiting the search once a step fits. Its darkest clipped rung '
     'clips by a hair, and as a fill it needs dark text: light text on it is under AA.',
     {'oklch': {'C': '0.290', 'H': '335'}, 'chosenAt': {'L': '0.69', 'C': '0.29', 'H': '335'},
      'mapped': [50, 100, 200, 300, 500, 600, 700, 800],
      'cusp': {'L': '0.685', 'nearestRung': 400}, 'clipsBy': {'step': 800, 'C': '0.001'},
      'contrast': {'lightPole': '3.22', 'darkPole': '6.53'}}),
    ('#4b5563',
     'Never gamut-mapped: after the taper there is almost no chroma to clip. Exercises the direct '
     'path end to end.',
     {'oklch': {'C': '0.026'}, 'mapped': []}),
    ('#F5F0F3',
     'Near-achromatic but not achromatic, so its hue still moves the ramp: the case between a '
     'real colour and the degenerate one. Never mapped.',
     {'oklch': {'C': '0.007'}, 'chosenAt': {'L': '0.96', 'C': '0.007', 'H': '340'},
      'mapped': [], 'hueIgnored': False}),
    ('#28240C',
     'Very dark and low in chroma; the ladder must lighten it a long way. Never mapped.',
     {'oklch': {'L': '0.26', 'C': '0.039'}, 'chosenAt': {'L': '0.26', 'C': '0.04', 'H': '100'},
      'mapped': []}),
    ('#ffffff',
     'The light pole. Its chroma is float noise rather than zero and its hue is noise too, so the '
     'ramp must not depend on the hue: guards the degenerate achromatic path.',
     {'oklch': {'L': '1.000000', 'C': '0.000000'}, 'mapped': [], 'hueIgnored': True}),
    ('#000000',
     'The dark pole, where lightness and chroma are both exactly zero: the other degenerate end.',
     {'oklch': {'L': '0', 'C': '0'}, 'exactZero': ['L', 'C'], 'mapped': []}),
    ('#ff0000',
     'The sRGB red primary, at the red boundary.',
     {'oklch': {'C': '0.258', 'H': '29'}, 'mapped': [50, 100, 200, 300, 400, 500, 600, 700]}),
    ('#00ff00',
     'The green primary. Its light rungs fit despite the second-highest chroma in the set, because '
     'green is sRGB\'s widest hue: the clearest proof that clipping depends on hue, not chroma '
     'alone.',
     {'oklch': {'C': '0.295', 'H': '142'}, 'mapped': [50, 400, 500, 600, 700, 800, 900, 950],
      'chromaRank': 2}),
    ('#0000ff',
     'The blue primary, with the highest chroma in the set; it clips the light end.',
     {'oklch': {'C': '0.313', 'H': '264'}, 'mapped': [50, 100, 200, 300, 400, 500, 600],
      'chromaRank': 1}),
    ('#7C3AED',
     'Violet, a narrow-gamut hue.',
     {'oklch': {'C': '0.247', 'H': '293'}, 'mapped': [50, 100, 200, 300, 400, 500]}),
    ('#DB2777',
     'A hue just past the wraparound, where a hue-interpolation bug shows up. It clips on both '
     'sides of two unclipped middle rungs.',
     {'oklch': {'C': '0.218', 'H': '0.6'}, 'mapped': [50, 100, 200, 300, 600]}),
    ('#123456',
     'A mild colour that still clips at the lightest rung: the boundary case, and the one most '
     'likely to expose an epsilon or linear-versus-sRGB gamut-test error.',
     {'oklch': {'C': '0.072'}, 'mapped': [50], 'clipsBy': {'step': 50, 'C': '0.003'}}),
    ('#abcdef',
     'The same boundary from a lighter seed, clipping by less.',
     {'oklch': {'C': '0.060'}, 'mapped': [50], 'clipsBy': {'step': 50, 'C': '0.0002'}}),
]

# The derivation's rounding, pinned on its own (D39, closing the second item D26 left owed). No hex
# seed can do it: over all 16,777,216 seeds, 11 rungs and 3 channels, measured 25/09/2026, no
# scaled channel value is an exact tie, and the closest is 3.6e-10 from one. So these vectors start
# at step 5's input, linear sRGB, in the transfer function's linear segment, where the scaled value
# is two correctly rounded multiplications and needs no pow() from anybody's maths library. Each
# channel is the one binary64 value within 3,000 ulps of its preimage whose scaled value is exactly
# k + 0.5, chosen so that between them the three channels separate half to even (the rule, D39)
# from half away from zero and half up (the red and blue ties sit above an even byte), from
# rounding the exact product of the sRGB value and 255 before that multiplication rounds (the
# green tie's exact product is just below it, above an odd byte), and from rounding the product of
# the real numbers the channel and a decimal 12.92 denote (the blue tie's is just above it).
# Those three ties do not separate the two reorderings of the linear segment's multiplications:
# the constants first (JavaScript's left-to-right `255 * 12.92 * c`) and 255 before 12.92
# (`c * 255 * 12.92`) each land on exactly the same tie as the rule on all three (review of PR
# #35, LOW 1). So a second vector, `operation-order`, takes the red tie's input one ulp up. In
# step 5's order its scaled value is 2.5000000000000004, which rounds to 3; in either reordering
# it is exactly 2.5, which rounds to 2. audit_vectors.py recomputes all of it. Near-black, and
# far enough in OKLab from every colour any theme holds (check_conformance fails one within 0.02).
QUANTISE = [
    ('exact-ties', [0.0007588174588720937, 0.0010623444424209313, 0.0025799793601651187],
     'Three linear channels, each landing exactly on a tie when scaled in double precision in the '
     'order the spec writes. Half to even takes the even byte at each; half away from zero and half '
     'up take the byte above at the red and blue ties; rounding the exact product, which is just '
     'below the green tie, takes the byte below it; and rounding the decimal product, which is just '
     'above the blue tie, takes the byte above it.',
     {'exactTie': [
         {'channel': 'r', 'binary64': '2.5', 'halfEven': '02', 'halfAwayFromZero': '03',
          'exactProduct': '02', 'exactDecimal': '02'},
         {'channel': 'g', 'binary64': '3.5', 'halfEven': '04', 'halfAwayFromZero': '04',
          'exactProduct': '03', 'exactDecimal': '04'},
         {'channel': 'b', 'binary64': '8.5', 'halfEven': '08', 'halfAwayFromZero': '09',
          'exactProduct': '08', 'exactDecimal': '09'}]}),
    ('operation-order', [0.0007588174588720938, 0.0, 0.0],
     'The red tie\'s input one step up. In the order the spec writes, its scaled value is just above '
     'the tie and rounds up; multiplying the two constants first, or by the scale before the '
     'transfer\'s slope, lands exactly on the tie and rounds to the even byte below.',
     {'order': [
         {'channel': 'r', 'binary64': '2.500000000000000444089209850062616169452667236328125',
          'rule': '03', 'constantsFirst': '02', 'scaleFirst': '02'}]}),
]

PHP_SRC = '''
define('ABSPATH', sys_get_temp_dir());
function salt_log($m) {}
require %s;
$seeds = json_decode(%s, true);
$out = array();
foreach ($seeds as $s) { $out[$s] = salt_derive_ramp($s); }
echo json_encode($out);
'''


def from_python(seeds):
    sys.path.insert(0, PY)
    from oklch import salt_derive_ramp                      # noqa: E402
    return {s: {str(k): v.lower() for k, v in salt_derive_ramp(s).items()} for s in seeds}


def from_php(seeds):
    src = PHP_SRC % (json.dumps(PHP), json.dumps(json.dumps(seeds)))
    r = subprocess.run(['php', '-r', src], capture_output=True, text=True, check=True)
    return {s: {str(k): v.lower() for k, v in ramp.items()} for s, ramp in json.loads(r.stdout).items()}


def quantise_python():
    sys.path.insert(0, PY)
    from oklch import quantise                              # noqa: E402
    return {q: quantise(rgb) for q, rgb, _, _ in QUANTISE}


def main():
    seeds = [s for s, _, _ in VECTORS]
    check = '--check' in sys.argv

    if not shutil.which('php') or not os.path.exists(PHP):
        sys.exit('FAIL: php and ../salt/inc/colors.php are both required — freezing means '
                 'capturing the agreement of TWO implementations. One is not a quorum.')

    py, php = from_python(seeds), from_php(seeds)
    # The quantise vectors are frozen from Python alone. salt's PHP still rounds half away from
    # zero (`round()`), the rule until 3.0.0, so it disagrees on the ties and on nothing else; it
    # adopts half to even when salt moves to 3.0.0 (D39, Phase C). The seeds keep the two-
    # implementation agreement above, because no seed reaches a tie and so the rule change moves
    # none of them: a disagreement there is still a real finding.
    qpy = quantise_python()

    drift = [f'{s} step {k}: py={py[s][k]} php={php[s][k]}'
             for s in seeds for k in py[s] if py[s][k] != php[s][k]]
    if drift:
        print('FAIL: the two implementations DISAGREE. Nothing was frozen.')
        print('  This is a real finding — one of them has drifted from the spec. Fix that first;')
        print('  do NOT re-freeze to paper over it.')
        for d in drift:
            print('   ', d)
        return 1

    doc = {
        '$comment': (
            'FROZEN reference ramps — the independent truth every conforming implementation proves '
            'itself against. Regenerate with scripts/freeze_vectors.py, but read its docstring first: '
            'if an implementation disagrees with a vector here, the IMPLEMENTATION is wrong. '
            'Re-freeze only when the spec or the seed corpus changes. These hexes are test fixtures, not a palette '
            '— nothing renders them, and this contract holds no colour values.'),
        # The package's version, never one of the file's own: every contract file carries the
        # version of the release it ships in (CHANGELOG.md, "Versioning"). A per-file version
        # meaning "last changed in" rotted twice before this rule replaced it.
        'version': json.load(open(PKG))['version'],
        'spec': 'derivation.json',
        'frozen': '2026-09-25',
        'provenance': (
            'Frozen from the byte-identical agreement of TWO independent implementations: '
            'salt/inc/colors.php (PHP) and foundations/scripts/oklch.py (Python). Both were run '
            'over every seed below and agreed on all '
            f'{len(seeds) * 11} ramp steps. That agreement is what is frozen here; from this point '
            'each implementation proves itself against this file alone, with no sibling checkout '
            'and no PHP runtime. The quantise vectors are frozen from the Python implementation '
            'alone: they pin the rounding rule 3.0.0 adopts, half to even, and salt\'s PHP still '
            'rounds half away from zero until it moves to 3.0.0 (design-system decision D39).'),
        'counts': {'seeds': len(seeds), 'steps': 11, 'assertions': len(seeds) * 11,
                   'quantise': len(QUANTISE)},
        '$exercises': (
            'What each vector exercises is a structured field, `exercises`, that '
            'scripts/audit_vectors.py RECOMPUTES from derivation.json rather than reading as prose: '
            'a coordinate is re-measured and rounded to the places written, a clip range is '
            're-derived rung by rung, a cusp is searched for. A claim kind the audit does not know '
            'fails, and so does a vector with no claims. `$what` is one line of prose for a reader, '
            'and holds no figure: every figure is a claim. The prose notes these fields replace '
            'were wrong three times before anything read them.'),
        'vectors': [{'seed': s, '$what': what, 'exercises': claims, 'ramp': py[s]}
                    for s, what, claims in VECTORS],
        '$quantise': (
            'Step 5 of derivation.json on its own: `linear` is three LINEAR sRGB channels, the '
            'values the gamut map hands to step 5, and `hex` is what they must quantise to. No hex '
            'seed makes a scaled channel an exact tie, so the seeds above cannot tell half to even '
            'from half away from zero; these can, and they tell the binary64 operand step 5 names '
            'from two exact ones. Read each channel as the binary64 its JSON number denotes and '
            'compute in binary64, in the order step 5 writes.'),
        'quantise': [{'id': q, '$what': what, 'linear': rgb, 'hex': qpy[q], 'exercises': claims}
                     for q, rgb, what, claims in QUANTISE],
    }

    if check:
        if not os.path.exists(OUT):
            print(f'FAIL: {OUT} does not exist.'); return 1
        cur = json.load(open(OUT))
        same = cur.get('vectors') == doc['vectors'] and cur.get('quantise') == doc['quantise']
        print('PASS: frozen vectors still match both implementations.' if same
              else 'FAIL: contract/vectors.json is STALE vs the live implementations.')
        return 0 if same else 1

    json.dump(doc, open(OUT, 'w'), indent=2)
    print(f'Froze {len(seeds)} vectors x 11 steps = {len(seeds) * 11} assertions -> contract/vectors.json')
    print(f'  and {len(QUANTISE)} quantise vector(s): ' + ', '.join(f'{q} -> {qpy[q]}' for q in qpy))
    print('  Both implementations agreed on every step.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
