#!/usr/bin/env python3
"""No length or duration enters the contract's prose unnamed.

    python3 scripts/check_prose_lengths.py     # exit 0 = clean, 1 = a length got in

WHY A GATE AND NOT A PROMISE
----------------------------
The contract carries structure and rules, never a brand's values (design-system decision D26).
check_no_colours.py holds that line for colour. Nothing held it for lengths and durations, and they
got in three times: 2.0.0's default scales, then a page-frame width and five motion multipliers in
the scale shape's comments, then one product's display size, in pixels, in a description the
emitter writes into every theme's build. Each was scrubbed by hand after a review found it. D27 made the third a
gate's job, and this is that gate.

WHAT IT READS
-------------
Every file under foundations/, because every one of them ships: npm packs the whole directory
bar `__pycache__`, and a README or CHANGELOG line reaches a consumer's node_modules exactly as a
description string does. It reads a file's whole text, not a parse of it. A length cannot appear in
Python or JavaScript source outside a string or a comment (a number with a unit attached is a
syntax error in both), so
the whole text IS the prose and the strings, with no tokeniser to get wrong. JSON is read the same
way: its prose sits under dozens of keys (`$why`, `what`, `rule`, `reason`, `description`, …), and a
guard that trusted a list of prose keys would pass the next key nobody listed.

Escapes are decoded first, in every file: JSON's and JavaScript's `\\uXXXX` and `\\u{…}`, and
Python's `\\xXX`, and then HTML's named, decimal and hexadecimal character references
(`&nbsp;` and its numeric forms), which Markdown renders; so a number, an escaped no-break space and a unit are the number,
no-break space and unit a reader sees. A backslash
escaped in its turn is decoded too, which can only make the guard see a length that is not there.
Unicode format characters (soft hyphen, zero-width space, word joiner) are then dropped: they
render as nothing, so a figure split by one is read as the figure.

A file type it does not read, or a file it cannot read as UTF-8, fails by name, as in
check_no_colours.py.

WHAT IT MATCHES
---------------
A number followed by a CSS length or time unit: D27's `rem`, `px`, `em`, `ch`, `vw`, `ms` and `s`,
and the rest of CSS Values 4's absolute, font-relative, viewport and container units. Case does not
matter, and a number may be signed, have an exponent or omit a digit either side of its
point. Between number and a unit that is not also an English word it allows whitespace, hyphens
(a figure written as a compound adjective) and the word `CSS`, and it reads the spelled-out words
`pixel(s)`, `second(s)` and `millisecond(s)` as their units. `point(s)` spelled out is not read:
this is a colour package, and lightness and colour-difference points are ordinary prose here; `pt`
is. Units that are also English words (`in`, `s`,
`ex`, `cap`, `lh`, …) match only when attached, so "one in five" written in digits is prose and
the same digits with `in` attached are a length. Everything is compared in one canonical spelling:
the number's exact decimal value and the unit in lower case, so a figure written with a space, a
trailing zero or the word `CSS` is the same figure written plainly.

A number the guard cannot put in that spelling is a third verdict, UNRANKABLE, and fails: digits
that are not ASCII (full-width, Arabic-Indic), vulgar fractions and superscripts, directly before a
unit. CSS reads none of them as a number, so the guard cannot say what figure the prose claims, and
a guard that skipped them would pass a full-width copy of a figure it forbids.

What it cannot see: a number whose unit is a word away (in "between A and Bpx" only B is counted),
and a unit glued to a word before it (a letter, digit or point right before the number). A unit
at the end of a hyphenated identifier IS seen: a custom property named for its value, such as a
radius suffixed with its pixel size, counts as that figure.

ITS OWN FILE
------------
This file is scanned too, all of it except the allowance tables between the two marker comments
below, which name every allowed figure by construction. The markers must each appear exactly once,
in order, and the region between them may only assign the tables; anything else fails, so the
mask cannot be widened or lost quietly. The region is still read under its own rule: every figure
in it, in a reason string or a comment, must be a key of RULE_FIGURES or EXAMPLES, with no count.

THE ALLOWLIST
-------------
Every length the prose may state is listed per file with its EXACT count, as narrow as
check_no_colours.py's hex budget: a count too high or too low fails, so a new length fails even in a
file where lengths are legitimate. There are three kinds of allowance.

  RULE_FIGURES — the contract's own figures, each named once with the rule it belongs to. A file
    that states one lists it with no reason of its own: the figure's name is the reason.
  EXAMPLES — a length quoted as an example of a SPELLING or an arithmetic case (a malformed value
    the implementation refuses, a worked unit conversion), listed per file with its reason. None
    of these is a size anything renders at.
  FIXTURE_BUDGETS — a file that is a corpus of synthetic values (the type vectors, and the gates'
    probe scales) is held to an exact total, like the colour vectors' hex budget, and to a sha256
    of its sorted canonical figures, so swapping one value for another at the same count fails
    and prints the pair to re-bless. Each value is
    chosen for the maths it exercises; a private gate in the design-system repository ranks the
    type vectors against every theme, and the probe scales are synthetic by construction.

A length that is none of these is a brand-like value in public prose, and fails with the file, the
line and the figure. Move the value to the implementation that owns it, or describe it without a
number; if it is genuinely a rule of the contract, name it in RULE_FIGURES with the rule.
"""
import ast
import hashlib
import html
import os
import re
import subprocess
import sys
import unicodedata
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
SELF = os.path.relpath(os.path.abspath(__file__), ROOT)

# ── allowance tables: begin ── (masked from this file's own scan; see ITS OWN FILE above)
# The contract's own figures, each named with the rule it belongs to.
RULE_FIGURES = {
    '0.5px': 'the type-distinctness threshold: a published step within 0.5px of a theme step at '
             'both viewports fails (D33 (b), contract/type-scale.json $noValues)',
    '1px': 'the type scale\'s T5 and T6 floors (a gap or a move of exactly 1px passes), the '
           'focus ring\'s offset floor, and the scale shape\'s `--space-px` constant',
    '2px': 'the focus ring\'s thickness floor, WCAG 2.4.13\'s 2 CSS px perimeter (D35)',
    '16px': 'the initial root font size a rem is read at (scale-shape.json `pxAt`, the layout '
            'roles, the focus rules), and layout rule L4\'s gutter floor, set equal to it (D37)',
    '24px': 'the target-size floor, WCAG 2.5.8\'s 24 x 24 CSS px (D36)',
    '0.1em': 'the caps tracking default, Tailwind v4\'s `tracking-widest` '
             '(contract/type-scale.json $where)',
}

# A length quoted as an example of a spelling or a computation, never as a size.
_SPELLINGS = ('the length spellings the scale shape accepts and refuses (`0.25rem`, never '
              '`1.rem`, `.5rem` or `0.25 rem`)')
EXAMPLES = {
    '0.25rem': _SPELLINGS,
    '0.5rem': _SPELLINGS + '; `.5rem` is read as 0.5rem',
    '1rem': 'a refused spelling (`1.rem`), or the `max(1rem, 16px)` rung layout rule L4 refuses '
            'as unrankable',
    '0.01px': 'the focus offset\'s edge case: a gap narrower than a pixel that would otherwise '
              'pass as clear',
    '0.125rem': 'why a focus length in rem is refused: read at a 16px root it passes as 2px, and '
                'at a 10px root it draws 1.25px',
    '1.25px': 'the same worked conversion (0.125rem at a 10px root)',
    '10px': 'the same worked conversion (a smaller root)',
    '0.0000625rem': 'a synthetic `spaceBase` small enough that the old six-digit format wrote '
                    'exponent notation',
    '0.00003125rem': 'what that base derives for `--space-0-5`, exactly',
    '640px': 'a breakpoint given in px, which 2.1.1 multiplied by 16 instead of refusing',
    '10240px': 'what 2.1.1 wrote for it',
    '8px': 'a map family given a string (`radius: "8px"`), which 2.1.1 reported as rungs',
    '1vw': 'a slotted family given a map (`typeScaleFluid: {"0": "1vw"}`), which 2.1.1 wrote through',
    '1.2rem': 'the output shape of a fluid step, quoted from a vector in contract/type-vectors.json',
    '1.1156rem': 'the same quoted vector',
    '0.3749vw': 'the same quoted vector',
    '1.4062rem': 'the same quoted vector',
}

# Per file, the exact count of each length it may state. A figure in RULE_FIGURES carries its own
# reason; any other must be in EXAMPLES.
ALLOWED = {
    'CHANGELOG.md': {'0.00003125rem': 2, '0.0000625rem': 1, '0.1em': 1, '0.25rem': 2,
                     '0.5px': 1, '0.5rem': 1, '10240px': 1, '16px': 4, '1px': 2, '1rem': 1,
                     '1vw': 1, '24px': 2, '2px': 3, '640px': 1, '8px': 1},
    'contract/scale-shape.json': {'0.25rem': 2, '0.5rem': 1, '1px': 1, '1rem': 1},
    'contract/type-scale.json': {'0.1em': 1, '0.5px': 1, '1px': 1},
    'contract/vocabulary.json': {'0.01px': 1, '0.125rem': 1, '1.25px': 1, '10px': 1, '16px': 8,
                                 '1px': 1, '1rem': 1, '2px': 5},
    'scripts/check_type_scale.py': {'1px': 3},
    'scripts/contrast_rules.py': {'2px': 3},
    'scripts/layout_roles.mjs': {'16px': 1},
    'scripts/scale_tokens.mjs': {'0.25rem': 3},
    'scripts/type_tokens.mjs': {'0.3749vw': 1, '1.1156rem': 1, '1.2rem': 1, '1.4062rem': 1},
    'scripts/validate_palette.py': {'2px': 1},
}

# Files that are corpora of synthetic values: an exact total, like the colour vectors' hex budget,
# and a sha256 of the sorted canonical figures, so a value swapped for another at the same count
# fails too. A deliberate change re-blesses both; the failure prints the new pair.
FIXTURE_BUDGETS = {
    'contract/type-vectors.json': (
        434,
        '1189824fc8497e1e919ac2a7784513ce1e4765b026c884139bd265e30e897b86',
        'The type vectors: fixtures and the published named scales, each chosen for the maths it '
        'exercises, and the notes that describe them. scripts/check_type_distinct.py, in the '
        'design-system repository, fails any step within 0.5px of any theme step at both '
        'viewports.'),
    'scripts/check_scale_shape.py': (
        86,
        '646beee3e6d9be105c8cbbc568073eb0fd605ba932e732478ad09bd2cad031ad',
        'The scale-shape gate\'s probe scales and refusal cases: every family, rung and list '
        'position given its own synthetic value, so a value on the wrong rung is caught.'),
    'scripts/selftest_emit.py': (
        51,
        '4b3fd5a9809d6f68c85ee6134e88a293defad6e28cabf8ba704ae3e362c0baa3',
        'The emitter\'s self-test: synthetic scale values and malformed spellings, two of them in '
        'digits CSS does not read, none a theme\'s (D27 replaced the four that were).'),
    'scripts/check_layout_roles.py': (
        23,
        '9856c07973b26d3f22a9695ba4aef8294dde00348f082363bf45cbda06cdf039',
        'The layout-roles gate\'s synthetic probe scale (its space base is no product\'s) and its '
        'boundary and refusal cases.'),
}
# ── allowance tables: end ──

_SPACED = ('rem|em|ch|px|pt|vw|vh|vmin|vmax|ms|pixels?|milliseconds?|seconds?')
_TIGHT = ('ex|cap|ic|lh|rlh|pc|cm|mm|q|in|vi|vb|svw|svh|svi|svb|svmin|svmax|lvw|lvh|lvi|lvb|'
          'lvmin|lvmax|dvw|dvh|dvi|dvb|dvmin|dvmax|cqw|cqh|cqi|cqb|cqmin|cqmax|s')
_UNIT_NAMES = {'pixel': 'px', 'pixels': 'px', 'second': 's', 'seconds': 's',
               'millisecond': 'ms', 'milliseconds': 'ms'}
_NUM = r'[-+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?'
# Between a number and a spaced unit: whitespace, hyphens (a compound adjective) and the word CSS.
_GAP = r'(?:[\s-]|CSS[\s-])*'
LENGTH = re.compile(
    rf'(?<![\w.])({_NUM})(?:{_GAP}({_SPACED})|({_TIGHT}))(?!\w)', re.I)
# Anything number-like before a unit that is not ASCII: a figure the guard cannot canonicalise.
ODD_NUMBER = re.compile(
    rf'([^\sA-Za-z-]*[^\x00-\x7f\sA-Za-z-][^\sA-Za-z-]*){_GAP}({_SPACED}|{_TIGHT})(?!\w)', re.I)

SCAN_EXT = ('.py', '.json', '.md', '.mjs', '.cjs', '.js', '.mts', '.cts', '.ts', '.jsx', '.tsx',
            '.css', '.txt', '.html', '.yml', '.yaml', '.sh')
SCAN_NAMES = ('LICENSE', '.npmrc')
EXEMPT = {
    '.DS_Store': 'macOS Finder metadata, created by browsing the folder; npm never packs it.',
}


_ESCAPE = re.compile(r'\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})')


def unescape(text):
    text = _ESCAPE.sub(lambda m: chr(int(m.group(1) or m.group(2) or m.group(3), 16)), text)
    # Format characters (soft hyphen, zero-width space, word joiner, ...) render as nothing, so
    # a figure split by one reads as the figure; they are dropped before matching.
    return ''.join(c for c in html.unescape(text) if unicodedata.category(c) != 'Cf')


def canonical(number, unit):
    unit = unit.lower()
    unit = _UNIT_NAMES.get(unit, unit)
    value = Decimal(number).normalize()
    text = format(value, 'f')
    return f'{text}{unit}'


def files():
    out = subprocess.run(['git', '-C', ROOT, 'ls-files'], capture_output=True, text=True)
    if out.returncode != 0:
        print('FAIL: cannot list tracked files — is this a git checkout?')
        sys.exit(1)
    every = set(out.stdout.split('\n')) - {''}
    for root, dirs, names in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules', '__pycache__')]
        for n in names:
            every.add(os.path.relpath(os.path.join(root, n), ROOT))
    read, unranked = [], []
    for rel in sorted(every):
        name = os.path.basename(rel)
        if name in EXEMPT:
            continue
        if name.endswith(SCAN_EXT) or name in SCAN_NAMES:
            read.append(rel)
        else:
            unranked.append(rel)
    return read, unranked


def scan(text):
    """[(line number, canonical figure, as written, context)] and [(line number, as written)] for the
    figures no canonical spelling exists for."""
    found, odd = [], []
    for n, line in enumerate(unescape(text).splitlines(), 1):
        for m in LENGTH.finditer(line):
            found.append((n, canonical(m.group(1), m.group(2) or m.group(3)), m.group(0),
                          line[max(0, m.start() - 60):m.end() + 40].strip()))
        for m in ODD_NUMBER.finditer(line):
            if any(unicodedata.category(c) in ('Nd', 'No') for c in m.group(1)
                   if ord(c) > 0x7f):
                odd.append((n, m.group(0).strip().lstrip('([{\'"`,;:=')))
    return found, odd


_BEGIN = '# ── allowance tables: begin ──'
_END = '# ── allowance tables: end ──'
_TABLES = ('RULE_FIGURES', '_SPELLINGS', 'EXAMPLES', 'ALLOWED', 'FIXTURE_BUDGETS')


def mask_tables(text):
    """(this file's text with the allowance tables blanked, line numbers kept; the tables' first
    and last line numbers; None), or (text, None, the reason it cannot be masked). Each marker is matched as a whole line's start, so a marker quoted in prose
    or in the constants above is not one."""
    lines = text.split('\n')
    begins = [i for i, l in enumerate(lines) if l.startswith(_BEGIN)]
    ends = [i for i, l in enumerate(lines) if l.startswith(_END)]
    if len(begins) != 1 or len(ends) != 1 or begins[0] >= ends[0]:
        return text, None, (f'the allowance-table markers must each appear once, begin before end '
                      f'(found {len(begins)} begin, {len(ends)} end)')
    # The region may hold only the tables: moving a marker to take in code or prose would
    # otherwise widen the mask without a word.
    region = '\n'.join(lines[begins[0]:ends[0] + 1])
    try:
        body = ast.parse(region).body
    except SyntaxError as e:
        return text, None, f'the masked region does not parse as Python ({e.msg})'
    names = [s.targets[0].id if isinstance(s, ast.Assign) and len(s.targets) == 1
             and isinstance(s.targets[0], ast.Name) else None for s in body]
    if sorted(n for n in names if n) != sorted(_TABLES) or None in names:
        return text, None, (f'the masked region must assign exactly {", ".join(_TABLES)} and nothing '
                      f'else (it assigns {names})')
    for i in range(begins[0], ends[0] + 1):
        lines[i] = ''
    return '\n'.join(lines), (begins[0] + 1, ends[0] + 1), None


def corpus_digest(found, odd):
    """sha256 of a corpus's sorted canonical figures (unrankable ones as written), one per line."""
    figures = sorted([f[1] for f in found] + [w for _, w in odd])
    return hashlib.sha256('\n'.join(figures).encode('utf-8')).hexdigest()


def check_config():
    """The allowlist's own consistency: every allowance names a figure or an example."""
    bad = []
    for rel, figures in ALLOWED.items():
        if rel in FIXTURE_BUDGETS:
            bad.append(f'{rel} has both a fixture budget and per-figure allowances')
        for fig, count in figures.items():
            if fig not in RULE_FIGURES and fig not in EXAMPLES:
                bad.append(f'{rel}: {fig} is allowed but is neither a RULE_FIGURE nor an EXAMPLE')
            if not isinstance(count, int) or count < 1:
                bad.append(f'{rel}: {fig} has a count of {count!r}; an allowance is at least 1')
    for fig in set(RULE_FIGURES) | set(EXAMPLES):
        if fig != canonical(re.match(_NUM, fig).group(0), fig[len(re.match(_NUM, fig).group(0)):]):
            bad.append(f'{fig} is not in canonical spelling, so no scanned figure can match it')
    used = {f for figs in ALLOWED.values() for f in figs}
    for fig in sorted((set(RULE_FIGURES) | set(EXAMPLES)) - used):
        bad.append(f'{fig} is named but no file is allowed it; remove the stale name')
    return bad


def main():
    hits = check_config()
    read, unranked = files()
    for rel in unranked:
        hits.append(f'{rel}: a file type this guard neither reads nor exempts '
                    '(add its extension to SCAN_EXT, or its name to EXEMPT with the reason)')
    scanned = 0
    for rel in read:
        try:
            text = open(os.path.join(ROOT, rel), encoding='utf-8').read()
        except (OSError, UnicodeDecodeError) as e:
            hits.append(f'{rel}: cannot be read as UTF-8 text ({type(e).__name__}); a file the '
                        'guard cannot read is a file a length passes through')
            continue
        if rel == SELF:
            masked, span, why = mask_tables(text)
            if why:
                hits.append(f'{rel}: {why}')
                continue
            # The tables are masked from the counted scan, not from the guard: every figure in
            # them, in a reason string or a comment, must itself be a named figure or example.
            found, odd = scan(text)
            for n, fig, written, _ in found:
                if span[0] <= n <= span[1] and fig not in RULE_FIGURES and fig not in EXAMPLES:
                    hits.append(f'{rel}:{n}: {written!r} ({fig}) is in the allowance tables but '
                                'is neither a RULE_FIGURE nor an EXAMPLE')
            for n, written in odd:
                if span[0] <= n <= span[1]:
                    hits.append(f'{rel}:{n}: UNRANKABLE {written!r} in the allowance tables')
            text = masked
        scanned += 1
        found, odd = scan(text)
        if rel in FIXTURE_BUDGETS:
            # A corpus may hold unrankable spellings on purpose, as refusal cases; they count in
            # its total like any other value.
            expected, digest, why = FIXTURE_BUDGETS[rel]
            got, got_digest = len(found) + len(odd), corpus_digest(found, odd)
            if (got, got_digest) != (expected, digest):
                what = (f'{got} lengths, the fixture budget is exactly {expected}' if got != expected
                        else 'the same count, but a value changed: the corpus digest differs')
                hits.append(f'{rel}: {what}\n      reason for the budget: {why}\n      if the '
                            f'change is deliberate and no value is a theme\'s, re-bless it in '
                            f'FIXTURE_BUDGETS as: {got}, \'{got_digest}\'')
            continue
        for n, written in odd:
            hits.append(f'{rel}:{n}: UNRANKABLE {written!r}: a number CSS does not read, so the '
                        'guard cannot say what figure it claims; write it in ASCII digits')
        allowed = ALLOWED.get(rel, {})
        counts = {}
        for n, fig, written, _ in found:
            counts[fig] = counts.get(fig, 0) + 1
            if fig not in allowed:
                what = ('a rule figure, but not allowed in this file' if fig in RULE_FIGURES
                        else 'not a figure the contract names')
                hits.append(f'{rel}:{n}: {written!r} ({fig}) is {what}')
        for fig, expected in allowed.items():
            got = counts.get(fig, 0)
            if got != expected:
                # Every mention, so a reviewer can see which is new: a count that moves by one is
                # also how a figure's rule mention gets swapped for a product's value.
                where = ''.join(f'\n        {rel}:{n}: {written!r}  …{context}…'
                                for n, f, written, context in found if f == fig)
                hits.append(f'{rel}: {fig} appears {got} time(s), the allowance is exactly '
                            f'{expected}{where}')
    for rel in sorted(set(ALLOWED) | set(FIXTURE_BUDGETS)):
        if rel not in read:
            hits.append(f'{rel}: has an allowance but no such file was read; remove it')

    print(f'scanned {scanned} files')
    for fig, why in RULE_FIGURES.items():
        print(f'  rule figure  {fig}: {why}')
    for rel, (expected, _, why) in sorted(FIXTURE_BUDGETS.items()):
        print(f'  budget       {rel}: exactly {expected} lengths')
    if hits:
        print(f'\nFAIL: {len(hits)} length(s) or duration(s) in the contract\'s prose that it does '
              'not name:')
        for h in hits:
            print(f'    {h}')
        print('\n  The contract carries structure and rules, never a brand\'s values (D26). Move '
              'the value to the\n  implementation that owns it, or say it without a number. A '
              'rule of the contract goes in\n  RULE_FIGURES with the rule it belongs to.')
        return 1
    print('\nPASS: every length and duration in the contract\'s prose is a figure it names.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
