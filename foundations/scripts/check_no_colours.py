#!/usr/bin/env python3
"""The founding property, as a gate: this repository holds no colour values.

    python3 scripts/check_no_colours.py     # exit 0 = clean, 1 = a colour got in

WHY A GATE AND NOT A PROMISE
----------------------------
For v1 the property was self-evident: the repo was four JSON files and two scripts, and you could
read the whole thing in an afternoon. v2 promoted a generator, a maths module and a palette
instrument into it — three times the code, all of it *about* colour, none of it allowed to contain
any. That is exactly the condition under which a value slips in as a "temporary default", a test
fixture, or a helpful example, and nobody notices because everything still works.

It works precisely as well with a colour in it. That is the problem: this repo's failure mode is
silent. The failure it was created after — one system shipping another's greys for a day — did not
break a build either.

FAILS CLOSED, NO SKIP FLAG. It reads files, which are always obtainable, so "cannot run" only ever
means the checkout is wrong.

THE ALLOWLIST
-------------
Every allowance names its reason, AND is as narrow as the reason is.

The first version was not. It exempted whole files: `scripts/oklch.py` was excused for using the
CSS keywords `white` and `black`, which meant it was silently excused for every one of the 140
named colours, and a planted `slateblue` passed. Now an allowance lists the exact keywords, and a
hex allowance pins the exact COUNT the file is entitled to — so a new colour added to the frozen
fixtures trips the gate even though hex is legitimate throughout that file. An allowlist entry
whose scope is wider than its justification is a disabled check wearing a reason.

Detection was also narrower than the threat. `hex_to_rgb` does `lstrip('#')`, so a bare `f8fafc`
is a working colour with no hash in it, and `0xf8fafc` is another. Both were invisible.
"""
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))

# Hex allowances: (exact permitted count, reason). The count is the narrowing — hex is legitimate
# throughout these two files, so "this file may contain hex" would excuse a 16th seed appearing in
# a 15-seed corpus. Change the corpus deliberately and you change the number here deliberately.
HEX_ALLOWED = {
    'contract/vectors.json': (
        182,
        '15 frozen fixtures x (1 seed + 11 ramp steps), and the two quantise vectors\' outputs (D39). '
        'INPUTS to the derivation and its recorded outputs — a corpus chosen for the maths it '
        'exercises, not a palette. Nothing renders them, and the file says so itself.'),
    'scripts/freeze_vectors.py': (
        15,
        'The 15 seeds that produced those fixtures, each with the reason it was chosen (which '
        'gamut branch it exercises). Same corpus, stated at its source.'),
}

# Keyword allowances: the EXACT keywords a file may use, never "this file is excused".
KEYWORD_ALLOWED = {
    'scripts/oklch.py': (
        ('white', 'black'),
        'Implements CSS color-mix(in oklch, A p%, white|black). Those two keywords are the '
        'achromatic poles of the space — (L=1, C=0) and (L=0, C=0) — i.e. coordinates and CSS '
        'syntax, not palette choices. Every other colour the module touches arrives as an '
        'argument, and every other colour NAME is still forbidden here.'),
    'scripts/emit.py': (
        ('navy',),
        'The one deprecated preset key: a hue word naming a RAMP, not a value, kept only so an '
        'existing preset keeps working while the extraction is proved byte-identical. The gate is '
        'right to see it — that is why the allowance is a reminder here rather than a widened '
        'pattern — and it is deleted when the alias is.'),
}

HEX = re.compile(r'#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b')
# A colour does not need a hash to work. hex_to_rgb() lstrips one, so a bare six-digit string is a
# live colour, and 0x-prefixed integers are the same value in another coat. Six digits are flagged
# outright; three only when they carry a hex LETTER, because '100' and '950' are ramp rung names.
BARE_HEX6 = re.compile(r"""(['"])([0-9a-fA-F]{6})\1""")
BARE_HEX3 = re.compile(r"""(['"])([0-9a-fA-F]*[a-fA-F][0-9a-fA-F]*)\1""")
HEX_LITERAL = re.compile(r'\b0x[0-9a-fA-F]{3,8}\b')
# A functional colour notation carrying actual numbers. `oklch(from X ...)` in prose and
# `hex_to_oklch(` in code are not colour values and must not trip this.
FUNCTIONAL = re.compile(r'(?<![\w_])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*[\d.]')
NAMES = ('aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|'
         'blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|'
         'crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|'
         'darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|'
         'darkslateblue|darkslategray|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|'
         'dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|'
         'gray|green|greenyellow|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lawngreen|'
         'lemonchiffon|lime|limegreen|linen|magenta|maroon|midnightblue|mintcream|mistyrose|'
         'moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|papayawhip|'
         'peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|'
         'saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|'
         'slategray|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|'
         'white|whitesmoke|yellow|yellowgreen')
# A named colour used as a VALUE: a bare quoted string that is nothing but a colour name, or a CSS
# declaration ending in one. Prose is not scanned — "the blue-yellow axis" is an explanation, and a
# gate that cannot tell an explanation from a value is a gate people learn to ignore.
QUOTED_NAME = re.compile(rf"""(['"])({NAMES})\1""", re.I)
CSS_DECL = re.compile(rf':\s*({NAMES})\s*(?:;|\}}|$)', re.I)

# EVERY file is read, unless it is exempt by name below with its reason. The guard used to read
# only the extensions it listed, and missed a new file type twice: `.mjs` when the scale
# implementation arrived, then `.cjs`, `.mts`, `.cts`, `.jsx` and `.tsx`, which no file here used yet
# but any could. A file the guard does not read is a file a colour passes through, so an unlisted
# type is now a failure that names the file, never a skip.
SCAN_EXT = ('.py', '.json', '.css', '.md', '.txt', '.html', '.yml', '.yaml', '.sh', '.php',
            '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx')
# Text files with no extension, read like the rest.
SCAN_NAMES = ('LICENSE', '.npmrc')
# By exact file name, each with its reason. Nothing here is shipped: npm never packs these.
EXEMPT = {
    '.DS_Store': 'macOS Finder metadata, created by browsing the folder; npm never packs it.',
}


def tracked_files():
    """(files to read, files neither read nor exempt). Tracked and untracked alike: a colour
    committed later is still a colour, and a gate that only sees the index would pass the branch
    that introduced it."""
    out = subprocess.run(['git', '-C', ROOT, 'ls-files'], capture_output=True, text=True)
    if out.returncode != 0:
        print('FAIL: cannot list tracked files — is this a git checkout?')
        sys.exit(1)
    every = set(out.stdout.split())
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


def main():
    hits = []
    scanned = 0
    hex_counts = {}
    read, unranked = tracked_files()
    for rel in unranked:
        hits.append((rel, 0, 'a file type this guard neither reads nor exempts',
                     os.path.splitext(rel)[1] or os.path.basename(rel),
                     '  add its extension to SCAN_EXT, or its name to EXEMPT with the reason'))
    for rel in read:
        path = os.path.join(ROOT, rel)
        try:
            text = open(path, encoding='utf-8').read()
        except (OSError, UnicodeDecodeError) as e:
            # Unreadable is not clean. Skipping it was the same hole as an unlisted extension.
            hits.append((rel, 0, 'cannot be read as UTF-8 text', type(e).__name__,
                         '  a file the guard cannot read is a file a colour passes through'))
            continue
        scanned += 1
        keywords_ok = set(KEYWORD_ALLOWED.get(rel, ((), ''))[0])
        hex_budget = rel in HEX_ALLOWED
        self_scan = rel == os.path.relpath(os.path.abspath(__file__), ROOT)

        for n, line in enumerate(text.splitlines(), 1):
            for m in HEX.finditer(line):
                hex_counts[rel] = hex_counts.get(rel, 0) + 1
                if not hex_budget and not self_scan:
                    hits.append((rel, n, 'hex literal', m.group(0), line))
            if not self_scan:
                for m in BARE_HEX6.finditer(line):
                    hits.append((rel, n, 'bare hex (no hash — lstrip("#") makes it live)',
                                 m.group(2), line))
                for m in BARE_HEX3.finditer(line):
                    if len(m.group(2)) == 3:
                        hits.append((rel, n, 'bare 3-digit hex', m.group(2), line))
                for m in HEX_LITERAL.finditer(line):
                    hits.append((rel, n, '0x colour literal', m.group(0), line))
                for m in FUNCTIONAL.finditer(line):
                    hits.append((rel, n, 'functional colour', m.group(0), line))
                for rx, what in ((QUOTED_NAME, 'named colour as a value'),
                                 (CSS_DECL, 'named colour as a value')):
                    for m in rx.finditer(line):
                        name = m.group(2) if rx is QUOTED_NAME else m.group(1)
                        if name.lower() in keywords_ok:
                            continue
                        hits.append((rel, n, what, m.group(0), line))

    # The hex budget: an allowed file may contain exactly the hex its reason accounts for. A 16th
    # seed in a 15-seed corpus is a new colour in this repository, whatever file it lands in.
    for rel, (expected, why) in HEX_ALLOWED.items():
        got = hex_counts.get(rel, 0)
        if got != expected:
            hits.append((rel, 0, 'hex budget',
                         f'{got} hex literals, allowance is exactly {expected}',
                         f'  reason for the allowance: {why}'))

    print(f'scanned {scanned} files')
    for rel, (expected, why) in sorted(HEX_ALLOWED.items()):
        print(f'  allowed  {rel}: exactly {expected} hex literals\n      {why}')
    for rel, (kws, why) in sorted(KEYWORD_ALLOWED.items()):
        print(f'  allowed  {rel}: the keyword(s) {", ".join(kws)} — and no other colour name'
              f'\n      {why}')

    if hits:
        print(f'\nFAIL: {len(hits)} colour value(s) in a repository that holds none:')
        for rel, n, kind, tok, line in hits:
            where = f'{rel}:{n}' if n else rel
            print(f'    {where}  {kind}: {tok!r}')
            print(f'        {line.strip()[:120]}')
        print('\n  If a value genuinely belongs here, it does not. Move it to the consuming '
              'implementation\n  and pass it in as an argument — that is the whole design. If it '
              'is documentation, use a\n  placeholder. Adding a file to the allowlist requires a '
              'reason good enough to write down.')
        return 1
    print('\nPASS: no colour values. The contract still holds none.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
