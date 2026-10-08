#!/usr/bin/env python3
"""Evaluate the contract's contrast rules against a real palette. Holds no colours.

    python3 scripts/contrast_rules.py          # list every rule this contract will evaluate

    from contrast_rules import evaluate, make_var_resolver
    report = evaluate(values={'light': {...role -> value...}, 'dark': {...}})
    if not report.ok:
        print(report.render()); sys.exit(1)

WHY THIS IS HERE
----------------
v2 added `contrast.conditionalRequirements` — eight rules that apply only when an implementation
emits the roles they name. Writing them down was half the job, and only half got done: nothing
evaluated them. A conforming implementation's gate iterated `contrast.requirements` alone, so of
the three rules that applied to it, zero ran.

That is not a theoretical gap. Reverting `brand.fill` to the raw brand seed — the exact regression
that role exists to prevent, annotated in this very contract with *"Unmeasured, it silently becomes
brand again"* — drove `on-brand-fill` to 3.77:1 against the contract's own 4.5 rule, and the gate
printed `contrast 10 role pairs meet AA` and `PASS: conforms to the contract`, exit 0.

It is the third instance of one failure shape in this repository: a rule that exists, is written
down, is not run, and is covered by a summary line asserting everything passed. The first two were
inside `validate_palette.py`. A contract that keeps producing this bug is not unlucky; it is
missing the code that turns a rule into a check.

WHY IT BELONGS IN BASE RATHER THAN IN EACH IMPLEMENTATION
---------------------------------------------------------
The rules live here, so the code that interprets them lives here. And there are now two
implementations that would otherwise each write this, independently, from prose — which is exactly
the duplication the v2 promotion exists to end. An interpreter that drifts between implementations
turns one contract into two.

FAIL-CLOSED, IN THE ESTABLISHED STYLE
-------------------------------------
A rule whose `when` roles are all emitted but whose values cannot be resolved to a real colour is
reported UNVERIFIED and **fails**. It is never a quiet pass. That is the same argument the contract
already makes at `colorRoles.extended.$onDark.$resolvable`: an unresolved `color-mix()` cannot be
measured, and scoring an unmeasured role as a passing one recreates the hole the rule was added to
close. If a role has a contrast obligation, resolve its value at build time.

A rule whose `when` roles are NOT all emitted is SKIPPED, and skipped is counted and printed
separately from passed. An implementation emitting none of the extended roles skips every
conditional rule but one: `[ink, brand.tint]` names two REQUIRED roles, so it binds everyone
(contract/vocabulary.json#contrast.conditionalRequirements.$rule). Measured on a palette of the
14 required roles alone: every conditional rule but that one skips, and that one applies, in both
modes (selftest_emit.py asserts it). The report says so in a number rather than by silence.

A RULE THAT NAMES NO REAL ROLE NEVER RUNS
-----------------------------------------
A conditional rule applies only when every role in its `when` is emitted, so a typo there does not
fail: `ink.muted.invrse` is emitted by nobody, and the rule is skipped by every implementation for
ever, counted among the legitimate skips. So the command line refuses a contract in which a rule
names a role the vocabulary does not declare, or whose `when` and `pair` name different roles.
"""
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from oklch import contrast_ratio  # noqa: E402

DEFAULT_VOCABULARY = os.path.join(HERE, '..', 'contract', 'vocabulary.json')
DEFAULT_SCALE_SHAPE = os.path.join(HERE, '..', 'contract', 'scale-shape.json')
MODES = ('light', 'dark')

# A resolved colour: what a ratio can actually be computed from. Anything else — a color-mix(), an
# unresolved var() chain, an rgba() — is not measurable and must not be scored as if it were.
_RESOLVED = re.compile(r'#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')
_VAR = re.compile(r'^var\(\s*(--[\w-]+)\s*\)$')


def role_to_property(role):
    """`surface.alt` -> `--color-surface-alt`. contract/vocabulary.json#colorRoles.$rule."""
    return '--color-' + role.replace('.', '-')


def make_var_resolver(by_property, max_depth=12):
    """Build a resolver that follows `var()` chains to a real colour, per mode.

    by_property: {'--color-surface': {'light': <value>, 'dark': <value>}} — or
                 {'--color-surface': <value>} for a mode-invariant property.

    Returns resolve(value, mode) -> hex or None. None means *not statically resolvable*, which the
    evaluator treats as unverified-and-failing rather than as absent.

    Both implementations need this identically, which is the whole reason it is not written twice.
    """
    def value_for(prop, mode):
        entry = by_property.get(prop)
        if entry is None:
            return None
        if isinstance(entry, dict) and (set(entry) & set(MODES)):
            return entry.get(mode, entry.get('light'))
        return entry

    def resolve(value, mode, depth=0):
        if depth > max_depth or not isinstance(value, str):
            return None
        v = value.strip()
        if _RESOLVED.match(v):
            return v
        m = _VAR.match(v)
        if m:
            return resolve(value_for(m.group(1), mode), mode, depth + 1)
        return None

    return resolve


def load_rules(vocabulary=None):
    """(unconditional, conditional) rule lists, straight from the contract."""
    path = vocabulary or DEFAULT_VOCABULARY
    doc = json.load(open(path, encoding='utf-8')) if isinstance(path, str) else path
    contrast = doc['contrast']
    conditional = contrast.get('conditionalRequirements', {}).get('rules', [])
    return contrast.get('requirements', []), conditional


def declared_roles(vocabulary=None):
    """Every colour role id the vocabulary declares, in dotted form.

    The required and status roles, every list under `colorRoles.extended`, the chart roles (written
    in CSS form there; `$idForm` restores the dots) and each status companion suffix on each
    status role. A `$`-prefixed key is prose and declares nothing."""
    path = vocabulary or DEFAULT_VOCABULARY
    doc = json.load(open(path, encoding='utf-8')) if isinstance(path, str) else path
    roles = doc['colorRoles']
    ids = {r['id'] for r in roles['required']} | set(roles['status']['required'])
    for key, block in roles['extended'].items():
        if key.startswith('$'):
            continue
        if isinstance(block, list):
            ids |= {r['id'] for r in block}
        elif key == 'chart':
            ids |= {r['id'].replace('-', '.') for r in block['roles']}
        elif key == 'statusCompanions':
            ids |= {s['id'].replace('<status>', status)
                    for s in block['suffixes'] for status in roles['status']['required']}
        else:
            raise ValueError(f'colorRoles.extended.{key} is neither a list of roles nor a block '
                             'this function knows how to read, so it cannot say what it declares')
    return ids


def rule_role_problems(vocabulary=None):
    """What is wrong with the roles the contrast rules name, as a list of sentences (empty = sound).

    A conditional rule whose `when` names an undeclared role is skipped by every implementation,
    silently, for ever; one whose `pair` names a role its `when` does not can be evaluated with
    that role absent, and fail as MISSING on an implementation that owes it nothing; and one whose
    `when` names a role its `pair` does not is released by a role it never measures, so an
    implementation that omits that role owes nothing on the pair. So `when` and `pair` must name
    the same roles."""
    path = vocabulary or DEFAULT_VOCABULARY
    doc = json.load(open(path, encoding='utf-8')) if isinstance(path, str) else path
    known = declared_roles(doc)
    unconditional, conditional = load_rules(doc)
    problems = []
    for kind, rules in (('requirements', unconditional), ('conditionalRequirements', conditional)):
        for rule in rules:
            for role in list(rule['pair']) + list(rule.get('when', [])):
                if role not in known:
                    problems.append(f'{kind} rule {rule["pair"]} names {role!r}, which the '
                                    'vocabulary does not declare')
            if kind == 'conditionalRequirements':
                for role in rule['pair']:
                    if role not in rule['when']:
                        problems.append(f'conditional rule {rule["pair"]} pairs {role!r} but its '
                                        '`when` does not name it')
                for role in rule['when']:
                    if role not in rule['pair']:
                        problems.append(f'conditional rule {rule["pair"]} names {role!r} in its '
                                        '`when` but does not pair it, so a role it never measures '
                                        'decides whether it binds')
    return problems


class Verdict:
    __slots__ = ('rule', 'kind', 'mode', 'status', 'ratio', 'fg', 'bg', 'why')

    def __init__(self, rule, kind, mode, status, ratio=None, fg=None, bg=None, why=''):
        self.rule, self.kind, self.mode, self.status = rule, kind, mode, status
        self.ratio, self.fg, self.bg, self.why = ratio, fg, bg, why

    @property
    def pair(self):
        return self.rule['pair']

    def __repr__(self):
        return f'<{self.status} {self.pair[0]} on {self.pair[1]} ({self.mode})>'


class Report:
    def __init__(self, verdicts):
        self.verdicts = verdicts

    def _of(self, *statuses):
        return [v for v in self.verdicts if v.status in statuses]

    @property
    def passed(self): return self._of('pass')

    @property
    def failures(self): return self._of('fail', 'unverified', 'missing')

    @property
    def skipped(self): return self._of('skipped')

    @property
    def ok(self): return not self.failures

    def render(self):
        lines = []
        for v in self.verdicts:
            if v.status == 'skipped':
                continue
            tag = {'pass': 'ok  ', 'fail': 'FAIL', 'unverified': 'UNVERIFIED',
                   'missing': 'MISSING'}[v.status]
            head = f'  [{tag}] {v.pair[0]} on {v.pair[1]} ({v.mode})'
            if v.ratio is not None:
                head += f'  {v.ratio:.2f} >= {v.rule["minRatio"]}  [{v.fg} on {v.bg}]'
            lines.append(head)
            if v.why:
                lines.append(f'         {v.why}')
        n_rules = len({id(v.rule) for v in self.verdicts})
        lines.append('')
        lines.append(f'  {len(self.passed)} checks met · {len(self.failures)} failed · '
                     f'{len(self.skipped)} skipped (roles not emitted) · {n_rules} rules in the '
                     'contract')
        if self.failures:
            lines.append('')
            lines.append('  A rule that names a role you emit is a rule you have accepted. '
                         'UNVERIFIED is a\n  failure, not a pass: an unresolved color-mix() '
                         'cannot be measured, and scoring an\n  unmeasured role as a passing one '
                         'is the hole these rules were added to close.')
        return '\n'.join(lines)


def evaluate(values=None, resolve=None, emitted=None, modes=MODES, vocabulary=None):
    """Evaluate every contrast rule in the contract against a real palette.

    Give it EITHER:
      values   {mode: {role: value}} — role ids (`surface`, `brand.fill`), values may be raw
               colours or `var()` chains; chains are resolved through the same map by property.
    OR:
      resolve  callable(role, mode) -> hex or None, plus
      emitted  the set of role ids the implementation actually emits.

    Returns a Report. `report.ok` is the gate.
    """
    unconditional, conditional = load_rules(vocabulary)

    if resolve is None:
        if values is None:
            raise ValueError('evaluate() needs either values= or resolve= + emitted=. It cannot '
                             'measure a palette it has not been given.')
        by_property = {}
        for mode in modes:
            for role, value in (values.get(mode) or {}).items():
                by_property.setdefault(role_to_property(role), {})[mode] = value
        chain = make_var_resolver(by_property)
        emitted = emitted if emitted is not None else {
            r for mode in modes for r in (values.get(mode) or {})}

        def resolve(role, mode, _chain=chain, _v=values):          # noqa: A001
            raw = (_v.get(mode) or {}).get(role)
            if raw is None:
                raw = (_v.get('light') or {}).get(role)
            return _chain(raw, mode)
    elif emitted is None:
        raise ValueError('resolve= needs emitted= alongside it: whether a conditional rule APPLIES '
                         'depends on which roles exist, and a resolver that returns None cannot '
                         'distinguish "not emitted" from "not resolvable". Those two must never '
                         'collapse — one is a legitimate skip, the other is a failure.')

    verdicts = []

    def run(rule, kind, applies):
        if not applies:
            verdicts.append(Verdict(rule, kind, '-', 'skipped'))
            return
        fg_role, bg_role = rule['pair']
        for mode in modes:
            missing = [r for r in (fg_role, bg_role) if r not in emitted]
            if missing:
                verdicts.append(Verdict(
                    rule, kind, mode, 'missing',
                    why=f'{", ".join(missing)} is required by this contract and is not emitted'))
                continue
            fg, bg = resolve(fg_role, mode), resolve(bg_role, mode)
            if fg is None or bg is None:
                unres = [r for r, v in ((fg_role, fg), (bg_role, bg)) if v is None]
                verdicts.append(Verdict(
                    rule, kind, mode, 'unverified', fg=fg, bg=bg,
                    why=f'{", ".join(unres)} does not resolve to a measurable colour. Resolve it '
                        'at build time — see contract/vocabulary.json'
                        '#colorRoles.extended.$onDark.$resolvable.'))
                continue
            ratio = contrast_ratio(fg, bg)
            verdicts.append(Verdict(
                rule, kind, mode, 'pass' if ratio >= rule['minRatio'] else 'fail',
                ratio=ratio, fg=fg, bg=bg,
                why='' if ratio >= rule['minRatio'] else rule.get('$why', '')))

    for rule in unconditional:
        run(rule, 'unconditional', True)
    for rule in conditional:
        run(rule, 'conditional', all(r in emitted for r in rule['when']))
    return Report(verdicts)


# ── reading a CSS length, ASCII only ──
# One implementation, shared with the repository's scripts/check_scales.py, which found this class
# first. Python's `\d` matches every Unicode digit and its bare `.strip()` removes every Unicode
# space, but CSS reads neither: a length followed by a no-break space, or a size in full-width or
# Arabic-Indic digits, passed that gate and the generator, then rendered as an invalid declaration
# in Chrome, which drops it. So the pattern spells `[0-9]`, the only whitespace stripped is CSS's
# own (space, tab, LF, CR, FF: CSS Syntax 3, section 4.2), and any non-ASCII character is refused
# by name before a value is parsed at all. A CSS number also needs a digit after its point: a
# browser drops `2.px` as invalid, and with it the outline, so reading it as 2 would pass a ring
# that is never drawn.
CSS_WHITESPACE = ' \t\n\r\f'
PX_LENGTH = re.compile(r'([0-9]+(?:\.[0-9]+)?)px')


def non_ascii(*values):
    """Every non-ASCII character in the string values, named once each (empty = none)."""
    return list(dict.fromkeys(f'U+{ord(c):04X} {unicodedata.name(c, "(unnamed)")}'
                              for v in values if isinstance(v, str) for c in v if ord(c) > 0x7F))


# ── the focus ring's geometry (contract/vocabulary.json#contrast.focusIndicator) ──
# A length this contract can rank: an unsigned number and px, any case, or a bare zero.
# Everything else, rem and a sign included, is refused rather than guessed at
# (focusIndicator.$lengths says why for each shape).


def css_px(value):
    """A length in CSS px as a Decimal, or None when it cannot be ranked. Decimal rather than
    float, so a floor compares exactly against the digits written."""
    from decimal import Decimal
    if not isinstance(value, str) or non_ascii(value):
        return None
    text = value.strip(CSS_WHITESPACE).lower()
    if text == '0':
        return Decimal(0)
    m = PX_LENGTH.fullmatch(text)
    return Decimal(m.group(1)) if m else None


def evaluate_focus_geometry(lengths, vocabulary=None):
    """Each geometry rule against the value an implementation emits for its property.

    lengths: {custom property: value}, e.g. {'--focus-ring-width': '2px', ...}.
    Returns [(rule, status, px, value, why)] with status 'pass', 'fail', 'unreadable' or
    'missing'. The last three all fail: a length nobody can rank is not a length that passed."""
    from decimal import Decimal
    path = vocabulary or DEFAULT_VOCABULARY
    doc = json.load(open(path, encoding='utf-8')) if isinstance(path, str) else path
    out = []
    for rule in doc['contrast']['focusIndicator']['geometry']:
        bounds = [k for k in ('atLeastCssPx', 'greaterThanCssPx') if k in rule]
        if len(bounds) != 1:
            raise ValueError(f'focusIndicator.geometry {rule.get("id")!r} carries {bounds or "no bound"}; '
                             'each rule carries exactly one of atLeastCssPx and greaterThanCssPx')
        raw = lengths.get(rule['css'])
        if raw is None:
            out.append((rule, 'missing', None, None, f'{rule["css"]} is not emitted'))
            continue
        px = css_px(raw)
        if px is None:
            odd = non_ascii(raw)
            out.append((rule, 'unreadable', None, raw,
                        f'{rule["css"]}: {raw!r} ' + (f'contains {", ".join(odd)}, which CSS does '
                        'not read in a length; retype it in ASCII' if odd else 'is not a length '
                        'this contract can rank (a number and px, or 0)')
                        + '; see focusIndicator.$lengths'))
            continue
        bound = Decimal(str(rule[bounds[0]]))
        ok = px >= bound if bounds[0] == 'atLeastCssPx' else px > bound
        word = '>=' if bounds[0] == 'atLeastCssPx' else '>'
        out.append((rule, 'pass' if ok else 'fail', px, raw,
                    f'{rule["css"]}: {raw} is {px} CSS px, needs {word} {bound}'))
    return out


def focus_and_target_problems(vocabulary=None, scale_shape=None):
    """What is malformed in focusIndicator and targetSize, as sentences (empty = sound).

    Both blocks are read by other people's checks, so a renamed key is a check that silently
    reads nothing. And the keyline's colour is claimed to need no rule of its own because a
    required rule already covers it; that claim is checked here rather than trusted.

    Each geometry rule names a family and rung of contract/scale-shape.json and the property that
    rung emits. All three must resolve there and agree: a rule whose property the scale shape does
    not emit is a rule every implementation fails as MISSING, and one whose family or rung has gone
    is a rule nobody can trace back to what it measures."""
    path = vocabulary or DEFAULT_VOCABULARY
    doc = json.load(open(path, encoding='utf-8')) if isinstance(path, str) else path
    contrast = doc['contrast']
    problems = []
    num = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0  # noqa: E731
    shape = scale_shape or DEFAULT_SCALE_SHAPE
    families = (json.load(open(shape, encoding='utf-8')) if isinstance(shape, str) else shape)['families']
    for rule in contrast['focusIndicator']['geometry']:
        fam = families.get(rule.get('family'))
        where = f'focusIndicator.geometry {rule.get("id")!r}'
        if not isinstance(fam, dict) or not isinstance(fam.get('steps'), list):
            problems.append(f'{where} names family {rule.get("family")!r}, which contract/scale-shape.json '
                            'does not declare with rungs')
        elif rule.get('rung') not in fam['steps']:
            problems.append(f'{where} names rung {rule.get("rung")!r}, which {rule["family"]} does not '
                            f'declare ({", ".join(fam["steps"])})')
        elif fam.get('css', '').replace('{k}', rule['rung']) != rule.get('css'):
            problems.append(f'{where} says it is emitted as {rule.get("css")!r}, but contract/scale-shape.json '
                            f'emits {rule["family"]}.{rule["rung"]} as '
                            f'{fam.get("css", "").replace("{k}", rule["rung"])!r}')
        bounds = [k for k in ('atLeastCssPx', 'greaterThanCssPx') if k in rule]
        if len(bounds) != 1 or not num(rule[bounds[0]]):
            problems.append(f'focusIndicator.geometry {rule.get("id")!r} needs exactly one '
                            'non-negative atLeastCssPx or greaterThanCssPx')
        if not str(rule.get('css', '')).startswith('--') or not rule.get('family') \
                or not rule.get('rung'):
            problems.append(f'focusIndicator.geometry {rule.get("id")!r} needs a family, a rung '
                            'and the custom property it is emitted as')
    required_pairs = {tuple(r['pair']): r['minRatio'] for r in contrast['requirements']}
    ring_grounds = {r['pair'][1] for r in contrast['requirements']
                    + contrast['conditionalRequirements']['rules'] if r['pair'][0] == 'focus'}
    # The keyline is the part of the indicator that meets its ground, so it owes the ring's own
    # thickness floor. Without it the 2 px floor stops at the one ground where the ring is not
    # what the reader sees.
    ring_width = next((g.get('atLeastCssPx') for g in contrast['focusIndicator']['geometry']
                       if g.get('id') == 'width'), None)
    # A rule this repository cannot evaluate says so in data, so that nobody reads its presence
    # here as a pass. Checked by value, since a misspelt field is a claim nobody made.
    unevaluated = [('targetSize', contrast['targetSize'])] + [
        (f'the keyline on {k.get("ground")}', k) for k in contrast['focusIndicator']['keyline']]
    for where, rule in unevaluated:
        if rule.get('evaluatedBy') != 'rendered-page':
            problems.append(f'{where} has no evaluator in this repository, so it must carry '
                            f'"evaluatedBy": "rendered-page"; it carries {rule.get("evaluatedBy")!r}')
    for k in contrast['focusIndicator']['keyline']:
        width = k.get('widthAtLeastCssPx')
        if not num(width) or not num(ring_width) or width < ring_width:
            problems.append(f'the keyline on {k["ground"]} needs widthAtLeastCssPx at least the '
                            f'ring\'s width floor ({ring_width} CSS px), and carries {width!r}')
        if required_pairs.get((k['role'], k['ground']), 0) < 3.0:
            problems.append(f'the keyline [{k["role"]}, {k["ground"]}] is said to need no rule of '
                            'its own, but no unconditional rule holds it to 3:1 or more')
        if k['ground'] in ring_grounds:
            problems.append(f'{k["ground"]} has a keyline because the ring cannot carry it, and '
                            'also a [focus, ...] pair claiming the ring does')
    target = contrast['targetSize']
    if not all(num(target['minCssPx'].get(k)) and target['minCssPx'][k] > 0
               for k in ('width', 'height')):
        problems.append('targetSize.minCssPx needs a positive width and height')
    ids = [e['id'] for e in target['exceptions']]
    if len(ids) != len(set(ids)):
        problems.append(f'targetSize.exceptions repeats an id: {ids}')
    spacing = [e for e in target['exceptions'] if e['id'] == 'spacing']
    if len(spacing) != 1 or not num(spacing[0].get('circleDiameterCssPx')):
        problems.append('targetSize.exceptions needs one `spacing` exception with its '
                        'circleDiameterCssPx')
    return problems


def _cli():
    unconditional, conditional = load_rules()
    print(f'contract/vocabulary.json — {len(unconditional)} unconditional rule(s), '
          f'{len(conditional)} conditional\n')
    print('  ALWAYS (the required roles):')
    for r in unconditional:
        print(f'    {r["pair"][0]:22} on {r["pair"][1]:24} >= {r["minRatio"]}   {r["standard"]}')
    print('\n  ONLY WHEN every role named in `when` is emitted:')
    for r in conditional:
        print(f'    {r["pair"][0]:22} on {r["pair"][1]:24} >= {r["minRatio"]}   '
              f'when {", ".join(r["when"])}')
        if r.get('$why'):
            print(f'      {r["$why"]}')
    print('\n  Hand a palette to evaluate() to get a verdict per rule. Roles you do not emit are '
          'skipped\n  and counted; roles you do emit whose values will not resolve are UNVERIFIED, '
          'and unverified\n  fails.')
    problems = rule_role_problems()
    if problems:
        print(f'\nFAIL: {len(problems)} rule(s) name a role that makes them unrunnable:')
        for p in problems:
            print('   ', p)
        return 1
    # The check passes on a sound contract whether or not it looks, so it is shown each shape it
    # exists to refuse, on a copy, and must name every one.
    import copy
    doc = json.load(open(DEFAULT_VOCABULARY, encoding='utf-8'))
    rules = doc['contrast']['conditionalRequirements']['rules']
    doctored = copy.deepcopy(doc)
    bad = doctored['contrast']['conditionalRequirements']['rules']
    bad[0]['when'] = [bad[0]['when'][0] + '-typo'] + bad[0]['when'][1:]
    bad[1]['when'] = bad[1]['when'][:1]
    bad[2]['when'] = bad[2]['when'] + ['ink']
    doctored['contrast']['requirements'][0]['pair'] = ['no-such-role', 'surface']
    found = rule_role_problems(doctored)
    for needle in (f"names '{rules[0]['when'][0]}-typo'", f"pairs '{rules[1]['pair'][1]}'",
                   f"conditional rule {rules[2]['pair']} names 'ink' in its `when`",
                   "names 'no-such-role'"):
        if not any(needle in p for p in found):
            print(f'\nFAIL: the check did not report a doctored rule ({needle}); it has stopped '
                  f'looking. It reported: {found}')
            return 1
    print(f'\n  Every role these rules name is one of the {len(declared_roles())} the vocabulary '
          'declares, and every\n  conditional rule\'s `when` names exactly the roles it pairs.')
    doc = json.load(open(DEFAULT_VOCABULARY, encoding='utf-8'))
    # Checked before anything below reads the blocks, so a renamed key is named, not a KeyError.
    problems = focus_and_target_problems(doc)
    if problems:
        print(f'\nFAIL: {len(problems)} problem(s) in focusIndicator or targetSize:')
        for p in problems:
            print('   ', p)
        return 1
    # The scale-shape references pass on a sound contract whether or not they are looked at, so
    # the check is shown each broken reference it exists to name, on a copy.
    import copy
    for field, broken, needle in (('family', 'focusRings', 'does not declare with rungs'),
                                  ('rung', 'widht', "names rung 'widht'"),
                                  ('css', '--focus-ring-widht', 'but contract/scale-shape.json emits')):
        doctored = copy.deepcopy(doc)
        doctored['contrast']['focusIndicator']['geometry'][0][field] = broken
        if not any(needle in f for f in focus_and_target_problems(doctored)):
            print(f'\nFAIL: a geometry rule with {field} {broken!r} was not reported; the check against '
                  'contract/scale-shape.json has stopped looking.')
            return 1
    # Likewise the keyline's floor and both evaluatedBy fields, which a sound contract passes
    # whether or not they are read.
    for block in (('targetSize',), ('focusIndicator', 'keyline', 0)):
        doctored = copy.deepcopy(doc)
        node = doctored['contrast']
        for key in block:
            node = node[key]
        del node['evaluatedBy']
        if not any('must carry "evaluatedBy"' in f for f in focus_and_target_problems(doctored)):
            print(f'\nFAIL: {".".join(map(str, block))} without evaluatedBy was not reported.')
            return 1
    for broken in (None, 1):
        doctored = copy.deepcopy(doc)
        doctored['contrast']['focusIndicator']['keyline'][0]['widthAtLeastCssPx'] = broken
        if not any('needs widthAtLeastCssPx' in f for f in focus_and_target_problems(doctored)):
            print(f'\nFAIL: a keyline with widthAtLeastCssPx {broken!r} was not reported; the '
                  'keyline has stopped being held to the ring\'s floor.')
            return 1
    focus, target = doc['contrast']['focusIndicator'], doc['contrast']['targetSize']
    print('\n  FOCUS RING GEOMETRY (evaluate_focus_geometry, on the emitted lengths):')
    for g in focus['geometry']:
        bound = (f'>= {g["atLeastCssPx"]}' if 'atLeastCssPx' in g
                 else f'> {g["greaterThanCssPx"]}')
        print(f'    {g["css"]:22} {bound} CSS px   {g.get("standard", "")}')
    print('\n  RENDERED-PAGE RULES (a product\'s browser check; no token can show them):')
    for k in focus['keyline']:
        print(f'    a keyline in {k["role"]} on {k["ground"]}, outermost, at least '
              f'{k["widthAtLeastCssPx"]} CSS px, where the ring cannot carry 3:1')
    print(f'    every target at least {target["minCssPx"]["width"]} x '
          f'{target["minCssPx"]["height"]} CSS px, or one of: '
          f'{", ".join(e["id"] for e in target["exceptions"])}   {target["standard"]}')
    return 0


if __name__ == '__main__':
    sys.exit(_cli())
