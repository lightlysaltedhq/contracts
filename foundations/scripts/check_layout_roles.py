#!/usr/bin/env python3
"""The layout rhythm roles point at real rungs, and their one implementation resolves and refuses
what the vocabulary says.

    python3 scripts/check_layout_roles.py     # exit 0 = sound · 1 = not, or a file is unreadable

ONE IMPLEMENTATION
------------------
scripts/layout_roles.mjs (the `./layout-roles` export, run here through layout_roles_cli.mjs) resolves a product's layout roles against
its spacing scale and checks every invariant in contract/vocabulary.json#layoutRoles. It reads each
end's length from scripts/scale_tokens.mjs, so the space derivation is written once. This gate runs
that code; it holds no second copy of it.

WHAT IT RUNS
------------
  1. Data checks. Every default names a rung of its role's family in contract/scale-shape.json
     (the reference that has to resolve), every role has exactly the declared ends, the invariants are
     of kinds the implementation knows and name declared roles, and no role's property is one the
     scale shape already emits.
  2. Probes through the implementation. The defaults on a synthetic scale resolve to the lengths
     written below; each invariant, on a declaration built to break it and nothing else, is refused
     under its own code and no other; an undeclared role, end or rung, a malformed declaration, a
     scale the scale shape refuses and a length that cannot be ranked are each refused by name; a
     doctored contract is reported as a contract error; and a legal override resolves to its rung.
     The expected lengths are written for the defaults the file has now, on a synthetic scale. If
     the file changes a default, this says so rather than recomputing the answer, which would be a
     second implementation.

  3. The declarations: LayoutEnd and LayoutToken in layout_roles.d.mts must describe exactly what
     the implementation returns, every field and its type.

A PASS also needs its own guards to fire: SELF_TEST breaks the data one way at a time and each
break must be named, SELF_TEST_IMPL breaks a copy of the implementation one way at a time and the
probes must notice each, and SELF_TEST_TYPES does the same to the declarations. Needs `node`. Fails closed, no skip flag.
"""
import copy
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
VOCAB_PATH = os.path.join(ROOT, 'contract', 'vocabulary.json')
SHAPE_PATH = os.path.join(ROOT, 'contract', 'scale-shape.json')
IMPL = os.path.join(HERE, 'layout_roles.mjs')
CLI = os.path.join(HERE, 'layout_roles_cli.mjs')
TYPES = os.path.join(HERE, 'layout_roles.d.mts')

KINDS = ('emitted', 'ends', 'order', 'floor')
OPS = ('<=', '<', '>=', '>')
CSS_NAME = re.compile(r'--[a-z0-9]+(?:-[a-z0-9]+)*\Z')


# ── 1. data checks ────────────────────────────────────────────────────────────────────────────────
def shape_properties(shape):
    """Every custom property the scale shape can emit, so a layout role cannot claim one."""
    props = set()
    for spec in shape['families'].values():
        css = spec.get('css')
        if not css:
            continue
        steps = spec.get('steps') or shape['families'].get(spec.get('stepsFrom'), {}).get('steps') or []
        props |= {css.replace('{k}', s) for s in steps} if '{k}' in css else {css}
        props |= set(spec.get('alsoEmits', {}))
    return props


def data_problems(vocab, shape):
    L = vocab.get('layoutRoles')
    if not isinstance(L, dict):
        return ['vocabulary.json has no layoutRoles block']
    p = []
    ends = L.get('ends')
    if not (isinstance(ends, list) and len(ends) >= 2 and len(set(ends)) == len(ends)
            and all(isinstance(e, str) and e for e in ends)):
        p.append(f'layoutRoles.ends {ends!r} must list at least two distinct end names')
        ends = []
    css = L.get('css', '')
    if not (isinstance(css, str) and css.count('{role}') == 1 and css.count('{end}') == 1):
        p.append(f'layoutRoles.css {css!r} needs exactly one {{role}} and one {{end}}')
        css = None
    ids = [r.get('id') for r in L.get('roles', [])]
    if not ids or len(set(ids)) != len(ids):
        p.append(f'layoutRoles.roles must be non-empty, each id once: {ids}')
    taken = shape_properties(shape)
    for r in L.get('roles', []):
        fam = shape['families'].get(r.get('family'))
        if not isinstance(fam, dict) or '{k}' not in fam.get('css', '') or not fam.get('steps'):
            p.append(f'role {r.get("id")!r} family {r.get("family")!r} is not a scale-shape family '
                     'with a property per rung, so its ends have nothing to point at')
            continue
        d = r.get('defaults')
        if not isinstance(d, dict) or sorted(d) != sorted(ends):
            p.append(f'role {r.get("id")!r} defaults {d!r} must name exactly the ends {ends}')
            continue
        for end, rung in d.items():
            if rung not in fam['steps']:
                p.append(f'role {r["id"]!r} default {end} {rung!r} is not a rung of '
                         f'{r["family"]} in contract/scale-shape.json')
        if css:
            for end in ends:
                prop = css.replace('{role}', str(r.get('id'))).replace('{end}', end)
                if not CSS_NAME.match(prop):
                    p.append(f'role {r.get("id")!r} renders to {prop!r}, not a custom property name')
                elif prop in taken:
                    p.append(f'role {r.get("id")!r} renders to {prop}, which the scale shape '
                             'already emits: two owners for one property')
    inv_ids = [i.get('id') for i in L.get('invariants', [])]
    if len(set(inv_ids)) != len(inv_ids):
        p.append(f'invariant ids repeat: {inv_ids}')
    for inv in L.get('invariants', []):
        k, where = inv.get('kind'), f'invariant {inv.get("id")!r}'
        if k not in KINDS:
            p.append(f'{where} is of kind {k!r}; the implementation knows {", ".join(KINDS)}')
        elif k == 'ends' and inv.get('op') not in OPS:
            p.append(f'{where} op {inv.get("op")!r} is not one of {OPS}')
        elif k == 'order':
            for pair in inv.get('pairs') or [None]:
                if not (isinstance(pair, list) and len(pair) == 3 and pair[0] in ids
                        and pair[2] in ids and pair[1] in OPS):
                    p.append(f'{where} pair {pair!r} must be [declared role, op, declared role]')
        elif k == 'floor':
            n = inv.get('atLeastCssPx')
            if inv.get('role') not in ids or inv.get('end') not in ends or not (
                    isinstance(n, (int, float)) and not isinstance(n, bool) and n > 0):
                p.append(f'{where} needs a declared role and end and a positive atLeastCssPx')
    return p


# ── 2. probes through the implementation ──────────────────────────────────────────────────────────
def run(batch, cli=CLI):
    try:
        r = subprocess.run(['node', cli], input=json.dumps(batch), capture_output=True, text=True,
                           timeout=60)
    except FileNotFoundError:
        raise SystemExit('FAIL: `node` is not on PATH. scripts/layout_roles.mjs is the one '
                         'implementation of the layout roles, and this gate runs it.')
    if r.returncode != 0:
        return None, (r.stderr or r.stdout).strip()
    return json.loads(r.stdout), None


# A synthetic scale, no product's: a 0.3rem base, so each section length is a rung times 4.8 px and
# lands on a decimal, and a container padding of its own.
PADDING = {'base': '1.25rem', 'sm': '1.875rem', 'lg': '2.75rem'}
# What the defaults resolve to on it, in CSS px: written, not computed.
DEFAULT_PX = {'section-sm': ('38.4', '67.2'), 'section-md': ('76.8', '115.2'),
              'section-lg': ('96', '134.4'), 'gutter': ('20', '44')}
# A token list built by hand, every default's rung under its own property: it resolves as it stands,
# so a probe that changes one token's property alone and is refused was refused for the property.
HAND = [{'family': 'space', 'rung': r, 'property': f'--space-{r}', 'value': f'{r}px'}
        for r in ('8', '14', '16', '24', '20', '28')] + [
    {'family': 'containerPadding', 'rung': r, 'property': f'--container-padding-{r}', 'value': v}
    for r, v in (('base', '20px'), ('lg', '44px'))]


def cases(shape):
    every = list(shape['families']['space']['steps'])
    scale = {'spaceBase': '0.3rem', 'space': every, 'containerPadding': PADDING}
    padded = lambda **k: dict(scale, containerPadding=dict(PADDING, **k))  # noqa: E731
    renamed = copy.deepcopy(shape)
    renamed['families']['containerPadding']['css'] = '--gutter-{k}'
    return [
        ('defaults', {'scales': scale}, 'resolve'),
        ('L1: gutter.max at containerPadding lg, which the scale does not emit',
         {'scales': dict(scale, containerPadding={'base': '1.25rem'})}, ['L1']),
        ('L1: resolved under a scale shape whose containerPadding property is not the one the '
         'tokens were derived under', {'scales': scale, 'shape': renamed}, ['L1']),
        ('a hand-built token list, every rung under its own property', {'tokens': HAND}, 'resolve'),
        ('L1: a hand-built containerPadding base token under another property',
         {'tokens': [t for t in HAND if t['rung'] != 'base']
          + [{'family': 'containerPadding', 'rung': 'base', 'value': '100px',
              'property': '--elsewhere'}]}, ['L1']),
        ('L2: section-lg shrinks as the viewport grows',
         {'scales': scale, 'overrides': {'section-lg': {'min': '32', 'max': '28'}}}, ['L2']),
        ('L2 allows a role that holds still: a gutter at lg at both ends',
         {'scales': scale, 'overrides': {'gutter': {'min': 'lg', 'max': 'lg'}}}, 'resolve'),
        ('L3: section-sm louder than section-md at max',
         {'scales': scale, 'overrides': {'section-sm': {'min': '12', 'max': '28'}}}, ['L3']),
        ('L4: a 12 px gutter', {'scales': padded(base='0.75rem')}, ['L4']),
        ('L4 is inclusive: a 16 px gutter', {'scales': padded(base='16px')}, 'resolve'),
        ('a gutter in em cannot be ranked', {'scales': padded(base='1em')}, ['unrankable']),
        ('a space base in em is the scale shape\'s to refuse', {'scales': dict(scale, spaceBase='0.3em')},
         ['scale']),
        ('a gutter in vw cannot be ranked', {'scales': padded(base='5vw')}, ['unrankable']),
        # $L4 says where a product that must hold 16 px at every root puts the floor: in the
        # composed --space-gutter. This is why it is not the rung.
        ('a gutter rung floored in place, max(1rem, 16px), cannot be ranked',
         {'scales': padded(base='max(1rem, 16px)')}, ['unrankable']),
        ('an undeclared role', {'scales': scale, 'overrides': {'hero': {'min': '8'}}}, ['unknownRole']),
        ('an undeclared end', {'scales': scale, 'overrides': {'gutter': {'mid': '8'}}}, ['unknownEnd']),
        ('an undeclared rung', {'scales': scale, 'overrides': {'gutter': {'max': '13'}}},
         ['unknownRung']),
        ('another family\'s rung', {'scales': scale, 'overrides': {'section-sm': {'min': 'lg'}}},
         ['unknownRung']),
        ('a rung given as a number', {'scales': scale, 'overrides': {'gutter': {'max': 12}}},
         ['unknownRung']),
        ('a role given a rung instead of its ends', {'scales': scale, 'overrides': {'gutter': '6'}},
         ['declaration']),
        ('space without spaceBase', {'scales': {'space': every, 'containerPadding': PADDING}},
         ['scale']),
    ]


def probe_problems(shape, vocab, cli=CLI, types=None):
    todo = cases(shape)
    doctored = copy.deepcopy(vocab)
    doctored['layoutRoles']['invariants'].append({'id': 'LX', 'kind': 'bogus'})
    bad_op = copy.deepcopy(vocab)
    bad_op['layoutRoles']['invariants'] = [
        dict(i, pairs=[[i['pairs'][0][0], '=<', i['pairs'][0][2]]]) if i['kind'] == 'order' else i
        for i in bad_op['layoutRoles']['invariants']]
    moved = {'scales': todo[0][1]['scales'], 'overrides': {'gutter': {'min': 'sm'}}}
    unreadable = (('an invariant of an unknown kind', doctored),
                  ('an order pair with an unknown op', bad_op),
                  ('a vocabulary with no layoutRoles', {}),
                  ('a vocabulary whose layoutRoles is empty', {'layoutRoles': {}}))
    batch = [c[1] for c in todo] + [
        {'scales': todo[0][1]['scales'], 'vocabulary': v} for _, v in unreadable] + [moved]
    out, crash = run(batch, cli)
    if crash:
        return [f'the implementation crashed: {crash}']
    if not isinstance(out, list) or len(out) != len(batch):
        return [f'the implementation answered {len(out) if isinstance(out, list) else out!r} '
                f'results for {len(batch)} cases']
    p = []
    for (label, _, want), got in zip(todo, out):
        if want == 'resolve':
            if 'roles' not in got:
                p.append(f'{label}: should resolve, got {got}')
        elif got.get('codes') != want:
            p.append(f'{label}: should be refused as exactly {want}, got {got}')
    first = out[0]
    if 'roles' in first:
        got_px = {role: (ends['min']['px'], ends['max']['px']) for role, ends in first['roles'].items()}
        if got_px != DEFAULT_PX:
            p.append(f'the defaults resolve to {got_px} CSS px at a base of '
                     f'{todo[0][1]["scales"]["spaceBase"]}; this gate is '
                     f'written for {DEFAULT_PX}. If a default changed on purpose, change DEFAULT_PX '
                     'with it; if not, the resolution is wrong.')
        L = vocab['layoutRoles']
        css = {f: spec['css'] for f, spec in shape['families'].items() if 'css' in spec}
        want_tokens = [(L['css'].replace('{role}', r['id']).replace('{end}', e),
                        f'var({css[r["family"]].replace("{k}", r["defaults"][e])})')
                       for r in L['roles'] for e in L['ends']]
        got_tokens = [(t['property'], t['value']) for t in first['tokens']]
        if got_tokens != want_tokens:
            p.append(f'the defaults emit {got_tokens}, not the vocabulary\'s roles and ends in order, '
                     f'each a reference to its rung: {want_tokens}')
    for (label, _), got in zip(unreadable, out[len(todo):-1]):
        if 'contractError' not in got:
            p.append(f'{label} should be a contract error, got {got}')
    p.extend(types_problems(open(TYPES, encoding='utf-8').read() if types is None else types,
                            [r for r in out if 'roles' in r]))
    p.extend(inherited_problems(os.path.join(os.path.dirname(cli), 'layout_roles.mjs'),
                                todo[0][1]['scales']))
    g = out[-1].get('roles', {}).get('gutter', {})
    tokens = {t['property']: t['value'] for t in out[-1].get('tokens', [])}
    if (g.get('min', {}).get('rung'), g.get('min', {}).get('px'), g.get('max', {}).get('px')) != \
            ('sm', '30', '44') or tokens.get('--space-gutter-min') != 'var(--container-padding-sm)':
        p.append(f'a gutter whose min is overridden to sm should resolve to 30 and 44 CSS px and emit '
                 f'var(--container-padding-sm), got {g} and {tokens.get("--space-gutter-min")}')
    return p


# An inherited override cannot be written in JSON (JSON.parse makes `__proto__` an own key), so this
# probe imports the implementation directly. Validation reads own properties, so resolution must too:
# an override on the prototype was never validated and must not be applied.
INHERITED = '''
import { readFileSync } from 'node:fs'
import { resolveLayoutRoles } from %s
import { deriveScaleTokens } from %s
const [vocab, shape, scales] = JSON.parse(readFileSync(0, 'utf8'))
const tokens = deriveScaleTokens(shape, scales)
const got = [Object.create({ gutter: { min: 'sm' } }), { gutter: Object.create({ min: 'sm' }) }]
  .map((o) => resolveLayoutRoles(vocab, shape, tokens, o).roles.gutter.min.rung)
process.stdout.write(JSON.stringify(got))
'''


def inherited_problems(impl, scales):
    vocab = json.load(open(VOCAB_PATH, encoding='utf-8'))
    shape = json.load(open(SHAPE_PATH, encoding='utf-8'))
    tokens_impl = os.path.join(HERE, 'scale_tokens.mjs')
    src = INHERITED % (json.dumps(pathlib.Path(impl).as_uri()), json.dumps(pathlib.Path(tokens_impl).as_uri()))
    r = subprocess.run(['node', '--input-type=module', '-e', src], input=json.dumps([vocab, shape, scales]),
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        return [f'the inherited-override probe crashed: {(r.stderr or r.stdout).strip()}']
    got = json.loads(r.stdout)
    if got != ['base', 'base']:
        return [f'an override on the prototype (of the overrides, then of one role\'s ends) should be '
                f'ignored, as the validation ignores it, leaving gutter.min at base; got {got}']
    return []


# ── the declarations, against what the implementation returns ────────────────────────────────────
_TYPE_CHECK = {
    'string': lambda v: isinstance(v, str),
    'number': lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
}
_FIELD = re.compile(r'\s*([A-Za-z]+)(\??):\s*(.+?)\s*$')


def declared(types_text, name):
    """{field: (optional, type)} from `export interface <name>`, and every line it cannot rank."""
    m = re.search(r'export interface ' + name + r' \{\n(.*?)\n\}', types_text, re.S)
    if not m:
        return None, [f'cannot rank: layout_roles.d.mts declares no `export interface {name}`']
    fields, p = {}, []
    for line in m.group(1).splitlines():
        if not line.strip() or line.strip().startswith('//'):
            continue
        f = _FIELD.match(line)
        if not f or f.group(3) not in _TYPE_CHECK:
            p.append(f'cannot rank the {name} line {line.strip()!r}: this gate checks `name?: type` '
                     f'with a type in {sorted(_TYPE_CHECK)}')
            continue
        fields[f.group(1)] = (f.group(2) == '?', f.group(3))
    return fields, p


def types_problems(types_text, results):
    """LayoutEnd and LayoutToken describe what the implementation returns, and nothing it does not."""
    p = []
    for name, items in (('LayoutEnd', [e for r in results for ends in r['roles'].values()
                                       for e in ends.values()]),
                        ('LayoutToken', [t for r in results for t in r['tokens']])):
        fields, bad = declared(types_text, name)
        p += bad
        if fields is None:
            continue
        seen = set()
        for item in items:
            for k, v in item.items():
                seen.add(k)
                if k not in fields:
                    p.append(f'the implementation returns {k!r} on a {name}, which it does not declare')
                elif not _TYPE_CHECK[fields[k][1]](v):
                    p.append(f'a {name} {k} is {v!r}, and {name} declares {fields[k][1]}')
            p += [f'{name} declares {k} required, and {item} has none'
                  for k, (optional, _) in fields.items() if not optional and k not in item]
        p += [f'{name} declares {k}, which the implementation never returned' for k in fields
              if k not in seen]
    return sorted(set(p), key=p.index)


# ── 3. the gate's own guards ──────────────────────────────────────────────────────────────────────
def _doctor(fn):
    def apply(vocab):
        v = copy.deepcopy(vocab)
        fn(v['layoutRoles'])
        return v
    return apply


SELF_TEST = (
    ('a default at a rung the scale shape does not declare',
     _doctor(lambda L: L['roles'][0]['defaults'].update(min='13')), 'is not a rung of'),
    ('a role missing an end', _doctor(lambda L: L['roles'][1]['defaults'].pop('max')),
     'must name exactly the ends'),
    ('a role declared twice', _doctor(lambda L: L['roles'].append(copy.deepcopy(L['roles'][0]))),
     'each id once'),
    ('a property template without {end}', _doctor(lambda L: L.update(css='--space-{role}')),
     'exactly one {role} and one {end}'),
    ('a role whose property the scale shape owns (role 1, end 5 is --space-1-5)',
     _doctor(lambda L: L.update(ends=['5', 'max']) or L['roles'].append(
         {'id': '1', 'family': 'space', 'what': 'x', 'defaults': {'5': '1', 'max': '2'}})),
     'already emits'),
    ('an invariant of an unknown kind',
     _doctor(lambda L: L['invariants'].append({'id': 'LX', 'kind': 'bogus'})), 'implementation knows'),
    ('an order pair naming an undeclared role',
     _doctor(lambda L: [i.update(pairs=[['section-sm', '<=', 'hero']]) for i in L['invariants']
                        if i['kind'] == 'order']), 'must be [declared role'),
    ('a floor with no minimum',
     _doctor(lambda L: [i.pop('atLeastCssPx') for i in L['invariants'] if i['kind'] == 'floor']),
     'positive atLeastCssPx'),
    ('a role whose family has no rungs', _doctor(lambda L: L['roles'][3].update(family='stagger')),
     'with a property per rung'),
    ('a default at another family\'s rung', _doctor(lambda L: L['roles'][3]['defaults'].update(min='6')),
     'is not a rung of containerPadding'),
)

# One break at a time in a copy of the implementation; the probes must report each.
SELF_TEST_IMPL = (
    ('L2 compares the other way', "const [a, b] = [endPx(role, ends[0]), endPx(role, ends[ends.length - 1])]",
     "const [b, a] = [endPx(role, ends[0]), endPx(role, ends[ends.length - 1])]"),
    ('a rem read as one px', "  if (m[4].toLowerCase() === 'rem') n *= 16n\n", '\n'),
    ('the floor made exclusive', 'if (a && cmp(a, floor) < 0)', 'if (a && cmp(a, floor) <= 0)'),
    ('L2 made strict', "const OPS = { '<=': (c) => c <= 0,", "const OPS = { '<=': (c) => c < 0,"),
    ('an override ignored', 'const rung = given && Object.hasOwn(given, end) ? given[end] : spec.defaults[end]',
     'const rung = spec.defaults[end]'),
    ('an inherited override applied', 'const given = Object.hasOwn(overrides, spec.id) ? overrides[spec.id] : undefined',
     'const given = overrides[spec.id]'),
    ('an unknown rung accepted',
     "else if (typeof rung !== 'string' || !familyOf[role].steps.includes(rung))", "else if (false)"),
    ('an unknown kind skipped', "throw new ContractError(`invariant ${inv.id} is of kind", "void (`${inv.id}"),
    ('a token that is a length, not a reference', "value: `var(${property})`, role", 'value: t?.value, role'),
    ('the gutter read from the space scale', "const found = byRung.get(`${spec.family} ${rung}`)",
     "const found = byRung.get(`space ${rung}`)"),
    ('an unreadable vocabulary read anyway', "if (L === null || typeof L !== 'object' ||", 'if (false &&'),
    ('L1 blind to the property', 'const t = found?.property === property ? found : undefined',
     'const t = found'),
)


SELF_TEST_TYPES = (
    ('a returned field left undeclared', '  px: string\n}', '}'),
    ('a field declared that is never returned', '  end: string\n}', '  end: string\n  width: string\n}'),
    ('a value declared as the wrong type', '  value: string\n  px: string', '  value: number\n  px: string'),
)


def self_test(vocab, shape):
    p = []
    for name, doctor, needle in SELF_TEST:
        found = data_problems(doctor(vocab), shape)
        if not any(needle in f for f in found):
            p.append(f'SELF_TEST {name!r}: the data check did not name it (wanted {needle!r}), '
                     f'it found {found}')
    tmp = tempfile.mkdtemp(prefix='layout-roles-selftest-')
    try:
        os.makedirs(os.path.join(tmp, 'scripts'))
        shutil.copytree(os.path.join(ROOT, 'contract'), os.path.join(tmp, 'contract'))
        for f in ('scale_tokens.mjs', 'layout_roles_cli.mjs'):
            shutil.copy2(os.path.join(HERE, f), os.path.join(tmp, 'scripts'))
        source = open(IMPL, encoding='utf-8').read()
        broken_impl = os.path.join(tmp, 'scripts', 'layout_roles.mjs')
        broken_cli = os.path.join(tmp, 'scripts', 'layout_roles_cli.mjs')
        for name, old, new in SELF_TEST_IMPL:
            if source.count(old) != 1:
                p.append(f'SELF_TEST_IMPL {name!r}: its target occurs {source.count(old)} times in '
                         'layout_roles.mjs, so the break was not made. Update the self-test.')
                continue
            open(broken_impl, 'w', encoding='utf-8').write(source.replace(old, new))
            if not probe_problems(shape, vocab, broken_cli):
                p.append(f'SELF_TEST_IMPL {name!r}: the implementation was broken and every probe '
                         'still passed')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    types = open(TYPES, encoding='utf-8').read()
    for name, old, new in SELF_TEST_TYPES:
        if types.count(old) != 1:
            p.append(f'SELF_TEST_TYPES {name!r}: its target occurs {types.count(old)} times in '
                     'layout_roles.d.mts. Update the self-test.')
        elif not probe_problems(shape, vocab, types=types.replace(old, new)):
            p.append(f'SELF_TEST_TYPES {name!r}: the declarations were broken and nothing noticed')
    return p


def main():
    try:
        vocab = json.load(open(VOCAB_PATH, encoding='utf-8'))
        shape = json.load(open(SHAPE_PATH, encoding='utf-8'))
    except (OSError, ValueError) as e:
        print(f'FAIL: cannot read the contract: {e}')
        return 1
    fails = data_problems(vocab, shape)
    if not fails:
        fails = probe_problems(shape, vocab)
    if not fails:
        fails = self_test(vocab, shape)
    if fails:
        print(f'FAIL: {len(fails)} problem(s) in the layout roles:')
        for f in fails:
            print('   ', f)
        return 1
    L = vocab['layoutRoles']
    print(f'layout roles: {len(L["roles"])} roles x {len(L["ends"])} ends, every default a rung of '
          'its family in contract/scale-shape.json')
    for role, (lo, hi) in DEFAULT_PX.items():
        r = next(r for r in L['roles'] if r['id'] == role)
        print(f'  {role:11} {r["family"]:17} {r["defaults"]["min"]:>4} -> {r["defaults"]["max"]:<4} '
              f'({lo} -> {hi} CSS px on the synthetic probe scale)')
    print(f'  {len(cases(shape)) + 5} probes through scripts/layout_roles.mjs, each invariant '
          f'refused by its own code, and the declarations match the output; {len(SELF_TEST)} data '
          f'guards, {len(SELF_TEST_IMPL)} implementation breaks and {len(SELF_TEST_TYPES)} '
          'declaration breaks caught')
    print('PASS: the layout roles resolve against the scale shape and refuse what they must.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
