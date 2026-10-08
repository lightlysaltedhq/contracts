#!/usr/bin/env python3
"""The scale shape is readable, and its one implementation derives and refuses what it says.

    python3 scripts/check_scale_shape.py     # exit 0 = sound · 1 = not, or the file is unreadable

ONE IMPLEMENTATION
------------------
scripts/scale_tokens.mjs (the `./scale-tokens` export) derives every scale token from
contract/scale-shape.json and a scale's values, and emit.py builds its scale tokens by calling it.
There used to be two derivations, the emitter's and the reference's, kept equal by this gate. In
four review rounds running they disagreed somewhere the gate's probes did not look, so now there is
one, and `build/` reproducing byte for byte across every theme is the proof that the switch changed
nothing. What is left to check is the file itself and the implementation against the file.

WHAT IT RUNS
------------
  1. Data checks on the file. It must be a shape this gate can read (closed world: SPEC_KEYS), with
     one owner per custom property except where two families declare exclusiveWith each other, and
     every requires, modifies, sets, exclusiveWith, derive and template consistent.
  2. Consistency: on probes that give every family, rung and list position a value of its own, the
     implementation derives exactly the properties the file claims, each once, with the family's
     declared type and group, in the file's order (families as listed, rungs as `steps` declare
     them, whatever order a scale's own object uses; this holds for every case that derives). Withholding a family removes exactly its properties and changes nothing
     else except what it modifies, or is refused where a supplied family requires it.
  3. Refusals: an undeclared family or rung, a rung given to both of an exclusive pair, a slotted
     value that is a string or a list of the wrong length, a map family given a string, a derived
     family given an object or a repeated rung, a derivation source that is not a length, and a
     `pxAt` value not in rem.
  4. Expectations: a rounding tie, a value far below 1e-4, zero and signed zero, a product longer
     than any float, pixel widths (one that no float computes right), a reordered `space` list, a dark
     value on its own rung only, and a filled template with its
     record. Written for the derive parameters the file has now; if the file changes them, the gate
     says so rather than recomputing its own answer, which would be a second implementation.

A PASS also needs its own guards to fire: SELF_TEST, at the bottom, breaks the file or the
implementation one way at a time and each break must be caught by name. Needs `node`. Fails closed,
no skip flag.
"""
import collections
import copy
import decimal
import itertools
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
SHAPE_PATH = os.path.join(ROOT, 'contract', 'scale-shape.json')
REFERENCE = os.path.join(HERE, 'scale_tokens.mjs')
CLI = os.path.join(HERE, 'scale_tokens_cli.mjs')
TYPES = os.path.join(HERE, 'scale_tokens.d.mts')

FAMILY_NAME = re.compile(r'[a-z][A-Za-z]*\Z')                # non-numeric, so JS keeps key order
SLOT_NAME = FAMILY_NAME
STEP_NAME = re.compile(r'-?[a-z0-9]+(?:-[a-z0-9]+)*\Z')     # '-5', '2xl', 'in-out', '0-5'
CSS_NAME = re.compile(r'--[a-z0-9]+(?:-[a-z0-9]+)*\Z')
GROUP_NAME = re.compile(r'[a-z]+\Z')
COLOUR_TOKEN = re.compile(r'color\.([a-z][a-z-]*)\.([a-z0-9]+)\Z')
PLACEHOLDER = re.compile(r'\{([^{}]*)\}')
DERIVE_KEYS = {'from', 'op', 'decimalSeparator', 'significantDigits', 'of', 'rounding', 'notation',
               'units'}
UNIT_NAME = re.compile(r'[a-z%]+\Z')
DERIVE_OF = ('exactDecimal',)
DERIVE_OPS, DERIVE_ROUNDING, DERIVE_NOTATION = ('multiply',), ('halfEven',), ('plain',)
SETS = ('dark', 'record')


def unique_value(typ, n):
    """A value of this type that no other family, rung or list position in the probe shares."""
    return {'dimension': f'{n}.5rem', 'number': n + 0.25, 'duration': f'{n}ms', 'fontWeight': 100 + n,
            'cubicBezier': f'cubic-bezier(0, 0, {n}, 1)', 'shadow': f'0 0 {n}px 0'}.get(typ, f'{n}px')


PROBE_TYPES = ('dimension', 'number', 'duration', 'fontWeight', 'cubicBezier', 'shadow')


# ── 1. data checks on the file ───────────────────────────────────────────────────────────────────
def _names(v, fams, what):
    if not isinstance(v, list) or not v:
        return [f'{what} must be a non-empty list of family names']
    return [f'{what} names {t!r}, which is not a declared family' for t in v if t not in fams]


def _type(v, fams):
    return [] if v in PROBE_TYPES else [
        f'type {v!r}: cannot rank it. The probe has unique values for {", ".join(PROBE_TYPES)}; a '
        'new type is a new line in unique_value(), not a guess.']


def _css(v, fams):
    if not isinstance(v, str) or v.count('{k}') > 1 or not CSS_NAME.match(v.replace('{k}', 'k')):
        return [f'css {v!r} is not a custom property name with at most one `{{k}}`']
    return []


def _group(v, fams):
    return [] if isinstance(v, str) and GROUP_NAME.match(v) else [f'group {v!r} is not a word']


def _steps(v, fams):
    if not isinstance(v, list) or not v:
        return ['steps must be a non-empty list']
    bad = [s for s in v if not isinstance(s, str)]
    if bad:
        return [f'non-string step {", ".join(repr(s) for s in bad)}. A rung name is a string even '
                'when it looks like a number: 1 and "1" are different keys to every consumer that '
                'is not Python.']
    p = [f'step {s!r} is not a lowercase rung name' for s in v if not STEP_NAME.match(s)]
    dup = sorted({s for s in v if v.count(s) > 1})
    return p + ([f'duplicate step(s) {dup}'] if dup else [])


def _flag(v, fams):
    return [] if isinstance(v, bool) else [f'{v!r} is not true or false']


def _steps_from(v, fams):
    target = fams.get(v) if isinstance(v, str) else None
    if not isinstance(target, dict) or 'steps' not in target:
        return [f'stepsFrom {v!r} names no declared family with steps of its own']
    return []


def _tokens(v, fams):
    if not isinstance(v, list) or not v:
        return ['requiresTokens must be a non-empty list']
    return [f'requiresTokens entry {t!r}: cannot rank it. The probe can supply color.<role>.<rung> '
            'through preset.extended and nothing else.' for t in v
            if not isinstance(t, str) or not COLOUR_TOKEN.match(t)]


def _constants(v, fams):
    if not isinstance(v, dict) or not v:
        return ['alsoEmits must be an object mapping each custom property to the constant value the '
                'emitter writes for it']
    p = [f'alsoEmits {c!r} is not a custom property name' for c in v if not CSS_NAME.match(c)]
    return p + [f'alsoEmits {c!r}: its value must be a non-empty string' for c, val in v.items()
                if not (isinstance(val, str) and val)]


def _derive(v, fams):
    if not isinstance(v, dict) or set(v) != DERIVE_KEYS:
        return [f'derive must carry exactly {sorted(DERIVE_KEYS)}; cannot rank anything else']
    p = []
    src = fams.get(v['from']) if isinstance(v['from'], str) else None
    if not (isinstance(src, dict) and src.get('scalar') and not src.get('noEmit')):
        p.append(f'derive.from {v["from"]!r} names no declared, emitting, scalar family')
    for key, known in (('op', DERIVE_OPS), ('of', DERIVE_OF), ('rounding', DERIVE_ROUNDING),
                       ('notation', DERIVE_NOTATION)):
        if v[key] not in known:
            p.append(f'derive.{key} {v[key]!r}: cannot rank it. Known: {", ".join(known)}.')
    sep = v['decimalSeparator']
    if not (isinstance(sep, str) and len(sep) == 1 and not sep.isalnum()):
        p.append(f'derive.decimalSeparator {sep!r} must be one punctuation character')
    units = v['units']
    if not (isinstance(units, list) and units and all(isinstance(u, str) and UNIT_NAME.match(u)
                                                      for u in units)):
        p.append(f'derive.units {units!r} must be a non-empty list of unit names')
    sig = v['significantDigits']
    if not (isinstance(sig, int) and not isinstance(sig, bool) and 1 <= sig <= 17):
        p.append(f'derive.significantDigits {sig!r} must be a whole number from 1 to 17')
    return p


def _slots(v, fams):
    if not isinstance(v, list) or not v or len(set(map(str, v))) != len(v):
        return ['slots must be a non-empty list of distinct names']
    return [f'slot {s!r} is not a camelCase name' for s in v
            if not isinstance(s, str) or not SLOT_NAME.match(s)]


def _string(what):
    return lambda v, fams: [] if isinstance(v, str) and v else [f'{what} must be a non-empty string']


def _record_as(v, fams):
    return [] if isinstance(v, str) and SLOT_NAME.match(v) else [f'recordAs {v!r} is not a name']


def _sets(v, fams):
    return [] if v in SETS else [f'sets {v!r}: cannot rank it. Known: {", ".join(SETS)}.']


def _px_at(v, fams):
    return [] if isinstance(v, int) and not isinstance(v, bool) and v > 0 else [
        f'pxAt {v!r} must be a positive whole number']


# Every key a family may carry. A key outside this table is a shape the gate cannot rank, so it
# fails rather than being ignored; the file's own `$keys` must document exactly these.
SPEC_KEYS = {
    'type': _type, 'css': _css, 'group': _group, 'steps': _steps, 'scalar': _flag,
    'stepsFrom': _steps_from, 'noEmit': _flag,
    'modifies': lambda v, f: _names(v, f, 'modifies'), 'sets': _sets,
    'requires': lambda v, f: _names(v, f, 'requires'),
    'exclusiveWith': lambda v, f: _names(v, f, 'exclusiveWith'),
    'derive': _derive, 'optional': _flag, 'themeExtensible': _flag, 'requiresTokens': _tokens,
    'alsoEmits': _constants, 'slots': _slots, 'valueTemplate': _string('valueTemplate'),
    'recordAs': _record_as, 'pxAt': _px_at, 'what': _string('what'),
    'pxFrom': lambda v, f: [] if isinstance(v, str) and UNIT_NAME.match(v) else [f'pxFrom {v!r} is not a unit name'],
}


def rung_number(rung, sep):
    try:
        return decimal.Decimal(rung.replace(sep, '.'))
    except decimal.InvalidOperation:
        return None


def claims(families):
    """{custom property: [(family, how)]} for everything the file says any family emits."""
    out = collections.defaultdict(list)
    for fam, spec in families.items():
        if spec.get('noEmit') or not isinstance(spec.get('css'), str):
            continue
        if 'steps' in spec:
            for step in spec['steps']:
                out[spec['css'].replace('{k}', step)].append((fam, f'rung {step!r}'))
        elif spec.get('scalar'):
            out[spec['css']].append((fam, 'its property'))
        for css in spec.get('alsoEmits') or {}:
            out[css].append((fam, 'alsoEmits'))
    return out


def shape_problems(doc):
    if not isinstance(doc, dict):
        return ['cannot rank: the file is not a JSON object']
    p = []
    for k, v in doc.items():
        if k.startswith('$'):
            if not (isinstance(v, str) or (isinstance(v, dict)
                                           and all(isinstance(x, str) for x in v.values()))):
                p.append(f'{k} is prose: a string, or an object of strings')
        elif k == 'version':
            if not isinstance(v, str):
                p.append('version must be a string')
        elif k != 'families':
            p.append(f'top-level key {k!r}: cannot rank it. The file carries `version`, '
                     '`families` and `$` prose, and nothing else.')
    fams = doc.get('families')
    if not isinstance(fams, dict) or not fams:
        return p + ['`families` must be a non-empty object']
    documented = set(doc['$keys']) if isinstance(doc.get('$keys'), dict) else set()
    if documented != set(SPEC_KEYS):
        p.append(f'$keys is out of step with the keys this gate ranks: undocumented '
                 f'{sorted(set(SPEC_KEYS) - documented)}, documented but unranked '
                 f'{sorted(documented - set(SPEC_KEYS))}. A key a reader cannot look up is a key '
                 'nobody reads right.')
    for fam, spec in fams.items():
        where = f'family {fam!r}'
        if not FAMILY_NAME.match(fam):
            p.append(f'{where}: not a camelCase identifier')
        if not isinstance(spec, dict):
            p.append(f'{where}: not an object')
            continue
        for k, v in spec.items():
            if k.startswith('$'):
                if not isinstance(v, str):
                    p.append(f'{where}: {k} is prose and must be a string')
            elif k not in SPEC_KEYS:
                p.append(f'{where}: key {k!r} — cannot rank it. Add it to SPEC_KEYS and $keys with '
                         'what it means, or drop it.')
            else:
                p.extend(f'{where}: {m}' for m in SPEC_KEYS[k](v, fams))
    if p:
        return p                     # the rules below assume every key above was readable
    for fam, spec in fams.items():
        where = f'family {fam!r}'
        stepped = 'steps' in spec or 'stepsFrom' in spec
        if bool(spec.get('scalar')) == stepped:
            p.append(f'{where}: must be exactly one of scalar or stepped (steps / stepsFrom)')
        if 'steps' in spec and 'stepsFrom' in spec:
            p.append(f'{where}: declares steps AND stepsFrom')
        for rel in ('requires', 'modifies', 'exclusiveWith'):
            if fam in spec.get(rel, ()):
                p.append(f'{where}: names itself in {rel}')
        if spec.get('noEmit'):
            extra = [k for k in ('type', 'css', 'group', 'alsoEmits', 'requiresTokens', 'derive',
                                 'exclusiveWith', 'valueTemplate', 'recordAs', 'pxAt') if k in spec]
            if extra:
                p.append(f'{where}: noEmit, yet declares {extra}, which only an emitting family has')
            if not spec.get('modifies') or 'sets' not in spec:
                p.append(f'{where}: noEmit, so it must say which families it modifies and what it '
                         'sets there')
            for target in spec.get('modifies', ()):
                if fams[target].get('noEmit'):
                    p.append(f'{where}: modifies {target!r}, which emits nothing to modify')
                if target not in spec.get('requires', ()):
                    p.append(f'{where}: modifies {target!r} but does not require it. Its only '
                             f'effect is on the tokens of {target!r}, so supplied without it, it '
                             'would be supplied and do nothing.')
                if spec.get('sets') == 'dark' and spec.get('stepsFrom') != target:
                    p.append(f'{where}: sets "dark" on {target!r}, so its rungs must be '
                             f'{target!r}\'s (stepsFrom)')
                if spec.get('sets') == 'record' and 'recordAs' not in fams[target]:
                    p.append(f'{where}: sets "record" on {target!r}, which records nothing '
                             '(no recordAs)')
            if spec.get('sets') == 'record' and 'slots' not in spec:
                p.append(f'{where}: sets "record", so it must name its slots')
        else:
            for k in ('modifies', 'sets'):
                if k in spec:
                    p.append(f'{where}: {k} is for noEmit families; an emitting family owns its '
                             'own properties')
            missing = [k for k in ('type', 'css', 'group') if k not in spec]
            if missing:
                p.append(f'{where}: emits, so it needs {missing}')
            elif ('{k}' in spec['css']) != stepped:
                p.append(f'{where}: css {spec["css"]!r} must carry `{{k}}` exactly when the family '
                         'has rungs')
            if 'slots' in spec and 'valueTemplate' not in spec:
                p.append(f'{where}: takes slots, so it must say how they are written (valueTemplate)')
        for k in ('valueTemplate', 'recordAs'):
            if k in spec and 'slots' not in spec:
                p.append(f'{where}: {k} needs slots to work on')
        if 'valueTemplate' in spec:
            unknown = [s for s in PLACEHOLDER.findall(spec['valueTemplate'])
                       if s not in spec.get('slots', ())]
            if unknown:
                p.append(f'{where}: valueTemplate names {unknown}, which are not its slots')
        if ('pxAt' in spec) != ('pxFrom' in spec):
            p.append(f'{where}: pxAt and pxFrom come together: the width, and the unit it is computed from')
        if 'pxAt' in spec and not (stepped and spec.get('type') == 'dimension'):
            p.append(f'{where}: pxAt is for a stepped dimension family')
        for other in spec.get('exclusiveWith', ()):
            if fam not in fams[other].get('exclusiveWith', ()):
                p.append(f'{where}: exclusiveWith {other!r}, but {other!r} does not say the same')
        d = spec.get('derive')
        if d:
            if 'steps' not in spec:
                p.append(f'{where}: derive needs steps of its own')
            if d['from'] not in spec.get('requires', ()):
                p.append(f'{where}: derives from {d["from"]!r}, so it must require it')
            p.extend(f'{where}: rung {s!r} has no number with decimalSeparator '
                     f'{d["decimalSeparator"]!r}' for s in spec.get('steps', ())
                     if rung_number(s, d['decimalSeparator']) is None)
    for css, who in claims(fams).items():
        names = [f for f, _ in who]
        exclusive = all(b in fams[a].get('exclusiveWith', ()) for a in names for b in names
                        if a != b)
        if len(who) > 1 and not exclusive:
            p.append(f'{css} is claimed by ' + ' and '.join(f'{f} ({how})' for f, how in who)
                     + '. One property belongs to one family, unless the two declare exclusiveWith '
                     'each other and the emitter refuses a rung given to both.')
    return p


def families_of(doc):
    """The families as the emitter should see them: file order, `$` prose stripped."""
    return collections.OrderedDict(
        (fam, {k: v for k, v in spec.items() if not k.startswith('$')})
        for fam, spec in doc['families'].items())


def rungs(fam, families):
    spec = families[fam]
    return families[spec['stepsFrom']]['steps'] if 'stepsFrom' in spec else spec.get('steps', [])


# ── 2. the probes ────────────────────────────────────────────────────────────────────────────────
def exclusive_groups(families):
    groups, placed = [], set()
    for fam, spec in families.items():
        if spec.get('exclusiveWith') and fam not in placed:
            group = [fam] + [o for o in spec['exclusiveWith'] if o not in placed]
            placed.update(group)
            groups.append(group)
    return groups


def probes(families):
    """Every family, rung and list position with a value of its own. Rungs an exclusive group
    shares go to one member per probe, rotating, so every rung of every member is in some probe."""
    groups = exclusive_groups(families)
    out = []
    for variant in range(max([len(g) for g in groups] + [1])):
        n = itertools.count(1)
        scales = collections.OrderedDict()
        for fam, spec in families.items():
            typ = spec.get('type') or families.get(spec.get('stepsFrom'), {}).get('type')

            def one():
                if spec.get('slots'):
                    return [unique_value(typ, next(n)) for _ in spec['slots']]
                return unique_value(typ, next(n))
            if spec.get('scalar'):
                scales[fam] = one()
            elif spec.get('derive'):
                scales[fam] = list(rungs(fam, families))
            else:
                scales[fam] = {r: one() for r in rungs(fam, families)}
        for group in groups:
            shared = [r for r in rungs(group[0], families)
                      if all(r in rungs(g, families) for g in group)]
            for i, r in enumerate(shared):
                keep = group[(i + variant) % len(group)]
                for g in group:
                    if g != keep:
                        scales[g].pop(r, None)
        out.append(scales)
    return out


def owned(families, scales):
    """{custom property: family} for everything the file says these scales emit."""
    own = collections.OrderedDict()
    for fam, spec in families.items():
        if not scales.get(fam) or spec.get('noEmit'):
            continue
        if spec.get('scalar'):
            own[spec['css']] = fam
        else:
            for r in rungs(fam, families):
                if r in scales[fam]:
                    own[spec['css'].replace('{k}', r)] = fam
        for css in spec.get('alsoEmits') or {}:
            own[css] = fam
    return own


# The expectation cases below were written for these derive parameters. If the file changes them,
# the gate fails and says so: recomputing the expected strings here would be a second implementation.
EXPECTED_DERIVE = {'from': 'spaceBase', 'op': 'multiply', 'decimalSeparator': '-',
                   'significantDigits': 6, 'of': 'exactDecimal', 'rounding': 'halfEven',
                   'notation': 'plain', 'units': ['rem']}


def _check_tokens(want):
    """A check that the named properties carry these fields exactly (value, dark, px, expr, ...)."""
    def check(tokens):
        by = {t['property']: t for t in tokens}
        p = []
        for prop, fields in want.items():
            if prop not in by:
                p.append(f'{prop} is not derived')
                continue
            for k, v in fields.items():
                got = by[prop].get(k, '(absent)') if v is not None else by[prop].get(k)
                if v is None and k in by[prop]:
                    p.append(f'{prop} carries {k} {by[prop][k]!r}, and should carry none')
                elif v is not None and got != v:
                    p.append(f'{prop} {k}: expected {v!r}, derived {got!r}')
        return p
    return check


def cases(families):
    """(label, scales, expect) where expect is 'refuse', or a check over the derived tokens."""
    ps = probes(families)
    out = []
    for i, s in enumerate(ps, 1):
        out.append((f'probe {i}', s, ('probe', s)))
    first = ps[0]
    for fam in first:
        rest = collections.OrderedDict((k, v) for k, v in first.items() if k != fam)
        needed = [g for g in rest if fam in families[g].get('requires', ()) and rest.get(g)]
        out.append((f'probe 1 without {fam}', rest, 'refuse' if needed else ('without', fam)))
    for fam, spec in families.items():
        for other in spec.get('exclusiveWith', ()):
            if isinstance(first.get(fam), dict) and first[fam]:
                rung = next(iter(first[fam]))
                theirs = next((s[other][rung] for s in ps if rung in s.get(other, {})), None)
                if theirs is not None:
                    s = copy.deepcopy(first)
                    s[other] = dict(s.get(other, {}), **{rung: theirs})
                    out.append((f'rung {rung!r} in both {fam} and {other}', s, 'refuse'))
    out.append(('an undeclared family', dict(first, gateUndeclared={'x': '1px'}), 'refuse'))
    # Names every JavaScript object inherits: each must be refused as undeclared, not taken for a
    # family, which is what `in` did.
    for name in ('constructor', '__proto__', 'valueOf'):
        out.append((f'a family named {name}', {name: {'x': '1px'}}, 'refuse'))
    s = copy.deepcopy(first)
    s['radius']['gate-undeclared'] = '1px'
    out.append(('an undeclared radius rung', s, 'refuse'))

    # Malformed values: each must be refused, never read.
    base = {'typeScaleFluid': {'0': ['1rem', '1vw', '2rem']}, 'typeScaleViewports': ['300px', '900px']}
    for label, change in (
            ('typeScaleFluid {"0": "1vw"}', {'typeScaleFluid': {'0': '1vw'}}),
            ('a fluid rung with too few positions', {'typeScaleFluid': {'0': ['1rem', '1vw']}}),
            ('a fluid rung with too many positions',
             {'typeScaleFluid': {'0': ['1rem', '1vw', '2rem', '3rem']}}),
            ('the viewports as a string', {'typeScaleViewports': '300px'}),
            ('the viewports with too few positions', {'typeScaleViewports': ['300px']}),
            ('the viewports with too many positions',
             {'typeScaleViewports': ['300px', '600px', '900px']}),
            ('a fluid position that is not a string or number',
             {'typeScaleFluid': {'0': ['1rem', {'x': 1}, '2rem']}})):
        out.append((label, dict(base, **change), 'refuse'))
    for label, s in (
            ('radius given a string', {'radius': '8px'}),
            ('a radius rung given a list', {'radius': {'sm': ['8px']}}),
            ('space given an object', {'spaceBase': '1rem', 'space': {'1': '1rem'}}),
            ('space listing a rung twice', {'spaceBase': '1rem', 'space': ['1', '1']}),
            ('spaceBase that is not a length', {'spaceBase': 'auto', 'space': ['1']}),
            ('spaceBase given as the number 4', {'spaceBase': 4, 'space': ['1']}),
            ('spaceBase given without a unit', {'spaceBase': '0.25', 'space': ['1']}),
            ('spaceBase with a space before its unit', {'spaceBase': '0.25 rem', 'space': ['1']}),
            ('spaceBase with a point and no digits after it', {'spaceBase': '1.rem', 'space': ['1']}),
            ('spaceBase with no digits before its point', {'spaceBase': '.5rem', 'space': ['1']}),
            ('spaceBase in a unit the contract does not name', {'spaceBase': '0.25foo', 'space': ['1']}),
            ('spaceBase in px, which derive.units does not name', {'spaceBase': '4px', 'space': ['1']}),
            ('a breakpoint with a point and no digits after it', {'breakpoint': {'md': '40.rem'}}),
            ('a breakpoint in px', {'breakpoint': {'md': '640px'}}),
            ('a breakpoint in em', {'breakpoint': {'md': '40em'}})):
        out.append((label, s, 'refuse'))

    # Expectations, for the derive parameters above.
    def space(base, rung_list):
        return {'spaceBase': base, 'space': rung_list}
    for label, s, want in (
            ('a rounding tie', space('0.265625rem', ['0-5']),
             {'--space-0-5': {'value': '0.132812rem', 'expr': 'calc(var(--spacing) * 0.5)'}}),
            ('a tie that only the exact decimal product has', space('0.333333rem', ['1-5']),
             {'--space-1-5': {'value': '0.5rem'}}),
            ('a value below 1e-4', space('0.0000625rem', ['0-5']),
             {'--space-0-5': {'value': '0.00003125rem'}}),
            ('a zero base', space('0rem', ['0-5', '12']),
             {'--space-0-5': {'value': '0rem'}, '--space-12': {'value': '0rem'}}),
            ('a signed zero base', space('-0rem', ['0-5']), {'--space-0-5': {'value': '0rem'}}),
            ('a product longer than any float',
             space('0.1234567890123456789012345678901rem', ['3']),
             {'--space-3': {'value': '0.37037rem'}}),
            ('a product of seven digits', space('2469135rem', ['0-5']),
             {'--space-0-5': {'value': '1234570rem'}}),
            ('the constants', space('1rem', ['1']),
             {'--space-0': {'value': '0', 'constant': True}, '--space-px': {'value': '1px'}}),
            ('pixel widths', {'breakpoint': {'sm': '2.5rem', 'md': '40rem', 'lg': '0.123457rem',
                                             'xl': '2.99999999999999999999rem'}},
             {'--breakpoint-sm': {'px': '40px'}, '--breakpoint-md': {'px': '640px'},
              '--breakpoint-lg': {'px': '1px'},
              # 47.99999... truncates to 47; a float reads the value as 3 and writes 48.
              '--breakpoint-xl': {'px': '47px'}}),
            ('a partial, reordered space list, written in declared order',
             space('1rem', ['12', '0-5']),
             {'--space-0-5': {'value': '0.5rem'}, '--space-12': {'value': '12rem'}}),
            ('a dark value on its own rung only',
             {'weight': {'regular': 400, 'bold': 700}, 'weightDark': {'bold': 600}},
             {'--weight-bold': {'value': 700, 'dark': 600}, '--weight-regular': {'dark': None}}),
            ('a filled template and its record', base,
             {'--step-0': {'value': 'clamp(1rem, 1vw, 2rem)', 'rung': '0',
                           'fluid': {'min': '1rem', 'preferred': '1vw', 'max': '2rem',
                                     'minViewport': '300px', 'maxViewport': '900px'}}})):
        out.append((label, s, ('expect', _check_tokens(want))))
    return out


def reference(batch, script=CLI):
    """[(tokens, refusal)] from the implementation, one per scales in the batch, and a crash."""
    try:
        # A timeout because a broken implementation can loop (the self-test breaks it on purpose),
        # and a gate that hangs is a gate somebody kills and forgets.
        run = subprocess.run(['node', script], input=json.dumps(batch), capture_output=True,
                             text=True, timeout=120)
    except FileNotFoundError:
        return None, ('the implementation is JavaScript and `node` is not on PATH. This gate has no '
                      'skip flag: a check that did not run is not a pass.')
    except subprocess.TimeoutExpired:
        return None, 'the implementation did not answer the batch within 120 seconds'
    try:
        results = json.loads(run.stdout) if run.returncode == 0 else None
    except json.JSONDecodeError:
        results = None
    if not isinstance(results, list) or len(results) != len(batch):
        return None, ('the implementation did not answer the batch (exit '
                      f'{run.returncode}): {(run.stderr or run.stdout or "no output").strip()[-600:]}')
    return [(r.get('tokens'), r.get('refused')) for r in results], None


def shape_refusal_problems(module, shape_path):
    """Refusals that depend on the shape rather than the scale: a derivation whose `of` is missing,
    or names an operand this implementation does not round, must be refused, never assumed."""
    code = (
        f"import {{ deriveScaleTokens, ScaleRefused }} from {json.dumps(pathlib.Path(module).as_uri())}\n"
        "import { readFileSync } from 'node:fs'\n"
        f"const shape = JSON.parse(readFileSync({json.dumps(shape_path)}, 'utf8'))\n"
        "const out = []\n"
        "for (const [label, of] of [['missing', undefined], ['unknown (exactBinary64)', 'exactBinary64']]) {\n"
        "  const s = structuredClone(shape)\n"
        "  for (const f of Object.values(s.families)) if (f.derive) { if (of === undefined) delete f.derive.of; else f.derive.of = of }\n"
        "  try { deriveScaleTokens(s, { spaceBase: '1rem', space: ['1'] }); out.push(`derive.of ${label}: must be refused, and was derived`) }\n"
        "  catch (e) { if (!(e instanceof ScaleRefused)) out.push(`derive.of ${label}: threw ${e.constructor.name}, not ScaleRefused`) }\n"
        "}\n"
        "console.log(JSON.stringify(out))\n")
    try:
        run = subprocess.run(['node', '--input-type=module', '-e', code], capture_output=True, text=True,
                             timeout=120)
        return json.loads(run.stdout) if run.returncode == 0 else [
            f'the derive.of refusal check did not run: {(run.stderr or run.stdout).strip()[-400:]}']
    except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
        return [f'the derive.of refusal check did not run: {type(e).__name__}']


def _few(items, n=4):
    items = list(items)
    return ', '.join(items[:n]) + (f' and {len(items) - n} more' if len(items) > n else '')


def _probe_problems(label, families, scales, tokens):
    p, own = [], owned(families, scales)
    props = [t['property'] for t in tokens]
    dup = [x for x, c in collections.Counter(props).items() if c > 1]
    if dup:
        p.append(f'{label}: derives {_few(dup)} more than once')
    extra = [x for x in props if x not in own]
    missing = [x for x in own if x not in props]
    if extra:
        p.append(f'{label}: derives {_few(extra)}, which the file does not claim')
    if missing:
        p.append(f'{label}: the file claims {_few(missing)}, which is not derived')
    for t in tokens:
        spec = families.get(t.get('family'), {})
        if own.get(t['property']) not in (None, t.get('family')):
            p.append(f'{label}: {t["property"]} is derived for {t.get("family")}; the file gives it to '
                     f'{own[t["property"]]}')
        for key in ('type', 'group'):
            if t.get(key) != spec.get(key):
                p.append(f'{label}: {t["property"]} {key} {t.get(key)!r}; the file says {spec.get(key)!r}')
    return p


def _without_problems(label, families, full, scales_full, fam, tokens):
    """Withholding `fam` removes exactly its properties, and changes only what it modifies."""
    p = []
    before = {t['property']: t for t in full}
    after = {t['property']: t for t in tokens}
    gone = [x for x in before if x not in after]
    expected = [x for x, f in owned(families, scales_full).items() if f == fam]
    if sorted(gone) != sorted(expected):
        p.append(f'{label}: removed {_few(gone) or "nothing"}; the file says it owns '
                 f'{_few(expected) or "nothing"}')
    if [x for x in after if x not in before]:
        p.append(f'{label}: made {_few(x for x in after if x not in before)} appear')
    may = set(families[fam].get('modifies', ()))
    for x, t in after.items():
        if x in before and t != before[x] and t.get('family') not in may:
            p.append(f'{label}: changed {x} ({t.get("family")}), which {fam} does not modify')
    return p


def _order_problems(label, families, scales, tokens):
    """Written order is the file's: families as it lists them, each family's rungs as its `steps`
    declare them, whatever order the scale's own object or list happens to use, then its constants."""
    want = [x for x in owned(families, scales)]
    got = [t['property'] for t in tokens if t['property'] in want]
    if got != [x for x in want if x in got]:
        first = next(i for i, (a, b) in enumerate(zip(got, [x for x in want if x in got])) if a != b)
        return [f'{label}: writes {got[first]} where the file puts '
                f'{[x for x in want if x in got][first]}. Written order is the file\'s.']
    return []


def reference_problems(families, script=CLI):
    derive = next((s['derive'] for s in families.values() if s.get('derive')), None)
    if derive != EXPECTED_DERIVE:
        return [f'cannot rank: the expectation cases were written for derive {EXPECTED_DERIVE}; the '
                f'file now says {derive}. Rewrite the expected values with that change, deliberately.'], []
    todo = cases(families)
    results, crash = reference([s for _, s, _ in todo], script)
    if crash:
        return [crash], []
    full = {label: tokens for (label, _, _), (tokens, _) in zip(todo, results)}
    p = []
    derived = [tokens for tokens, refused in results if tokens is not None]
    for (label, scales, expect), (tokens, refused) in zip(todo, results):
        if expect == 'refuse':
            if refused is None:
                p.append(f'{label}: must be refused, and was derived')
            continue
        if refused is not None:
            p.append(f'{label}: must be derived, and was refused ({refused})')
            continue
        p.extend(_order_problems(label, families, scales, tokens))
        if expect[0] == 'probe':
            p.extend(_probe_problems(label, families, scales, tokens))
        elif expect[0] == 'without':
            p.extend(_without_problems(label, families, full['probe 1'] or [], cases_probe1(todo),
                                       expect[1], tokens))
        else:
            p.extend(f'{label}: {m}' for m in expect[1](tokens))
    return p, derived


def cases_probe1(todo):
    return next(s for label, s, _ in todo if label == 'probe 1')


# ── the declarations against the output ──────────────────────────────────────────────────────────
# The type expressions this gate can check a JSON value against. Anything else in ScaleToken is a
# shape it cannot rank, and fails rather than being trusted.
_TYPE_CHECK = {
    'string': lambda v: isinstance(v, str),
    'number': lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    'string | number': lambda v: isinstance(v, str) or (isinstance(v, (int, float))
                                                        and not isinstance(v, bool)),
    'true': lambda v: v is True,
    'Record<string, string | number>': lambda v: isinstance(v, dict) and all(
        isinstance(x, str) or (isinstance(x, (int, float)) and not isinstance(x, bool))
        for x in v.values()),
}
_FIELD = re.compile(r'\s*([A-Za-z]+)(\??):\s*(.+?)\s*$')


def declared_fields(types_text):
    """{field: (optional, type)} from `interface ScaleToken`, and any line it cannot rank."""
    m = re.search(r'export interface ScaleToken \{\n(.*?)\n\}', types_text, re.S)
    if not m:
        return None, ['cannot rank: scale_tokens.d.mts declares no `export interface ScaleToken`']
    fields, p = {}, []
    for line in m.group(1).splitlines():
        if not line.strip() or line.strip().startswith('//'):
            continue
        f = _FIELD.match(line)
        if not f or f.group(3) not in _TYPE_CHECK:
            p.append(f'cannot rank the ScaleToken line {line.strip()!r}: this gate checks '
                     f'`name?: type` with a type in {sorted(_TYPE_CHECK)}')
            continue
        fields[f.group(1)] = (f.group(2) == '?', f.group(3))
    return fields, p


def types_problems(types_text, families, token_lists):
    """ScaleToken must describe what the implementation actually returns, and nothing it does not."""
    fields, p = declared_fields(types_text)
    if fields is None:
        return p
    for fam, spec in families.items():
        if spec.get('recordAs') and spec['recordAs'] not in fields:
            p.append(f'ScaleToken does not declare {spec["recordAs"]!r}, the record {fam} writes')
    seen = set()
    for tokens in token_lists:
        for t in tokens:
            for k, v in t.items():
                seen.add(k)
                if k not in fields:
                    p.append(f'the implementation returns {k!r} (on {t["property"]}), which ScaleToken '
                             'does not declare')
                elif not _TYPE_CHECK[fields[k][1]](v):
                    p.append(f'{t["property"]} {k} is {v!r}, and ScaleToken declares {fields[k][1]}')
            for k, (optional, _) in fields.items():
                if not optional and k not in t:
                    p.append(f'ScaleToken declares {k} required, and {t["property"]} has none')
    p.extend(f'ScaleToken declares {k}, which the implementation never returned on any case'
             for k in fields if k not in seen)
    return sorted(set(p), key=p.index)


# ── all of it, over one (file, implementation) pair ──────────────────────────────────────────────
def materialise(doc, source):
    """A throwaway foundations/ holding this doc and this implementation, touching neither real file."""
    tmp = tempfile.mkdtemp(prefix='check-scale-shape-')
    shutil.copytree(os.path.join(ROOT, 'scripts'), os.path.join(tmp, 'scripts'),
                    ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copytree(os.path.join(ROOT, 'contract'), os.path.join(tmp, 'contract'))
    json.dump(doc, open(os.path.join(tmp, 'contract', 'scale-shape.json'), 'w'), indent=2)
    open(os.path.join(tmp, 'scripts', 'scale_tokens.mjs'), 'w', encoding='utf-8').write(source)
    return tmp


def problems(doc, source, types=None):
    p = shape_problems(doc)
    if p:
        return p                     # nothing below can be trusted over a shape it cannot read
    types = open(TYPES, encoding='utf-8').read() if types is None else types
    tmp = materialise(doc, source)
    try:
        found, derived = reference_problems(families_of(doc),
                                            os.path.join(tmp, 'scripts', 'scale_tokens_cli.mjs'))
        p += found
        p += shape_refusal_problems(os.path.join(tmp, 'scripts', 'scale_tokens.mjs'),
                                    os.path.join(tmp, 'contract', 'scale-shape.json'))
        p += types_problems(types, families_of(doc), derived)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return sorted(set(p), key=p.index)


# ── the gate's own guards ────────────────────────────────────────────────────────────────────────
def _doc(fn):
    def mutate(doc, src, types):
        doc = copy.deepcopy(doc)
        fn(doc['families'])
        return doc, src, types
    return mutate


def _anchor(text, old, new, where):
    if text.count(old) != 1:
        raise AssertionError(f'self-test anchor {old!r} occurs {text.count(old)} times in {where}, '
                             'not once')
    return text.replace(old, new)


def _src(old, new):
    return lambda doc, src, types: (doc, _anchor(src, old, new, 'scale_tokens.mjs'), types)


def _types(old, new):
    return lambda doc, src, types: (doc, src, _anchor(types, old, new, 'scale_tokens.d.mts'))


SELF_TEST = (
    ('a non-string step fails by name',
     _doc(lambda f: f['borderWidth']['steps'].__setitem__(0, 1)),
     "family 'borderWidth': non-string step 1"),
    ('a key the gate cannot rank fails', _doc(lambda f: f['radius'].__setitem__('deprecated', True)),
     "family 'radius': key 'deprecated' — cannot rank"),
    ('a property claimed by two families fails',
     _doc(lambda f: f['durationExtended']['steps'].append('ambient')),
     '--duration-ambient is claimed by duration'),
    ('a changed derivation is not silently re-expected',
     _doc(lambda f: f['space']['derive'].__setitem__('significantDigits', 4)),
     'cannot rank: the expectation cases were written for derive'),
    ('an implementation ignoring requires fails',
     _src("if (missing.length) throw", "if (false) throw"),
     'probe 1 without weight: must be refused, and was derived'),
    ('an implementation ignoring exclusiveWith fails',
     _src("if (both.length) throw", "if (false) throw"),
     "in both typeScaleFixed and typeScaleFluid: must be refused, and was derived"),
    ('an implementation rounding the tie half up fails',
     _src("(r * 2n === p && q % 2n === 1n)", "(r * 2n === p)"),
     "a rounding tie: --space-0-5 value: expected '0.132812rem', derived '0.132813rem'"),
    ('an implementation writing a zero with its scale fails',
     _src("if (n === 0n) return '0'", "if (n === 0n) return '0.0'"),
     "a zero base: --space-0-5 value: expected '0rem', derived '0.0rem'"),
    ('an implementation keeping the sign of a zero fails',
     _src("if (n === 0n) return '0'", "if (n === 0n) return neg ? '-0' : '0'"),
     "a signed zero base: --space-0-5 value: expected '0rem', derived '-0rem'"),
    ('an implementation converting px as if it were rem fails',
     _src("length(`${fam}.${rung}`, raw, [spec.pxFrom])", "length(`${fam}.${rung}`, raw, [spec.pxFrom, 'px'])"),
     'a breakpoint in px: must be refused, and was derived'),
    ('an implementation reading a slotted string fails',
     _src("if (!Array.isArray(v) || v.length !== slots.length || !v.every(isPlainValue))",
          "if (false)"),
     'typeScaleFluid {"0": "1vw"}: must be refused'),
    ('an implementation dropping a family fails',
     _src("if (!given(fam) || spec.noEmit) continue", "if (!given(fam) || spec.noEmit || fam === 'radius') continue"),
     'probe 1: the file claims --radius-sm'),
    ('an implementation putting a dark value on every rung fails',
     _src("if (Object.hasOwn(scales[fam], t.rung)) t.dark = scales[fam][t.rung]",
          "t.dark = scales[fam][t.rung] ?? t.value"),
     'a dark value on its own rung only: --weight-regular carries dark'),
    ('an implementation writing rungs in the scale\'s own order fails',
     _src("for (const rung of rungsOf(fam))\n        if (Object.hasOwn(scales[fam], rung)) one(",
          "for (const rung of Object.keys(scales[fam]))\n        if (Object.hasOwn(scales[fam], rung)) one("),
     "probe 1: writes --step-1 where the file puts --step--5"),
    ('an implementation computing pixel widths in floating point fails',
     _src("extra.px = `${plain({ neg: number.neg, n: whole, e: 0 })}px`",
          "extra.px = `${Math.trunc(Number(String(raw).match(/-?[\\d.]+/)[0]) * spec.pxAt)}px`"),
     "pixel widths: --breakpoint-xl px: expected '47px', derived '48px'"),
    ('a declaration the implementation does not honour fails',
     _types('  expr?: string\n', ''), "the implementation returns 'expr'"),
    ('a declared type the output does not have fails',
     _types('  px?: string\n', '  px?: number\n'), "px is '"),
    ('a field declared required that some tokens lack fails',
     _types('  rung?: string\n', '  rung: string\n'), 'ScaleToken declares rung required'),
    ('an implementation returning an undeclared field fails',
     _src("tokens.push({ property, family: fam, ...extra,", "tokens.push({ property, family: fam, extra: 1, ...extra,"),
     "the implementation returns 'extra'"),
    ('an implementation assuming the rounding\'s operand fails',
     _src("if (d.of !== 'exactDecimal')", "if (false)"),
     'derive.of missing: must be refused, and was derived'),
    ('an implementation finding families through the prototype fails',
     _src("if (!Object.hasOwn(F, fam)) throw", "if (!(fam in F)) throw"),
     'the implementation did not answer the batch'),
    ('an implementation accepting any unit fails',
     _src("if (!units.includes(m[2]))", "if (false)"), 'spaceBase in a unit the contract does not name: must be refused'),
    ('an implementation accepting a bare trailing point fails',
     _src("(-?\\d+(?:\\.\\d+)?)", "(-?\\d+(?:\\.\\d*)?)"), 'spaceBase with a point and no digits after it: must be refused'),
    ('an implementation ignoring the value template fails',
     _src("value = spec.valueTemplate.replace(", "value = raw; spec.valueTemplate.replace("),
     "a filled template and its record: --step-0 value: expected 'clamp(1rem, 1vw, 2rem)'"),
)


def self_test(doc, source):
    fails = []
    types = open(TYPES, encoding='utf-8').read()
    for name, mutate, want in SELF_TEST:
        try:
            got = problems(*mutate(doc, source, types))
        except Exception as e:                               # noqa: BLE001 — that is the finding
            fails.append(f'{name}: the case itself broke — {type(e).__name__}: {e}')
            continue
        if any(want in m for m in got):
            print(f'  guard fires   {name}')
        else:
            fails.append(f'{name}: DID NOT FIRE. Wanted a message containing {want!r}; got '
                         f'{got[:3] or "no problems at all"}')
    return fails


def main():
    doc = json.load(open(SHAPE_PATH, encoding='utf-8'), object_pairs_hook=collections.OrderedDict)
    source = open(REFERENCE, encoding='utf-8').read()

    found = problems(doc, source)
    fams = doc.get('families', {}) if isinstance(doc, dict) else {}
    print(f'contract/scale-shape.json: {len(fams)} families, '
          f'{sum(len(s.get("steps", [])) for s in fams.values() if isinstance(s, dict))} '
          'declared rungs')
    if found:
        print(f'\nFAIL: {len(found)} problem(s) with the scale shape or its implementation:')
        for f in found:
            print('   ', f)
        return 1
    print(f'  {len(cases(families_of(doc)))} cases: every probe, refusal and expectation holds')

    # Second, not first: every case mutates the REAL inputs, so it can only say something about a
    # guard when those inputs are clean. Over a broken file every case would stop at the same
    # problem and the output would blame the guards for it.
    print('\nits own guards, each against a deliberate break\n')
    broken = self_test(doc, source)
    if broken:
        print('\nFAIL: the gate cannot be trusted until its guards fire again:')
        for b in broken:
            print('   ', b)
        return 1
    print('\nPASS: the file is readable and consistent, and scripts/scale_tokens.mjs derives what '
          'it claims and refuses what it forbids.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
