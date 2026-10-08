#!/usr/bin/env python3
"""Self-contained test of the emitter and every guard on it.

    python3 scripts/selftest_emit.py     # exit 0 = sound, 1 = a guard stopped guarding

Needs no sibling checkout and no palette: the synthetic preset below is built from generated
coordinates rather than written as hexes, because this repository holds none and its own test
fixtures are not an exception. (`scripts/check_no_colours.py` would say so.)

WHAT IT LOCKS DOWN
------------------
Two halves, and the second matters more. First: a minimal conformant preset really does produce a
complete package. Second: every guard added after the adversarial review still FIRES. A guard is
code, code rots, and a guard that has stopped guarding is worse than no guard — it is a green tick
standing where a check used to be. Each case below names the defect it exists to prevent.
"""
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from contrast_rules import evaluate as evaluate_contrast, evaluate_focus_geometry, load_rules  # noqa: E402
from emit import (Identity, adapter_missing_dependencies, assert_css_references_resolve,  # noqa: E402
                  build_tokens, css_declarations, css_references, generate)
from oklch import derive_ramp  # noqa: E402

fails = []


def check(name, fn, want_error=None):
    """want_error: a substring the raised message must contain. None = must NOT raise."""
    try:
        fn()
    except Exception as e:                                    # noqa: BLE001 — that is the test
        if want_error is None:
            fails.append(f'{name}: raised unexpectedly — {type(e).__name__}: {e}')
        elif want_error.lower() not in str(e).lower():
            fails.append(f'{name}: raised, but the message never mentions {want_error!r} — {e}')
        else:
            print(f'  guard fires   {name}')
        return
    if want_error is not None:
        fails.append(f'{name}: DID NOT RAISE. The guard has stopped guarding.')
    else:
        print(f'  ok            {name}')


# ── a synthetic palette, generated rather than written ────────────────────────
def _hex(r, g, b):
    return '#%02x%02x%02x' % (r, g, b)


NEUTRAL = {str(s): _hex(v, v, v) for s, v in
           zip([50, 100, 200, 300, 400, 500, 600, 700, 800, 900],
               [250, 245, 229, 203, 163, 124, 90, 66, 45, 25])}
SEED = _hex(51, 85, 204)
LIGHT, DARK = _hex(250, 250, 250), _hex(23, 23, 23)
POLE_HI, POLE_LO = _hex(255, 255, 255), _hex(0, 0, 0)


def minimal_preset():
    return {
        'roles': {'primary': {'seed': SEED}},
        'neutral': dict(NEUTRAL),
        'semantic': {
            'surface': {'light': 'var(--color-neutral-50)', 'dark': 'var(--color-neutral-900)'},
            'surface.alt': {'light': 'var(--color-neutral-100)', 'dark': 'var(--color-neutral-800)'},
            'surface.inverse': {'light': 'var(--color-neutral-900)', 'dark': 'var(--color-neutral-50)'},
            'ink': {'light': 'var(--color-neutral-900)', 'dark': 'var(--color-neutral-50)'},
            'ink.muted': {'light': 'var(--color-neutral-600)', 'dark': 'var(--color-neutral-400)'},
            'ink.inverse': {'light': 'var(--color-neutral-50)', 'dark': 'var(--color-neutral-900)'},
            'brand': {'derived': 'exact-seed:primary'},
            'brand.strong': {'light': 'var(--color-primary-700)', 'dark': 'var(--color-primary-300)'},
            'brand.tint': {'light': 'var(--color-primary-50)', 'dark': 'var(--color-primary-950)'},
            'on-brand': {'derived': 'text-on:primary'},
            'accent': {'light': 'var(--color-accent-600)'},
            'on-accent': {'light': 'var(--color-neutral-50)'},
            'border': {'light': 'var(--color-neutral-200)', 'dark': 'var(--color-neutral-700)'},
            'focus': {'light': 'var(--color-primary-600)', 'dark': 'var(--color-primary-400)'},
        },
        'status': {'success': _hex(22, 101, 52), 'warning': _hex(133, 77, 14),
                   'error': _hex(153, 27, 27), 'info': _hex(30, 64, 175)},
        'textOn': {'candidates': [LIGHT, DARK], 'fallbacks': [POLE_HI, POLE_LO]},
        'fontSystem': {'sans': 'system-ui, sans-serif', 'serif': 'georgia, serif',
                       'mono': 'ui-monospace, monospace'},
    }


# Synthetic, like the palette above: no real scale's value belongs in a fixture that ships.
MINIMAL_SCALES = {'radius': {'sm': '5px'}, 'opacity': {'medium': 0.5}}

# The adapter maps roles a minimal preset does not have, so a package that wants it supplies them.
FULL_EXTENDED = {
    'surface': {'overlay': 'var(--color-neutral-50)', 'sunken': 'var(--color-neutral-200)',
                'interactive': 'var(--color-neutral-100)',
                'interactive-strong': 'var(--color-neutral-200)'},
    'border': {'subtle': 4, 'strong': 16},
    'brand': {'fill': 'var(--color-primary-600)'},
    'onBrandFill': 'var(--color-neutral-50)',
    'onDark': {'ink': 'var(--color-neutral-50)'},
    'chart': {str(n): f'var(--color-primary-{s})' for n, s in
              zip(range(1, 6), (500, 600, 700, 400, 300))},
}
IDENT = Identity('@selftest/ds', '0.0.0', title='Selftest', preset='selftest', generated='n/a')


def build(preset=None, scales=None, **kw):
    out = tempfile.mkdtemp(prefix='selftest-emit-')
    try:
        return generate(preset or minimal_preset(), out, IDENT,
                        MINIMAL_SCALES if scales is None else scales, **kw)
    finally:
        shutil.rmtree(out, ignore_errors=True)


def main():
    print('emitter self-test\n')

    # ── 1. the happy paths ──
    def minimal_package():
        out = tempfile.mkdtemp(prefix='selftest-emit-')
        try:
            tokens, doms, master = generate(minimal_preset(), out, IDENT, MINIMAL_SCALES,
                                            emit_adapter=False)
            assert len(master) > 60, f'only {len(master)} tokens'
            for rel in ('index.json', 'build/tokens.css', 'build/tokens.ts', 'build/tokens.js',
                        'build/tokens.d.ts', 'tokens/color/index.json'):
                assert os.path.isfile(os.path.join(out, rel)), f'{rel} not emitted'
            n = assert_css_references_resolve(out, files=('build/tokens.css',))
            assert n > 0, 'no var() references found at all — the check proved nothing'
            css = open(os.path.join(out, 'build/tokens.css')).read()
            assert 'chart' not in css, 'an extended role leaked into a preset that asked for none'
        finally:
            shutil.rmtree(out, ignore_errors=True)
    check('minimal preset -> complete package, every var() resolves', minimal_package)

    def with_adapter():
        p = minimal_preset()
        p['extended'] = FULL_EXTENDED
        out = tempfile.mkdtemp(prefix='selftest-emit-')
        try:
            generate(p, out, IDENT, MINIMAL_SCALES)
            assert_css_references_resolve(out)
            body = open(os.path.join(out, 'build/app-tokens.css')).read()
            assert css_declarations(body) and css_references(body)
        finally:
            shutil.rmtree(out, ignore_errors=True)
    check('adapter emitted when its dependencies exist', with_adapter)

    # ── 2. every guard must still fire ──
    # Blocker: 15 dangling refs in app-tokens.css from a minimal preset. The adapter maps roles
    # the preset never supplied, and each became a var() resolving to nothing.
    check('adapter refuses to emit against missing roles', lambda: build(),
          want_error='does not declare')

    # Blocker: Base's own default box-shadows referenced --color-shadow-*, which Base does not
    # emit. Now the family declares the dependency and it is checked before anything is written.
    check('shadow scale requires its colour roles',
          lambda: build(scales={'shadow': {'sm': '0 0 3px 0 var(--color-shadow-sm)'}},
                        emit_adapter=False),
          want_error='depends on')

    # Blocker: fontSystem with no `sans` still emitted --font-heading: var(--font-sans).
    def no_sans():
        p = minimal_preset()
        p['fontSystem'] = {'serif': 'georgia, serif'}
        build(preset=p, emit_adapter=False)
    check('font role must alias a declared family', no_sans, want_error='does not declare')

    # Blocker: docs= was documented as prose and could rewrite $value or drop `derived`, while
    # index.json went on asserting the output was proven against the frozen vectors.
    check('docs= rejects anything but prose',
          lambda: build(docs={'color.primary.500': {'$value': SEED}}, emit_adapter=False),
          want_error='prose only')
    check('docs= rejects dropping derivation provenance',
          lambda: build(docs={'color.primary.500': {'derived': None}}, emit_adapter=False),
          want_error='prose only')
    check('docs= accepts prose',
          lambda: build(docs={'color.primary.500': {'note': 'x'}}, emit_adapter=False))

    # Ruling: Base carries no scale values, so there is no default to fall back into.
    check('scales= is required',
          lambda: build_tokens(minimal_preset(), IDENT, None), want_error='required')
    check('unknown scale family raises',
          lambda: build(scales={'radii': {}}, emit_adapter=False), want_error='unknown scale')
    check('unknown rung raises',
          lambda: build(scales={'radius': {'xxl': '1px'}}, emit_adapter=False),
          want_error='does not declare')
    # Finding: `space` without `spaceBase`, and `weightDark` without `weight`, emitted nothing at all
    # and raised nothing, which reads as a design decision. The contract now declares the dependency.
    check('a family supplied without what it requires raises',
          lambda: build(scales={'space': ['1']}, emit_adapter=False), want_error='requires')
    # Ruling: one implementation. emit.py writes the implementation's scale values as they are, so
    # a value only exact decimal gets right (and a real theme never exercises) must arrive intact:
    # a second derivation inside the emitter would agree on every real theme and differ here.
    def writes_the_implementations_values():
        T = build_tokens(minimal_preset(), IDENT, {'spaceBase': '0.0000625rem', 'space': ['0-5'],
                                                   'breakpoint': {'md': '2.99999999999999999999rem'}})
        got = (T['space.0-5']['$value'], T['space.0-5']['derived']['expr'],
               T['layout.breakpoint.md']['px'])
        assert got == ('0.00003125rem', 'calc(var(--spacing) * 0.5)', '47px'), got
    check("emit.py writes the implementation's scale values as they are",
          writes_the_implementations_values)
    check('a rung cannot be both fixed and fluid',
          lambda: build(scales={'typeScaleFixed': {'0': '1rem'},
                                'typeScaleFluid': {'0': ('1rem', '1rem', '1rem')},
                                'typeScaleViewports': ('300px', '1000px')}, emit_adapter=False),
          want_error='supplied to both')

    # Finding: a dark-surface ramp named after a role silently overwrites that role.
    def reserved_name():
        p = minimal_preset()
        p['darkSurface'] = {'name': 'chart', 'steps': {'700': NEUTRAL['700']}}
        build(preset=p, emit_adapter=False)
    check('reserved ramp name raises', reserved_name, want_error='collides')

    def bad_ident():
        p = minimal_preset()
        p['darkSurface'] = {'name': 'Deep Sea', 'steps': {'700': NEUTRAL['700']}}
        build(preset=p, emit_adapter=False)
    check('ramp name must be a CSS identifier', bad_ident, want_error='identifier')

    # Finding: an injected adapter value containing */ closes the comment early and lands live
    # declarations in a file whose whole promise is that it declares no values.
    def injection():
        p = minimal_preset()
        p['extended'] = FULL_EXTENDED
        build(preset=p, adapter_values={'background': 'var(--color-surface) */ body{display:none}'})
    check('adapter value carrying */ is rejected', injection, want_error='*/')

    # And the backstop that catches all of the above even if a specific guard is removed.
    def dangling_backstop():
        out = tempfile.mkdtemp(prefix='selftest-emit-')
        try:
            os.makedirs(os.path.join(out, 'build'))
            open(os.path.join(out, 'build/tokens.css'), 'w').write(
                ':root { --a: 1px; --b: var(--a); --c: var(--nope); }\n')
            assert_css_references_resolve(out, files=('build/tokens.css',))
        finally:
            shutil.rmtree(out, ignore_errors=True)
    check('reference gate catches a dangling var()', dangling_backstop, want_error='dangling')

    missing = adapter_missing_dependencies({'x': 'var(--absent)'}, {'--present'})
    if missing != ['--absent']:
        fails.append(f'adapter_missing_dependencies returned {missing!r}')

    # ── 3. the contrast-rule evaluator ──
    # These rules were written down in the contract and evaluated by nothing, which is how a
    # reverted brand.fill measured 3.77:1 against the contract's own 4.5 rule while the gate
    # printed "conforms". The evaluator exists to close that; these cases exist so it cannot
    # quietly stop closing it. No literals: the fills are rungs of a derived ramp, chosen because
    # one clears the floor and one does not.
    ramp = derive_ramp(SEED)
    # Exactly the contract's REQUIRED colour roles, all fourteen: the palette of an implementation
    # that emits nothing optional. It used to hold nine and omit brand.tint, which made the check
    # below pass for the wrong reason (see required_roles_owe_exactly_one_conditional_rule).
    required = {'surface': NEUTRAL['50'], 'surface.alt': NEUTRAL['100'],
                'surface.inverse': NEUTRAL['900'],
                'ink': NEUTRAL['900'], 'ink.muted': NEUTRAL['600'], 'ink.inverse': NEUTRAL['50'],
                'brand': ramp[700], 'brand.strong': ramp[800], 'brand.tint': ramp[50],
                'on-brand': NEUTRAL['50'], 'accent': ramp[700], 'on-accent': NEUTRAL['50'],
                'border': NEUTRAL['300'], 'focus': ramp[600]}
    contract_required = {r['id'] for r in json.load(open(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', 'contract', 'vocabulary.json'),
        encoding='utf-8'))['colorRoles']['required']}
    if set(required) != contract_required:
        fails.append(f'the required-roles fixture is not the contract\'s required list: '
                     f'{sorted(set(required) ^ contract_required)}')

    def with_fill(fill):
        pal = dict(required, **{'brand.fill': fill, 'on-brand-fill': NEUTRAL['50']})
        return evaluate_contrast(values={'light': pal, 'dark': pal})

    def conditional_passes():
        r = with_fill(ramp[700])
        assert r.ok, f'a legible fill should pass: {[v.pair for v in r.failures]}'
        assert any(v.status == 'pass' and 'on-brand-fill' in v.pair[0] for v in r.verdicts), \
            'the conditional rule did not run at all — which is the original bug'
    check('conditional rule RUNS and passes on a legible fill', conditional_passes)

    def conditional_catches_regression():
        r = with_fill(ramp[500])
        assert not r.ok, ('a fill that cannot carry its own text passed. This is the exact '
                          'regression the rule exists to catch.')
        assert any(v.status == 'fail' and v.pair[0] == 'on-brand-fill' for v in r.verdicts)
    check('conditional rule CATCHES an illegible fill', conditional_catches_regression)

    def unresolvable_fails():
        pal = dict(required, **{'brand.fill': 'color-mix(in srgb, var(--color-brand) 80%, white)',
                                'on-brand-fill': NEUTRAL['50']})
        r = evaluate_contrast(values={'light': pal, 'dark': pal})
        assert not r.ok, 'an unmeasurable value was scored as a pass'
        assert any(v.status == 'unverified' for v in r.verdicts)
    check('unresolvable value is UNVERIFIED and fails', unresolvable_fails)

    def required_roles_owe_exactly_one_conditional_rule():
        # The contract's own text once said an implementation emitting no extended role owes no
        # conditional rule, and this check agreed only because its fixture lacked brand.tint.
        # [ink, brand.tint] names two REQUIRED roles, so it binds everyone. Moving an optional
        # role into its `when` would quietly release every product from it; this is what fails.
        r = evaluate_contrast(values={'light': required, 'dark': required})
        assert r.ok, f'the required roles alone should conform: {[v.pair for v in r.failures]}'
        applied = [v for v in r.verdicts if v.kind == 'conditional' and v.status != 'skipped']
        pairs = {tuple(v.pair) for v in applied}
        assert pairs == {('ink', 'brand.tint')}, \
            f'expected exactly [ink, brand.tint] to apply to the required roles, got {sorted(pairs)}'
        assert sorted(v.mode for v in applied) == ['dark', 'light'], \
            f'[ink, brand.tint] must be evaluated in both modes, got {[v.mode for v in applied]}'
        n_conditional = len(load_rules()[1])
        assert len(r.skipped) == n_conditional - 1, \
            f'{len(r.skipped)} conditional rules skipped; every one but [ink, brand.tint] should be'
    check('the 14 required roles alone -> exactly one conditional rule applies, [ink, brand.tint], '
          'in both modes', required_roles_owe_exactly_one_conditional_rule)

    def resolver_follows_var_chains():
        pal = dict(required)
        pal['brand.fill'] = 'var(--color-brand)'          # -> ramp[700], legible
        pal['on-brand-fill'] = 'var(--color-ink-inverse)'  # -> NEUTRAL['50']
        r = evaluate_contrast(values={'light': pal, 'dark': pal})
        assert r.ok, f'var() chains did not resolve: {[v.why for v in r.failures]}'
    check('resolver follows var() chains to a real colour', resolver_follows_var_chains)

    # ── text roles: opt-in, emitted by the contract's one implementation, refused when wrong ──
    # The scale and declaration are type-vectors.json's `valid-custom`: synthetic values, public
    # already, so this adds no number of its own to the tarball.
    vec = json.load(open(os.path.join(HERE, '..', 'contract', 'type-vectors.json'), encoding='utf-8'))
    custom = next(v for v in vec['overrides'] if v['id'] == 'valid-custom')
    type_scales = dict(MINIMAL_SCALES, **custom['product']['scale'])

    def text_roles_emitted():
        out = tempfile.mkdtemp(prefix='selftest-emit-')
        try:
            generate(minimal_preset(), out, IDENT, type_scales, emit_adapter=False,
                     typography=custom['declaration'])
            css = open(os.path.join(out, 'build/tokens.css')).read()
            text = [p for p in css_declarations(css) if p.startswith('--text-')]
            want = 5 * (11 + len(custom['declaration']['optionalRoles']))
            assert len(text) == want, f'{len(text)} --text-* properties, want {want}'
            assert_css_references_resolve(out, files=('build/tokens.css',))
            index = json.load(open(os.path.join(out, 'index.json')))['tokens']
            src = {t['css']: t['source'] for t in index.values()}
            assert src['--text-heading-1--line-height'] == IDENT.name, \
                'an override is the product\'s decision and is sourced to it'
            assert src['--text-heading-2'].endswith('#textRoles'), 'a default is the contract\'s'
        finally:
            shutil.rmtree(out, ignore_errors=True)
    check('a declaration emits every text role, five properties each, every var() resolving',
          text_roles_emitted)

    def no_declaration_no_roles():
        out = tempfile.mkdtemp(prefix='selftest-emit-')
        try:
            generate(minimal_preset(), out, IDENT, type_scales, emit_adapter=False)
            assert '--text-' not in open(os.path.join(out, 'build/tokens.css')).read()
        finally:
            shutil.rmtree(out, ignore_errors=True)
    check('no declaration, no text role: opt-in', no_declaration_no_roles)

    stale = json.loads(json.dumps(custom['declaration']))
    stale['overrides'][0]['replaces'] = 'subhead'
    check('a refused declaration fails the build and names why',
          lambda: build(scales=type_scales, emit_adapter=False, typography=stale),
          want_error='stale')
    check('a named scale is not derived here',
          lambda: build(scales=type_scales, emit_adapter=False,
                        typography={'scale': {'named': 'balanced'}}),
          want_error='named scale')
    check('text roles need the rung families they point at',
          lambda: build(scales={k: v for k, v in type_scales.items() if k != 'leading'},
                        emit_adapter=False, typography=custom['declaration']),
          want_error='carries no')
    # ── 4. the inverted band's companions (colorRoles.extended.$inverse) ──
    # A role the emitter spells differently from the contract is a role no rule ever measures:
    # the rule is keyed on the contract's id, the build carries another, and the rule skips.
    INVERSE = {'ink': {'muted.inverse': {'light': 'var(--color-neutral-400)',
                                         'dark': 'var(--color-neutral-600)'}},
               'border': {'inverse': {'light': 'var(--color-neutral-800)',
                                      'dark': 'var(--color-neutral-100)'},
                          'strong.inverse': {'light': 'var(--color-neutral-500)',
                                             'dark': 'var(--color-neutral-500)'}}}

    def inverse_companions_emit_under_the_contracts_names():
        p = minimal_preset()
        p['extended'] = INVERSE
        out = tempfile.mkdtemp(prefix='selftest-emit-')
        try:
            generate(p, out, IDENT, MINIMAL_SCALES, emit_adapter=False)
            css = open(os.path.join(out, 'build/tokens.css')).read()
            index = json.load(open(os.path.join(out, 'index.json')))
        finally:
            shutil.rmtree(out, ignore_errors=True)
        extended = json.load(open(os.path.join(HERE, '..', 'contract', 'vocabulary.json'),
                                  encoding='utf-8'))['colorRoles']['extended']
        family = extended['$inverse']['family']
        # The family is the list this test walks, so a role missing from it would go untested.
        # It must be exactly the extended roles that end in `.inverse`.
        named = {r['id'] for k, block in extended.items() if isinstance(block, list)
                 for r in block if r['id'].endswith('.inverse')}
        assert set(family) == named and len(family) == len(named), \
            f'$inverse.family {sorted(family)} is not the extended `.inverse` roles {sorted(named)}'
        for role in family:
            prop = '--color-' + role.replace('.', '-')
            assert index['tokens'].get('color.' + role, {}).get('css') == prop, \
                f'{role} is not emitted as token color.{role} with css {prop}'
            assert css.count(prop + ':') == 2, \
                f'{prop} should be declared once per mode, found {css.count(prop + ":")}'
    check('the inverted band\'s three companions emit under the contract\'s ids and names',
          inverse_companions_emit_under_the_contracts_names)

    def misspelt_key_refused(group, key):
        def run():
            p = minimal_preset()
            p['extended'] = {group: {key: {'light': 'var(--color-neutral-500)',
                                           'dark': 'var(--color-neutral-500)'}}}
            build_tokens(p, IDENT, MINIMAL_SCALES)
        return run
    check('a border key rendering a declared role\'s property under another id is refused',
          misspelt_key_refused('border', 'strong-inverse'), want_error="spell it 'strong.inverse'")
    check('an ink key rendering a declared role\'s property under another id is refused',
          misspelt_key_refused('ink', 'muted-inverse'), want_error="spell it 'muted.inverse'")
    check('an ink key that is no role is refused, not dropped',
          misspelt_key_refused('ink', 'faint'), want_error="'ink.faint' is not in")

    # An inverse companion given as a percentage is an alpha of ink, which on surface.inverse is
    # the band's own colour: `{"inverse": 12}` rendered at 1.00:1 and passed, having no rule.
    def inverse_percentage(key):
        def run():
            p = minimal_preset()
            p['extended'] = {'border': {key: 12}}
            build_tokens(p, IDENT, MINIMAL_SCALES)
        return run
    for key in ('inverse', 'strong.inverse'):
        check(f'border.{key} given as a percentage is refused', inverse_percentage(key),
              want_error='is a percentage')

    def other_border_percentage_still_emits():
        p = minimal_preset()
        p['extended'] = {'border': {'subtle': 12}}
        tokens = build_tokens(p, IDENT, MINIMAL_SCALES)
        css = [t['css'] for tid, t in tokens.items() if tid == 'color.border.subtle']
        assert css == ['--color-border-subtle'], f'emitted as {css}'
    check('any other border key may still be a percentage', other_border_percentage_still_emits)

    # The synthetic neutral ladder on its own inverted band (surface.inverse = neutral-900): 700
    # fails both thresholds, 500 clears 3:1 and not 4.5:1 (4.21:1), 400 clears both (6.97:1). The
    # middle case is what tells the two thresholds apart.
    def verdicts(extra, fg):
        pal = dict(required, **extra)
        return [v for v in evaluate_contrast(values={'light': pal, 'dark': pal}).verdicts
                if v.pair[0] == fg]

    def muted_inverse_is_measured():
        got = verdicts({'ink.muted.inverse': NEUTRAL['400']}, 'ink.muted.inverse')
        assert sorted(v.mode for v in got) == ['dark', 'light'], \
            f'[ink.muted.inverse, surface.inverse] did not run in both modes: {got}'
        assert all(v.status == 'pass' for v in got), f'a legible rung failed: {got}'
        for rung in ('700', '500'):
            got = verdicts({'ink.muted.inverse': NEUTRAL[rung]}, 'ink.muted.inverse')
            assert got and all(v.status == 'fail' for v in got), \
                f'muted text at neutral-{rung} on the inverted band passed: {got}'
    check('muted text on the inverted band is held to 4.5:1 once emitted',
          muted_inverse_is_measured)

    def strong_inverse_is_measured():
        for rung in ('400', '500'):
            got = verdicts({'border.strong.inverse': NEUTRAL[rung]}, 'border.strong.inverse')
            assert sorted(v.mode for v in got) == ['dark', 'light'] and \
                all(v.status == 'pass' for v in got), \
                f'a control outline at neutral-{rung} did not pass its 3:1 rule in both modes: {got}'
        got = verdicts({'border.strong.inverse': NEUTRAL['700']}, 'border.strong.inverse')
        assert got and all(v.status == 'fail' for v in got), \
            f'a control outline at neutral-700 on the inverted band passed: {got}'
    check('a control outline on the inverted band is held to 3:1 once emitted',
          strong_inverse_is_measured)

    def divider_carries_no_rule():
        got = verdicts({'border.inverse': NEUTRAL['900']}, 'border.inverse')
        assert got == [], f'border.inverse is a divider and binds no rule, got {got}'
    check('the inverted band\'s divider binds no contrast rule', divider_carries_no_rule)

    # ── the focus indicator (contrast.focusIndicator) ──
    # The ring's pairs sit in the two lists every evaluator already reads, so the first two
    # cases prove they run: unconditionally on the required grounds, and once the ground is
    # emitted on the others. On this ladder's page (neutral-50) and companion (neutral-100), a ring
    # at neutral-400 measures 2.42 and 2.31:1 and one at neutral-500 measures 4.00 and 3.83:1, so
    # the pair of them tells 3:1 from both a looser and a stricter threshold.
    def ring_binds_every_implementation():
        def ring(colour):
            pal = dict(required, focus=colour)
            return {(tuple(v.pair), v.mode): v.status
                    for v in evaluate_contrast(values={'light': pal, 'dark': pal}).verdicts
                    if v.pair[0] == 'focus' and v.status != 'skipped'}
        for ground in ('surface', 'surface.alt'):
            for mode in ('light', 'dark'):
                assert ring(NEUTRAL['400']).get((('focus', ground), mode)) == 'fail', \
                    f'a 2.4:1 ring passed on {ground} ({mode})'
                assert ring(NEUTRAL['500']).get((('focus', ground), mode)) == 'pass', \
                    f'a ring over 3:1 failed on {ground} ({mode})'
        ran = ring(ramp[600])
        assert len(ran) == 6 and set(ran.values()) == {'pass'}, \
            f'a legible ring should pass on the three required grounds in both modes: {ran}'
    check('the focus ring is measured on the required grounds, with no opt-in',
          ring_binds_every_implementation)

    def ring_binds_an_emitted_ground():
        def on_overlay(overlay):
            pal = dict(required, **({'surface.overlay': overlay} if overlay else {}))
            return [v for v in evaluate_contrast(values={'light': pal, 'dark': pal}).verdicts
                    if tuple(v.pair) == ('focus', 'surface.overlay')]
        assert all(v.status == 'skipped' for v in on_overlay(None)), \
            'the ring was measured on a ground this palette does not emit'
        got = on_overlay(ramp[600])
        assert got and all(v.status == 'fail' for v in got), \
            f'a ring the colour of the card it sits on passed: {got}'
    check('the focus ring is measured on an optional ground once it is emitted',
          ring_binds_an_emitted_ground)

    # The geometry evaluator, on every shape of length it must rank or refuse.
    def geometry(width, offset):
        lengths = {k: v for k, v in (('--focus-ring-width', width),
                                     ('--focus-ring-offset', offset)) if v is not None}
        return {rule['id']: status for rule, status, *_ in evaluate_focus_geometry(lengths)}

    GEOMETRY = [
        (('3px', '2px'), {'width': 'pass', 'offset': 'pass'}, 'the shipping shape'),
        (('2px', '1px'), {'width': 'pass', 'offset': 'pass'}, 'both floors are inclusive'),
        (('0.125rem', '1px'), {'width': 'unreadable', 'offset': 'pass'},
         'a rem is refused: it scales with a root the floor does not'),
        (('2PX', '1Px'), {'width': 'pass', 'offset': 'pass'}, 'units are case-insensitive'),
        (('1.5px', '2px'), {'width': 'fail', 'offset': 'pass'}, 'a thin ring fails'),
        (('3px', '0.0625REM'), {'width': 'pass', 'offset': 'unreadable'}, 'rem in any case is refused'),
        (('3px', '0'), {'width': 'pass', 'offset': 'fail'}, 'no offset fails'),
        (('3px', '0px'), {'width': 'pass', 'offset': 'fail'}, 'a flush ring fails'),
        (('3px', '0.01px'), {'width': 'pass', 'offset': 'fail'}, 'a sub-pixel offset is not clear'),
        (('3px', '0.99px'), {'width': 'pass', 'offset': 'fail'}, 'the offset floor is a whole px'),
        (('3px', '-1px'), {'width': 'pass', 'offset': 'unreadable'}, 'a signed length is refused'),
        ((' 3px\t', '\f2px\n'), {'width': 'pass', 'offset': 'pass'}, 'CSS whitespace is stripped'),
        (('\u0663px', '2px'), {'width': 'unreadable', 'offset': 'pass'},
         'an Arabic-Indic digit is refused'),
        (('\uff13px', '2px'), {'width': 'unreadable', 'offset': 'pass'}, 'a full-width digit is refused'),
        (('3px', '2px\u00a0'), {'width': 'pass', 'offset': 'unreadable'}, 'a no-break space is refused'),
        (('0.2em', '2px'), {'width': 'unreadable', 'offset': 'pass'}, 'em cannot be ranked'),
        (('thin', '2px'), {'width': 'unreadable', 'offset': 'pass'}, 'a keyword cannot be ranked'),
        (('calc(1px + 1px)', 'var(--x)'), {'width': 'unreadable', 'offset': 'unreadable'},
         'calc() and var() cannot be ranked'),
        (('2.px', '2px'), {'width': 'unreadable', 'offset': 'pass'},
         'a point with no digit after it is not a CSS number'),
        (('3', '2%'), {'width': 'unreadable', 'offset': 'unreadable'},
         'a unitless number and a percentage cannot be ranked'),
        ((None, None), {'width': 'missing', 'offset': 'missing'}, 'nothing emitted'),
    ]

    def geometry_ranks_and_refuses():
        wrong = [f'{why}: {args} gave {geometry(*args)}, want {want}'
                 for args, want, why in GEOMETRY if geometry(*args) != want]
        assert not wrong, '; '.join(wrong)
    check(f'the ring geometry evaluator ranks or refuses all {len(GEOMETRY)} shapes of length',
          geometry_ranks_and_refuses)

    def geometry_rule_needs_one_bound():
        doc = json.load(open(os.path.join(HERE, '..', 'contract', 'vocabulary.json'),
                             encoding='utf-8'))
        doc['contrast']['focusIndicator']['geometry'][0]['greaterThanCssPx'] = 0
        evaluate_focus_geometry({'--focus-ring-width': '3px', '--focus-ring-offset': '2px'},
                                vocabulary=doc)
    check('a geometry rule carrying two bounds is refused', geometry_rule_needs_one_bound,
          want_error='exactly one')

    print()
    if fails:
        print(f'FAIL: {len(fails)} problem(s):')
        for f in fails:
            print('   ', f)
        return 1
    print('PASS: the emitter works and every guard on it still fires.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
