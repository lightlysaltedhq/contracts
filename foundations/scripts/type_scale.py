#!/usr/bin/env python3
"""contract/type-scale.json and contract/vocabulary.json#textRoles, implemented in Python.

    from type_scale import load_contract, derive, parse_table, resolve, Refused
    vocab, ts = load_contract()
    derive(ts, ts['namedScales']['balanced'])          # -> {'viewports': ..., 'steps': {...}}
    resolve(vocab, ts, shape, declaration, product)     # -> {'roles': ..., 'tokens': [...]}

A CHECK, NOT A BUILD PATH. The contract's one implementation is scripts/type_tokens.mjs, exported
as ./type-tokens: emit.py runs it, and salt-core imports it. This second implementation exists for
check_type_scale.py alone, which runs both over every named scale and every vector in
contract/type-vectors.json and requires each to reproduce every expected string, byte for byte.
Nothing is built with it, so it can never be a second source of a shipped token (a design-system
ruling of 25/09/2026: two build paths for one rule, kept equal by probes, drifted).

WHY A SECOND ONE AT ALL. A frozen vector that one implementation reproduces describes that
implementation. The proposal this came from measured three traps that each looked right in one
language: `pow` against repeated multiplication, an exact tie that JavaScript's `toFixed` rounds
up, and a U+2212 minus in a step name. Two implementations, written apart, that agree on vectors
built to split them are the evidence that the vectors are right and that the JSON says enough.

EVERY RULE IS READ, AND A RULE THIS CANNOT RUN IS AN ERROR. The operation names, the rounding
mode, the notation and the order of the preferred-value arithmetic are fields in the contract. This
module implements the values the contract has today and raises ContractError on any other, rather
than quietly running its own idea of the rule: a consumer that ignores a changed field is a
consumer that has stopped conforming without noticing.

Invariants are evaluated on EXACT decimals (Python's decimal module), never on floats: a gap of
exactly one pixel passes, and nothing depends on how a float happens to round 0.0625 x 16.
"""
import json
import math
import os
import re
from decimal import Decimal, ROUND_HALF_EVEN, localcontext

HERE = os.path.dirname(os.path.abspath(__file__))
CONTRACT = os.path.join(HERE, '..', 'contract')


class ContractError(Exception):
    """The contract asks for something this implementation does not implement."""


class Refused(Exception):
    """The input breaks the contract. `codes` are contract/type-scale.json's names for why."""

    def __init__(self, codes, detail=''):
        self.codes = sorted(set(codes))
        super().__init__(f'{", ".join(self.codes)}{": " + detail if detail else ""}')


def load_contract():
    vocab = json.load(open(os.path.join(CONTRACT, 'vocabulary.json'), encoding='utf-8'))
    ts = json.load(open(os.path.join(CONTRACT, 'type-scale.json'), encoding='utf-8'))
    return vocab, ts


def dec(x):
    """A JSON number as the decimal it was written as. Decimal(float) would be the binary value."""
    return Decimal(repr(x)) if isinstance(x, float) else Decimal(x)


def is_number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


# ── rounding and notation ─────────────────────────────────────────────────────────────────────
def rounded(x, rule):
    """contract/type-scale.json#derivation.round, applied to the EXACT value of a binary64 result."""
    if rule.get('rounding') != 'halfEven' or rule.get('of') != 'exactBinary64':
        raise ContractError(f'rounding {rule!r} is not one this implementation runs')
    places = rule['decimalPlaces']
    if not isinstance(places, int) or isinstance(places, bool) or places < 0:
        raise ContractError(f'decimalPlaces {places!r} is not a whole number')
    with localcontext() as ctx:
        ctx.prec = 400                    # the exact expansion of any binary64 fits
        return Decimal(x).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_EVEN)


def written(d, notation='plain'):
    """A decimal in the contract's notation: plain, no exponent, no trailing zeros."""
    if notation != 'plain':
        raise ContractError(f'notation {notation!r} is not one this implementation writes')
    s = format(d, 'f')
    if '.' in s:
        s = s.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


# ── derivation ────────────────────────────────────────────────────────────────────────────────
OPS = {'multiply': lambda a, b: a * b, 'divide': lambda a, b: a / b,
       'subtract': lambda a, b: a - b}


def _preferred(rule, env):
    p = rule['preferred']
    if p.get('from') != 'roundedBounds':
        raise ContractError(f'preferred.from {p.get("from")!r} is not one this implementation runs')
    env = dict(env)
    for name, value in p['constants'].items():
        env[name] = float(value)
    for result, op, left, right in p['ops']:
        if op not in OPS:
            raise ContractError(f'preferred op {op!r} is not one this implementation runs')
        env[result] = OPS[op](env[left], env[right])
    return [rounded(env[name], rule['round']) for name in p['round']]


def check_inputs(ts, inputs):
    """`inputs`, then T2. Raises Refused; returns the step numbers in the order given."""
    spec = ts['inputs']
    if not isinstance(inputs, dict):
        raise Refused(['inputs'], 'a scale is an object of inputs')
    for key in spec['numbers']:
        if not is_number(inputs.get(key)):
            raise Refused(['inputs'], f'{key} is missing or is not a finite number')
    for key in spec['integers']:
        if float(inputs[key]) != int(inputs[key]):
            raise Refused(['inputs'], f'{key} is not a whole number')
    for key in spec['lists']:
        v = inputs.get(key)
        if not isinstance(v, list) or not v or not all(isinstance(s, str) for s in v):
            raise Refused(['inputs'], f'{key} is not a list of step names')
    bad = [s for s in inputs['steps'] if not step_name_ok(ts, s)]
    if bad:
        raise Refused(['T2'], f'step name(s) {bad!r}')
    return [int(s) for s in inputs['steps']]


def step_name_ok(ts, name):
    return (isinstance(name, str) and name.isascii()
            and re.fullmatch(ts['steps']['pattern'], name) is not None)


def derive(ts, inputs):
    """A scale's table from its inputs, exactly as contract/type-scale.json#derivation says.

    Returns {'viewports': (Decimal, Decimal), 'steps': {name: entry}}, entry being
    {'kind': 'fluid', 'minRem', 'preferredRem', 'preferredVw', 'maxRem'} or
    {'kind': 'fixed', 'sizeRem'}, every value an exact Decimal. Raises Refused when the inputs or
    the derived table break the contract.
    """
    rule = ts['derivation']
    for field, want in (('arithmetic', 'binary64'), ('repeat', 'stepDistance')):
        if rule.get(field) != want:
            raise ContractError(f'derivation.{field} {rule.get(field)!r} is not one this '
                                'implementation runs')
    if rule['fixed'].get('size') != 'min':
        raise ContractError(f'derivation.fixed.size {rule["fixed"].get("size")!r} is not one this '
                            'implementation runs')
    numbers = check_inputs(ts, inputs)
    fluid_from = int(inputs[rule['fixed']['below']])
    steps = {}
    for name, n in zip(inputs['steps'], numbers):
        side = rule['above'] if n > 0 else rule['below']
        if side['op'] not in ('multiply', 'divide'):
            raise ContractError(f'step op {side["op"]!r} is not one this implementation runs')
        bound = {}
        for end in ('min', 'max'):
            v = float(inputs[rule['base'][end]])
            ratio = float(inputs[side['by'][end]])
            for _ in range(abs(n)):
                v = OPS[side['op']](v, ratio)
            bound[end] = rounded(v, rule['round'])
        if n < fluid_from:
            steps[name] = {'kind': 'fixed', 'sizeRem': bound['min']}
            continue
        env = {k: float(inputs[k]) for k in ts['inputs']['numbers']}
        env['minRem'] = float(written(bound['min']))
        env['maxRem'] = float(written(bound['max']))
        pref_rem, pref_vw = _preferred(rule, env)
        steps[name] = {'kind': 'fluid', 'minRem': bound['min'], 'preferredRem': pref_rem,
                       'preferredVw': pref_vw, 'maxRem': bound['max']}
    # A name given twice is one entry in `steps`, so the duplicate is recorded where T1 can see it.
    table = {'viewports': (dec(inputs['viewportMinPx']), dec(inputs['viewportMaxPx'])),
             'steps': steps, 'repeated': len(set(inputs['steps'])) != len(inputs['steps'])}
    codes = table_failures(ts, table)
    if codes:
        raise Refused(codes)
    return table


# ── a product's own table ─────────────────────────────────────────────────────────────────────
def _strip(ts, s):
    return s.strip(ts['table']['whitespace'])


def _rem(ts, s):
    if not isinstance(s, str):
        return None
    m = re.fullmatch(ts['table']['rem'], _strip(ts, s))
    return Decimal(s.strip(ts['table']['whitespace'])[:-3]) if m else None


def parse_table(ts, families):
    """A table in contract/scale-shape.json's type families, read and checked like a derived one."""
    fams = ts['table']['families']
    fixed = families.get(fams[0]) or {}
    fluid = families.get(fams[1]) or {}
    vps = families.get(fams[2])
    if not isinstance(fixed, dict) or not isinstance(fluid, dict):
        raise Refused(['T3'], 'the fixed and fluid families are objects of step: size')

    def strings(v):
        if isinstance(v, str):
            yield v
        elif isinstance(v, list):
            for x in v:
                yield from strings(x)

    names = list(fixed) + list(fluid)
    values = [s for v in list(fixed.values()) + list(fluid.values()) + [vps] for s in strings(v)]
    if not all(step_name_ok(ts, n) for n in names) or not all(s.isascii() for s in values):
        raise Refused(['T2'])

    viewports = None
    if (isinstance(vps, list) and len(vps) == 2 and all(isinstance(v, str) for v in vps)
            and all(re.fullmatch(ts['table']['viewport'], _strip(ts, v)) for v in vps)):
        viewports = tuple(Decimal(_strip(ts, v)[:-2]) for v in vps)
    steps = {}
    for name in dict.fromkeys(names):
        if name in fixed and name in fluid:
            steps[name] = {'kind': 'both'}
        elif name in fixed:
            size = _rem(ts, fixed[name])
            steps[name] = {'kind': 'fixed', 'sizeRem': size} if size is not None else {'kind': 'unreadable'}
        else:
            rung = fluid[name]
            ok = isinstance(rung, list) and len(rung) == 3 and all(isinstance(v, str) for v in rung)
            lo, hi = (_rem(ts, rung[0]), _rem(ts, rung[2])) if ok else (None, None)
            m = re.fullmatch(ts['table']['preferred'], _strip(ts, rung[1])) if ok else None
            if lo is None or hi is None or m is None:
                steps[name] = {'kind': 'unreadable'}
            else:
                steps[name] = {'kind': 'fluid', 'minRem': lo, 'preferredRem': Decimal(m.group(1)),
                               'preferredVw': Decimal(m.group(3)), 'maxRem': hi}
    table = {'viewports': viewports, 'steps': steps}
    codes = table_failures(ts, table)
    if codes:
        raise Refused(codes)
    return table


# ── T1 to T7 ──────────────────────────────────────────────────────────────────────────────────
def table_failures(ts, table):
    """Every invariant the table breaks, as codes. T2 is checked before a table exists."""
    inv, root = ts['invariants'], dec(ts['units']['rootPx'])
    steps = table['steps']
    codes = set()
    numbers = sorted(int(n) for n in steps)
    if (table.get('repeated') or any(e['kind'] == 'both' for e in steps.values()) or 0 not in numbers
            or len(set(numbers)) != len(numbers)
            or numbers != list(range(numbers[0], numbers[-1] + 1))):
        codes.add('T1')
    vps = table['viewports']
    vps_ok = vps is not None and 0 < vps[0] < vps[1]
    readable = {n: e for n, e in steps.items() if e['kind'] in ('fixed', 'fluid')}
    # Viewports are owed only by a table that has a fluid step: an all-fixed table has nothing to
    # interpolate, and contract/scale-shape.json refuses viewports without a fluid step (#24, M3).
    needs_vps = any(e['kind'] == 'fluid' for e in steps.values())
    if (needs_vps and not vps_ok) or len(readable) != sum(1 for e in steps.values() if e['kind'] != 'both'):
        codes.add('T3')
    for e in readable.values():
        bounds = [e['sizeRem']] if e['kind'] == 'fixed' else [e['minRem'], e['maxRem']]
        if any(b <= 0 for b in bounds):
            codes.add('T3')
    tol = dec(inv['T4']['tolerancePx'])
    for e in readable.values():
        if e['kind'] != 'fluid':
            continue
        lo, hi = e['minRem'], e['maxRem']
        if vps_ok:
            for vp, want in ((vps[0], lo), (vps[1], hi)):
                got = e['preferredRem'] * root + e['preferredVw'] * vp / 100
                if abs(got - want * root) > tol:
                    codes.add('T4')
        if (hi - lo) * root < dec(inv['T6']['minMovePx']):
            codes.add('T6')
        if hi > dec(inv['T7']['maxOverMin']) * lo:
            codes.add('T7')
    if 'T1' not in codes and len(readable) == len(steps):
        order = sorted(readable, key=int)
        for i in (0, 1):
            size = lambda n: (readable[n]['sizeRem'] if readable[n]['kind'] == 'fixed'  # noqa: E731
                              else readable[n]['minRem' if i == 0 else 'maxRem'])
            for below, above in zip(order, order[1:]):
                if (size(above) - size(below)) * root < dec(inv['T5']['minGapPx']):
                    codes.add('T5')
    return sorted(codes)


def size_at_min(entry):
    return entry['sizeRem'] if entry['kind'] == 'fixed' else entry['minRem']


def css_of(ts, entry):
    """The value a consumer writes for `--step-<name>`, per contract/type-scale.json#output."""
    out = ts['output']
    kind = entry['kind']
    text = out['css'][kind]
    for field in out[kind]:
        text = text.replace('{' + field + '}', written(entry[field], ts['derivation']['notation']))
    return text


def expected_strings(ts, table):
    """Each step's written value, as contract/type-vectors.json holds it: {step name: css}."""
    return {name: css_of(ts, table['steps'][name]) for name in sorted(table['steps'], key=int)}


# ── text roles: a product's declaration, resolved ─────────────────────────────────────────────
def colour_names(vocab):
    """Every colour role this vocabulary names, in CSS form (what follows `--color-`)."""
    cr = vocab['colorRoles']
    ids = [r['id'] for r in cr['required']] + list(cr['status']['required'])
    statuses = list(cr['status']['required'])

    def walk(o):
        if isinstance(o, dict):
            if isinstance(o.get('id'), str):
                ids.append(o['id'])
            for k, v in o.items():
                if not k.startswith('$'):
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(cr['extended'])
    out = []
    for i in ids:
        for s in (statuses if i.startswith('<status>') else [None]):
            name = i.replace('<status>', s) if s else i
            out.append(name.replace('.', '-'))
    return sorted(set(out))


def _reason_ok(r):
    return isinstance(r, str) and any(c not in ' \t\n\r\f' for c in r)


def _custom_ok(v):
    return isinstance(v, dict) and v.get('custom') is True and set(
        k for k in v if not k.startswith('$')) <= {'custom', 'reason'}


def _neutral_value(fam, v):
    """A product's value for a rung, as the number rungDefaults would state it, or None."""
    if fam == 'tracking':
        m = re.fullmatch(r'(-?[0-9]+(?:\.[0-9]+)?)em', v) if isinstance(v, str) else None
        return Decimal(m.group(1)) if m else None
    return dec(v) if is_number(v) else None


def resolve(vocab, ts, shape, declaration, product):
    """A product's declaration and scale, resolved to its text roles, or Refused.

    shape      contract/scale-shape.json's document, or anything with the same
               `families.<family>.steps` for the type steps and the leading, tracking and weight
               rungs. Passed in because the scale shape is its own contract file.
    product    {'scale': {family: values}, 'fontRoles': [ids], 'colourRoles': [css names]}
    """
    TR, D = vocab['textRoles'], ts['declaration']
    rdef = ts['rungDefaults']
    fam_key = {fam: key for key, fam in ts['rungFamilies'].items()}
    required = [r['id'] for r in TR['required']]
    optional = [r['id'] for r in TR['optional']]
    defaults = {r['id']: r['defaults'] for r in TR['required'] + TR['optional']}
    scale = product.get('scale') or {}
    type_fams = ts['table']['families']

    # ── stage 1: the declaration itself ──
    codes = []
    if not isinstance(declaration, dict):
        raise Refused(['shape'])
    if any(k not in D['keys'] for k in declaration if not k.startswith('$')):
        codes.append('shape')
    sc = declaration.get('scale')
    form = None
    sk = sorted(k for k in sc if not k.startswith('$')) if isinstance(sc, dict) else None
    if sk == ['named'] and sc['named'] in ts['namedScales']['order']:
        form = 'named'
    elif sk in (['custom'], ['custom', 'reason']) and sc['custom'] is True:
        form = 'custom'
        if not _reason_ok(sc.get('reason')):
            codes.append('reason')
    else:
        codes.append('shape')
    carried = [f for f in type_fams if f in scale]
    if form == 'named' and carried:
        codes.append('table')
    if form == 'custom':
        # A step in both families is T1's to report, at stage 2; this asks only whether the
        # table covers the ladder the scale shape declares, no more and no less.
        names = set(scale.get(type_fams[0]) or {}) | set(scale.get(type_fams[1]) or {})
        if names != set(shape['families'][type_fams[1]]['steps']):
            codes.append('table')
    rungs = declaration.get('rungs', {})
    custom = set()
    if not isinstance(rungs, dict):
        codes.append('shape')
        rungs = {}
    for fam, v in rungs.items():
        if fam.startswith('$'):
            continue
        if fam not in D['rungs']['families'] or not _custom_ok(v):
            codes.append('shape')
            continue
        custom.add(fam)
        if not _reason_ok(v.get('reason')):
            codes.append('reason')
        values = scale.get(fam)
        if fam in D['rungs']['overlays']:
            if not isinstance(values, dict) or not values:
                codes.append('partialFamily')
        elif not isinstance(values, dict) or any(r not in values for r in shape['families'][fam]['steps']):
            codes.append('partialFamily')
    # A family the product carries without declaring it custom must BE the neutral one: every
    # rung rungDefaults names, at exactly its number. Anything else is a custom family nobody
    # declared, and a reason nobody wrote.
    # No rung beyond the neutral ones either: a rung the contract has no number for (leading
    # `mono`, a `weight.heavy`) is a value somebody chose, and an overlay (`weightDark`) has no
    # neutral numbers at all, so carrying one undeclared is refused (#24 review L4).
    for fam, key in fam_key.items():
        if fam in custom or fam not in scale:
            continue
        values = scale[fam]
        if not isinstance(values, dict) or set(values) != set(rdef[key]) or any(
                _neutral_value(fam, values[rung]) != dec(want) for rung, want in rdef[key].items()):
            codes.append('undeclaredCustom')
    for fam in D['rungs']['overlays']:
        if fam not in custom and scale.get(fam):
            codes.append('undeclaredCustom')
    opt = declaration.get('optionalRoles', [])
    if not isinstance(opt, list) or not all(isinstance(o, str) for o in opt):
        codes.append('shape')
        opt = []
    if any(o not in optional for o in opt):
        codes.append('unknownRole')
    if len(set(opt)) != len(opt):
        codes.append('shape')
    overrides = declaration.get('overrides', [])
    fields = sorted(D['overrides']['fields'])
    if not isinstance(overrides, list) or not all(
            isinstance(o, dict) and sorted(k for k in o if not k.startswith('$')) == fields
            for o in overrides):
        codes.append('shape')
    if codes:
        raise Refused(codes)

    # ── stage 2: the table ──
    if form == 'named':
        named = ts['namedScales'][sc['named']]
        table = derive(ts, {k: named[k] for k in ts['inputs']['numbers'] + ts['inputs']['lists']})
    else:
        table = parse_table(ts, {f: scale.get(f) for f in type_fams})

    # ── stage 3: the rung sets ──
    rung_set = {}
    for fam, key in fam_key.items():
        rung_set[fam] = list(shape['families'][fam]['steps']) if fam in custom else list(rdef[key])
    font_ids = [r['id'] for r in vocab['typographyRoles']['required'] + vocab['typographyRoles']['optional']]
    domain = {'steps': list(table['steps']), 'typographyRoles': font_ids, **rung_set}

    # ── stage 4: each override ──
    emitted = required + [o for o in optional if o in opt]
    props = TR['properties']
    structural = [(s['role'], s['property']) for s in TR['structural']]
    seen = []
    for o in overrides:
        key = (o['role'], o['property'])
        if key in seen:
            codes.append('duplicate')
        seen.append(key)
        if o['property'] not in TR['overridable'] or key in structural:
            codes.append('structural')
        elif o['role'] not in emitted:
            codes.append('unknownRole')
        elif not isinstance(o['value'], str):
            codes.append('numeric')
        elif o['value'] not in domain[props[o['property']]['domain']]:
            codes.append('unknownRung')
        elif o['replaces'] != defaults[o['role']][o['property']]:
            codes.append('stale')
        elif o['value'] == o['replaces']:
            codes.append('unchanged')
        elif not _reason_ok(o['reason']):
            codes.append('reason')
    if codes:
        raise Refused(codes)

    # ── stage 5: the roles, and R1 to R6 on them ──
    roles = {r: dict(defaults[r]) for r in emitted}
    changed = set()
    for o in overrides:
        roles[o['role']][o['property']] = o['value']
        changed.add((o['role'], o['property']))
    inv = TR['invariants']
    if roles[inv['R1']['role']][inv['R1']['property']] != inv['R1']['equals']:
        codes.append('R1')
    cmp = {'>': lambda a, b: a > b, '>=': lambda a, b: a >= b,
           '<': lambda a, b: a < b, '<=': lambda a, b: a <= b}
    for code in ('R2', 'R3'):
        if inv[code]['compare'] != 'step':
            raise ContractError(f'{code} compares {inv[code]["compare"]!r}')
        for a, op, b in inv[code]['pairs']:
            if not cmp[op](int(roles[a]['step']), int(roles[b]['step'])):
                codes.append(code)
    floor = dec(ts[inv['R4']['floor']])
    if any(size_at_min(table['steps'][roles[r]['step']]) < floor for r in emitted):
        codes.append('R4')
    fonts = set(product.get('fontRoles') or [])
    resolved = {}
    for r in emitted:
        f, hops = roles[r]['font'], 0
        while f is not None and f not in fonts and hops <= len(TR['fontFallback']):
            f, hops = TR['fontFallback'].get(f), hops + 1
        if f is None or f not in fonts:
            codes.append('R5')
        resolved[r] = f
    colours = set(colour_names(vocab)) | set(product.get('colourRoles') or [])
    if colours & set(emitted):
        codes.append('R6')
    if codes:
        raise Refused(codes)

    # ── stage 6: the tokens ──
    font_css = {r['id']: r['css'] for r in vocab['typographyRoles']['required']
                + vocab['typographyRoles']['optional']}
    tokens = []
    out_roles = {}
    for r in emitted:
        out_roles[r] = {**roles[r], 'font': resolved[r]}
        for prop, spec in props.items():
            if prop.startswith('$'):
                continue
            css = spec['css'].replace('{role}', r)
            if prop == 'font':
                value = f'var({font_css[resolved[r]]})'
            else:
                value = f'var({spec["references"].replace("{value}", roles[r][prop])})'
            tokens.append({'id': 'typography.text.' + css[len('--text-'):].replace('--', '.'),
                           'css': css, 'type': spec['type'], 'value': value,
                           'role': r, 'property': prop, 'overridden': (r, prop) in changed})
    return {'roles': out_roles, 'tokens': tokens, 'table': table}
