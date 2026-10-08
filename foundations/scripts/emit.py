#!/usr/bin/env python3
"""The generator core — a preset in, a conforming token package out. Holds ZERO colour values.

    from emit import Identity, generate
    generate(preset, out_dir,
             Identity(name='@acme/design', version='1.2.0', title='Acme', preset='acme',
                      generated='2026-08-15'),
             scales)          # required — Base declares the rungs, you supply the values

WHY THIS IS HERE AND NOT IN A BRAND'S REPO
------------------------------------------
Base v1 was the contract and nothing else: the tier model, 20 role names, the derivation spec, 165
frozen vectors. Two implementations conformed to it and neither extended the other, which was the
point. But all the machinery that turns a contract into a shipped package — the extended Tier-2
vocabulary a real application consumes, the OKLCH derivation, the status dark-rung repair, the
component-library adapter, the emitters for CSS/JSON/TS — lived inside ONE of those
implementations. A third implementation had exactly two options: copy that generator, or write a
second one. Both are the duplication this architecture exists to prevent, and the first is worse,
because a copied generator arrives carrying the brand it was copied from.

So the machinery is promoted and the palette is not. This module knows how to build and emit a
token package. It does not know, and cannot be told at import time, what colour anything is:

  • every colour value arrives in the `preset` dict;
  • every colour ROLE it can emit beyond the required 20 is OPTIONAL, emitted only if the preset
    supplies a value for it — so an implementation that wants none of them gets none;
  • the non-colour scales (space, motion, radius, type) arrive the same way. Base declares
    which families exist and what their rungs are called (contract/scale-shape.json, loaded
    as SCALE_SHAPE) and carries none of their values, so `scales=` is REQUIRED and has no
    default to fall back to. Every scale token is derived by scripts/scale_tokens.mjs, the
    contract's one implementation, which this module calls; so it needs `node` on PATH.

WHAT IS DELIBERATELY NOT HERE
-----------------------------
  • Any colour. Grep this file for `#` — the only hashes are in prose.
  • Any non-colour VALUE either, since v2.0.1. A page frame and four fixed type rungs chosen
    for one product's dashboard are that product's answers, not the contract's, and
    shipping them as defaults also made the extraction's byte-identity proof circular — it
    passed with no `scales=` at all, so the override path every other implementation will take
    was never once executed.
  • The `text_on` candidate colours. Base states contrast as a PROPERTY of the output and refuses
    to name the two colours an implementation picks between (contract/vocabulary.json#contrast);
    `preset['textOn']['candidates']` is where they live.
  • Any hue word in a key or a role name. The dark-surface ramp is `preset['darkSurface']`, not
    `navy` — a contract that holds no colours cannot have a colour in its schema. (`navy` is
    accepted as a legacy alias; see _dark_surface.)
  • Provenance labels, per-token reasoning and release history. Those belong to whoever made the
    decision, and arrive through `provenance=` and `docs=`.

BYTE-FOR-BYTE REPRODUCTION
--------------------------
This module was extracted from a shipping generator and its correctness proof is that the
generator, rewritten to call it, still emits identical bytes. Everything that could vary is
therefore injectable rather than assumed: source labels (`provenance`), per-token prose (`docs`,
prose ONLY — see TokenTable.DOC_KEYS), non-colour scales (`scales`, required), file headers
(`Identity`), and the adapter's values and preamble.
Nothing about the ORDER of construction is injectable, because order is structure: the emitted CSS
is ordered by insertion, so the block sequence below is part of the contract's output shape.
"""
import collections
import json
import os
import re
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oklch import derive_ramp, mix_toward_light, text_on  # noqa: E402
from contrast_rules import declared_roles  # noqa: E402

# The DERIVED role ladder is 11 steps — an output of the derivation spec (contract/derivation.json),
# not a palette choice. The hand-authored neutral ramp's length is the preset's business and this
# module never asks about it: see contract/vocabulary.json#neutralRamp for why that matters.
RAMP_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]

REQUIRED_PRESET_KEYS = ('roles', 'neutral', 'semantic', 'status', 'fontSystem')

_TAILWIND = 'tailwind-v4:packages/tailwindcss/theme.css'


# ══════════════════════════════════════════════════════════════════════════════
# IDENTITY — who is publishing, and what the emitted files should call themselves
# ══════════════════════════════════════════════════════════════════════════════
class Identity:
    """The publishing identity stamped into every emitted artifact.

    `name` and `version` should be READ from the package manifest by the caller, never restated:
    a generated file advertising a name the registry does not serve, or a version two releases
    behind, is a silent mislabelling of the whole corpus.
    """

    def __init__(self, name, version, *, title=None, preset='default', generated='',
                 command='python3 scripts/generate.py', palette_note=''):
        self.name = name                    # package name — index.json, adapter usage examples
        self.version = version              # index.json + every tokens/<domain>/index.json
        self.title = title or name          # human label in file headers
        self.preset = preset                # preset name
        self.generated = generated          # build stamp
        self.command = command              # the command a reader should run to regenerate
        self.palette_note = palette_note    # optional sentence in the CSS header, e.g. "X's own palette. "


# ══════════════════════════════════════════════════════════════════════════════
# THE TOKEN TABLE
# ══════════════════════════════════════════════════════════════════════════════
class TokenTable:
    """An ordered id -> record map. Insertion order is the emitted order, everywhere."""

    # The ONLY keys a docs overlay may touch. It is documented as prose, so it may only carry
    # prose. Before this allowlist it could set `$value` — rewriting a derived ramp step to any
    # colour at all while index.json went on asserting the output was proven against the frozen
    # vectors — and could delete `derived`, erasing the provenance that says where a value came
    # from. An annotation channel that can change values is not an annotation channel.
    DOC_KEYS = ('description', 'note', 'source')

    def __init__(self, docs=None):
        self._t = collections.OrderedDict()
        self._docs = docs or {}
        for tid, entry in self._docs.items():
            bad = [k for k in entry if k not in self.DOC_KEYS]
            if bad:
                raise ValueError(
                    f"docs[{tid!r}] tries to set {bad!r}. docs= carries PROSE ONLY "
                    f"({', '.join(self.DOC_KEYS)}). Values come from the preset and derivations "
                    "come from the spec; letting an annotation rewrite either would make "
                    "index.json's claim that the output is proven against the frozen vectors "
                    "false without anything noticing.")

    def add(self, tid, ttype, value, css, source, **kw):
        rec = {'$value': value, '$type': ttype, 'css': css, 'source': source}
        rec.update({k: v for k, v in kw.items() if v is not None})
        # The docs overlay replaces in place, so a record's key ORDER is set by this module and
        # cannot be disturbed by an implementation annotating it. A None clears a key.
        for k, v in self._docs.get(tid, {}).items():
            if v is None:
                rec.pop(k, None)
            else:
                rec[k] = v
        self._t[tid] = rec
        return rec

    def __contains__(self, tid): return tid in self._t
    def __len__(self): return len(self._t)
    def __getitem__(self, tid): return self._t[tid]
    def items(self): return self._t.items()
    def ids(self): return list(self._t)


def role_css(role):
    """A role id's CSS custom property. A dot is a hyphen — contract/vocabulary.json#colorRoles."""
    return '--color-' + role.replace('.', '-')


def _mode_pair(v):
    """A preset colour entry is either a bare value (mode-invariant) or {light, dark}."""
    if isinstance(v, dict):
        return v.get('light'), v.get('dark')
    return v, None


def _modes(light, dark):
    return {'light': light, 'dark': dark} if dark is not None else None


# Ramp names that would collide with a role this vocabulary already owns. A ramp called `chart`
# emits --color-chart-1 and quietly overwrites the categorical slot of the same name; a ramp
# called `neutral` overwrites the neutral ramp outright. Checked rather than documented, because
# the collision produces valid CSS and a wrong colour.
RESERVED_RAMP_NAMES = frozenset((
    'primary', 'secondary', 'accent', 'neutral',
    'surface', 'ink', 'text', 'brand', 'border', 'focus', 'link', 'chart', 'shadow',
    'success', 'warning', 'error', 'info', 'on-brand', 'on-accent', 'on-brand-fill',
))


def _dark_surface(preset):
    """The optional hand-authored dark-surface ramp: (name, {step: value}) or (None, {}).

    Accepts two spellings::

        "darkSurface": { "name": "<ramp name>", "steps": { "700": ..., ... } }
        "navy":        { "700": ..., ... }                       # LEGACY

    The legacy `navy` key is supported so an existing preset keeps working untouched, and it is
    deprecated on sight: it names a HUE in a schema whose entire premise is that it holds none, and
    it does not generalise — the next implementation's dark ramp is not navy, and a preset that
    called it navy would be lying about its own palette. `name` is what enters the token ids and
    the CSS custom properties (`--color-<name>-<step>`), so it is the implementation's word for its
    own ramp, never this module's.
    """
    ds = preset.get('darkSurface')
    if ds:
        if 'steps' not in ds or 'name' not in ds:
            raise ValueError("preset['darkSurface'] needs both 'name' (the ramp's own word for "
                             "itself, which becomes --color-<name>-<step>) and 'steps'.")
        return _checked_ramp_name(ds['name']), ds['steps']
    legacy = preset.get('navy')
    if legacy:
        return _checked_ramp_name('navy'), legacy
    return None, {}


def _checked_ramp_name(name):
    if not re.fullmatch(r'[a-z][a-z0-9]*(?:-[a-z0-9]+)*', str(name)):
        raise ValueError(
            f'ramp name {name!r} is not a usable CSS identifier fragment. It becomes '
            '--color-<name>-<step>, so it must be lowercase alphanumerics separated by single '
            'hyphens.')
    if name in RESERVED_RAMP_NAMES:
        raise ValueError(
            f'ramp name {name!r} collides with a role name this vocabulary already owns. '
            f'--color-{name}-<step> would overwrite an existing custom property with a different '
            'meaning, and it would do it silently — the CSS stays valid and the colour is wrong. '
            f'Reserved: {", ".join(sorted(RESERVED_RAMP_NAMES))}.')
    return name


# ══════════════════════════════════════════════════════════════════════════════
# SCALE SHAPE — which non-colour scales exist, their step names, and their types.
#
# NO VALUES. This is the tier model applied consistently: Base says what roles exist and an
# implementation says what they are. That holds for `--radius-sm` exactly as it holds for
# `--color-surface`, and the reason is the same one this repository was founded on.
#
# v2.0.0 shipped these as DEFAULT_SCALES, carrying real numbers. That was wrong twice over. It
# handed one product's answers — a page frame and four fixed type rungs sized against a
# particular dashboard days earlier — to every future implementation as if they were the
# contract's. And it made the extraction's own byte-identity proof circular: the proof passed
# with no `scales=` argument at all, so ~90 tokens matched because Base's defaults WERE that
# implementation's values. A proof that matches by construction proves nothing, and the override
# path — the path every other implementation will take — was never executed.
#
# So `scales=` is REQUIRED. There is no default to fall back to, which means there is no way to
# accidentally ship somebody else's spacing scale, and the override path is now the only path.
# ══════════════════════════════════════════════════════════════════════════════
# The shape is contract/scale-shape.json. It was a dict literal here, which meant an
# implementation in any other language could learn the rung names only by reading Python. salt-core
# hand-rolled its own container widths as `--measure-wide`/`--measure-narrow`, the same properties
# this contract's `measure` family emits for TEXT measure. This module holds no copy: a second
# declaration here would be a second answer to "which rungs exist". Its scale tokens come from
# scripts/scale_tokens.mjs, which reads the same file, and byte identity of every theme's build is
# what shows the two agree.
SCALE_SHAPE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'contract',
                                'scale-shape.json')


def _load_scale_shape(path=SCALE_SHAPE_PATH):
    """The families, in file order, each without its `$`-prefixed prose."""
    doc = json.load(open(path, encoding='utf-8'), object_pairs_hook=collections.OrderedDict)
    return collections.OrderedDict(
        (fam, {k: v for k, v in spec.items() if not k.startswith('$')})
        for fam, spec in doc['families'].items())


SCALE_SHAPE = _load_scale_shape()

# The order this module has always written a fluid rung's record in. The contract names the keys
# (typeScaleFluid.slots, typeScaleViewports.slots); the order is this module's, kept so the emitted
# JSON does not move a byte.
_FLUID_RECORD_ORDER = ('min', 'max', 'minViewport', 'maxViewport', 'preferred')


def _validate_scales(scales):
    """`scales` is required. Everything else about it (unknown families and rungs, what requires
    what, exclusive rungs, the shape of each value) is the contract's reference consumer's to refuse,
    and it does, in scale_tokens() below."""
    if scales is None:
        raise ValueError(
            "scales= is required and has no default. Base declares WHICH non-colour scales exist "
            "and what their rungs are called (see contract/scale-shape.json and PRESET_SHAPE); it "
            "deliberately carries none of their values, exactly as it carries none of your "
            "colours. Pass scales={} for an implementation that wants no non-colour scales at all.")


# THE ONE IMPLEMENTATION. Every scale token this module writes comes from scripts/scale_tokens.mjs,
# the contract's reference consumer and the package's `./scale-tokens` export: value, type, group,
# dark value, records, pixel width and derivation expression, as it returns them. Two
# implementations kept equal by a gate disagreed in four review rounds running, each time where the
# probe did not look, so there is one, and this module only adds what the contract leaves to an
# emitter: token ids, provenance labels and prose. Needs `node` on PATH.
SCALE_TOKENS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scale_tokens_cli.mjs')


SCALE_TOKENS_TIMEOUT = 120
NODE_MISSING = ('emit.py builds every scale token with scripts/scale_tokens.mjs, and `node` is not on '
                'PATH. Install Node (22 or later); there is no Python fallback, because a second '
                'derivation is what this replaced.')


def scale_tokens(scales):
    """The contract's scale tokens for `scales`, from scale_tokens.mjs. Raises its refusal as-is."""
    try:
        # A timeout, because a hang here would otherwise hold the build, and CI, until its own cap.
        run = subprocess.run(['node', SCALE_TOKENS_PATH], input=json.dumps([scales]),
                             capture_output=True, text=True, timeout=SCALE_TOKENS_TIMEOUT)
    except FileNotFoundError:
        raise RuntimeError(NODE_MISSING) from None
    except subprocess.TimeoutExpired:
        raise RuntimeError(f'scripts/scale_tokens_cli.mjs did not answer within '
                           f'{SCALE_TOKENS_TIMEOUT} seconds.') from None
    if run.returncode != 0:
        raise RuntimeError(f'scripts/scale_tokens_cli.mjs failed: {(run.stderr or run.stdout).strip()}')
    try:
        (result,) = json.loads(run.stdout)
    except (ValueError, TypeError):
        result = None
    # The shape, not just the key: {"tokens": null} or a tokens that is not a list of objects would
    # otherwise reach the token loop and fail there, far from the cause.
    if not (isinstance(result, dict)
            and ((isinstance(result.get('tokens'), list)
                  and all(isinstance(t, dict) for t in result['tokens']))
                 or isinstance(result.get('refused'), str))):
        raise RuntimeError('scripts/scale_tokens_cli.mjs exited 0 without one {tokens} or {refused} '
                           f'result: {run.stdout.strip()[:300]!r}')
    if 'refused' in result:
        raise ValueError(f"{result['refused']} (refused by scripts/scale_tokens.mjs, from "
                         'contract/scale-shape.json)')
    return result['tokens']


# What the contract leaves to the emitter, per family: the token id (with {k} for the rung), the
# Tailwind v4 theme.css line a family was adopted from (None = this package's own), and the
# provenance and prose it records. None of it is a value.
_ADOPTED_VERBATIM = {'from': 'tailwind-v4', 'verbatim': True, 'version': '4.1.x'}
_SCALE_TOKEN_IDS = {
    'shadow': ('shadow.{k}', None,
               {'note': 'References --color-shadow-* which is mode-aware — the shadow adapts '
                        'automatically.'}),
    'radius': ('radius.{k}', None, {}),
    'borderWidth': ('border.width.{k}', None, {}),
    'focusRing': ('border.focus.{k}', None, {}),
    'opacity': ('opacity.{k}', None, {}),
    'duration': ('motion.duration.{k}', None, {}),
    'easing': ('motion.easing.{k}', None, {}),
    'stagger': ('motion.stagger.delay', None, {}),
    'durationExtended': ('motion.duration.{k}', None,
                         {'description': 'Ambient-loop rung above `ambient`, for motion measured in '
                                         'tens of seconds rather than hundreds of milliseconds. '
                                         'Named for the layer it drives, not its length.'}),
    'typeScaleFixed': ('typography.scale.step-{k}', None, {}),
    'typeScaleFluid': ('typography.scale.step-{k}', None, {}),
    'weight': ('typography.weight.{k}', None, {}),
    'leading': ('typography.leading.{k}', None, {}),
    'tracking': ('typography.tracking.{k}', None, {}),
    'measure': ('typography.measure.{k}', None, {}),
    'spaceBase': ('space.base', 325, {'adopted': _ADOPTED_VERBATIM}),
    'space': ('space.{k}', 325, {'adopted': {'from': 'tailwind-v4', 'derivedUpstream': True}}),
    'breakpoint': ('layout.breakpoint.{k}', 327, {'adopted': _ADOPTED_VERBATIM}),
    'container': ('layout.container.{k}', 333, {'adopted': _ADOPTED_VERBATIM}),
    'containerPage': ('layout.container.page', None,
                      {'description': "The page frame: the widest a page's content runs. Long-form "
                                      'prose keeps its own measure (--content-size), so the frame '
                                      'is free to be wider than a line of text reads well at.'}),
    'containerPadding': ('layout.container.padding.{k}', None, {}),
    'contentSize': ('layout.content.size', None, {'description': 'Long-form content measure.'}),
}
# The token keys the reference returns that are not records. Anything else it returns is a record
# (the type scale's "fluid") and is written under its own key.
_REFERENCE_KEYS = ('property', 'family', 'rung', 'constant', 'type', 'group', 'value', 'dark',
                   'expr', 'px')


def _add_scale_token(T, t, OWN, TW):
    fam = t['family']
    if fam not in _SCALE_TOKEN_IDS:
        raise ValueError(f'the contract declares scale family {fam!r} and emit.py has no token id '
                         'for it (_SCALE_TOKEN_IDS). A family is named here when it is added there.')
    id_template, line, extra = _SCALE_TOKEN_IDS[fam]
    if t.get('constant'):
        # A constant's id is its property with the first hyphen as a dot: --space-px -> space.px.
        tid, extra = t['property'][2:].replace('-', '.', 1), {'adopted': {'from': 'tailwind-v4'}}
    else:
        tid = id_template.format(k=t.get('rung'))
    kw = {'group': t['group'], 'note': extra.get('note'), 'description': extra.get('description')}
    for key, record in t.items():
        if key not in _REFERENCE_KEYS:
            # Key ORDER only, and only for the one record there is: this module has always written
            # a fluid rung's record in _FLUID_RECORD_ORDER, and JSON presentation is not a value.
            # Kept so the emitted files do not move a byte; every value is the reference's.
            if set(record) == set(_FLUID_RECORD_ORDER):
                record = {k: record[k] for k in _FLUID_RECORD_ORDER}
            kw[key] = record
    kw['modes'] = {'light': t['value'], 'dark': t['dark']} if 'dark' in t else None
    kw['adopted'] = extra.get('adopted')
    if 'expr' in t:
        source = SCALE_SHAPE[fam]['derive']['from']
        kw['derived'] = {'from': _SCALE_TOKEN_IDS[source][0], 'fn': 'calc', 'expr': t['expr']}
    kw['px'] = t.get('px')
    T.add(tid, t['type'], t['value'], t['property'], f'{TW}:{line}' if line else OWN, **kw)


def default_provenance(identity):
    """Source labels for each block. Every one is overridable — provenance is a claim about where
    a decision came from, and only the implementation can make that claim truthfully."""
    p = f'preset:{identity.preset}'
    return {
        'preset': p,
        'own': identity.name,
        'neutral': f'{p} neutral ramp',
        'darkSurface': f'{p} dark surface ramp',
        'semantic': f'{p} role mapping',
        'derived': f'{p} (derived)',
        'status': f'{p} status roles',
        'tailwind': _TAILWIND,
        'textRoles': '@lightlysaltedhq/design-foundations/vocabulary#textRoles',
    }


# ══════════════════════════════════════════════════════════════════════════════
# TEXT ROLES — contract/vocabulary.json#textRoles, resolved by the contract's ONE implementation
#
# The role tokens come from scripts/type_tokens.mjs (exported as ./type-tokens), run through Node,
# and from nowhere else. A design-system ruling of 25/09/2026: a Python emitter and a JavaScript
# consumer kept equal through probes drifted in ways the probes could not see, four review rounds
# running, so the rule has one implementation and this module asks it. scripts/type_scale.py is
# a second implementation that exists only to check the frozen vectors; nothing is built with it.
#
# This emitter writes text roles over a product's OWN table and rung families only: the tokens are
# references (--text-heading-1: var(--step-4)), so every --step-*, --leading-*, --tracking-* and
# --weight-* they point at has to be in `scales`. A product on a named scale or the neutral rungs
# takes those from ./type-tokens (stepFamilies, neutralRungFamilies) and supplies them as its
# scale; deriving them here would be a second path for the same numbers.
# ══════════════════════════════════════════════════════════════════════════════
TYPE_TOKENS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'type_tokens_cli.mjs')


def text_role_tokens(typography, scales, font_roles, colour_roles):
    """Every --text-* token a declaration resolves to, from type_tokens.mjs, or a ValueError."""
    scale = typography.get('scale') if isinstance(typography, dict) else None
    if isinstance(scale, dict) and 'named' in scale:
        raise ValueError(
            f"typography declares the named scale {scale['named']!r}. This emitter writes text "
            "roles over a product's own table only, and would have to derive the named one: take "
            "its rungs from @lightlysaltedhq/design-foundations/type-tokens (stepFamilies) and "
            "supply them in scales, declared custom, or emit the tokens with type-tokens itself.")
    absent = [f for f in ('leading', 'tracking', 'weight') if not scales.get(f)]
    if absent:
        raise ValueError(
            f"typography is supplied but scales carries no {absent!r}. Every role token points at "
            "a rung of those families, so they must be in scales: a product's own, declared "
            "custom, or the neutral ones from type-tokens (neutralRungFamilies).")
    # contract/scale-shape.json itself, as loaded above: the implementation reads its families.
    shape = {'families': SCALE_SHAPE}
    job = {'resolve': typography, 'shape': shape,
           'product': {'scale': scales, 'fontRoles': font_roles, 'colourRoles': colour_roles}}
    try:
        run = subprocess.run(['node', TYPE_TOKENS], input=json.dumps([job]), capture_output=True,
                             text=True)
    except FileNotFoundError:
        raise ValueError('typography is supplied and Node is not on PATH. The text roles are '
                         'resolved by scripts/type_tokens.mjs, the contract\'s one implementation, '
                         'and there is no second one to fall back to.') from None
    if run.returncode != 0:
        raise ValueError(f'scripts/type_tokens.mjs failed: {run.stderr.strip()}')
    out = json.loads(run.stdout)[0]
    if 'refused' in out:
        raise ValueError(
            f"the typography declaration is refused: {', '.join(out['refused'])}. Each code is "
            "contract/type-scale.json#declaration.refusals' name for a rule it breaks.")
    return out['tokens']


# ══════════════════════════════════════════════════════════════════════════════
# BUILD
# ══════════════════════════════════════════════════════════════════════════════
def build_tokens(preset, identity, scales, provenance=None, docs=None, typography=None):
    """Construct the whole token table from a preset. Returns a TokenTable.

    preset       the palette — see PRESET_SHAPE below and the module docstring
    identity     Identity(name, version, ...)
    scales       REQUIRED. {family: values} for the non-colour scales. Base declares which
                 families and rungs exist (contract/scale-shape.json) and carries none of
                 their values.
    provenance   {block: source label}; merged over default_provenance(identity)
    docs         {token id: {description|note|source}}; PROSE ONLY — see TokenTable.DOC_KEYS
    typography   OPTIONAL. A product's typography declaration (contract/type-scale.json#declaration).
                 Supplied, every text role is emitted as --text-* references; omitted, none is.
    """
    for key in REQUIRED_PRESET_KEYS:
        if key not in preset:
            raise ValueError(f"preset is missing required key {key!r} "
                             f"(required: {', '.join(REQUIRED_PRESET_KEYS)})")

    prov = dict(default_provenance(identity))
    prov.update(provenance or {})
    _validate_scales(scales)
    S = scales
    T = TokenTable(docs)
    PSRC, OWN = prov['preset'], prov['own']

    # ══════════ ROLE RAMPS + exact-seed tokens ══════════
    # Fallback chain secondary -> primary, accent -> secondary -> primary, so a one-seed brand is
    # a legitimate brand and still fills every role.
    r = preset.get('roles', {})
    seeds = collections.OrderedDict()
    prev = None
    for role in ('primary', 'secondary', 'accent'):
        seed = r.get(role, {}).get('seed') or prev
        if seed is None:
            raise ValueError("preset['roles']['primary']['seed'] is required — a brand needs at "
                             "least one seed; the others fall back up the chain.")
        seeds[role] = prev = seed

    for role, seed in seeds.items():
        T.add(f'color.{role}.base', 'color', seed, f'--color-{role}-base', PSRC, group='role',
              exactSeed=True, role=role,
              description=f'Verbatim {role} brand colour (exact hex, never laddered).')
        ramp = derive_ramp(seed)
        for step in RAMP_STEPS:
            T.add(f'color.{role}.{step}', 'color', ramp[step], f'--color-{role}-{step}', PSRC,
                  group='role', role=role,
                  derived={'from': f'color.{role}.base', 'fn': 'salt_derive_ramp', 'space': 'oklch'},
                  note='Gamut-mapped OKLCH ladder — @lightlysaltedhq/design-foundations/derivation, '
                       'proven against its frozen vectors.')

    # ══════════ NEUTRAL RAMP — hand-authored, length is the preset's business ══════════
    for step, value in preset['neutral'].items():
        T.add(f'color.neutral.{step}', 'color', value, f'--color-neutral-{step}', prov['neutral'],
              group='primitives',
              description='Hand-authored neutral ramp — not derived, not seeded. Its length is the '
                          "implementation's choice and the contract does not mandate one.")

    # ══════════ DARK-SURFACE RAMP — optional, hand-authored, named by the preset ══════════
    ds_name, ds_steps = _dark_surface(preset)
    for step, value in ds_steps.items():
        T.add(f'color.{ds_name}.{step}', 'color', value, f'--color-{ds_name}-{step}',
              prov['darkSurface'], group='primitives',
              description='Hand-authored dark-surface ramp — the steps the dark theme paints its '
                          'sunken / page / raised / hairline surfaces with. Not derived, not '
                          'seeded. It may deliberately share a step with the neutral ramp, which '
                          'is how a dark ramp CONTINUES the neutrals rather than forking a second '
                          'palette; a shared value there is a decision, never a duplicate to fix.')

    # ══════════ SEMANTIC ROLES — the role -> ramp-position mapping ══════════
    # This is the mapping Base most deliberately refuses to specify: one implementation's dark
    # surface is the bottom of its neutral ramp, another's is a step on a separate ramp, and both
    # conform. All this module does is emit whatever the preset says.
    txt = preset.get('textOn', {})
    for role, spec in preset['semantic'].items():
        note = None
        if 'derived' in spec:
            kind, target = spec['derived'].split(':', 1)
            src = prov['derived']
            if kind == 'exact-seed':
                light = f'var(--color-{target}-base)'
                note = ('Exact brand fill. Brand-as-TEXT should use a ladder step '
                        '(e.g. color.link.*).')
            elif kind == 'text-on':
                if not txt.get('candidates'):
                    raise ValueError(
                        f"semantic role {role!r} derives 'text-on:{target}' but the preset has no "
                        "textOn.candidates. Base states contrast as a property and refuses to name "
                        "the colours you choose between — supply "
                        "preset['textOn'] = {'candidates': [...], 'fallbacks': [lighter, darker]}.")
                light = text_on(seeds[target], txt['candidates'],
                                txt.get('fallbacks', txt['candidates'][:2]),
                                txt.get('minRatio', 4.5))
                note = f'AA-safe text on the {target} role (text_on).'
            else:
                raise ValueError(f'unknown derivation {spec["derived"]!r} on semantic role {role!r} '
                                 '— known kinds: exact-seed:<role>, text-on:<role>')
            dark = None
        else:
            light, dark = spec['light'], spec.get('dark')
            src = prov['semantic']
        T.add('color.' + role, 'color', light, role_css(role), src, group='semantic',
              modes=_modes(light, dark), note=note)

    # ══════════ STATUS ROLES + the dark-rung repair ══════════
    # Status is where a green gate is worst: Base's contrast contract enumerates five role pairs
    # and status is on none of them, so four mode-INVARIANT status literals authored against a
    # light surface will ship unreadable on a dark one with nothing complaining. The repair is
    # DERIVED rather than hand-authored — mix each role toward the light pole in OKLCH — so it
    # fans out from whatever seeds a preset supplies instead of pinning four more literals, and it
    # is resolved at BUILD time to a real value: redefining --color-success in terms of
    # var(--color-success) is circular, and every emitted step has to be a real displayable colour
    # for the non-CSS consumers.
    #
    # The ratio is the preset's. Push it too far and chroma compresses until two adjacent status
    # hues converge; too little and the repair does not clear AA. Measure, do not guess — and
    # remember that status is never colour alone: every indicator carries an icon and a word.
    mix = preset.get('statusDark', {}).get('mixTowardLight')
    for k, v in preset['status'].items():
        dark = mix_toward_light(v, mix) if mix else None
        T.add(f'color.{k}', 'color', v, f'--color-{k}', prov['status'], group='status',
              modes=_modes(v, dark),
              description='Status role. Light is the preset\'s literal' + (
                  f'; dark is that literal mixed {int(mix * 100)}% toward the light pole in OKLCH, '
                  'which restores contrast on a dark surface. ' if mix else '. ') +
                          'Never use status colour alone — pair it with an icon and a word.')

    # ══════════ FONTS — a system stack, an optional brand family, and the ROLES ══════════
    fp = preset.get('fonts', {})

    def famval(key):
        stack = preset['fontSystem'][key]
        brand = fp.get(key)
        return f'"{brand}", {stack}' if brand else stack

    # THE FOURTH SLOT. `display` is declared here with the other three so a role may alias it,
    # but it is EMITTED at the end of the typography domain (see below), because that is where the
    # wrapper that first needed a fourth face appended it and emitted order is part of the output
    # shape. Its custom property is --font-display-FAMILY, not --font-display: the latter is the
    # display ROLE's own property, and the two sharing it would make --font-display:
    # var(--font-display) — circular, resolving to nothing, and rendering as a styling choice
    # rather than a build error.
    FAMILY_CSS = {'sans': '--font-sans', 'serif': '--font-serif', 'mono': '--font-mono',
                  'display': '--font-display-family'}

    declared_families = []
    for key, css in FAMILY_CSS.items():
        if key not in preset['fontSystem']:
            continue
        declared_families.append(key)
        if key == 'display':
            continue                      # declared now, emitted last
        src = f'{PSRC} brand family + {OWN} system stack' if fp.get(key) else f'{OWN} system stack'
        T.add(f'typography.family.{key}', 'fontFamily', famval(key), css, src, group='families')

    # A role is an ALIAS onto a family, so the family has to exist. Defaulting to 'sans' and
    # emitting var(--font-sans) when fontSystem never declared a sans produces a role that
    # resolves to nothing — text silently falls back to the browser default, which looks like a
    # styling choice rather than a build error.
    def _family(role_key, default):
        fam = fp.get(role_key, default)
        if fam not in declared_families:
            raise ValueError(
                f"typography role {role_key!r} aliases the {fam!r} family, which preset"
                f"['fontSystem'] does not declare (it has: {declared_families or 'nothing'}). "
                "A role must point at a family that exists, or --font-* resolves to nothing and "
                "the page quietly renders in the browser default.")
        return fam

    heading_family = _family('headingRole', 'sans')
    body_family = _family('bodyRole', 'sans')
    T.add('typography.role.heading', 'fontFamily', f'var({FAMILY_CSS[heading_family]})',
          '--font-heading', OWN, group='families',
          description='Heading role — what components consume (Tier 2). Never reference a family '
                      'directly.')
    T.add('typography.role.body', 'fontFamily', f'var({FAMILY_CSS[body_family]})', '--font-body',
          PSRC, group='families',
          description=f'Body role (Tier 2). Pairs the {body_family} family here.')
    # `lead` is optional (vocabulary.json#typographyRoles.optional) precisely because the two
    # implementations disagree: one pairs a serif standfirst with a sans body (marketing prose),
    # the other keeps its lead on the same sans as its body (a data-dense application). A `Lead`
    # component consumes the role rather than hard-coding either answer or forking.
    if fp.get('leadRole'):
        lead_family = _family('leadRole', body_family)
        T.add('typography.role.lead', 'fontFamily', f'var({FAMILY_CSS[lead_family]})',
              '--font-lead', PSRC, group='families',
              description=f'Lead/standfirst role (Tier 2, optional). Pairs the {lead_family} '
                          'family here.')
    display_role_done = False
    if fp.get('displayRole') and _family('displayRole', None) != 'display':
        T.add('typography.role.display', 'fontFamily',
              f'var({FAMILY_CSS[fp["displayRole"]]})', '--font-display', PSRC, group='families',
              description='Display role (Tier 2, optional) — poster type at the top of the scale, '
                          'where the face chosen to be legible at body size is not the face you '
                          'want at the largest step.')
        display_role_done = True

    # ══════════════════════════════════════════════════════════════════════════
    # EXTENDED TIER-2 ROLES — every one optional, emitted only if the preset has it
    # contract/vocabulary.json#colorRoles.extended describes each role's job.
    # ══════════════════════════════════════════════════════════════════════════
    ext = preset.get('extended', {})
    INK = 'var(--color-ink)'

    def ink_alpha(pct):
        return f'color-mix(in srgb, {INK} {pct}%, transparent)'

    def add_ext(tid, value, **kw):
        light, dark = _mode_pair(value)
        T.add(tid, 'color', light, role_css(tid[len('color.'):]), OWN, group='enrichment',
              modes=_modes(light, dark), **kw)

    # links — brand-as-TEXT, so normally a ladder step rather than the seed
    for k in ('default', 'hover', 'active', 'visited'):
        if k in ext.get('link', {}):
            add_ext(f'color.link.{k}', ext['link'][k])

    # surfaces
    for k in ('overlay', 'sunken', 'interactive', 'interactive-strong', 'disabled', 'backdrop'):
        if k in ext.get('surface', {}):
            add_ext(f'color.surface.{k}', ext['surface'][k])

    # text tones. A number means "this percent of ink over transparency" — which is why these
    # invert for free when ink inverts, from one declaration.
    for k, v in ext.get('text', {}).items():
        if isinstance(v, (int, float)):
            T.add(f'color.text.{k}', 'color', ink_alpha(v), f'--color-text-{k}', OWN,
                  group='enrichment', derived={'from': 'color.ink', 'fn': 'color-mix', 'space': 'srgb'})
        else:
            add_ext(f'color.text.{k}', v)

    # An `ink` or `border` key is the rest of a role id, so its spelling is the role. A key that
    # renders a declared role's property under another id (`strong-inverse` for `strong.inverse`)
    # builds `--color-border-strong-inverse` as token color.border.strong-inverse: the CSS a page
    # reads, under an id no contrast rule is keyed on, so the rule skips and the gate says PASS.
    # So such a key is refused, naming the id to use, and so is an `ink` key that is no role at
    # all, which was dropped without a word. `ink.on-dark` is a declared role, so the legacy
    # spelling `ink: {on-dark}` passes through here to the non-flipping family below.
    declared = declared_roles()
    by_property = {role_css(r): r for r in declared}
    for group in ('ink', 'border'):
        for k in ext.get(group, {}):
            rid = f'{group}.{k}'
            if rid in declared:
                continue
            twin = by_property.get(role_css(rid))
            if twin:
                raise ValueError(f"preset['extended']['{group}'] key {k!r} renders {role_css(rid)}, the "
                                 f"property of the role {twin!r}, under the id {rid!r}, which no contrast "
                                 f"rule is keyed on. Spell it {twin[len(group) + 1:]!r}.")
            if group == 'ink':
                raise ValueError(f"preset['extended']['ink'] key {k!r} is not a role: {rid!r} is not "
                                 'in contract/vocabulary.json, and an ink key the emitter does not know '
                                 'would be dropped without a word.')

    # The muted reading on surface.inverse (contract/vocabulary.json#colorRoles.extended.$inverse).
    # Its two border companions, `inverse` and `strong.inverse`, arrive through the border loop
    # below. The other `ink` key, `on-dark`, is the legacy spelling read with the non-flipping family.
    if 'muted.inverse' in ext.get('ink', {}):
        add_ext('color.ink.muted.inverse', ext['ink']['muted.inverse'])

    # border variants — same alpha-of-ink technique as the text tones. role_css, not an f-string:
    # `strong.inverse` has a dot in it, and a dot is a hyphen in a custom property's name.
    for k, v in ext.get('border', {}).items():
        # A percentage is an alpha of `ink`, and on `surface.inverse` ink is the wrong pole: the mix
        # lands on the band's own colour, and `{"inverse": 12}` rendered at 1.00:1. The inverse
        # companions (the roles whose id ends in `.inverse`) take a value, never a percentage.
        if isinstance(v, (int, float)) and f'border.{k}'.endswith('.inverse'):
            raise ValueError(f"preset['extended']['border'][{k!r}] is a percentage, an alpha of ink, "
                             'which on surface.inverse is the band\'s own colour. Give it a value, '
                             'such as a neutral rung, as {"light": ..., "dark": ...}.')
        if isinstance(v, (int, float)):
            T.add(f'color.border.{k}', 'color', ink_alpha(v), role_css(f'border.{k}'), OWN,
                  group='enrichment', derived={'from': 'color.ink', 'fn': 'color-mix', 'space': 'srgb'})
        else:
            add_ext(f'color.border.{k}', v)

    # status companions — derived from the status role and the surface, so they adapt in both
    sc = ext.get('statusCompanions', {})
    for k in preset['status']:
        for suffix in ('subtle', 'border'):
            pct = sc.get(suffix)
            if pct is None:
                continue
            T.add(f'color.{k}.{suffix}', 'color',
                  f'color-mix(in srgb, var(--color-{k}) {pct}%, var(--color-surface))',
                  f'--color-{k}-{suffix}', OWN, group='enrichment',
                  derived={'from': f'color.{k}', 'fn': 'color-mix', 'space': 'srgb'})
    for k, pct in (sc.get('glow') or {}).items():
        T.add(f'color.{k}.glow', 'color',
              f'color-mix(in srgb, var(--color-{k}) {pct}%, transparent)',
              f'--color-{k}-glow', OWN, group='enrichment',
              derived={'from': f'color.{k}', 'fn': 'color-mix', 'space': 'srgb'})

    # ── data-visualisation ────────────────────────────────────────────────────
    # Two different jobs behind one prefix, and swapping them is a real defect rather than a
    # stylistic one: the categorical slots encode IDENTITY (which series), the bands encode ORDER
    # (which rank). Bending a categorical slot into an ordinal ramp repaints a series as a rank.
    #
    # A brand of three role seeds yields three categorical hues, and slots beyond that can only be
    # lightness variants of slots already present. That is a measurable limit, not a shortfall to
    # be fixed by generating a sixth hue — state it in the token descriptions and let the
    # consumer's chart honour it. scripts/validate_palette.py is the instrument.
    for n in sorted(ext.get('chart', {}), key=lambda x: int(x)):
        add_ext(f'color.chart.{n}', ext['chart'][n],
                description=f'Categorical data-viz series {n} (Tier 2). Encodes identity — which '
                            'series this is — never rank.')
    for n in sorted(ext.get('chartBand', {}), key=lambda x: int(x)):
        total = len(ext['chartBand'])
        add_ext(f'color.chart.band.{n}', ext['chartBand'][n],
                description=f'Sequential position band {n} of {total}, hottest to faintest '
                            '(Tier 2). An ordinal fill for touching strips and stacked columns, '
                            'ALWAYS with an identifying legend; never a categorical series '
                            'colour, never a standalone mark.')
    if 'chartNeutral' in ext:
        add_ext('color.chart.neutral', ext['chartNeutral'],
                description='De-emphasised comparison SERIES (competitors, "lost", inactive). '
                            'Deliberately quiet — it must lose to every categorical slot — while '
                            'staying far enough from them that it cannot be mistaken for one. Not '
                            'a further series: series beyond the palette fold into "Other".')
    if 'chartInactive' in ext:
        add_ext('color.chart.inactive', ext['chartInactive'],
                description='The unlit or de-emphasised MARK — an off dot in a gauge, an inactive '
                            'segment. Must stay distinguishable from the TRACK it sits on, which '
                            'is why it cannot be surface.sunken: meters and gauges draw their '
                            'tracks with the sunken surface, and an unlit dot in the track\'s own '
                            'colour vanishes into it. Measure against both the track and the card.')

    # shadow colours (mode-aware, so every box-shadow token above adapts without carrying a mode)
    for k in ('sm', 'md', 'lg'):
        if k in ext.get('shadow', {}):
            add_ext(f'color.shadow.{k}', ext['shadow'][k])

    # brand states + the solid fill
    if 'active' in ext.get('brand', {}):
        add_ext('color.brand.active', ext['brand']['active'],
                description='Active/pressed brand state.')
    if 'fill' in ext.get('brand', {}):
        add_ext('color.brand.fill', ext['brand']['fill'],
                description='Solid brand-button fill. NOT the seed: a fill carries text on it and '
                            'therefore has a contrast obligation the exact seed was never chosen '
                            'to meet, which is why every consumer that reached for the seed here '
                            'ended up hard-coding its own text colour instead.')
    if 'onBrandFill' in ext:
        add_ext('color.on-brand-fill', ext['onBrandFill'],
                description='Text/icon colour on color.brand.fill. This pair is the one that has '
                            'to measure — see contract/vocabulary.json#contrast.')
    if 'onTint' in ext.get('brand', {}):
        add_ext('color.on-brand-tint', ext['brand']['onTint'],
                description='The glyph/text colour drawn ON color.brand.tint (an icon-chip glyph, '
                            'a link) — NOT color.brand.fill, which is the solid button surface, a '
                            'different job. Inverts opposite to the tint\'s own wash: see '
                            'contract/vocabulary.json#colorRoles.extended.$secondaryAccentWhy.')

    # secondary's own fill/tint, accent's tint, and the on-*-tint glyph role for all three —
    # marketing kit L2's card components (18/08/2026, revised the same day). `*.tint` is a WASH:
    # it stays a dark wash in dark mode. `on-*-tint` is the glyph/text drawn ON it, and THAT is
    # what inverts — decoupled from whatever `brand`/`accent` do as their own bare role, which is
    # why this no longer reads `ext['accent']` for the glyph the way the first attempt did.
    # `accent` already IS the accent fill (paired with `on-accent`) and is untouched here.
    sec = ext.get('secondary', {})
    if 'fill' in sec:
        add_ext('color.secondary.fill', sec['fill'],
                description="Solid fill for the secondary hue — brand.fill's counterpart for "
                            'color.secondary. A genuine solid button/surface fill (FeatureCard\'s '
                            'own CTA pill), mode-invariant, distinct from color.secondary.tint\'s '
                            'wash job.')
    if 'tint' in sec:
        add_ext('color.secondary.tint', sec['tint'],
                description="Secondary-hue tinted WASH — brand.tint's counterpart. Stays a dark "
                            'wash in dark mode. Pairs with color.on-secondary-tint (the glyph) '
                            'and with color.ink (plain text) — see contract/vocabulary.json#contrast.')
    if 'onTint' in sec:
        add_ext('color.on-secondary-tint', sec['onTint'],
                description="The glyph/text colour drawn ON color.secondary.tint — inverts "
                            'opposite to the wash (light-register step in both modes).')
    acc = ext.get('accent', {})
    if 'tint' in acc:
        add_ext('color.accent.tint', acc['tint'],
                description="Accent-hue tinted WASH — brand.tint's counterpart for color.accent, "
                            'which (with on-accent) already is the accent fill pair, so only the '
                            'wash was missing. Stays a dark wash in dark mode.')
    if 'onTint' in acc:
        add_ext('color.on-accent-tint', acc['onTint'],
                description="The glyph/text colour drawn ON color.accent.tint. Deliberately NOT "
                            'the same as color.accent (the fill role) — see color.on-brand-tint.')

    # ── the NON-FLIPPING family ────────────────────────────────────────────────
    # Roles for a ground that is dark in BOTH themes: a full-bleed band, a photographic hero, a
    # media overlay. Everything else in this vocabulary answers "what does this mean in the
    # current theme"; these answer "what does this mean on a ground that never changes".
    #
    # The two anchors came first and were enough for a headline on a band. The QUIETER readings —
    # a muted paragraph, a hairline, the wash behind a secondary button — had no role, so the
    # first application to need them derived them itself, out of the anchors and the opacity
    # scale. That derivation was good by every rule this repo states: no component knew a colour.
    # It was still wrong, for one reason worth stating in full, because it is the reason the
    # extended vocabulary exists at all:
    #
    #   A ROLE GETS MEASURED BY THE CONFORMANCE GATE. AN APP-SIDE MIX DOES NOT.
    #
    # Move the preset and every role is re-checked; the three mixes in an application's stylesheet
    # are not, and they fail silently on the surface with the most traffic. Which is the same
    # "green gate, unmeasured role" shape as the status roles rendering at 2.2:1 on a dark canvas
    # while five enumerated contrast pairs all passed.
    #
    # Consequence for values: a role with a measurement obligation must be RESOLVABLE. An
    # unresolved color-mix() cannot be measured, so a gate meeting one can only report it
    # unverified — which recreates the hole. Resolve the mix at build time, as the status dark
    # rung above does, or point at a real value.
    od = ext.get('onDark', {})
    ink_on_dark = od.get('ink', ext.get('ink', {}).get('on-dark'))
    if ink_on_dark is not None:
        add_ext('color.ink.on-dark', ink_on_dark,
                description='Text/icon/border on a surface that is dark in BOTH themes '
                            '(photographic or immersive heroes, media overlays). Does NOT invert '
                            "— that is ink.inverse's job, and reaching for it here is the "
                            'commonest way a hero goes unreadable in one theme.')
    if 'ink-muted' in od:
        add_ext('color.ink.on-dark.muted', od['ink-muted'],
                description='The de-emphasised reading on a surface that is dark in BOTH themes — '
                            'the supporting paragraph under a full-bleed band\'s headline. NOT '
                            'ink.muted, whose failure here is asymmetric and therefore survives '
                            'review: it flips, so it is right in dark mode and unreadable on the '
                            'same band in light. Must clear the text contrast property against '
                            'surface.deep AND surface.deep-raised, in both modes.')
    if 'border' in od:
        add_ext('color.border.on-dark', od['border'],
                description='The hairline on a surface that is dark in BOTH themes. border and '
                            'border.subtle both flip or track ink, so both are wrong here for the '
                            'same reason ink.muted is. Non-text contrast obligation against '
                            'surface.deep — an invisible outline on a ghost control removes the '
                            'control.')
    if 'highlight' in od:
        add_ext('color.highlight.on-dark', od['highlight'],
                description="The brand's highlight hue on a surface that is dark in BOTH themes "
                            '— an eyebrow, an icon tint, a small emphasised label on a full-bleed '
                            'band. NOT accent: that role is the general-purpose tinted-fill/on-'
                            'fill pair, and reaching for it here would inherit whatever hue '
                            'accent happens to be rather than the highlight family. Same '
                            'obligation shape as ink.on-dark — text contrast against '
                            'surface.deep AND surface.deep-raised, in both modes.')
    for k, tid in (('wash', 'color.surface.on-dark-wash'),
                   ('wash-hover', 'color.surface.on-dark-wash-hover')):
        if k in od:
            add_ext(tid, od[k],
                    description='The low-opacity fill behind a secondary control on a surface '
                                'that is dark in BOTH themes. It LIGHTENS the ground, so the '
                                'label on it has LESS contrast than the same text beside it on '
                                'the bare band — that inherited pair is the measurement, and the '
                                'one an app-side derivation never makes.'
                                + (' The hover rung is the lighter of the pair, so it is the '
                                   'worst case.' if k == 'wash-hover' else ''))

    # gradients — decorative, and referencing ramp steps rather than restating them
    for name, value in (preset.get('gradients') or {}).items():
        light, dark = _mode_pair(value)
        T.add(f'gradient.{name}', 'gradient', light, f'--gradient-{name}', OWN, group='enrichment',
              modes=_modes(light, dark),
              description='Decorative gradient. References ramp steps rather than restating their '
                          'values, so editing the ramp cannot desync the gradient from it.')

    # The two grounds of the non-flipping family. They emit LAST rather than beside their family
    # above purely because that is where they already were — position in this list is emitted
    # order, and moving them would change a shipping stylesheet to make a source file read better.
    for k in ('deep', 'deep-raised'):
        value = od.get(k, ext.get('surfaceDeep', {}).get(k))
        if value is not None:
            add_ext(f'color.surface.{k}', value,
                    description=('Page surface that is dark in BOTH themes.' if k == 'deep' else
                                 'Raised card/input surface over color.surface.deep. Same '
                                 'non-flipping contract.'))

    # ══════════ NON-COLOUR PRIMITIVES AND SCALES ══════════
    # A family may depend on colour roles it does not own. Emitting it without them writes a
    # var() nobody declares, which renders as an unstyled element rather than as an error — so
    # the dependency is declared in SCALE_SHAPE and checked here, before anything is written.
    for fam, spec in SCALE_SHAPE.items():
        if fam not in S or not S[fam]:
            continue
        missing = [t for t in spec.get('requiresTokens', ()) if t not in T]
        if missing:
            raise ValueError(
                f"scales[{fam!r}] is supplied but the colour role(s) it depends on are not: "
                f"{missing}. Supply them in preset['extended'] (e.g. extended.shadow), or drop "
                f"the {fam!r} family. Emitting it anyway would write a var() that resolves to "
                "nothing, and an unresolved custom property fails silently at paint time.")

    # Every scale token, from the contract's reference consumer (see scale_tokens() above). The
    # typography families come before the fourth font family below and the space and layout
    # families after it, because that is where each block has always been written: position in the
    # token table is emitted order, in tokens.ts's cssVar map among other places.
    TW = prov['tailwind']
    typography_ends = list(SCALE_SHAPE).index('measure')
    derived_tokens = scale_tokens(S)
    for t in derived_tokens:
        if list(SCALE_SHAPE).index(t['family']) <= typography_ends:
            _add_scale_token(T, t, OWN, TW)

    # THE FOURTH FAMILY, emitted last in its domain (see the FAMILY_CSS block above for why here
    # and why the property is named as it is). The role comes WITH the family and is not optional:
    # a role that aliases a family nothing declares renders the browser default, which reads as a
    # styling choice rather than a build error, and _family() refuses it for exactly that reason.
    # CSS resolves var() at computed-value time, so a family declared after the roles that
    # reference it is not a problem — declaration order here is cosmetic.
    if 'display' in preset['fontSystem']:
        src = (f'{PSRC} brand family + {OWN} system stack' if fp.get('display')
               else f'{OWN} system stack')
        T.add('typography.family.display', 'fontFamily', famval('display'), '--font-display-family',
              src, group='families',
              description='Poster/display face — a FOURTH family beside sans, serif and mono. '
                          'Components consume the ROLE (--font-display), never this.')
        if not display_role_done:
            T.add('typography.role.display', 'fontFamily', 'var(--font-display-family)',
                  '--font-display', OWN, group='families',
                  description='Display role (Tier 2) — poster type at the top of the scale, where '
                              'the face chosen to be legible at body size is not the face you '
                              'want at the largest step.')

    # TEXT ROLES, last in the typography domain, so that every family and typography role they
    # can point at is already in the table. OPT-IN: without a declaration nothing is emitted and no
    # byte of an existing build moves. The contract's defaults are sourced to the contract; an
    # override is the product's own decision and is sourced to it.
    if typography is not None:
        fonts = [tid[len('typography.role.'):] for tid in T.ids() if tid.startswith('typography.role.')]
        colours = sorted({rec['css'][len('--color-'):] for _, rec in T.items()
                          if rec['css'].startswith('--color-')})
        for tok in text_role_tokens(typography, S, fonts, colours):
            T.add(tok['id'], tok['type'], tok['value'], tok['css'],
                  OWN if tok['overridden'] else prov['textRoles'], group='text')

    for t in derived_tokens:
        if list(SCALE_SHAPE).index(t['family']) > typography_ends:
            _add_scale_token(T, t, OWN, TW)

    return T


# ══════════════════════════════════════════════════════════════════════════════
# EMIT — the token tree, the master index, the CSS, the JS/TS
# ══════════════════════════════════════════════════════════════════════════════
_SPLIT = {'color': True, 'typography': True, 'motion': True}

DEFAULT_TREE_SOURCE = ('Generated from the preset by scripts/emit.py in @lightlysaltedhq/design-foundations — do not '
                       'hand-edit.')

DEFAULT_CONVENTIONS = collections.OrderedDict([
    ('id', 'Dot-notation mirroring the CSS custom property: color.primary.500 <-> --color-primary-500.'),
    ('roleSeed', 'color.{role}.base is the VERBATIM brand colour; color.{role}.{50..950} is the derived ladder.'),
    ('ramps', 'DERIVED role ladders are 11 steps (50..950) — an output of the derivation spec. Every '
              'hand-authored ramp\'s length is the implementation\'s own choice; ramp length is '
              'deliberately not part of the shared contract.'),
    ('$value', 'Resolved, ready-to-use value or the literal CSS declaration (var()/color-mix()).'),
    ('modes', 'Present when the token differs between light and dark. Absent = mode-agnostic.'),
])

DEFAULT_DERIVATION_NOTE = ('gamut-mapped OKLCH — implements @lightlysaltedhq/design-foundations/derivation; '
                           'proven against its frozen vectors.')


def _domains(tokens):
    doms = collections.OrderedDict()
    for tid, rec in tokens.items():
        doms.setdefault(tid.split('.')[0], collections.OrderedDict())[tid] = rec
    return doms


def _group_of(dom, tid, rec):
    if dom == 'motion':
        return tid.split('.')[1]
    return rec.get('group', 'index')


def write_token_tree(tokens, out_dir, identity, tree_source=DEFAULT_TREE_SOURCE):
    """tokens/<domain>/index.json (+ per-group files where a domain splits). Returns (summary, master)."""
    domain_summary, master = collections.OrderedDict(), collections.OrderedDict()
    for dom, toks in _domains(tokens).items():
        dpath = os.path.join(out_dir, 'tokens', dom)
        os.makedirs(dpath, exist_ok=True)
        groups = collections.OrderedDict()
        for tid, rec in toks.items():
            groups.setdefault(_group_of(dom, tid, rec), collections.OrderedDict())[tid] = rec
        split = _SPLIT.get(dom) and len(groups) > 1
        if split:
            for grp, gt in groups.items():
                d = collections.OrderedDict([
                    ('$schema', '../../schema/tokens.schema.json'),
                    ('domain', dom), ('group', grp), ('count', len(gt)), ('source', tree_source),
                ])
                d['tokens'] = gt
                json.dump(d, open(os.path.join(dpath, f'{grp}.json'), 'w'), indent=2)
        idx = collections.OrderedDict([
            ('$schema', '../../schema/tokens.schema.json'),
            ('domain', dom), ('version', identity.version), ('generated', identity.generated),
            ('count', len(toks)),
            ('groups', collections.OrderedDict((g, len(v)) for g, v in groups.items())),
            ('files', [f'{g}.json' for g in groups] if split else []),
            ('tokens', toks),
        ])
        json.dump(idx, open(os.path.join(dpath, 'index.json'), 'w'), indent=2)
        domain_summary[dom] = {'count': len(toks), 'groups': list(groups),
                               'index': f'tokens/{dom}/index.json'}
        for tid, rec in toks.items():
            master[tid] = collections.OrderedDict([
                ('domain', dom), ('type', rec['$type']), ('css', rec['css']), ('value', rec['$value']),
                ('modes', 'modes' in rec), ('derived', bool(rec.get('derived'))),
                ('exactSeed', bool(rec.get('exactSeed'))),
                ('file', f'tokens/{dom}/index.json'), ('source', rec['source']),
            ])
    return domain_summary, master


def write_index(out_dir, identity, domain_summary, master, palette_source=None,
                derivation_note=DEFAULT_DERIVATION_NOTE, conventions=None, extra=None):
    """index.json — the master manifest. `extra` is inserted after totalTokens, in its own order."""
    if palette_source is None:
        palette_source = (f'{identity.preset} — presets/{identity.preset}/preset.json. This '
                          'implementation owns every value here. The shared rules live in '
                          '@lightlysaltedhq/design-foundations; colours are never shared.')
    mi = collections.OrderedDict([
        ('$schema', './schema/index.schema.json'),
        ('name', identity.name), ('version', identity.version), ('generated', identity.generated),
        ('preset', identity.preset),
        ('paletteSource', palette_source),
        ('derivation', derivation_note),
        ('totalTokens', len(master)),
    ])
    for k, v in (extra or {}).items():
        mi[k] = v
    mi['domains'] = domain_summary
    mi['conventions'] = conventions if conventions is not None else DEFAULT_CONVENTIONS
    mi['tokens'] = master
    json.dump(mi, open(os.path.join(out_dir, 'index.json'), 'w'), indent=2)
    return mi


def _css_light(rec): return rec['modes']['light'] if 'modes' in rec else rec['$value']
def _css_dark(rec): return rec['modes']['dark'] if 'modes' in rec else None


def _by_domain_list(tokens):
    doms = collections.OrderedDict()
    for tid, rec in tokens.items():
        doms.setdefault(tid.split('.')[0], []).append((tid, rec))
    return doms


# WHERE THE COMPILED ARTEFACTS GO, relative to out_dir. It is a parameter because a repository
# that generates SEVERAL themes has to put each one somewhere different, and the alternative —
# out_dir/<theme>/build/ — buries the stylesheets a consumer imports one level deeper than the
# JSON corpus nobody imports. Passing '.' makes out_dir itself the package root, which is the
# arrangement every internal relative path in the emitted tree already assumes: tokens/<domain>/
# index.json points at ../../schema, and index.json points at ./schema and tokens/<domain>/.
# Change this default and those references stop resolving.
DEFAULT_BUILD_DIR = 'build'


def write_tokens_css(tokens, out_dir, identity, dark_selector='[data-theme="dark"]',
                     build_dir=DEFAULT_BUILD_DIR):
    """<build_dir>/tokens.css — :root plus ONE dark block that re-points Tier 2. No component ever
    carries a dark variant; if it needs one, the roles are not doing their job."""
    doms = _by_domain_list(tokens)
    L = [f'/* {identity.title} — design tokens (preset: {identity.preset})',
         f' * GENERATED from themes/ — do not hand-edit. Run `{identity.command}`.',
         f' * {identity.palette_note}Derivation: gamut-mapped OKLCH (build-time).',
         f' * Dark mode activates on {dark_selector}.',
         ' */', '', ':root {']
    for dom, items in doms.items():
        real = [(t, rc) for t, rc in items if not rc['css'].startswith('(')]
        if not real:
            continue
        L.append(f'\n  /* ── {dom.upper()} ── */')
        for t, rc in real:
            L.append(f"  {rc['css']}: {_css_light(rc)};")
    L.append('}\n')
    L.append(dark_selector + ' {')
    # A text-role token that points at a property with a dark value is declared AGAIN here, with the
    # same value. A custom property's var() is substituted where it is declared and the result
    # inherits, so --text-display--font-weight: var(--weight-bold), declared on :root, carries
    # :root's light bold into a nested [data-theme="dark"] subtree, where --weight-bold is the dark
    # one. Re-declared on the dark selector, it is substituted there. Measured in
    # chrome-headless-shell (#24 re-review): nested, display rendered 700 where 600 is right.
    moded = {rc['css'] for _, rc in tokens.items() if _css_dark(rc) is not None}
    for dom, items in doms.items():
        dk = [(t, rc) for t, rc in items if _css_dark(rc) is not None and not rc['css'].startswith('(')]
        again = [(t, rc) for t, rc in items if rc.get('group') == 'text' and _css_dark(rc) is None
                 and set(_VAR_RE.findall(str(rc['$value']))) & moded]
        if not dk and not again:
            continue
        L.append(f'\n  /* ── {dom.upper()} ── */')
        for t, rc in dk:
            L.append(f"  {rc['css']}: {_css_dark(rc)};")
        for t, rc in again:
            L.append(f"  {rc['css']}: {rc['$value']};")
    L.append('}')
    build = os.path.join(out_dir, build_dir)
    os.makedirs(build, exist_ok=True)
    open(os.path.join(build, 'tokens.css'), 'w').write('\n'.join(L) + '\n')


def write_ts_js_dts(tokens, out_dir, identity, build_dir=DEFAULT_BUILD_DIR):
    """build/tokens.ts (readable source) + tokens.js/.d.ts (real ESM + types).

    Emitting only .ts is a trap worth naming: a package that exports a raw .ts with no main and no
    types only resolves for a consumer who transpiles node_modules, which nobody does by default.
    """
    doms = _by_domain_list(tokens)
    head = f'// {identity.title} — design tokens (GENERATED — do not hand-edit). Preset: {identity.preset}.'
    lines = [head,
             '// Values are resolved hexes (ramps) or literal CSS declarations (roles). '
             'Prefer cssVar + the CSS import.',
             '', 'export const tokens = {']
    for dom, items in doms.items():
        lines.append(f'  // ── {dom} ──')
        for tid, rc in items:
            lines.append(f'  {json.dumps(tid)}: {json.dumps(rc["$value"])},')
    lines.append('} as const;\n')
    lines.append('export type TokenId = keyof typeof tokens;')
    lines.append('\nexport const cssVar: Record<TokenId, string> = {')
    for tid, rc in tokens.items():
        if not rc['css'].startswith('('):
            lines.append(f'  {json.dumps(tid)}: {json.dumps(rc["css"])},')
    lines.append('} as unknown as Record<TokenId, string>;\n')
    lines.append('/** Tokens that differ between light and dark. */')
    lines.append('export const modal: TokenId[] = [')
    for tid, rc in tokens.items():
        if 'modes' in rc:
            lines.append(f'  {json.dumps(tid)},')
    lines.append('];\n')
    lines.append('/** The verbatim exact-seed brand tokens (color.{role}.base). */')
    lines.append('export const exactSeed: TokenId[] = [')
    for tid, rc in tokens.items():
        if rc.get('exactSeed'):
            lines.append(f'  {json.dumps(tid)},')
    lines.append('];')
    build = os.path.join(out_dir, build_dir)
    os.makedirs(build, exist_ok=True)
    open(os.path.join(build, 'tokens.ts'), 'w').write('\n'.join(lines) + '\n')

    js = [l.replace(' as const;', ';')
           .replace('export const cssVar: Record<TokenId, string> = {', 'export const cssVar = {')
           .replace('} as unknown as Record<TokenId, string>;', '};')
           .replace('export const modal: TokenId[] = [', 'export const modal = [')
           .replace('export const exactSeed: TokenId[] = [', 'export const exactSeed = [')
          for l in lines]
    js = [l for l in js if not l.startswith('export type TokenId')]
    js[0] = head
    open(os.path.join(build, 'tokens.js'), 'w').write('\n'.join(js) + '\n')

    dts = [head, '']
    dts.append('export declare const tokens: {')
    for tid, rc in tokens.items():
        dts.append(f'  readonly {json.dumps(tid)}: {json.dumps(rc["$value"])};')
    dts.append('};')
    dts.append('export type TokenId = keyof typeof tokens;')
    dts.append('export declare const cssVar: Record<TokenId, string>;')
    dts.append('/** Tokens that differ between light and dark. */')
    dts.append('export declare const modal: TokenId[];')
    dts.append('/** The verbatim exact-seed brand tokens (color.{role}.base). */')
    dts.append('export declare const exactSeed: TokenId[];')
    open(os.path.join(build, 'tokens.d.ts'), 'w').write('\n'.join(dts) + '\n')


# ── build/app-tokens.css — the shadcn/ui adapter ─────────────────────────────
# The declaration block below is a literal template rather than a generated one on purpose: the
# column alignment is part of the file's readability, and every VALUE is a named substitution, so
# an implementation can re-point any single role without this module holding one.
SHADCN_DEFAULT_VALUES = {
    'background': 'var(--color-surface)',
    'foreground': 'var(--color-ink)',
    'card': 'var(--color-surface-overlay)',
    'card_foreground': 'var(--color-ink)',
    'card_border': 'var(--color-border-subtle)',
    'popover': 'var(--color-surface-overlay)',
    'popover_foreground': 'var(--color-ink)',
    'popover_border': 'var(--color-border-subtle)',
    'primary': 'var(--color-brand-fill)',
    'primary_foreground': 'var(--color-on-brand-fill)',
    'secondary': 'var(--color-surface-sunken)',
    'secondary_foreground': 'var(--color-ink)',
    'muted': 'var(--color-surface-sunken)',
    'muted_foreground': 'var(--color-ink-muted)',
    'accent': 'var(--color-surface-sunken)',
    'accent_foreground': 'var(--color-ink)',
    'destructive': 'var(--color-error)',
    'destructive_foreground': 'var(--color-ink-on-dark)',
    'border': 'var(--color-border)',
    'input': 'var(--color-border-strong)',
    'ring': 'var(--color-focus)',
    'chart_1': 'var(--color-chart-1)',
    'chart_2': 'var(--color-chart-2)',
    'chart_3': 'var(--color-chart-3)',
    'chart_4': 'var(--color-chart-4)',
    'chart_5': 'var(--color-chart-5)',
    'elevate_1': 'var(--color-surface-interactive)',
    'elevate_2': 'var(--color-surface-interactive-strong)',
    'button_outline': 'color-mix(in srgb, var(--color-ink) 10%, transparent)',
    'badge_outline': 'var(--color-border)',
    'radius': 'var(--radius-sm)',
    'primary_border': 'var(--color-brand-fill)',
    'secondary_border': 'var(--color-surface-sunken)',
    'muted_border': 'var(--color-surface-sunken)',
    'accent_border': 'var(--color-surface-sunken)',
    'destructive_border': 'var(--color-error)',
    # Two sentences of the body's own prose, substitutable for the same reason the values are:
    # what a system calls its recessed surface, and where its reasoning is written down, are
    # facts about that system.
    'note_fill': 'must satisfy contrast.',
    'note_recessed': 'intent, not by value, and a system with a single recessed surface answers '
                     'all three.',
}

_SHADCN_BODY = '''

:root {
  /* ── surfaces + text ── */
  --background: %(background)s;
  --foreground: %(foreground)s;

  --card:            %(card)s;
  --card-foreground: %(card_foreground)s;
  --card-border:     %(card_border)s;

  --popover:            %(popover)s;
  --popover-foreground: %(popover_foreground)s;
  --popover-border:     %(popover_border)s;

  /* ── brand ──
   * --primary is the SOLID FILL role, not the seed: it carries --primary-foreground text, so it
   * %(note_fill)s */
  --primary:            %(primary)s;
  --primary-foreground: %(primary_foreground)s;

  /* secondary / muted / accent are one fill in this vocabulary — shadcn distinguishes them by
   * %(note_recessed)s */
  --secondary:            %(secondary)s;
  --secondary-foreground: %(secondary_foreground)s;
  --muted:                %(muted)s;
  --muted-foreground:     %(muted_foreground)s;
  --accent:               %(accent)s;
  --accent-foreground:    %(accent_foreground)s;

  --destructive:            %(destructive)s;
  --destructive-foreground: %(destructive_foreground)s;

  /* ── lines ── */
  --border: %(border)s;
  --input:  %(input)s;
  --ring:   %(ring)s;

  /* ── data-viz ── */
  --chart-1: %(chart_1)s;
  --chart-2: %(chart_2)s;
  --chart-3: %(chart_3)s;
  --chart-4: %(chart_4)s;
  --chart-5: %(chart_5)s;

  /* ── interaction ──
   * --elevate-1/2 are the two rungs of the hover/active overlay system. --button-outline is
   * ink-alpha, so it inverts with --color-ink automatically: a dark hairline in light mode, a
   * light one in dark, from ONE declaration. --badge-outline WAS a five-percent ink alpha and
   * measured invisible in dark (a sliver of near-white over navy — the outline badge read as
   * bare text; correctness review 18/08/2026, E13); it now reads the border role, which is what
   * the badge painted before the consolidation and is tuned per theme and mode already. */
  --elevate-1: %(elevate_1)s;
  --elevate-2: %(elevate_2)s;
  --button-outline: %(button_outline)s;
  --badge-outline:  %(badge_outline)s;

  /* ── shape ──
   * shadcn derives its lg/md/sm radii from this single --radius. */
  --radius: %(radius)s;

  /* ── shadcn *-border companions ──
   * These exist because shadcn's Tailwind preset maps `<role>.border` separately; each simply
   * tracks its own fill. */
  --primary-border:     %(primary_border)s;
  --secondary-border:   %(secondary_border)s;
  --muted-border:       %(muted_border)s;
  --accent-border:      %(accent_border)s;
  --destructive-border: %(destructive_border)s;
}
'''


def default_shadcn_preamble(identity):
    return f'''/* {identity.title} — app/shadcn token adapter (GENERATED, preset: {identity.preset})
 *
 * Expresses the shadcn/ui role vocabulary (--background, --card, --primary, …) in terms of this
 * package's Tier 2 roles, so an app UI built on shadcn can consume the brand WITHOUT restating a
 * single colour.
 *
 * USAGE — import BOTH, tokens.css FIRST, before your Tailwind entry:
 *
 *   import '{identity.name}/build/tokens.css'
 *   import '{identity.name}/build/app-tokens.css'
 *   import './globals.css'
 *
 * tokens.css is NOT optional: every declaration here is a var() reference into it and this file
 * defines ZERO values of its own. Import this one alone and the app is silently unthemed.
 *
 * ── WHY THERE IS NO DARK BLOCK ──
 * This file is MODE-INVARIANT, and that is the entire point of it.
 *
 * Dark mode in this system is a Tier 2 inversion (@lightlysaltedhq/design-foundations/vocabulary):
 * tokens.css re-points --color-surface, --color-ink, --color-border … under the dark selector.
 * Because every line below is a REFERENCE rather than a value, dark mode is inherited — the
 * moment the attribute flips, --background follows --color-surface on its own.
 *
 * Consequence for consumers: DELETE your app's dark palette block. Do not re-declare these under
 * a dark selector "to be safe" — that reintroduces exactly the second source of truth this file
 * exists to remove, and it will silently drift from the roles it duplicates.
 *
 * Requires the consuming app to switch dark mode on the same selector tokens.css uses, NOT on a
 * `.dark` class. In Tailwind:  darkMode: ["selector", '[data-theme="dark"]']
 *
 * ── VALUES ARE WHOLE COLOURS, NOT CHANNEL TRIPLES ──
 * shadcn's own template stores `--primary: 222 47% 11%` and consumes it as
 * `hsl(var(--primary) / <alpha-value>)`. That encoding cannot express a var() chain, a
 * color-mix(), or anything this package publishes, so these are whole colours. A consuming
 * Tailwind config must therefore map them as raw values and implement opacity modifiers with
 * color-mix, e.g.
 *   primary: ({{ opacityValue }}) => opacityValue === undefined
 *     ? 'var(--primary)'
 *     : `color-mix(in srgb, var(--primary) calc(${{opacityValue}} * 100%), transparent)`
 * Without that, every `bg-primary/50` in the app silently renders fully opaque.
 *
 * ── NOT EMITTED, DELIBERATELY ──
 *   --sidebar-*  mapping seven roles nothing consumes would be speculative. Build them from
 *                --color-surface-alt / --color-border / --color-brand-fill when a sidebar lands.
 *   --font-*     tokens.css already emits the family and role tokens. A next/font `.variable`
 *                class on <body> out-cascades :root for its descendants, so a self-hosted face
 *                keeps winning without anything here.
 *   --shadow-*, --ease-*, --radius-md/lg
 *                all already in tokens.css under their own names — consume them directly.
 */'''


def write_app_tokens_css(out_dir, identity, values=None, preamble=None, declared=None,
                         build_dir=DEFAULT_BUILD_DIR):
    """build/app-tokens.css — the component-library adapter. Zero values of its own.

    `declared` is the set of custom properties the token stylesheet declares. Pass it and the
    adapter refuses to emit unless every role it maps actually exists; omit it and you are
    choosing to skip that check, which generate() never does.
    """
    v = dict(SHADCN_DEFAULT_VALUES)
    v.update(values or {})

    # Every substitution lands inside a file that is one big comment plus one rule block. A value
    # carrying `*/` closes the comment early and everything after it becomes live CSS — which in
    # a file whose entire promise is "defines ZERO values of its own" means an injected value
    # becomes a real declaration. Cheap to check, and impossible to spot by reading the output.
    for key, value in v.items():
        if '*/' in str(value):
            raise ValueError(
                f'adapter value {key!r} contains "*/", which would close a CSS comment early and '
                'turn whatever follows into live declarations in a file that is supposed to '
                'declare no values of its own.')
    text = preamble if preamble is not None else default_shadcn_preamble(identity)
    if not (text.startswith('/*') and text.rstrip().endswith('*/') and '*/' not in text[:-2]):
        raise ValueError(
            'the adapter preamble must be exactly one CSS comment: it has to start with "/*", end '
            'with "*/", and contain no other "*/". Anything else leaks its tail into the '
            'stylesheet as live CSS.')

    if declared is not None:
        missing = adapter_missing_dependencies(v, declared)
        if missing:
            raise ValueError(
                f'the adapter maps {len(missing)} role(s) this token set does not declare: '
                f'{", ".join(missing)}.\n'
                '  The adapter defines no values of its own — every line is a reference — so a '
                'role it maps but you do not emit becomes a dangling var() and the component '
                'silently renders unstyled. Either supply those roles in preset["extended"], '
                'override the mapping via adapter_values=, or pass emit_adapter=False.')

    text += (_SHADCN_BODY % v)
    build = os.path.join(out_dir, build_dir)
    os.makedirs(build, exist_ok=True)
    open(os.path.join(build, 'app-tokens.css'), 'w').write(text)


# ══════════════════════════════════════════════════════════════════════════════
# THE REFERENCE GATE — every var() in every emitted stylesheet must resolve
#
# One mechanism, three bugs. v2.0.0 emitted, from a MINIMAL conformant preset: 15 undeclared
# references in the shadcn adapter (its default mapping names extended roles the preset never
# supplied), three in tokens.css (Base's own default box-shadows referenced shadow COLOUR roles
# Base does not emit), and a dangling --font-heading whenever fontSystem declared no `sans`.
#
# Each had its own local fix, and fixing them one at a time would have left the fourth. An
# unresolved custom property is CSS's worst failure mode: it is valid, it throws nothing, and the
# property falls back to its initial value — so a card renders transparent, a shadow renders
# black, a heading renders Times. Nobody sees a build error; somebody sees an ugly page, later.
#
# The consuming implementation already claimed this property ("no dangling references"). Base
# must own it, because Base is now what produces them.
# ══════════════════════════════════════════════════════════════════════════════
_DECL_RE = re.compile(r'^\s*(--[\w-]+)\s*:', re.M)
_VAR_RE = re.compile(r'var\(\s*(--[\w-]+)')


def css_declarations(text):
    """Every custom property a stylesheet DECLARES."""
    return set(_DECL_RE.findall(text))


def css_references(text):
    """Every custom property a stylesheet REFERENCES, as (property, line number)."""
    out = []
    for n, line in enumerate(text.splitlines(), 1):
        for m in _VAR_RE.finditer(line):
            out.append((m.group(1), n))
    return out


def assert_css_references_resolve(out_dir, files=('build/tokens.css', 'build/app-tokens.css'),
                                  root='build/tokens.css'):
    """Fail closed unless every var() in every emitted stylesheet resolves to a property declared
    by the emitted set.

    `root` is the token stylesheet: an adapter legitimately declares nothing of its own and
    references the root's properties throughout — that IS an adapter — so each file resolves
    against (root's declarations + its own).
    """
    paths = [f for f in files if os.path.isfile(os.path.join(out_dir, f))]
    if root not in paths:
        raise ValueError(f'{root} was not emitted, so nothing can be resolved against it.')
    root_text = open(os.path.join(out_dir, root), encoding='utf-8').read()
    root_decls = css_declarations(root_text)

    dangling = []
    for rel in paths:
        text = open(os.path.join(out_dir, rel), encoding='utf-8').read()
        allowed = root_decls | css_declarations(text)
        for prop, line in css_references(text):
            if prop not in allowed:
                dangling.append((rel, line, prop))
    if dangling:
        detail = '\n'.join(f'    {rel}:{line}  {prop}' for rel, line, prop in dangling)
        raise ValueError(
            f'{len(dangling)} dangling var() reference(s) in the emitted CSS — each one resolves '
            f'to nothing:\n{detail}\n'
            '  An unresolved custom property is valid CSS that throws nothing and falls back to '
            'the property\'s initial value, so this ships as a rendering bug rather than a build '
            'failure. Supply the missing role in the preset, or stop emitting whatever references '
            'it.')
    return sum(len(css_references(open(os.path.join(out_dir, r), encoding='utf-8').read()))
               for r in paths)


def adapter_missing_dependencies(values, declared):
    """Which properties the adapter would reference that the token set does not declare."""
    missing = []
    for key, value in values.items():
        for prop, _ in css_references(str(value)):
            if prop not in declared and prop not in missing:
                missing.append(prop)
    return missing


def declared_properties(tokens):
    return {rec['css'] for _, rec in tokens.items() if not rec['css'].startswith('(')}


def write_schema(out_dir, identity):
    """schema/tokens.schema.json + schema/index.schema.json — the shape a consumer can validate."""
    spath = os.path.join(out_dir, 'schema')
    os.makedirs(spath, exist_ok=True)
    schema = {
        "$schema": "http://json-schema.org/draft-07/schema#", "title": f"{identity.title} token file",
        "type": "object", "required": ["domain", "tokens"],
        "properties": {
            "domain": {"type": "string"}, "group": {"type": "string"}, "count": {"type": "integer"},
            "tokens": {"type": "object", "additionalProperties": {
                "type": "object", "required": ["$value", "$type", "css", "source"],
                "properties": {
                    "$value": {}, "$type": {"enum": ["color", "gradient", "shadow", "dimension", "number",
                                                     "duration", "cubicBezier", "fontFamily", "fontWeight"]},
                    "css": {"type": "string"}, "source": {"type": "string"}, "group": {"type": "string"},
                    "role": {"enum": ["primary", "secondary", "accent"]}, "exactSeed": {"type": "boolean"},
                    "description": {"type": "string"}, "note": {"type": "string"},
                    "modes": {"type": "object", "required": ["light", "dark"],
                              "properties": {"light": {}, "dark": {}}},
                    "derived": {"type": "object"}, "runtime": {"type": "object"}, "fluid": {"type": "object"},
                    "adopted": {"type": "object"}, "px": {"type": "string"}}}}}}
    json.dump(schema, open(os.path.join(spath, 'tokens.schema.json'), 'w'), indent=2)
    json.dump({"$schema": "http://json-schema.org/draft-07/schema#",
               "title": f"{identity.title} master token index",
               "type": "object", "required": ["totalTokens", "domains", "tokens"],
               "properties": {"name": {"type": "string"}, "version": {"type": "string"},
                              "generated": {"type": "string"}, "preset": {"type": "string"},
                              "paletteSource": {"type": "string"}, "totalTokens": {"type": "integer"},
                              "domains": {"type": "object"}, "tokens": {"type": "object"}}},
              open(os.path.join(spath, 'index.schema.json'), 'w'), indent=2)


# ══════════════════════════════════════════════════════════════════════════════
# THE WHOLE PIPELINE
# ══════════════════════════════════════════════════════════════════════════════
def generate(preset, out_dir, identity, scales, *, provenance=None, docs=None,
             tree_source=DEFAULT_TREE_SOURCE, palette_source=None,
             derivation_note=DEFAULT_DERIVATION_NOTE, conventions=None, index_extra=None,
             dark_selector='[data-theme="dark"]', adapter_values=None, adapter_preamble=None,
             emit_adapter=True, clean=('tokens', 'build', 'schema'),
             build_dir=DEFAULT_BUILD_DIR, typography=None):
    """Build and write everything. Returns (tokens, domain_summary, master).

    `scales` is positional and required — see contract/scale-shape.json ($noValues) for why Base
    declares the rungs and carries none of their values.

    The caller stays responsible for anything only it can know: its own provenance labels, its own
    per-token reasoning, its own release notes in `index_extra`, and anything it emits in addition
    (an admin-panel adapter, a migration crosswalk). Those belong to the implementation.
    """
    tokens = build_tokens(preset, identity, scales, provenance=provenance, docs=docs,
                          typography=typography)
    for f in clean or ():
        p = os.path.join(out_dir, f)
        if os.path.isdir(p):
            shutil.rmtree(p)
    domain_summary, master = write_token_tree(tokens, out_dir, identity, tree_source=tree_source)
    write_index(out_dir, identity, domain_summary, master, palette_source=palette_source,
                derivation_note=derivation_note, conventions=conventions, extra=index_extra)
    write_tokens_css(tokens, out_dir, identity, dark_selector=dark_selector, build_dir=build_dir)
    write_ts_js_dts(tokens, out_dir, identity, build_dir=build_dir)
    if emit_adapter:
        # `declared` is always passed here: the adapter is emitted only when the roles it maps
        # actually exist. generate() has no way to skip that check, on purpose.
        write_app_tokens_css(out_dir, identity, values=adapter_values, preamble=adapter_preamble,
                             declared=declared_properties(tokens), build_dir=build_dir)
    write_schema(out_dir, identity)

    # The gate. Everything written above is checked before this function returns, so a dangling
    # reference is a build failure rather than a rendering bug found by a human, later.
    _css = os.path.join(build_dir, 'tokens.css') if build_dir != '.' else 'tokens.css'
    _adapter = os.path.join(build_dir, 'app-tokens.css') if build_dir != '.' else 'app-tokens.css'
    assert_css_references_resolve(out_dir, files=(_css, _adapter), root=_css)
    return tokens, domain_summary, master


SCALES_SHAPE_DOC = """\
`scales=` is REQUIRED and Base carries none of its values. Base declares the families and the
rung NAMES (which are shared vocabulary — that is what lets two implementations swap a
component); you supply what they are. Pass {} for an implementation that wants none.
"""

PRESET_SHAPE = """\
The preset is the palette, and this module holds none of it.

  roles         {primary: {seed}, secondary?: {seed}, accent?: {seed}}
                secondary falls back to primary, accent to secondary. One seed is a brand.
  neutral       {step: value} — hand-authored. Any length; the contract mandates none.
  darkSurface   {name, steps} — optional hand-authored dark-surface ramp. `name` becomes
                --color-<name>-<step>, so it is your word for your ramp. (Legacy: a bare `navy`
                key, deprecated — it names a hue in a schema that holds none.)
  semantic      {role: {light, dark?}} or {role: {derived: "exact-seed:<seed role>"}}
                                       or {role: {derived: "text-on:<seed role>"}}
  status        {success, warning, error, info}
  statusDark    {mixTowardLight: 0..1} — optional; omit and status is mode-invariant, which is a
                choice you should make with a measurement rather than by default.
  textOn        {candidates: [...], fallbacks: [lighter, darker], minRatio?} — required only if a
                semantic role uses a `text-on:` derivation.
  fontSystem    {sans, serif, mono, display?} — the fallback stacks. `display` is a FOURTH slot,
                optional, emitted as --font-display-family with the `display` role aliasing it.
  fonts         {sans?, serif?, mono?, display?, headingRole?, bodyRole?, displayRole?}
  gradients     {name: value | {light, dark}} — optional
  extended      every key optional; see contract/vocabulary.json#colorRoles.extended
                link {default,hover,active,visited}
                surface {overlay,sunken,interactive,interactive-strong,disabled,backdrop}
                text {tertiary,disabled,icon}            number = percent of ink over transparency
                ink {muted.inverse}
                border {subtle,strong,disabled}          number = percent of ink over transparency
                border {inverse,strong.inverse}          the inverted band's companions. A
                    value, never a percentage: an alpha of ink is the band's own colour on
                    surface.inverse, so emit.py refuses one. strong.inverse carries a measurement
                    obligation, so give it a value a gate can resolve.
                statusCompanions {subtle: pct, border: pct, glow: {status: pct}}
                chart {"1".."5"}  chartBand {"1".."5"}  chartNeutral  chartInactive
                shadow {sm,md,lg}
                brand {active, fill}   onBrandFill
                onDark {ink, ink-muted, highlight, border, wash, wash-hover, deep, deep-raised}
                    the NON-FLIPPING family — a ground that is dark in BOTH themes. Every one of
                    these carries a measurement obligation, so supply values a gate can RESOLVE:
                    an unresolved color-mix() cannot be measured, and an unmeasured role is the
                    hole these exist to close. See contract/vocabulary.json#contrast
                    .conditionalRequirements.
                    Accepted legacy spellings for the two oldest members, so an existing preset
                    need not move: ink {on-dark} and surfaceDeep {deep, deep-raised}.

Every colour entry is either a bare value (mode-invariant) or {"light": ..., "dark": ...}.
"""

if __name__ == '__main__':
    print(__doc__)
    print(PRESET_SHAPE)
    print(SCALES_SHAPE_DOC)
    for _fam, _spec in SCALE_SHAPE.items():
        _kind = 'scalar' if _spec.get('scalar') else (
            'rung names only (derived)' if _spec.get('derive') else 'map of rung -> value')
        print(f'  {_fam:22} {_kind}')
        if _spec.get('steps'):
            print(f'  {"":22}   rungs: {", ".join(_spec["steps"])}')
        for _k in ('slots', 'valueTemplate', 'recordAs', 'requiresTokens', 'stepsFrom', 'requires',
                   'modifies', 'sets', 'exclusiveWith', 'derive', 'alsoEmits', 'pxAt', 'what'):
            if _spec.get(_k):
                print(f'  {"":22}   {_k}: {_spec[_k]}')
