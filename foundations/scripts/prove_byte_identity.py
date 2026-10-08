#!/usr/bin/env python3
"""Prove a theme still emits exactly what it has committed.

    python3 foundations/scripts/prove_byte_identity.py                       # theme: saltworks
    python3 foundations/scripts/prove_byte_identity.py --theme wakemere
    python3 foundations/scripts/prove_byte_identity.py --theme saltworks --ref v4.9.0

    exit 0 = every artifact reproduced byte-for-byte · 1 = drift · 2 = cannot run

WHY THIS IS COMMITTED HERE
--------------------------
v2 promoted a 77KB generator out of a brand's repo and into the contract. The entire case that the
promotion preserved behaviour is one claim — *the implementation still emits identical bytes* —
and that claim was verified by a script in a temporary directory. A proof nobody can re-run is an
assertion, and this contract exists because of an assertion nobody could re-run.

THE SHAPE CHANGED WITH THE CONSOLIDATION, THE CLAIM DID NOT. `--impl` used to name a SIBLING
checkout; the contract and its themes are one repository now, so it defaults to this one and
`--theme` names which package to rebuild. The reference is still the COMMIT, and the rebuild still
runs from that commit's own foundations/ — which is now stronger than it was, because contract and
theme are proved together at one revision instead of a working tree being diffed against a tag.

WHAT IT ACTUALLY PROVES, AND WHAT IT DOES NOT
---------------------------------------------
It runs the implementation's own build command and diffs the result against the implementation's
own committed artifacts. So it proves: *the generator, as it stands, reproduces what is checked in.*

Whether that is the PROMOTION proof depends entirely on one thing — whether that generator
imports this repo's `emit.py`. If it does, the machinery moved and behaviour did not, which is the
whole claim of v2. If it does not, the identical bytes prove only that the implementation's own
generator is deterministic, and **a generator that COPIED the machinery reproduces those bytes
exactly as well as one that imports it.** The copy is the failure this repository was founded to
prevent, so the two results may never be allowed to look alike.

They are therefore not allowed to. `--claim promotion` is the default and FAILS when nothing
imports the emitter; the weaker `--claim determinism` must be asked for by name, prints under a
`### NOT THE PROMOTION PROOF ###` banner, and still requires byte-identity. A reader skimming for
a green tick cannot pick up the wrong one.

THE REFERENCE IS THE COMMIT, NOT THE WORKING TREE
-------------------------------------------------
The reference artifacts are extracted with `git archive`, not read from the checkout. This is not
tidiness: during the original verification another agent was editing that repo's working tree, and
a harness reading files in place would have diffed against half-finished work and reported a pass
or a failure that meant nothing either way.

COMPLETENESS
------------
The first version of this harness reported success with files missing, because it only compared
the files it thought to look for. This one enumerates the artifact set FROM THE REFERENCE and
fails on anything unaccounted for in either direction — missing, extra, or differing — and refuses
to pass on an empty set. Anything genuinely outside the emitter's scope must be named with
`--out-of-scope`, which prints it as an exclusion rather than silently skipping it.
"""
import argparse
import filecmp
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.abspath(os.path.join(HERE, '..'))
DEFAULT_ARTIFACTS = ('index.json', 'tokens', 'build', 'schema')
RULE = '=' * 78


def die(msg, *more):
    print(f'FAIL: {msg}')
    for m in more:
        print(f'  {m}')
    sys.exit(2)


def run(cmd, cwd, env=None):
    return subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, shell=isinstance(cmd, str))


def export_ref(impl, ref, dest):
    """Materialise the implementation at `ref` — the committed truth, not the working tree."""
    p = run(['git', '-C', impl, 'rev-parse', '--verify', f'{ref}^{{commit}}'], impl)
    if p.returncode != 0:
        die(f'{impl} has no commit {ref!r}', p.stderr.strip())
    sha = p.stdout.strip()
    archive = run(['git', '-C', impl, 'archive', ref, '--format=tar', f'--output={dest}.tar'], impl)
    if archive.returncode != 0:
        die(f'git archive {ref} failed', archive.stderr.strip())
    os.makedirs(dest, exist_ok=True)
    untar = run(['tar', '-xf', f'{dest}.tar', '-C', dest], impl)
    if untar.returncode != 0:
        die('could not unpack the reference export', untar.stderr.strip())
    os.remove(f'{dest}.tar')
    return sha


def artifact_files(root, roots):
    out = []
    for rel in roots:
        p = os.path.join(root, rel)
        if os.path.isfile(p):
            out.append(rel)
        elif os.path.isdir(p):
            for dirpath, dirnames, names in os.walk(p):
                dirnames[:] = [d for d in dirnames if d not in ('__pycache__', '.git')]
                for n in names:
                    if n == '.DS_Store':
                        continue
                    out.append(os.path.relpath(os.path.join(dirpath, n), root))
    return sorted(set(out))


def build_command(tree, theme=None):
    pkg = os.path.join(tree, 'package.json')
    cmd = None
    if os.path.isfile(pkg):
        cmd = json.load(open(pkg)).get('scripts', {}).get('build')
    if not cmd and os.path.isfile(os.path.join(tree, 'scripts', 'generate.py')):
        cmd = 'python3 scripts/generate.py'
    if not cmd:
        die('cannot tell how to build this repository',
            'expected package.json scripts.build, or scripts/generate.py')
    # Rebuild ONLY the theme under test. Building the others would work and would also mean a
    # failure in an unrelated theme reported as a drift in this one.
    return f'{cmd} --theme {theme}' if theme else cmd


def imports_base_emitter(tree):
    """Does the build actually load the contract's generator core?

    Grep, and reported as such. It is the difference between proving a promotion and proving a
    tautology, so it is stated either way rather than assumed.
    """
    hits = []
    sdir = os.path.join(tree, 'scripts')
    for n in sorted(os.listdir(sdir)) if os.path.isdir(sdir) else []:
        if not n.endswith('.py'):
            continue
        text = open(os.path.join(sdir, n), encoding='utf-8', errors='replace').read()
        if 'from emit import' in text or 'import emit' in text:
            hits.append(f'scripts/{n}')
    return hits


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog='prove_byte_identity.py',
        description="Run a conforming implementation's own build and diff it against that "
                    "implementation's committed artifacts, byte for byte.")
    ap.add_argument('--impl', default=os.path.abspath(os.path.join(BASE, os.pardir)),
                    help='path to the repository holding the themes (a git checkout). Defaults '
                         'to the one this script lives in.')
    ap.add_argument('--theme', default='saltworks',
                    help='which theme to rebuild and diff (default: saltworks)')
    ap.add_argument('--ref', default='HEAD',
                    help='the commit to prove against (default HEAD). The reference is always the '
                         'COMMIT, never the working tree.')
    ap.add_argument('--artifacts', nargs='+', default=None,
                    help='paths, relative to the repository, that the generator owns '
                         "(default: the chosen theme's build/<theme>/)")
    ap.add_argument('--out-of-scope', nargs='*', default=[],
                    help='artifact paths this repo\'s emitter does not own (an admin-panel '
                         'adapter, say). Printed as declared exclusions — never skipped silently.')
    ap.add_argument('--claim', choices=('promotion', 'determinism'), default='promotion',
                    help='which claim this run is making. promotion (default): the artifacts are '
                         "reproduced BY A GENERATOR THAT IMPORTS this repo's emit.py — the thing "
                         'v2 exists to prove. determinism: the artifacts are merely reproduced, '
                         'by whatever generator the implementation has. You must ASK for the '
                         'weaker claim; it is never substituted silently, and it still requires '
                         'byte-identity.')
    args = ap.parse_args(argv)
    if args.artifacts is None:
        args.artifacts = [os.path.join('build', args.theme)]

    impl = os.path.abspath(args.impl)
    # Ask git rather than the filesystem. In a linked worktree `.git` is a FILE naming the main
    # repository's git directory, so the isdir() test this replaced refused every worktree while
    # passing the same commit in a plain clone. The top-level comparison keeps what that test
    # also meant: --impl names the repository's root, not a directory somewhere inside it.
    top = run(['git', '-C', impl, 'rev-parse', '--show-toplevel'], HERE)
    if top.returncode != 0 or os.path.realpath(top.stdout.strip()) != os.path.realpath(impl):
        die(f'{impl} is not a git checkout',
            'The reference has to come from a commit, so this needs a repository.',
            'This gate has no skip flag: "cannot run" means the checkout is wrong, which is a '
            'real failure.')

    tmp = tempfile.mkdtemp(prefix='prove-byte-identity-')
    try:
        ref_tree = os.path.join(tmp, 'reference')
        sha = export_ref(impl, args.ref, ref_tree)
        work = os.path.join(tmp, 'rebuild')
        shutil.copytree(ref_tree, work)
        # No sibling to arrange any more: the export carries foundations/ with it, so the rebuild
        # uses the contract AS COMMITTED AT THE SAME REVISION as the theme. That is the honest
        # pairing — a tree proved against a working-copy contract proves a combination nobody has
        # committed.

        expected = artifact_files(ref_tree, args.artifacts)
        if not expected:
            die(f'the reference at {args.ref} contains none of {args.artifacts}',
                'A proof over an empty set is not a proof, so this refuses to pass.')

        importers = imports_base_emitter(work)
        cmd = build_command(work, args.theme)

        env = dict(os.environ)
        env['PYTHONPATH'] = os.path.join(work, 'foundations', 'scripts') + os.pathsep + \
            env.get('PYTHONPATH', '')
        env['PYTHONDONTWRITEBYTECODE'] = '1'   # never let a stale .pyc answer for the source
        for rel in args.artifacts:
            p = os.path.join(work, rel)
            if os.path.isdir(p):
                shutil.rmtree(p)
            elif os.path.isfile(p):
                os.remove(p)

        built = run(cmd, work, env)
        if built.returncode != 0:
            die(f'the implementation\'s build failed: {cmd}',
                (built.stderr or built.stdout).strip()[:2000])

        produced = artifact_files(work, args.artifacts)
        oos = set(args.out_of_scope)

        missing = [f for f in expected if f not in produced and f not in oos]
        extra = [f for f in produced if f not in expected and f not in oos]
        compared, differing = [], []
        for rel in expected:
            if rel in oos or rel in missing:
                continue
            a, b = os.path.join(ref_tree, rel), os.path.join(work, rel)
            compared.append(rel)
            if not filecmp.cmp(a, b, shallow=False):
                differing.append(rel)

        print(f'repository      {impl}')
        print(f'theme           {args.theme}')
        print(f'reference       {args.ref} @ {sha[:12]}  (committed tree, not the working tree)')
        print(f'build command   {cmd}')
        print('emit.py imported by  ' + (', '.join(importers) if importers
                                              else '### NOTHING ### — this cannot be the promotion proof'))
        print(f'artifacts       {len(expected)} in the reference, {len(produced)} rebuilt, '
              f'{len(compared)} compared')
        for rel in sorted(oos):
            print(f'  out of scope (declared)  {rel}')

        bad = bool(missing or extra or differing)
        for label, items in (('missing from the rebuild', missing),
                             ('present only in the rebuild', extra),
                             ('DIFFERING', differing)):
            for rel in items:
                print(f'  {label}: {rel}')
                if label == 'DIFFERING':
                    d = run(['diff', '-u', os.path.join(ref_tree, rel), os.path.join(work, rel)], tmp)
                    print('\n'.join('      ' + l for l in d.stdout.splitlines()[:40]))

        if bad:
            print(f'\n{RULE}')
            print(f'FAIL: {len(missing)} missing, {len(extra)} unexpected, {len(differing)} '
                  'differing.')
            print(RULE)
            return 1

        n = len(compared)
        if importers:
            print(f'\n{RULE}')
            print('PASS — THE PROMOTION PROOF')
            print(RULE)
            print(f'  {n} artifacts reproduced byte-for-byte by a generator that IMPORTS this')
            print(f"  repo's emit.py ({', '.join(importers)}).")
            print('  That is the claim v2 exists to make: the machinery moved, and behaviour did')
            print('  not.')
            if args.claim == 'determinism':
                print('\n  (You asked only for determinism. You got the stronger claim anyway.)')
            print(RULE)
            return 0

        # ── the weak path. It must be impossible to skim as the strong one. ──
        print(f'\n{RULE}')
        print('  ###   NOT THE PROMOTION PROOF   ###')
        print(RULE)
        print(f'  {n} artifacts reproduced byte-for-byte — and NOTHING in this implementation')
        print("  imports this repo's emit.py.")
        print('')
        print('  PROVEN      this implementation\'s own generator is deterministic.')
        print("  NOT PROVEN  that it uses the contract's emit.py at all.")
        print('')
        print('  Those two claims differ by the entire point of the promotion. A generator that')
        print('  COPIED the machinery reproduces these bytes exactly as well as one that IMPORTS')
        print('  it — and the copy is the failure this repository was founded to prevent, because')
        print('  a copied generator arrives carrying the brand it was copied from. If this line')
        print('  is ever quoted as evidence that the promotion holds, it will be quoting a run')
        print('  that could not tell the difference.')
        print(RULE)
        if args.claim == 'promotion':
            print('  This run asked for the PROMOTION claim and cannot make it, so it fails.')
            print('  Re-run once the generator imports emit.py — or pass --claim determinism to')
            print('  state, on the record, that you are making the weaker claim on purpose.')
            print(RULE)
            return 1
        print('  Exiting 0 because --claim determinism was requested explicitly. The weaker')
        print('  claim is the one on the record for this run.')
        print(RULE)
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
