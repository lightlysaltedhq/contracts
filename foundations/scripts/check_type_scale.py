#!/usr/bin/env python3
"""The typography contract's gate: vocabulary.json#textRoles, type-scale.json and type-vectors.json.

    python3 scripts/check_type_scale.py     # exit 0 = sound, 1 = a claim is false

FOUR THINGS, EACH FAIL-CLOSED
-----------------------------
1. STRUCTURE. Every name the typography contract uses resolves: each text role's default step is on
   the scale shape's type ladder, each default rung is one the scale shape declares for its family
   AND one rungDefaults gives a number, each `references` template is the custom property the scale
   shape's family emits, each font is a typography role. The defaults themselves pass R1 to R6.
   The scale shape is read from contract/scale-shape.json itself, and every property a role
   token references is checked to be one the scale shape's own implementation, ./scale-tokens
   (scripts/scale_tokens_cli.mjs), actually writes for a scale carrying those rungs.
2. TWO IMPLEMENTATIONS. scripts/type_tokens.mjs, the reference consumer and the one implementation
   anything builds with, and scripts/type_scale.py, kept for this gate alone, each run every vector
   and every named scale. Each must reproduce every expected string exactly. The frozen file is the
   referee; the two agreeing with it independently is the evidence that the JSON says enough.
3. CLAIMS. Every vector's `exercises` is recomputed from first principles here, with code that
   borrows nothing from either implementation: an exact tie is re-derived and its binary expansion
   read, a pow flip is re-derived with a correctly rounded power, a refusal's quantity is
   re-measured. The colour vectors' prose notes were wrong twice before anything read them.
4. COVERAGE. Every refusal code the contract names has a vector that produces it, except R1, which
   no declaration can reach because body's step is structural; that construction is checked instead.

A gate must forbid what it cannot rank. A claim kind this gate does not know fails; it is not
skipped.
"""
import collections
import json
import math
import os
import re
import subprocess
import sys
from decimal import Decimal, ROUND_HALF_EVEN, ROUND_HALF_UP, localcontext
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import type_scale as PY                                                   # noqa: E402

C = lambda n: os.path.join(HERE, '..', 'contract', n)                     # noqa: E731
vocab = json.load(open(C('vocabulary.json'), encoding='utf-8'))
ts = json.load(open(C('type-scale.json'), encoding='utf-8'))
vectors = json.load(open(C('type-vectors.json'), encoding='utf-8'))
# The scale shape, from its own contract file: no copy, no constant.
SCALE_SHAPE = json.load(open(C('scale-shape.json'), encoding='utf-8'))['families']
SCALE_CLI = os.path.join(HERE, 'scale_tokens_cli.mjs')
JS = os.path.join(HERE, 'type_tokens_cli.mjs')
TYPE_FAMS = ts['table']['families']
SHAPE = {'families': SCALE_SHAPE}               # the document's families, as a consumer passes them
LADDER = SHAPE['families'][TYPE_FAMS[1]]['steps']

fails = []


def bad(section, msg):
    fails.append(f'[{section}] {msg}')


def exact(x):
    with localcontext() as ctx:
        ctx.prec = 400
        return Decimal(x)


def r4(x, mode):
    with localcontext() as ctx:
        ctx.prec = 400
        return Decimal(x).quantize(Decimal('0.0001'), rounding=mode)


def plain(d):
    s = format(d, 'f')
    if '.' in s:
        s = s.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def is_tie(d):
    x = d * 10000
    return x - x.to_integral_value(rounding='ROUND_FLOOR') == Decimal('0.5')


# ── an independent reading of a step's written value ──────────────────────────────────────────
CLAMP = re.compile(r'clamp\(([0-9.]+)rem, (-?[0-9.]+)rem \+ (-?[0-9.]+)vw, ([0-9.]+)rem\)')
FIXED = re.compile(r'([0-9.]+)rem')


def read_css(css):
    m = CLAMP.fullmatch(css)
    if m:
        return {'kind': 'fluid', 'min': Decimal(m.group(1)), 'a': Decimal(m.group(2)),
                'b': Decimal(m.group(3)), 'max': Decimal(m.group(4))}
    m = FIXED.fullmatch(css)
    if m:
        return {'kind': 'fixed', 'min': Decimal(m.group(1)), 'max': Decimal(m.group(1))}
    return None


def at(entry, end):
    return entry['min'] if end == 'min' else entry['max']


# ── an independent derivation of one bound: repeated binary64 operations, nothing borrowed ────
def raw_bound(inp, n, end, below=None):
    v = float(inp['baseMinRem' if end == 'min' else 'baseMaxRem'])
    if n > 0:
        r = float(inp['ratioMin' if end == 'min' else 'ratioMax'])
        for _ in range(n):
            v = v * r
    else:
        r = float(inp[below[end]] if below else inp['ratioBelow'])
        for _ in range(-n):
            v = v / r
    return v


def js_math_round_4(v):
    """JavaScript's Math.round(v * 1e4) / 1e4: the integer nearest the binary product, ties up."""
    y = v * 1e4
    k = math.floor(y)
    if y - k >= 0.5:
        k += 1
    return Decimal(k) / Decimal(10000)


# ═════════════════════════════════════════════════════════════════════════════════════════════
# 1. STRUCTURE
# ═════════════════════════════════════════════════════════════════════════════════════════════
def check_structure():
    TR = vocab['textRoles']
    typo = vocab['typographyRoles']
    font_ids = [r['id'] for r in typo['required'] + typo['optional']]
    required_fonts = [r['id'] for r in typo['required']]
    props = [p for p in TR['properties'] if not p.startswith('$')]
    roles = TR['required'] + TR['optional']
    ids = [r['id'] for r in roles]
    if len(ids) != len(set(ids)):
        bad('STRUCTURE', f'text role ids repeat: {ids}')
    if props != TR['overridable']:
        bad('STRUCTURE', f'properties {props} and overridable {TR["overridable"]} must be the same '
                         'list in the same order: a property that cannot be overridden is structural '
                         'and belongs in `structural`, not in a second list.')
    fam_of = {fam: key for key, fam in ts['rungFamilies'].items()}
    for fam in fam_of:
        if fam not in SCALE_SHAPE:
            bad('STRUCTURE', f'rungFamilies names {fam!r}, which the scale shape does not declare')
    for key, fam in ts['rungFamilies'].items():
        for rung in ts['rungDefaults'].get(key, {}):
            if fam in SCALE_SHAPE and rung not in SCALE_SHAPE[fam]['steps']:
                bad('STRUCTURE', f'rungDefaults.{key}.{rung} is not a rung the scale shape declares '
                                 f'for {fam!r}')
    # Each property's reference is the custom property the scale shape's family emits.
    for prop, spec in TR['properties'].items():
        if prop.startswith('$') or prop == 'font':
            continue
        fam = TYPE_FAMS[1] if spec['domain'] == 'steps' else spec['domain']
        want = SCALE_SHAPE[fam]['css'].replace('{k}', '{value}') if fam in SCALE_SHAPE else None
        if spec['references'] != want:
            bad('STRUCTURE', f'textRoles.properties.{prop}.references is {spec["references"]!r}; the '
                             f'scale shape\'s {fam!r} emits {want!r}. A role token pointing at a '
                             'property nothing emits is a dangling var().')
        if spec['domain'] != 'steps' and spec['domain'] not in fam_of:
            bad('STRUCTURE', f'{prop} draws from {spec["domain"]!r}, which has no rungDefaults')
    for r in roles:
        d = r.get('defaults', {})
        if sorted(d) != sorted(props):
            bad('STRUCTURE', f'{r["id"]} defaults {sorted(d)}; every role sets exactly {props}')
            continue
        if d['step'] not in LADDER:
            bad('STRUCTURE', f'{r["id"]} step {d["step"]!r} is not on the scale shape\'s type ladder')
        for prop in ('leading', 'tracking', 'weight'):
            key = fam_of[prop]
            if d[prop] not in ts['rungDefaults'][key]:
                bad('STRUCTURE', f'{r["id"]} {prop} {d[prop]!r} has no neutral number in '
                                 f'rungDefaults.{key}, so a product on the neutral rungs cannot '
                                 'emit its default')
        if d['font'] not in font_ids:
            bad('STRUCTURE', f'{r["id"]} font {d["font"]!r} is not a typography role')
    for k, v in TR['fontFallback'].items():
        chain, seen = k, set()
        while chain not in required_fonts:
            if chain in seen or chain not in TR['fontFallback']:
                bad('STRUCTURE', f'the font fallback from {k!r} never reaches a required typography '
                                 'role')
                break
            seen.add(chain)
            chain = TR['fontFallback'][chain]
    for s in TR['structural']:
        if s['role'] not in ids or s['property'] not in props:
            bad('STRUCTURE', f'structural entry {s} names no real role and property')
    inv = TR['invariants']
    if (inv['R1']['role'], inv['R1']['property']) not in [(s['role'], s['property'])
                                                          for s in TR['structural']]:
        bad('STRUCTURE', 'R1 fixes body\'s step, so body\'s step must be structural, or an override '
                         'could move it')
    for code in ('R2', 'R3'):
        for a, op, b in inv[code]['pairs']:
            if a not in ids or b not in ids or op not in ('>', '>=', '<', '<='):
                bad('STRUCTURE', f'{code} pair {[a, op, b]} does not read')
    for el, role in TR['elementConvention'].items():
        if not re.fullmatch(r'h[1-6]|p', el) or role not in [r['id'] for r in TR['required']]:
            bad('STRUCTURE', f'elementConvention {el!r} -> {role!r}: an HTML heading or p, to a '
                             'required role')
    # Every property a role token points at is one ./scale-tokens writes: a named scale's table
    # and the neutral rungs, turned into tokens by the scale shape's own implementation, must
    # declare every --step-*, --leading-*, --tracking-* and --weight-* the default roles use.
    fams, crash = run_js([{'stepFamilies': {k: ts['namedScales']['balanced'][k] for k in
                                            ts['inputs']['numbers'] + ts['inputs']['lists']}},
                          {'neutralRungFamilies': True}])
    if crash:
        bad('STRUCTURE', f'type_tokens did not run: {crash}')
    else:
        scale = {**fams[0]['families'], **fams[1]['families']}
        p = subprocess.run(['node', SCALE_CLI], input=json.dumps([scale]), capture_output=True,
                           text=True)
        written = json.loads(p.stdout)[0] if p.returncode == 0 else {'refused': p.stderr[-200:]}
        if 'tokens' not in written:
            bad('STRUCTURE', f'./scale-tokens refuses a named scale with the neutral rungs: '
                             f'{written.get("refused")}')
        else:
            props = {t['property'] for t in written['tokens']}
            resolved, crash = run_js([{'resolve': {'scale': {'named': 'balanced'}}, 'shape': SHAPE,
                                       'product': {'scale': fams[1]['families'],
                                                   'fontRoles': ['heading', 'body']}}])
            refs = set()
            for t in (resolved or [{}])[0].get('tokens', []):
                refs.update(re.findall(r'var\((--[\w-]+)\)', t['value']))
            dangling = sorted(r for r in refs - props if not r.startswith('--font-'))
            if crash or not refs or dangling:
                bad('STRUCTURE', f'role tokens reference {dangling or "nothing"}, which ./scale-tokens '
                                 'does not write for a named scale and the neutral rungs')
    colours = PY.colour_names(vocab)
    clash = sorted(set(ids) & set(colours))
    if clash:
        bad('STRUCTURE', f'R6: text role(s) {clash} share a name with a colour role')
    n_req, n_opt = len(TR['required']), len(TR['optional'])
    print(f'  structure   {n_req} required and {n_opt} optional text roles; every default step, rung '
          f'and font resolves against the scale shape, rungDefaults and typographyRoles; no role name '
          f'is one of {len(colours)} colour roles')
    return len(ids)


def check_named_invariants():
    ns = ts['namedScales']
    order = ns['order']
    inputs = ts['inputs']['numbers'] + ts['inputs']['lists']
    shares = ns['invariants']['N1']['shares']
    for n in order:
        missing = [k for k in inputs if k not in ns[n]]
        if missing:
            bad('N1', f'{n} does not repeat {missing}; each named scale carries every input')
    for k in shares:
        vals = {json.dumps(ns[n].get(k)) for n in order}
        if len(vals) != 1:
            bad('N1', f'the named scales disagree on {k}: {sorted(vals)}')
    for n in order:
        if ns[n]['steps'] != LADDER:
            bad('N3', f'{n} steps are not the scale shape\'s type steps {LADDER}')
        if ns[n]['fluidFrom'] != int(LADDER[0]):
            bad('N3', f'{n} fixes steps below {ns[n]["fluidFrom"]}; every named step is fluid')
    exp = {n: vectors['namedScales'][n]['expect']['steps'] for n in order}
    for prev, cur in zip(order, order[1:]):
        for step in ns['invariants']['N2']['aheadAt']:
            a, b = read_css(exp[prev][step]), read_css(exp[cur][step])
            if not (a and b and b['min'] > a['min'] and b['max'] > a['max']):
                bad('N2', f'{cur} is not strictly ahead of {prev} at step {step} at both viewports')
    print(f'  named       {", ".join(order)}: N1 shared inputs, N2 each strictly ahead of the last '
          f'at steps {ns["invariants"]["N2"]["aheadAt"][0]} to {ns["invariants"]["N2"]["aheadAt"][-1]}, '
          'N3 fluid on the scale shape\'s ladder')


# ═════════════════════════════════════════════════════════════════════════════════════════════
# 2. TWO IMPLEMENTATIONS
# ═════════════════════════════════════════════════════════════════════════════════════════════
def jobs():
    """(label, job, expected) for every vector and named scale, in file order."""
    out = []
    for v in vectors['derivations']:
        out.append((f'derivation {v["id"]}', {'derive': v['inputs']}, v['expect']))
    for v in vectors['tables']:
        out.append((f'table {v["id"]}', {'table': v['table']}, v['expect']))
    for v in vectors['refusals']:
        for x in v.get('variants', [v]):
            key = 'table' if 'table' in x else 'derive'
            out.append((f'refusal {x["id"]}', {key: x['table' if key == 'table' else 'inputs']},
                        x['expect']))
    for v in vectors['overrides']:
        out.append((f'override {v["id"]}', {'resolve': v['declaration'], 'shape': SHAPE,
                                              'product': v['product']}, v['expect']))
    for n in ts['namedScales']['order']:
        sc = ts['namedScales'][n]
        inp = {k: sc[k] for k in ts['inputs']['numbers'] + ts['inputs']['lists']}
        out.append((f'named {n}', {'derive': inp}, vectors['namedScales'][n]['expect']))
    return out


def run_python(job):
    try:
        if 'derive' in job:
            return {'steps': PY.expected_strings(ts, PY.derive(ts, job['derive']))}
        if 'table' in job:
            return {'steps': PY.expected_strings(ts, PY.parse_table(ts, job['table']))}
        r = PY.resolve(vocab, ts, job['shape'], job['resolve'], job['product'])
        return {'roles': r['roles'], 'tokens': {t['css']: t['value'] for t in r['tokens']}}
    except PY.Refused as e:
        return {'refused': e.codes}


def run_js(batch):
    p = subprocess.run(['node', JS], input=json.dumps(batch), capture_output=True, text=True)
    if p.returncode != 0:
        lines = p.stderr.strip().splitlines() or ['no output']
        return None, next((l.strip() for l in lines if 'Error' in l), lines[-1])
    return json.loads(p.stdout), None


def same(a, b):
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def check_implementations():
    js_batch = jobs()
    got_js, crash = run_js([j for _, j, _ in js_batch])
    if crash:
        bad('JS', f'type_tokens.mjs did not run: {crash}')
        return
    for out in got_js:
        if isinstance(out.get('tokens'), list):
            out['tokens'] = {t['css']: t['value'] for t in out['tokens']}
    n_strings = 0
    for (label, job, want), js in zip(js_batch, got_js):
        py = run_python(job)
        for name, got in (('type_tokens.mjs', js), ('type_scale.py', py)):
            if not same(got, want):
                bad('VECTORS', f'{label}: {name} gives {json.dumps(got)[:300]}, the vector expects '
                               f'{json.dumps(want)[:300]}')
        n_strings += len(want.get('steps', {})) + len(want.get('tokens', {})) + len(want.get('refused', []))
    # The two helpers a consumer writes its scale tokens with, round-tripped against the vectors.
    named = [{k: ts['namedScales'][n][k] for k in ts['inputs']['numbers'] + ts['inputs']['lists']}
             for n in ts['namedScales']['order']]
    fam, crash = run_js([{'stepFamilies': x} for x in named] + [{'neutralRungFamilies': True}])
    if crash:
        bad('JS', f'type_tokens.mjs did not run: {crash}')
        return
    for n, f in zip(ts['namedScales']['order'], fam):
        back = PY.expected_strings(ts, PY.parse_table(ts, f['families']))
        if back != vectors['namedScales'][n]['expect']['steps']:
            bad('VECTORS', f'stepFamilies({n}) does not read back as {n}\'s own table')
    want = {'leading': ts['rungDefaults']['leading'],
            'tracking': {k: f'{plain(Decimal(repr(v)) if isinstance(v, float) else Decimal(v))}em'
                         for k, v in ts['rungDefaults']['trackingEm'].items()},
            'weight': ts['rungDefaults']['weight']}
    if not same(fam[-1]['families'], want):
        bad('VECTORS', f'neutralRungFamilies gives {fam[-1]["families"]}, not the neutral rungs {want}')
    print(f'  vectors     {len(js_batch)} jobs ({n_strings} expected strings, codes and tokens): '
          'type_tokens.mjs and type_scale.py each reproduce every one; stepFamilies and '
          'neutralRungFamilies read back exactly')


# ═════════════════════════════════════════════════════════════════════════════════════════════
# 3. CLAIMS, recomputed
# ═════════════════════════════════════════════════════════════════════════════════════════════
def by_id(section):
    out = {}
    for v in vectors[section]:
        for x in v.get('variants', [v]):
            out[x['id']] = x
    return out


def claim_fail(vid, msg):
    bad('CLAIMS', f'{vid}: {msg}')


def steps_of(v):
    return {k: read_css(c) for k, c in v['expect'].get('steps', {}).items()}


def check_derivation_claims(v):
    ex, inp, st = v['exercises'], v['inputs'], steps_of(v)
    for kind, c in ex.items():
        if kind == 'exactTie':
            x = raw_bound(inp, int(c['step']), c['bound'])
            e = exact(x)
            ok = (str(e) == c['binary64'] and is_tie(e)
                  and plain(r4(x, ROUND_HALF_EVEN)) == c['halfEven'] != c['halfAwayFromZero']
                  == plain(r4(x, ROUND_HALF_UP))
                  and plain(at(st[c['step']], c['bound'])) == c['halfEven'])
            if not ok:
                claim_fail(v['id'], f'exactTie {c} does not recompute (binary64 {e})')
        elif kind == 'binaryNearTie':
            n = int(c['step'])
            x = raw_bound(inp, n, c['bound'])
            base = Decimal(repr(float(inp['baseMinRem' if c['bound'] == 'min' else 'baseMaxRem'])))
            ratio = Decimal(repr(float(inp['ratioMin' if c['bound'] == 'min' else 'ratioMax'])))
            d = base * ratio ** n
            side = 'below' if exact(x) < d else 'above'
            ok = (str(d) == c['decimal'] and is_tie(d) and not is_tie(exact(x))
                  and side == c['binary64']
                  and plain(r4(x, ROUND_HALF_EVEN)) == c['halfEven']
                  and plain(d.quantize(Decimal('0.0001'), rounding=ROUND_HALF_EVEN))
                  == c['exactDecimalHalfEven'] != c['halfEven']
                  and plain(js_math_round_4(x)) == c['mathRound'] != c['halfEven']
                  and plain(at(st[c['step']], c['bound'])) == c['halfEven'])
            if not ok:
                claim_fail(v['id'], f'binaryNearTie {c} does not recompute (decimal {d}, binary64 '
                                    f'{exact(x)})')
        elif kind == 'powFlip':
            n = int(c['step'])
            x = raw_bound(inp, n, c['bound'])
            base = float(inp['baseMinRem' if c['bound'] == 'min' else 'baseMaxRem'])
            ratio = float(inp['ratioMin' if c['bound'] == 'min' else 'ratioMax'])
            pw = base * float(Fraction(ratio) ** n)              # a correctly rounded power
            ok = (plain(r4(x, ROUND_HALF_EVEN)) == c['repeated'] != c['pow']
                  == plain(r4(pw, ROUND_HALF_EVEN))
                  and plain(at(st[c['step']], c['bound'])) == c['repeated'])
            if not ok:
                claim_fail(v['id'], f'powFlip {c} does not recompute')
        elif kind == 'viewports':
            named = {(ts['namedScales'][n]['viewportMinPx'], ts['namedScales'][n]['viewportMaxPx'])
                     for n in ts['namedScales']['order']}
            got = (inp['viewportMinPx'], inp['viewportMaxPx'])
            if got != (c['minPx'], c['maxPx']) or got in named:
                claim_fail(v['id'], f'viewports {c}: the inputs say {got}, and the claim is that '
                                    'they are not a named scale\'s')
        elif kind == 'moveExactly1Px':
            e = st.get(c)
            if not e or e['kind'] != 'fluid' or (e['max'] - e['min']) * 16 != 1:
                claim_fail(v['id'], f'step {c} does not move exactly 1px')
        elif kind == 'fixed':
            got = [k for k, e in sorted(st.items(), key=lambda kv: int(kv[0])) if e['kind'] == 'fixed']
            below = [s for s in inp['steps'] if int(s) < inp['fluidFrom']]
            if got != c or below != c:
                claim_fail(v['id'], f'fixed {c}: the expectation fixes {got}, fluidFrom fixes {below}')
        elif kind == 'maxOverMin':
            ratios = {k: e['max'] / e['min'] for k, e in st.items() if e['kind'] == 'fluid'}
            top = max(ratios, key=lambda k: ratios[k])
            if not (top == c['step'] and Decimal(c['atLeast']) <= ratios[top] < Decimal(c['below'])
                    <= Decimal(repr(ts['invariants']['T7']['maxOverMin']))):
                claim_fail(v['id'], f'maxOverMin {c}: the largest is {ratios[top]} at step {top}')
        else:
            claim_fail(v['id'], f'claim kind {kind!r} is not one this gate recomputes, so it is not '
                                'a claim anyone checks')


def check_table_claims(v):
    st = steps_of(v)
    for kind, c in v['exercises'].items():
        if kind == 'gapExactly1Px':
            for g in c:
                if (at(st[g['above']], g['at']) - at(st[g['below']], g['at'])) * 16 != 1:
                    claim_fail(v['id'], f'gap {g} is not exactly 1px')
        elif kind == 'moveExactly1Px':
            for s in c:
                if (st[s]['max'] - st[s]['min']) * 16 != 1:
                    claim_fail(v['id'], f'step {s} does not move exactly 1px')
        elif kind == 'maxOverMinExactly':
            e = st[c['step']]
            if e['max'] / e['min'] != Decimal(c['ratio']) or Decimal(c['ratio']) != Decimal(
                    repr(ts['invariants']['T7']['maxOverMin'])):
                claim_fail(v['id'], f'{c}: step {c["step"]} is {e["max"] / e["min"]}, not T7\'s limit')
        elif kind == 'writesPlain':
            val = plain(at(st[c['step']], 'min'))
            if not (val.isdigit() and len(val) == c['digits'] and 'e' in str(float(val))):
                claim_fail(v['id'], f'{c}: {val} is not a {c["digits"]}-digit value that a float '
                                    'writes in exponent form')
        elif kind == 'writesTen':
            val = plain(at(st[c['step']], 'max' if c['field'] == 'maxRem' else 'min'))
            normalized = str(Decimal(val).quantize(Decimal('0.0001')).normalize())
            if val != '10' or 'E' not in normalized:
                claim_fail(v['id'], f'{c}: the value is {val}, and normalize() writes {normalized}')
        else:
            claim_fail(v['id'], f'claim kind {kind!r} is not one this gate recomputes')


def mini_table(inp):
    """An independent derivation, for re-measuring a refused scale nothing else will write out."""
    out = {}
    for s in inp['steps']:
        n = int(s)
        lo = r4(raw_bound(inp, n, 'min'), ROUND_HALF_EVEN)
        hi = r4(raw_bound(inp, n, 'max'), ROUND_HALF_EVEN)
        out[s] = {'kind': 'fixed' if n < inp['fluidFrom'] else 'fluid', 'min': lo,
                  'max': lo if n < inp['fluidFrom'] else hi}
    return out


def check_refusal_claims(v, derivations, tables):
    ex = v['exercises']
    want = v['expect'].get('refused')
    if not want or len(want) != 1:
        claim_fail(v['id'], f'a refusal vector breaks exactly one rule; it expects {want}')
    if 'otherwise' in ex:
        base = derivations.get(ex['otherwise']) or tables.get(ex['otherwise'])
        if not base or 'refused' in base['expect']:
            claim_fail(v['id'], f'otherwise names {ex["otherwise"]!r}, which is not a valid vector')
            return
        if 'inputs' in v:
            a, b = dict(base['inputs']), dict(v['inputs'])
            if 'missing' in ex:
                a.pop(ex['missing'], None)
                if ex['missing'] in v['inputs'] or a != b:
                    claim_fail(v['id'], f'is not {ex["otherwise"]} without {ex["missing"]}')
            elif 'respelt' in ex:
                i, cp = ex['respelt']['index'], ex['respelt']['codePoint']
                ch = chr(int(cp[2:], 16))
                a['steps'] = list(a['steps'])
                a['steps'][i] = a['steps'][i].replace('-', ch)
                if a != b or ch.isascii():
                    claim_fail(v['id'], f'is not {ex["otherwise"]} with step {i} respelt in {cp}')
            else:
                claim_fail(v['id'], 'a non-derivable vector says how it differs from the one it copies')
        else:
            a, b = json.loads(json.dumps(base['table'])), v['table']
            if 'alsoFixed' in ex:
                s = ex['alsoFixed']
                extra = b[TYPE_FAMS[0]].get(s)
                a[TYPE_FAMS[0]][s] = extra
                if extra is None or a != b or s not in a[TYPE_FAMS[1]]:
                    claim_fail(v['id'], f'is not {ex["otherwise"]} with step {s} also fixed')
            elif 'respelt' in ex:
                s, slot, was = ex['respelt']['step'], ex['respelt']['slot'], ex['respelt']['was']
                now = b[TYPE_FAMS[1]][s][slot]
                a[TYPE_FAMS[1]][s][slot] = now
                if a != b or base['table'][TYPE_FAMS[1]][s][slot] != was or re.fullmatch(
                        ts['table']['rem'], now):
                    claim_fail(v['id'], f'is not {ex["otherwise"]} with one bound respelt out of rem')
            elif 'shifted' in ex:
                s, by = ex['shifted']['step'], Decimal(ex['shifted']['preferredRemBy'])
                pa, pb = a[TYPE_FAMS[1]][s][1].split('rem + ')
                a[TYPE_FAMS[1]][s][1] = f'{plain(Decimal(pa) + by)}rem + {pb}'
                if a != b or by * 16 <= Decimal(repr(ts['invariants']['T4']['tolerancePx'])):
                    claim_fail(v['id'], f'is not {ex["otherwise"]} with step {s}\'s preferred value '
                                        'moved past T4\'s tolerance')
            else:
                claim_fail(v['id'], 'a table variant says how it differs from the one it copies')
        return
    st = mini_table(v['inputs'])
    for kind, c in ex.items():
        if kind == 'maxOverMin':
            e = st[c['step']]
            if not e['max'] > Decimal(c['above']) * e['min'] or want != ['T7']:
                claim_fail(v['id'], f'{c}: step {c["step"]} is {e["max"] / e["min"]}')
        elif kind == 'smallestGap':
            end = c['at']
            order = sorted(st, key=int)
            gaps = {(a, b): (at(st[b], end) - at(st[a], end)) * 16 for a, b in zip(order, order[1:])}
            g = gaps[(c['below'], c['above'])]
            if not (0 < g < 1 and g == min(gaps.values())) or want != ['T5']:
                claim_fail(v['id'], f'{c}: that gap is {g}px, the smallest {min(gaps.values())}px')
        elif kind == 'smallestMoveUnder1Px':
            moves = {k: (e['max'] - e['min']) * 16 for k, e in st.items() if e['kind'] == 'fluid'}
            m = moves[c['step']]
            if not (0 < m < 1 and m == min(moves.values())) or want != ['T6']:
                claim_fail(v['id'], f'{c}: step {c["step"]} moves {m}px')
        elif kind == 'notInverted':
            if any(e['max'] < e['min'] for e in st.values()) is c:
                claim_fail(v['id'], 'a step is inverted')
        elif kind == 'inverted':
            e = st[c['step']]
            if not e['max'] < e['min'] or want != ['T6']:
                claim_fail(v['id'], f'{c}: step {c["step"]} is not inverted')
        elif kind in ('flat', 'gapPx', 'below', 'above'):
            if kind != 'flat':
                continue
            g = [(at(st[ex['above']], end) - at(st[ex['below']], end)) * 16 for end in ('min', 'max')]
            if v['inputs'][c] != 1 or g != [Decimal(ex['gapPx'])] * 2 or want != ['T5']:
                claim_fail(v['id'], f'flat {c}: gaps {g}')
        else:
            claim_fail(v['id'], f'claim kind {kind!r} is not one this gate recomputes')


def check_override_claims(v, named_steps):
    ex, decl, prod, exp = v['exercises'], v['declaration'], v['product'], v['expect']
    TR = vocab['textRoles']
    defaults = {r['id']: r['defaults'] for r in TR['required'] + TR['optional']}
    want = exp.get('refused')
    ovs = decl.get('overrides', [])
    for kind, c in ex.items():
        if kind == 'valid':
            if 'roles' not in exp:
                claim_fail(v['id'], 'claims valid and expects a refusal')
        elif kind == 'carriesNeutralRungs':
            sc = prod['scale']
            ok = (sc.get('leading') == ts['rungDefaults']['leading']
                  and sc.get('weight') == ts['rungDefaults']['weight']
                  and {k: Decimal(t[:-2]) for k, t in sc.get('tracking', {}).items()}
                  == {k: Decimal(repr(x)) if isinstance(x, float) else Decimal(x)
                      for k, x in ts['rungDefaults']['trackingEm'].items()})
            if not ok:
                claim_fail(v['id'], 'the product\'s rungs are not exactly the neutral ones')
        elif kind == 'fallsBack':
            for role, face in c.items():
                if defaults[role]['font'] in prod['fontRoles'] or exp['roles'][role]['font'] != face:
                    claim_fail(v['id'], f'{role} does not fall back to {face}')
        elif kind == 'custom':
            got = (['scale'] if decl['scale'].get('custom') else []) + sorted(decl.get('rungs', {}))
            if got != c:
                claim_fail(v['id'], f'custom {c}: the declaration makes {got} custom')
        elif kind == 'override':
            o = ovs[c]
            code = want[0] if want else None
            checks = {
                'stale': lambda: o['replaces'] != defaults[o['role']][o['property']],
                'numeric': lambda: not isinstance(o['value'], str),
                'unchanged': lambda: o['value'] == o['replaces'] == defaults[o['role']][o['property']],
                'structural': lambda: {'role': o['role'], 'property': o['property']} in [
                    {'role': s['role'], 'property': s['property']} for s in TR['structural']],
                'unknownRung': lambda: o['value'] in SCALE_SHAPE[o['property']]['steps']
                    and o['value'] not in ts['rungDefaults'][{f: k for k, f in ts['rungFamilies'].items()}[o['property']]],
                'reason': lambda: isinstance(o['reason'], str) and not o['reason'].strip(' \t\n\r\f'),
                'duplicate': lambda: any((p['role'], p['property']) == (o['role'], o['property'])
                                         for p in ovs[:c]),
                'unknownRole': lambda: o['role'] in [r['id'] for r in TR['optional']]
                    and o['role'] not in decl.get('optionalRoles', []),
            }
            if code not in checks or not checks[code]():
                claim_fail(v['id'], f'override {c} does not break {code} as claimed')
        elif kind in ('declaredByShapeNotNeutral', 'notEmitted'):
            continue                                   # read with `override` above
        elif kind == 'family':
            fam = c
            spec = SCALE_SHAPE[fam]
            fams = spec.get('steps') or SCALE_SHAPE[spec['stepsFrom']]['steps']
            if want == ['partialFamily']:
                missing = [r for r in fams if r not in prod['scale'].get(fam, {})]
                if missing != ex['missing'] or fam not in decl.get('rungs', {}):
                    claim_fail(v['id'], f'{fam} is missing {missing}, not {ex["missing"]}')
            elif want == ['undeclaredCustom']:
                key = {f: k for k, f in ts['rungFamilies'].items()}.get(fam)
                neutral = ts['rungDefaults'].get(key, {}) if key else {}
                extra = [r for r in prod['scale'].get(fam, {}) if r not in neutral]
                if fam in decl.get('rungs', {}) or prod['scale'].get(fam) == neutral or (
                        'withoutNeutral' in ex and extra != ex['withoutNeutral']):
                    claim_fail(v['id'], f'{fam} is declared, is the neutral family, or its rungs '
                                        f'without a neutral number are {extra}')
            else:
                claim_fail(v['id'], f'family claim on a vector expecting {want}')
        elif kind in ('missing', 'withoutNeutral'):
            continue
        elif kind == 'carries':
            if [f for f in TYPE_FAMS if f in prod['scale']] != c or 'named' not in decl['scale']:
                claim_fail(v['id'], f'the product carries {list(prod["scale"])}')
        elif kind == 'repeats':
            opt = decl.get('optionalRoles', [])
            if opt.count(c) < 2 or want != ['shape']:
                claim_fail(v['id'], f'{c} is not listed twice in optionalRoles')
        elif kind == 'named':
            if decl['scale'].get('named') != c or c in ts['namedScales']['order']:
                claim_fail(v['id'], f'{c} is a named scale')
        elif kind == 'pair':
            a, op, b = c
            steps = {r: int(defaults[r]['step']) for r in defaults}
            for o in ovs:
                if o['property'] == 'step':
                    steps[o['role']] = int(o['value'])
            holds = {'>': steps[a] > steps[b], '>=': steps[a] >= steps[b],
                     '<': steps[a] < steps[b], '<=': steps[a] <= steps[b]}[op]
            rule = 'R2' if c in TR['invariants']['R2']['pairs'] else 'R3'
            if holds or c not in TR['invariants'][rule]['pairs'] or want != [rule]:
                claim_fail(v['id'], f'pair {c} holds, or is not {want}\'s')
        elif kind == 'boundary':
            a, op, b = c
            steps = {r: int(defaults[r]['step']) for r in defaults}
            for o in ovs:
                if o['property'] == 'step':
                    steps[o['role']] = int(o['value'])
            rule = 'R2' if c in TR['invariants']['R2']['pairs'] else 'R3'
            strict = op in ('>', '<')
            if (c not in TR['invariants'][rule]['pairs'] or steps[a] != steps[b]
                    or (want == [rule]) != strict or (not strict and 'roles' not in exp)):
                claim_fail(v['id'], f'boundary {c}: {a} at {steps[a]}, {b} at {steps[b]}, expecting {want}')
        elif kind == 'role':
            step = next((o['value'] for o in ovs if o['role'] == c and o['property'] == 'step'),
                        defaults[c]['step'])
            e = read_css(named_steps[decl['scale']['named']][step])
            if not e['min'] < Decimal(repr(ts['roleFloorRem'])) or want != ['R4']:
                claim_fail(v['id'], f'{c} at step {step} is {e["min"]}rem at the narrow viewport')
        elif kind == 'unresolved':
            if c in prod['fontRoles'] or want != ['R5']:
                claim_fail(v['id'], f'{c} is emitted')
        elif kind == 'collides':
            if c not in prod['colourRoles'] or c not in defaults or want != ['R6']:
                claim_fail(v['id'], f'{c} is not both a product colour role and a text role')
        else:
            claim_fail(v['id'], f'claim kind {kind!r} is not one this gate recomputes')


def check_named_claims():
    ns = ts['namedScales']
    for n in ns['order']:
        sc, v = ns[n], vectors['namedScales'][n]
        st = steps_of(v)
        c = v['exercises']
        order = sorted(st, key=int)
        gaps = [(at(st[b], e) - at(st[a], e)) * 16 for a, b in zip(order, order[1:]) for e in ('min', 'max')]
        moves = [(st[k]['max'] - st[k]['min']) * 16 for k in order]
        ratios = {k: st[k]['max'] / st[k]['min'] for k in order}
        top = max(ratios, key=lambda k: ratios[k])
        errs = [abs(st[k]['a'] * 16 + st[k]['b'] * Decimal(vp) / 100 - at(st[k], e) * 16)
                for k in order for vp, e in ((sc['viewportMinPx'], 'min'), (sc['viewportMaxPx'], 'max'))]
        ties = [{'step': k, 'bound': e, 'binary64': str(exact(raw_bound(sc, int(k), e)))}
                for k in order for e in ('min', 'max') if is_tie(exact(raw_bound(sc, int(k), e)))]
        differs, inverts = [], []
        for k in order:
            if int(k) >= 0:
                continue
            lo = r4(raw_bound(sc, int(k), 'min', below={'min': 'ratioMin'}), ROUND_HALF_EVEN)
            hi = r4(raw_bound(sc, int(k), 'max', below={'max': 'ratioMax'}), ROUND_HALF_EVEN)
            if (lo, hi) != (st[k]['min'], st[k]['max']):
                differs.append(k)
            if hi < lo:
                inverts.append(k)
        got = collections.OrderedDict([
            ('minGapPx', plain(min(gaps))), ('minMovePx', plain(min(moves))),
            ('largestMaxOverMin', {'step': top, 'atLeast': c['largestMaxOverMin']['atLeast'],
                                   'below': c['largestMaxOverMin']['below']}),
            ('worstPreferredErrorPx', plain(max(errs))), ('exactTies', ties),
            ('utopiaBelow', {'differsAt': differs, 'invertsAt': inverts})])
        lm = c['largestMaxOverMin']
        if not same(got, c) or not Decimal(lm['atLeast']) <= ratios[top] < Decimal(lm['below']):
            claim_fail(f'named {n}', f'claims {json.dumps(c)}, recomputes {json.dumps(got)}')
        if min(gaps) < ts['invariants']['T5']['minGapPx'] or not differs:
            claim_fail(f'named {n}', 'fails T5, or Utopia\'s two ratios would reproduce it')


# Every kind of claim the vectors must carry at least once. A vector can be deleted, or its
# `exercises` emptied, and every other check still passes: the one vector that tells a binary64
# rule from a decimal one went that way unnoticed until review (#24, M2). So the kinds are counted.
REQUIRED_KINDS = ('exactTie', 'binaryNearTie', 'powFlip', 'writesPlain', 'writesTen', 'maxOverMin',
                  'moveExactly1Px', 'viewports')


def check_claim_presence():
    seen = set()
    for section in ('derivations', 'tables', 'refusals', 'overrides'):
        for v in vectors[section]:
            for x in v.get('variants', [v]):
                if not x.get('exercises'):
                    claim_fail(x['id'], 'has no `exercises`: a vector that claims nothing proves '
                                        'nothing, and nothing would notice it going')
                seen |= set(x.get('exercises') or {})
    for n in ts['namedScales']['order']:
        if not vectors['namedScales'][n].get('exercises'):
            claim_fail(f'named {n}', 'has no `exercises`')
    bounded = [x['exercises']['boundary'] for x in vectors['overrides'] if 'boundary' in x.get('exercises', {})]
    TR = vocab['textRoles']['invariants']
    for pair in TR['R2']['pairs'] + TR['R3']['pairs']:
        if pair not in bounded:
            claim_fail('type-vectors.json', f'no vector puts {pair} at its boundary; a > read as >= '
                                            '(or the reverse) would pass unseen')
    missing = [k for k in REQUIRED_KINDS if k not in seen]
    if missing:
        claim_fail('type-vectors.json', f'no vector claims {missing}; each kind is carried by at '
                                        'least one vector, or the trap it exercises is untested')


def check_claims():
    check_claim_presence()
    derivations, tables = by_id('derivations'), by_id('tables')
    for v in derivations.values():
        check_derivation_claims(v)
    for v in tables.values():
        check_table_claims(v)
    for v in vectors['refusals']:
        for x in v.get('variants', [v]):
            check_refusal_claims(x, derivations, tables)
    named_steps = {n: vectors['namedScales'][n]['expect']['steps'] for n in ts['namedScales']['order']}
    for v in vectors['overrides']:
        check_override_claims(v, named_steps)
    check_named_claims()
    n = (len(derivations) + len(tables) + sum(len(v.get('variants', [v])) for v in vectors['refusals'])
         + len(vectors['overrides']) + len(ts['namedScales']['order']))
    print(f'  claims      {n} vectors\' `exercises` recomputed from first principles')


# ═════════════════════════════════════════════════════════════════════════════════════════════
# 4. COVERAGE
# ═════════════════════════════════════════════════════════════════════════════════════════════
def check_coverage():
    codes = {'inputs'} | {k for k in ts['invariants'] if re.fullmatch(r'T[0-9]', k)}
    for stage in ts['declaration']['refusals']['stages']:
        codes |= set(stage)
    seen = set()
    for v in vectors['refusals']:
        for x in v.get('variants', [v]):
            seen |= set(x['expect'].get('refused', []))
    for v in vectors['overrides']:
        seen |= set(v['expect'].get('refused', []))
    unreachable = {'R1'}
    missing = sorted(codes - seen - unreachable)
    if missing:
        bad('COVERAGE', f'no vector produces {missing}. A refusal nothing exercises is a rule no '
                        'consumer is held to.')
    stray = sorted(seen - codes)
    if stray:
        bad('COVERAGE', f'vectors expect {stray}, which the contract does not name')
    print(f'  coverage    {len(codes - unreachable)} of {len(codes)} refusal codes each produced by a '
          'vector; R1 is unreachable by construction (body\'s step is structural), checked above')


# ═════════════════════════════════════════════════════════════════════════════════════════════
# 5. THE API: ./type-tokens is what its .d.mts says it is, imports nothing, and returns plain JSON
# ═════════════════════════════════════════════════════════════════════════════════════════════
MODULE = os.path.join(HERE, 'type_tokens.mjs')
TYPES = os.path.join(HERE, 'type_tokens.d.mts')
PROBE = r"""
const m = await import(process.argv[1])
const [vocab, ts, vectors, shape] = JSON.parse(await new Response(process.stdin).text())
const out = { names: Object.keys(m).sort(), tables: [], resolved: [], families: [], css: [] }
const plain = (x) => { try { return JSON.parse(JSON.stringify(x)) } catch (e) { out.bigint = String(e); return null } }
for (const n of ts.namedScales.order) {
  const t = m.derive(ts, ts.namedScales[n]); out.tables.push(plain(t)); out.families.push(plain(m.stepFamilies(ts, t)))
  out.css.push(m.cssOf(ts, t.steps['1']))
}
for (const v of vectors.derivations) out.tables.push(plain(m.derive(ts, v.inputs)))
for (const v of vectors.tables) out.tables.push(plain(m.parseTable(ts, v.table)))
for (const v of vectors.overrides) {
  if (!('roles' in v.expect)) continue
  out.resolved.push(plain(m.resolve(vocab, ts, shape, v.declaration, v.product)))
}
out.families.push(plain(m.neutralRungFamilies(ts)))
try { m.derive(ts, {}) } catch (e) { out.refused = { isError: e instanceof Error, isRefused: e instanceof m.Refused, codes: e.codes } }
process.stdout.write(JSON.stringify(out))
"""

_API_TYPES = {
    'string': lambda v, _: isinstance(v, str),
    'boolean': lambda v, _: isinstance(v, bool),
    'string[] | null': lambda v, _: v is None or (isinstance(v, list) and all(isinstance(x, str) for x in v)),
    'Record<string, FluidStep | FixedStep>': lambda v, ck: isinstance(v, dict) and all(
        ck('FluidStep' if isinstance(x, dict) and x.get('kind') == 'fluid' else 'FixedStep', x) for x in v.values()),
    'Record<string, Role>': lambda v, ck: isinstance(v, dict) and all(ck('Role', x) for x in v.values()),
    'TextRoleToken[]': lambda v, ck: isinstance(v, list) and all(ck('TextRoleToken', x) for x in v),
    'Table': lambda v, ck: ck('Table', v),
}
CHECKED = ('FluidStep', 'FixedStep', 'Table', 'Role', 'TextRoleToken', 'Resolved')


def check_api():
    src = open(MODULE, encoding='utf-8').read()
    code = '\n'.join(l for l in src.splitlines() if not l.lstrip().startswith('//'))
    for pat, what in ((r'^\s*import\b', 'an import'), (r'\bimport\(', 'a dynamic import'),
                      (r'\brequire\(', 'a require'), (r'\bprocess\b', '`process`')):
        if re.search(pat, code, re.M):
            bad('API', f'type_tokens.mjs has {what}. The export imports nothing and reads no argv, so '
                       'it bundles for any platform; the command line is type_tokens_cli.mjs.')
    types = open(TYPES, encoding='utf-8').read()
    declared = sorted(re.findall(r'^export declare (?:class|function) (\w+)', types, re.M))
    interfaces = {}
    for name, body in re.findall(r'^export interface (\w+) \{\n(.*?)\n\}', types, re.M | re.S):
        if name not in CHECKED:
            continue          # an argument type, which the pack gate's TypeScript consumer compiles
        fields = {}
        for line in body.splitlines():
            if not line.strip() or line.strip().startswith(('//', '/*', '*')):
                continue
            f = re.fullmatch(r'\s*(\w+)(\??):\s*(.+?)\s*', line)
            if not f:
                bad('API', f'cannot rank the {name} line {line.strip()!r}')
                continue
            fields[f.group(1)] = (f.group(2) == '?', f.group(3))
        interfaces[name] = fields
    for name in CHECKED:
        if name not in interfaces:
            bad('API', f'type_tokens.d.mts declares no interface {name}, which the API returns')
            return
        for field, (_, t) in interfaces[name].items():
            if t not in _API_TYPES:
                bad('API', f'{name}.{field} is typed {t!r}, a type this gate cannot check against output')
                return
    shape = SHAPE
    p = subprocess.run(['node', '--input-type=module', '-e', PROBE, 'file://' + MODULE],
                       input=json.dumps([vocab, ts, vectors, shape]), capture_output=True, text=True)
    if p.returncode != 0:
        bad('API', f'the probe did not run: {(p.stderr.strip().splitlines() or ["?"])[-1]}')
        return
    out = json.loads(p.stdout)
    if out['names'] != declared:
        bad('API', f'type_tokens.mjs exports {out["names"]}; type_tokens.d.mts declares {declared}')
    if 'bigint' in out:
        bad('API', f'a result does not serialise as JSON: {out["bigint"]}. No BigInt crosses the API.')
    r = out.get('refused') or {}
    if not (r.get('isError') and r.get('isRefused') and isinstance(r.get('codes'), list)):
        bad('API', f'derive({{}}) threw {r}; it throws a Refused, an Error with a list of codes')
    seen = {n: set() for n in CHECKED}

    def ck(name, obj):
        fields = interfaces[name]
        if not isinstance(obj, dict):
            bad('API', f'a {name} is {obj!r}, not an object')
            return False
        ok = True
        for k, v in obj.items():
            seen[name].add(k)
            if k not in fields:
                bad('API', f'the implementation returns {name}.{k}, which type_tokens.d.mts does not declare')
                ok = False
            elif not _API_TYPES[fields[k][1]](v, ck):
                bad('API', f'{name}.{k} is {json.dumps(v)[:80]}, declared {fields[k][1]}')
                ok = False
        for k, (optional, _) in fields.items():
            if not optional and k not in obj:
                bad('API', f'{name} declares {k} required, and a result has none')
                ok = False
        return ok
    for t in out['tables']:
        ck('Table', t)
    for r in out['resolved']:
        ck('Resolved', r)
    if not any(t['viewports'] is None for t in out['tables']):
        bad('API', 'no probe returned an all-fixed table, so `viewports: null` is unchecked')
    for name in CHECKED:
        unseen = [k for k in interfaces[name] if k not in seen[name]]
        if unseen:
            bad('API', f'{name} declares {unseen}, which no result carried')
    print(f'  api         {len(declared)} exports, exactly the ones type_tokens.d.mts declares; '
          f'{len(out["tables"])} tables and {len(out["resolved"])} resolutions match its interfaces '
          'key for key; plain JSON; the module imports nothing')


def main():
    print('Typography contract: textRoles, type-scale.json, type-vectors.json')
    try:
        check_structure()
        check_named_invariants()
        check_implementations()
        check_claims()
        check_coverage()
        check_api()
    except (KeyError, TypeError, AttributeError, IndexError, ValueError) as e:
        bad('READ', f'the contract did not read: {type(e).__name__}: {e}. A gate that cannot read '
                    'a file passes nothing in it.')
    except PY.ContractError as e:
        bad('READ', f'type_scale.py cannot run a rule the contract states: {e}')
    if fails:
        print(f'\nFAIL: {len(fails)} problem(s) with the typography contract:')
        for f in fails:
            print('   ', f)
        return 1
    print('\nPASS: the typography contract reads, both implementations reproduce every vector, and '
          'every claim recomputes.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
