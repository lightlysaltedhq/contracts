#!/usr/bin/env python3
"""Self-conformance: does BASE'S OWN oklch.py still reproduce the frozen vectors?

    python3 scripts/check_derivation.py     # exit 0 = conformant, 1 = drifted

WHY THIS DID NOT EXIST, AND WHY IT HAD TO
-----------------------------------------
For v1 this repo held no implementation. It held the spec, the vectors, and `audit_vectors.py` —
which deliberately re-implements the derivation from `contract/derivation.json` rather than
importing anyone's, because an audit that borrows the thing it audits proves nothing. That was
right, and it stays exactly as it is.

v2 promoted an implementation INTO this repo. Nothing was checking it. An adversarial review
introduced the two drifts the README names as the exact traps a re-implementation falls into —
Python's banker's rounding in place of half-away-from-zero (the rule then; half to even since
3.0.0, D39), and a moved ladder rung — and all
three gates stayed green, because all three were looking somewhere else. A repo whose central
claim is "the vectors are the truth and an implementation that disagrees is wrong" shipped an
implementation nothing compared to the vectors.

This closes it, and it matters more now than when it was written: the consuming implementation is
being rewritten to import this module, which makes base's copy the only copy.

Both scripts are needed and they check different things. `audit_vectors.py` asks whether the
ARTIFACT is sound. This asks whether the IMPLEMENTATION still matches it.
"""
import inspect
import json
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
C = lambda n: os.path.join(HERE, '..', 'contract', n)  # noqa: E731


def _load_from_source(path, name):
    """Compile and execute the file ON DISK. Deliberately NOT `import`.

    ╔══════════════════════════════════════════════════════════════════════════════════════════╗
    ║  DO NOT SIMPLIFY THIS TO `import oklch`.                                                  ║
    ║                                                                                           ║
    ║  Importing can return STALE BYTECODE, and the edit that makes it do so is precisely the   ║
    ║  edit this gate exists to catch.                                                          ║
    ║                                                                                           ║
    ║  CPython decides a cached `.pyc` is still valid by comparing the source file's             ║
    ║  (mtime, size) against the pair written into the cache header. A one-character change to  ║
    ║  a numeric constant — `600: 0.53` becoming `600: 0.54` — changes NEITHER. The byte count  ║
    ║  is identical, and mtime is recorded to the second, so an edit-and-rerun inside the same  ║
    ║  second leaves the recorded pair matching. `import oklch` then hands back a module whose  ║
    ║  ladder does not match the file on disk.                                                  ║
    ║                                                                                           ║
    ║  This is observed, not theorised. It happened while this gate was being written: the      ║
    ║  gate printed PASS against bytecode nobody could read, on a source file that plainly      ║
    ║  disagreed with it. And a moved ladder rung is one of the exact two drifts this file      ║
    ║  exists to detect — so the failure mode of the shortcut is that the gate goes green ON    ║
    ║  THE BUG. It is not a slow gate or a noisy gate; it is a gate that reports the opposite   ║
    ║  of the truth, in the one case anybody is relying on it.                                  ║
    ║                                                                                           ║
    ║  A self-conformance check that can test a cached copy of the thing it is checking has     ║
    ║  the same defect as the closed loop this repository was founded to open: its evidence is  ║
    ║  something other than the truth it claims to be checking.                                 ║
    ║                                                                                           ║
    ║  Compiling the source text costs a few milliseconds and cannot go stale.                  ║
    ╚══════════════════════════════════════════════════════════════════════════════════════════╝
    """
    src = open(path, encoding='utf-8').read()
    mod = types.ModuleType(name)
    mod.__file__ = path
    exec(compile(src, path, 'exec'), mod.__dict__)  # noqa: S102 — see the box above
    return mod


# Loaded from source, never imported. This line is load-bearing — see _load_from_source.
oklch = _load_from_source(os.path.join(HERE, 'oklch.py'), 'oklch_under_test')


def main():
    spec = json.load(open(C('derivation.json')))['algorithm']
    doc = json.load(open(C('vectors.json')))
    fails = []

    # ── 1. the ladder, rung by rung, against the spec ──
    # Checked separately from the vectors so a moved rung says "the ladder moved" rather than
    # "1,900 hex digits changed".
    spec_ladder = {int(k): v for k, v in spec['2_ladder']['values'].items()}
    ours = dict(oklch.LADDER)
    if set(ours) != set(spec_ladder):
        fails.append(f'ladder steps {sorted(ours)} != spec {sorted(spec_ladder)}')
    for step in sorted(set(ours) & set(spec_ladder)):
        if abs(ours[step] - spec_ladder[step]) > 1e-12:
            fails.append(f'ladder rung {step}: implementation L={ours[step]} != spec '
                         f'L={spec_ladder[step]}')

    # ── 2. the gamut epsilon ──
    eps = spec['4_gamutMap']['gamutTest']['epsilon']
    sig_eps = inspect.signature(oklch._in_gamut).parameters['eps'].default
    if sig_eps != eps:
        fails.append(f'gamut epsilon {sig_eps} != spec {eps} — the spec calls this out as a real '
                     'interoperability trap at the boundary')

    # ── 3. rounding is half TO EVEN (D39; half away from zero until 3.0.0) ──
    # 0.5 and 2.5 are the discriminators: half away from zero and half up give 1 and 3. The
    # sixth case is not a tie: floor(x + 0.5) gives 1 there, because the addition rounds up.
    if spec['5_quantise'].get('rounding') != 'halfEven' or spec['5_quantise'].get('of') != 'exactBinary64':
        fails.append('derivation.json step 5 no longer rounds halfEven of exactBinary64, which is '
                     'what this gate holds the implementation to')
    for x, want in ((0.5, 0), (1.5, 2), (2.5, 2), (3.5, 4), (254.5, 254), (0.49999999999999994, 0),
                    (2.5000000000000004, 3)):
        got = oklch._round_half_even(x)
        if got != want:
            fails.append(f'rounding: _round_half_even({x!r}) = {got}, want {want} (half to even, '
                         'the contract\'s rule since 3.0.0)')

    # ── 4. the gamut test runs on LINEAR sRGB, before the transfer function ──
    # If it were testing after the transfer, an in-gamut linear triple near 1.0 would disagree.
    lin = oklch.oklch_to_linear_rgb(0.5, 0.0, 0.0)
    if not all(abs(c - oklch._srgb_to_lin(oklch._lin_to_srgb(c))) < 1e-9 for c in lin):
        fails.append('linear/transfer round-trip is inconsistent')

    # ── 5. THE GATE: all 165 frozen assertions, through this repo's own implementation ──
    steps = n = 0
    for v in doc['vectors']:
        got = {str(k): x for k, x in oklch.derive_ramp(v['seed']).items()}
        n += 1
        for step, want in v['ramp'].items():
            steps += 1
            if got.get(step) != want:
                fails.append(f'{v["seed"]} step {step}: ours={got.get(step)} frozen={want}')

    # ── 5b. the rounding rule itself, on channels whose scaled value is an exact tie ──
    # No seed reaches a tie (D39), so the 165 assertions above pass under half to even as well.
    # These are the ones that do not: step 5 alone, through the implementation's own `quantise`.
    ties = 0
    for q in doc.get('quantise', []):
        ties += 1
        got = oklch.quantise(q['linear'])
        if got != q['hex']:
            fails.append(f'quantise {q["id"]}: ours={got} frozen={q["hex"]} — step 5 rounds the '
                         'binary64 value scaled by 255, half to even')

    # ── 6. contrast, since the contract states its properties as ratios ──
    # A degenerate pair with a known exact answer: the two poles are 21:1 by definition. Built
    # from coordinates rather than written as two hexes, because this repository holds none —
    # scripts/check_no_colours.py caught the first draft of this line doing exactly that.
    poles = oklch.contrast_ratio(oklch.rgb_to_hex(1.0, 1.0, 1.0), oklch.rgb_to_hex(0.0, 0.0, 0.0))
    if abs(poles - 21.0) > 1e-9:
        fails.append(f'contrast_ratio between the two poles is {poles}, want exactly 21.0')

    print(f'self-conformance of scripts/oklch.py vs contract/')
    print(f'  ladder      {len(ours)} rungs match derivation.json')
    print(f'  epsilon     {sig_eps}')
    print(f'  rounding    half to even on the binary64 scaled channel (floor(x + 0.5) would drift)')
    print(f'  derivation  {steps} frozen assertions across {n} vectors')
    print(f'  quantise    {ties} vector(s) of exact ties through quantise()')

    if fails:
        print(f'\nFAIL: {len(fails)} drift(s) — the implementation disagrees with the contract:')
        for f in fails[:40]:
            print('   ', f)
        if len(fails) > 40:
            print(f'    … and {len(fails) - 40} more')
        print('\n  The vectors are the truth. Do NOT re-freeze to make this pass — re-freeze only '
              'when the\n  SPEC or the seed corpus changes, and say so. See the README.')
        return 1
    print('\nPASS: base\'s own implementation still matches the contract it publishes.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
