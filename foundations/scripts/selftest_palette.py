#!/usr/bin/env python3
"""The palette instrument's refusals, as tests.

Each case proves validate_palette.py REFUSES something; one accepting control per cluster proves
the rule does not fire always. Colours are generated from OKLCH numbers here rather than written,
because this package holds no colour values (check_no_colours.py).
"""
import contextlib
import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oklch import oklch_to_hex  # noqa: E402
import validate_palette  # noqa: E402

SURFACE = oklch_to_hex(0.97, 0.005, 80)
EDGE = oklch_to_hex(0.45, 0.02, 250)
# Four parts that pass: distinct hues, one grey, spread in lightness.
GOOD = [oklch_to_hex(0.37, 0.075, 248), oklch_to_hex(0.80, 0.08, 80),
        oklch_to_hex(0.62, 0.026, 250), oklch_to_hex(0.53, 0.13, 40)]
LABELS = ['a', 'b', 'c', 'd']
fails = []


def run(argv):
    """(exit code, report or stderr text). argparse refusals exit 2 and write to stderr."""
    buf, err = io.StringIO(), io.StringIO()
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(err):
            code = validate_palette.main(argv + ['--json'])
    except SystemExit as e:
        return e.code, err.getvalue()
    return code, json.loads(buf.getvalue())


def comp(colors, labels=LABELS, extra=()):
    return ['composition', '--colors', *colors, '--surface', SURFACE, '--labels', *labels,
            '--edged', 'b', '--edge', EDGE, *extra]


def expect(name, argv, failed_check=None, usage=None):
    """usage: a substring the argparse refusal must carry, so the RIGHT refusal is proved."""
    code, report = run(argv)
    if usage is not None:
        ok = code == 2 and isinstance(report, str) and usage in report
    elif failed_check is None:
        ok = code == 0
    else:
        ok = code == 1 and failed_check in report['enforcedFailures']
    print(f'  {"ok  " if ok else "FAIL"}  {name}')
    if not ok:
        fails.append(name)


def main():
    print('palette instrument self-test\n')
    expect('control: a distinct, spread, edged set passes', comp(GOOD))
    expect('a repeated label is refused', comp(GOOD, labels=['a', 'b', 'c', 'c']), usage='repeats a label')
    expect('a repeated label cannot hide a pale part', [
        'composition', '--colors', oklch_to_hex(0.96, 0.01, 80), *GOOD[1:], '--surface', SURFACE,
        '--labels', 'x', 'x', 'y', 'z'], usage='repeats a label')
    expect('--edge without --edged is refused', [
        'composition', '--colors', *GOOD, '--surface', SURFACE, '--edge', EDGE],
           usage='--edge needs --edged')
    expect('--edged without --edge is refused', [
        'composition', '--colors', *GOOD, '--surface', SURFACE, '--labels', *LABELS,
        '--edged', 'b'], usage='--edged needs --edge')
    expect('--edged naming no label is refused', comp(GOOD, extra=['--edged', 'q']),
           usage='which is not a label')
    greys = [oklch_to_hex(L, 0.01, 250) for L in (0.30, 0.80, 0.55, 0.42)]
    expect('four greys are refused as one colour', comp(greys), 'at most one achromatic part')
    near = [GOOD[0], oklch_to_hex(0.80, 0.08, 55), GOOD[2], GOOD[3]]
    expect('two chromatic parts 15° apart are refused', comp(near),
           'hue separation, chromatic pairs')
    flat = [GOOD[0], GOOD[1], GOOD[2], oklch_to_hex(0.60, 0.13, 40)]
    expect('two parts at one lightness are refused', comp(flat), 'pairwise lightness step')
    pale = [oklch_to_hex(0.95, 0.04, 300), *GOOD[1:]]
    expect('a pale part with no edge fails mark contrast', comp(pale),
           'mark contrast vs surface')
    expect('a faint edge fails edge contrast', comp(GOOD)[:-1] + [oklch_to_hex(0.9, 0.01, 250)],
           'edge contrast vs surface')
    code, report = run(comp(GOOD))
    ok = code == 0 and 'tritan' in report['enforced']
    print(f'  {"ok  " if ok else "FAIL"}  tritan is enforced by default in composition mode')
    if not ok:
        fails.append('tritan default')
    print()
    if fails:
        print(f'FAIL: {len(fails)} case(s): ' + '; '.join(fails))
        return 1
    print('PASS: every refusal fires, and the control passes.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
