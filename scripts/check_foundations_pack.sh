#!/usr/bin/env bash
#
# Prove the foundations tarball is what it claims to be, against the tarball itself
# rather than against the source tree it was built from.
#
# Five things are checked. The first keeps the tarball to foundations/ alone. The palettes
# that conform to this contract live in the private design-system repository, not here, but
# this repository holds more than one package, and npm packs relative to the directory holding
# the manifest: a manifest moved to the repository root would ship everything beside it. The
# check also still refuses build/, themes/ and packages/ paths and token output, which were the
# palette-bearing paths when foundations/ lived in design-system, so a copy pasted back in from
# there is refused too.
#
# The second re-runs the contract's own central claim — that it holds zero colour values
# — over the shipped bytes. `pnpm guard` proves it of the working tree; a `files` entry
# is what decides whether the working tree is what goes out.
#
# The third checks every declared export resolves inside the tarball, because a `files`
# list that omits an exported path produces a package that installs cleanly and throws on
# import.
#
# The fourth holds every version in the shipped contract to the package's own, at any depth
# and in any spelling, and refuses a file it cannot read.
#
# The fifth proves the publish would reach registry.npmjs.org even from the repository
# root, where a scope redirect to GitHub Packages is in force.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

tarball="$(cd "$root/foundations" && npm pack --silent --pack-destination "$work")"
tar -xzf "$work/$tarball" -C "$work"
pkg="$work/package"

echo "Packed $tarball"

# ── 1. Nothing from outside foundations/ ─────────────────────────────────────────
forbidden=$(tar -tzf "$work/$tarball" | grep -E 'package/(build|themes|packages)/|\.css$|tokens\.js$|preset\.json$|scales\.json$' || true)
if [ -n "$forbidden" ]; then
  echo "✗ the tarball carries files that must never be published:"
  echo "$forbidden" | sed 's/^/      /'
  exit 1
fi
echo "✓ no theme, build or token output in the tarball"

# ── 2. The shipped bytes hold no colour values ───────────────────────────────────
# check_no_colours.py reads `git ls-files`, so the extract needs to be a checkout.
git -C "$pkg" init -q .
git -C "$pkg" add -A
# Unsigned: a throwaway repository needs no signature, and a machine that signs every commit
# (through an agent that can be locked) would otherwise fail the gate for the wrong reason.
git -C "$pkg" -c user.email=gate@local -c user.name=gate -c commit.gpgsign=false commit -qm "packed"
if ! ( cd "$pkg" && python3 scripts/check_no_colours.py > "$work/guard.txt" 2>&1 ); then
  echo "✗ the colour guard fails on the SHIPPED files:"
  tail -20 "$work/guard.txt" | sed 's/^/      /'
  exit 1
fi
echo "✓ colour guard passes on the shipped files"
if ! ( cd "$pkg" && python3 scripts/check_prose_lengths.py > "$work/lengths.txt" 2>&1 ); then
  echo "✗ the length guard fails on the SHIPPED files:"
  tail -20 "$work/lengths.txt" | sed 's/^/      /'
  exit 1
fi
echo "✓ length guard passes on the shipped files"

# ── 3. Every declared export exists in the tarball ───────────────────────────────
# An export may be a path or a set of conditions ({ types, default }); every path in either counts.
# Listed into a variable first, so a failure to list is a failure of this check (set -e), where a
# process substitution let it die silently and pass with nothing checked.
targets=$(node -e '
  const p = require("'"$root"'/foundations/package.json");
  for (const t of Object.values(p.exports))
    for (const path of typeof t === "string" ? [t] : Object.values(t)) console.log(path.replace(/^\.\//, ""));
')
[ -n "$targets" ] || { echo "✗ no export paths could be listed"; exit 1; }
missing=0
while IFS= read -r target; do
  if [ ! -f "$pkg/$target" ]; then
    echo "✗ exported path is not in the tarball: $target"
    missing=1
  fi
done <<< "$targets"
[ "$missing" -eq 0 ] || exit 1

# A file being present is not the same as a consumer being able to import it: `exports` could
# point at the right file with the wrong module type, or a module could throw on load. So each
# subpath is imported by name, through Node's own resolver, from a consumer that has the packed
# package in node_modules, exactly as an implementation would. `./scale-tokens` is code, a
# versioned API since the build derives its scale tokens through it, so it also has to derive a
# token from the exported shape.
consumer="$work/consumer"
mkdir -p "$consumer/node_modules/@lightlysaltedhq"
cp -R "$pkg" "$consumer/node_modules/@lightlysaltedhq/design-foundations"
if ! (cd "$consumer" && node --input-type=module -e '
  import { readFileSync } from "node:fs"
  const name = "@lightlysaltedhq/design-foundations"
  const exp = JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")).exports
  let bad = 0
  // The design system builds its scale tokens through these two, so dropping either would ship a
  // package whose consumers cannot derive what it builds. Removing one is a major, made here on purpose.
  for (const need of ["./scale-shape", "./scale-tokens"])
    if (!exp[need]) { console.log(`✗ ${name} no longer exports ${need}`); bad = 1 }
  for (const [sub, entry] of Object.entries(exp)) {
    const spec = name + sub.slice(1)
    const target = typeof entry === "string" ? entry : (entry.import ?? entry.default)
    try {
      const mod = target.endsWith(".json") ? await import(spec, { with: { type: "json" } }) : await import(spec)
      if (!target.endsWith(".json") && Object.keys(mod).length === 0) throw new Error("it exports nothing")
    } catch (e) { console.log(`✗ ${spec} does not import: ${e.message}`); bad = 1 }
  }
  if (!bad) {
    const { deriveScaleTokens } = await import(`${name}/scale-tokens`)
    const shape = (await import(`${name}/scale-shape`, { with: { type: "json" } })).default
    const t = deriveScaleTokens(shape, { spaceBase: "0.25rem", space: ["0-5"] })
      .find((x) => x.property === "--space-0-5")
    if (t?.value !== "0.125rem") { console.log(`✗ ${name}/scale-tokens derived ${JSON.stringify(t)} for --space-0-5`); bad = 1 }
  }
  process.exit(bad)
'); then
  exit 1
fi
echo "✓ every declared export resolves inside the tarball, and imports by name from a consumer"

# The exported code is for any consumer: a browser or edge bundle, a CommonJS script, `node -e`.
# So it must load nothing and touch no runtime global. Forbidden, not modelled: an earlier version
# parsed import specifiers and was fooled by a template literal, a comment inside import(), a
# re-export and process.getBuiltinModule. Every exported JavaScript file now fails on any of the
# words below, anywhere in the file, comments included (a comment is not stripped, because a
# stripper can be fooled too; the module's own comments are written without them). Its command
# line lives in scripts/scale_tokens_cli.mjs, which is not exported. Then ./scale-tokens is imported
# three ways that break a module which reads the process on load: an extensionless CommonJS
# script, a script on stdin, and `node -e` with an argument.
if ! (cd "$consumer" && node -e '
  const fs = require("node:fs"), path = require("node:path")
  const dir = "node_modules/@lightlysaltedhq/design-foundations"
  const exp = require(path.resolve(dir, "package.json")).exports
  const targets = Object.values(exp).flatMap((t) => typeof t === "string" ? [t] : Object.values(t))
  const FORBIDDEN = [
    [/\bimport\b/, "import (a static import, import() or import.meta)"],
    [/\bexport\s*(?:\*|\{[^}]*\})\s*(?:as\s+[\w$]+\s*)?from\b/, "export … from (a re-export)"],
    [/\brequire\b/, "require"],
    [/\bprocess\b/, "process"],
    [/\bglobalThis\b/, "globalThis"],
    [/\beval\b/, "eval"],
    [/\bFunction\s*\(/, "Function( (code from a string)"],
  ]
  let bad = 0
  for (const t of targets.filter((t) => /\.m?js$/.test(t))) {
    const src = fs.readFileSync(path.join(dir, t), "utf8")
    for (const [re, what] of FORBIDDEN) {
      const m = src.match(re)
      if (m) {
        const line = src.slice(0, m.index).split("\n").length
        console.log(`✗ ${t}:${line} uses ${what}. Exported code may load nothing and touch no runtime global, so it bundles for a browser or edge runtime.`); bad = 1
      }
    }
  }
  process.exit(bad)
'); then
  exit 1
fi
# One loop over the exported implementations: each must load, by name, however Node is started.
for probe in \
  'import("@lightlysaltedhq/design-foundations/scale-tokens").then((m) => { if (typeof m.deriveScaleTokens !== "function") process.exit(3) })' \
  'import("@lightlysaltedhq/design-foundations/type-tokens").then((m) => { if (typeof m.resolve !== "function" || typeof m.Refused !== "function") process.exit(3) })' \
  'import("@lightlysaltedhq/design-foundations/layout-roles").then((m) => { if (typeof m.resolveLayoutRoles !== "function" || typeof m.LayoutRefused !== "function" || typeof m.ContractError !== "function") process.exit(3) })'; do
  printf '%s\n' "$probe" > "$consumer/build-tokens"
  printf '%s\n' "$probe" > "$consumer/stdin-probe"
  what=$(printf '%s' "$probe" | sed -n 's|.*design-foundations/\([a-z-]*\)".*|./\1|p')
  for how in "node build-tokens" "node - < stdin-probe" "node -e PROBE arg"; do
    if [ "$how" = "node -e PROBE arg" ]; then
      (cd "$consumer" && node -e "$probe" arg) > "$work/how.txt" 2>&1
    else
      (cd "$consumer" && eval "$how") > "$work/how.txt" 2>&1
    fi || { echo "✗ $what does not load under \`$how\`:"; sed 's/^/      /' "$work/how.txt" | tail -5; exit 1; }
  done
done
echo "✓ exported code loads nothing and touches no runtime global, and ./scale-tokens, ./type-tokens and ./layout-roles each load from a CommonJS script, stdin and node -e"

# The declarations are what a TypeScript consumer compiles against, so compile one: strict, on the
# TypeScript this repository pins, once with moduleResolution bundler and once with node16. What
# that proves, exactly: the declarations exist and agree with how the export is used. TypeScript
# finds scale_tokens.d.mts beside scale_tokens.mjs on its own, so this compile does not prove the
# `types` condition points anywhere; a `types` path that is wrong or missing is caught by the
# in-tarball check above, which requires every path in every condition to exist. Only with no
# declaration file at all does this fail, with TS7016.
tsc="$root/node_modules/.bin/tsc"
[ -x "$tsc" ] || { echo "✗ TypeScript is not installed at $tsc: run npm ci. This check has no skip flag."; exit 1; }
ts="$consumer/ts"
mkdir -p "$ts"
ln -s ../node_modules "$ts/node_modules"
printf '{ "type": "module" }\n' > "$ts/package.json"
cat > "$ts/index.ts" <<'TS'
import { deriveScaleTokens, ScaleRefused, type ScaleShape, type ScaleToken } from '@lightlysaltedhq/design-foundations/scale-tokens'
import { resolveLayoutRoles, LayoutRefused, type LayoutEnd, type LayoutRoles } from '@lightlysaltedhq/design-foundations/layout-roles'
// The real contract files, as a consumer imports them, are what every implementation is handed: a
// declaration that only accepts a hand-built subset, or {}, would reject the file it exists to read
// (TS2345). Typed from each file itself (a type query, which needs no import attribute under node16).
declare const scaleShapeJson: typeof import('@lightlysaltedhq/design-foundations/scale-shape')
declare const vocabularyJson: typeof import('@lightlysaltedhq/design-foundations/vocabulary')
const shape: ScaleShape = scaleShapeJson
const tokens: ScaleToken[] = deriveScaleTokens(shape, { spaceBase: '0.25rem', space: ['0-5'] })
const first: ScaleToken | undefined = tokens[0]
const value: string | number | undefined = first?.value
const record: Record<string, string | number> | undefined = first?.fluid
const refused: Error = new ScaleRefused('refused')
// ./type-tokens, the typography rule's implementation, compiled the same way.
import { derive, cssOf, resolve, Refused, type Table, type Resolved, type TextRoleToken } from '@lightlysaltedhq/design-foundations/type-tokens'
const typeScale: Record<string, unknown> = {}
const table: Table = derive(typeScale, { viewportMinPx: 360, viewportMaxPx: 1240, baseMinRem: 1, baseMaxRem: 1.125,
  ratioMin: 1.2, ratioMax: 1.25, ratioBelow: 1.125, fluidFrom: 0, steps: ['0'] })
const css: string = cssOf(typeScale, table.steps['0'])
const resolved: Resolved = resolve(vocabularyJson, typeScale, scaleShapeJson, {}, { fontRoles: ['heading', 'body'] })
const token: TextRoleToken | undefined = resolved.tokens[0]
const typeRefused: Error = new Refused('refused')
const laid: LayoutRoles = resolveLayoutRoles(vocabularyJson, scaleShapeJson, tokens, { gutter: { min: 'base' } })
const end: LayoutEnd | undefined = laid.roles['gutter']?.['min']
const px: string | undefined = end?.px
const codes: string[] = new LayoutRefused(['L4'], 'too narrow').codes
export { value, record, refused, css, token, typeRefused, px, codes }
TS
for resolution in bundler node16; do
  module=$([ "$resolution" = bundler ] && echo esnext || echo node16)
  printf '{ "compilerOptions": { "strict": true, "noEmit": true, "module": "%s", "moduleResolution": "%s", "target": "es2022", "skipLibCheck": false, "resolveJsonModule": true }, "files": ["index.ts"] }\n' "$module" "$resolution" > "$ts/tsconfig.json"
  if ! (cd "$ts" && "$tsc" -p tsconfig.json) > "$work/tsc.txt" 2>&1; then
    echo "✗ a strict TypeScript consumer (moduleResolution $resolution) does not compile against ./scale-tokens, ./type-tokens and ./layout-roles:"
    sed 's/^/      /' "$work/tsc.txt" | head -10
    exit 1
  fi
done
echo "✓ a strict TypeScript $("$tsc" -v | cut -d' ' -f2) consumer compiles against ./scale-tokens, ./type-tokens and ./layout-roles, with moduleResolution bundler and node16"

# ── 4. Every contract file carries the package's version ────────────────────────
# One rule, and it is mechanical on purpose (CHANGELOG.md, "Versioning"). The files used
# to carry their own "last changed in" versions, and that rotted twice: vocabulary.json
# changed in 2.0.1 and again in 2.1.0 and said 2.0.0 throughout, because nothing can
# check "last changed" without a previous release to diff against. Equality with
# package.json can be checked on every run; which file moved in which release is the
# changelog's job. A contract file with no version at all fails too: absent is not equal.
#
# The gate names the only places a version may be, and fails every other one. Two rounds of
# review found a hole in a rule that tried to say which keys were NOT versions (a /version/i
# regex that also matched `inversion`, then a JSON Schema carve-out that covered a whole class
# of paths and left their `const`/`enum`/`default` unread). So:
#   - every file under contract/ and schema/, at any depth, is read. A file that is not JSON,
#     or does not parse, FAILS: a version it carries is a version nobody here can check;
#   - a key is a VERSION KEY when one of its words is `version`, splitting on camelCase and on
#     any character that is not a letter or digit: `specVersion`, `$version`, `contract_version`,
#     `schema.version`, `VERSION` all are, and `inversion` is not;
#   - a version key is allowed in exactly two places. One is a file's top-level `version`,
#     which must be the string in package.json (every file in contract/ must have one). The
#     other is the single definition schema/token-file.schema.json -> properties.version,
#     which must be exactly {"type":"string"}: the shape of an emitted file's version field,
#     pinning no value. Any other version key, anywhere, is a shape this gate does not rank
#     and FAILS. Prose naming a contract generation ("v2 adds ...") sits under a `$v2` key,
#     whose words are `v2`.
drift=$(node -e '
  const fs = require("fs"), path = require("path");
  const dir = process.argv[1];
  const want = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version;
  const out = [], files = [];
  const list = (sub) => {
    const abs = path.join(dir, sub);
    if (!fs.existsSync(abs)) { out.push(`${sub}/ is missing from the tarball`); return; }
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = `${sub}/${e.name}`;
      if (e.isDirectory()) list(rel); else files.push(rel);
    }
  };
  list("contract"); list("schema");
  const kind = (v) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
  const words = (k) => k.split(/[^A-Za-z0-9]+/)
    .flatMap((w) => w.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/))
    .filter(Boolean).map((w) => w.toLowerCase());
  const isVersionKey = (k) => words(k).includes("version");
  const DEFINITION_FILE = "schema/token-file.schema.json";
  const walk = (o, trail, file) => {
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, [...trail, `[${i}]`], file)); return; }
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      const at = [...trail, k].join(".").replace(/\.\[/g, "[");
      if (!isVersionKey(k)) { walk(v, [...trail, k], file); continue; }
      if (trail.length === 0 && k === "version") {
        if (typeof v !== "string") out.push(`${file} version is a ${kind(v)} (${JSON.stringify(v)}), not a version string; package.json says ${want}`);
        else if (v !== want) out.push(`${file} version says ${v}; package.json says ${want}`);
      } else if (file === DEFINITION_FILE && at === "properties.version") {
        if (JSON.stringify(v) !== JSON.stringify({ type: "string" }))
          out.push(`${file} properties.version is ${JSON.stringify(v)}; the definition of the version field of an emitted file must be exactly {"type":"string"}, pinning no value`);
      } else {
        out.push(`${file} ${at}: a version key this gate does not rank. The only places a version may be are the top-level "version" of a file and ${DEFINITION_FILE} properties.version`);
      }
    }
  };
  if (!files.some((f) => f.startsWith("contract/"))) out.push("contract/ holds no files at all");
  for (const f of files.sort()) {
    if (!f.endsWith(".json")) { out.push(`${f} is not JSON, so any version it carries cannot be checked`); continue; }
    let doc;
    try { doc = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); }
    catch (e) { out.push(`${f} does not parse as JSON (${e.message})`); continue; }
    if (f.startsWith("contract/") && !(doc && kind(doc) === "object" && "version" in doc)) out.push(`${f} has no top-level version; package.json says ${want}`);
    walk(doc, [], f);
  }
  console.log(out.join("\n"));
' "$pkg")
if [ -n "$drift" ]; then
  echo "✗ a version in the contract is not the package's, or cannot be read:"
  echo "$drift" | sed 's/^/      /'
  exit 1
fi
echo "✓ every file under contract/ and schema/ is JSON, and its only version keys are the permitted ones"

# The token-file schema's $id names the package and its MAJOR (D38): exactly
# https://cdn.jsdelivr.net/npm/<name>@<major>/<the ./schema/token-file export's path>. jsDelivr
# resolves `@<major>` to the latest release in that major, so an `@N` that lagged the package
# would name a different document the moment a release in the new major edited the schema.
# Read from the packed package.json, so a renamed export or package moves the expectation too.
id_drift=$(node -e '
  const fs = require("fs"), path = require("path");
  const dir = process.argv[1];
  const p = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const exp = p.exports && p.exports["./schema/token-file"];
  if (typeof exp !== "string") { console.log("./schema/token-file is not a single-path export"); process.exit(0); }
  const major = String(p.version).split(".")[0];
  const want = `https://cdn.jsdelivr.net/npm/${p.name}@${major}/${exp.replace(/^\.\//, "")}`;
  const got = JSON.parse(fs.readFileSync(path.join(dir, exp), "utf8")).$id;
  if (got !== want) console.log(`$id is ${JSON.stringify(got)}\n  expected ${JSON.stringify(want)} (package ${p.name}@${p.version})`);
' "$pkg")
if [ -n "$id_drift" ]; then
  echo "✗ the token-file schema's \$id does not name this package and its major:"
  echo "$id_drift" | sed 's/^/      /'
  exit 1
fi
echo "✓ the token-file schema's \$id names this package at its major"

# ── 5. It would actually go to npmjs.com ─────────────────────────────────────────
# The check that decides the outcome, and the least obvious one.
#
# In lightlysaltedhq/design-system, where this package lived until after 3.0.0, the root
# .npmrc maps the whole @lightlysaltedhq scope to GitHub Packages. A scope-level registry
# beats BOTH publishConfig.registry and an explicit --registry flag; verified there, from
# the repo root, that `npm publish ./foundations --registry=https://registry.npmjs.org`
# still reported GitHub Packages. This repository has no such redirect today, but a
# developer's own ~/.npmrc can carry one, so the probe stays.
#
# What DOES win is a scoped key inside publishConfig, and that is what foundations/
# carries. It matters because npm reads .npmrc from its working directory and not from
# ancestors: without the pin, which registry this package reached depended entirely on
# where npm happened to be run, and the manual publish landed correctly only because the
# instruction said `cd foundations` first. Under CI the working directory is a workflow
# setting rather than a habit.
#
# So the probe runs from the REPOSITORY ROOT deliberately — the directory where any scope
# redirect would be in force. Testing from foundations/ would prove almost nothing,
# because the scope is unset there and would fall through to the ambient default anyway.
#
# `--loglevel=notice` is explicit because the line read here is a notice, and a quiet run
# inherits its quiet: `npm run -s verify:foundations-pack` exports npm_config_loglevel=silent
# to this script, the inner publish printed nothing, and the check reported a blank target
# as a wrong one. An empty read now fails as what it is.
target=$( (cd "$root" && npm publish ./foundations --dry-run --loglevel=notice 2>&1) | sed -n 's/.*Publishing to \([^ ]*\).*/\1/p' | head -1)
if [ -z "$target" ]; then
  echo "✗ npm's dry run printed no 'Publishing to' line, so this check cannot tell where the"
  echo "      package would go. Run \`cd \"$root\" && npm publish ./foundations --dry-run\` and read it."
  exit 1
fi
if [ "$target" != "https://registry.npmjs.org" ]; then
  echo "✗ from the repository root, npm would publish this to $target"
  echo "      publishConfig[\"@lightlysaltedhq:registry\"] is what overrides the root"
  echo "      .npmrc's scope redirect. Neither publishConfig.registry nor --registry does."
  exit 1
fi
echo "✓ resolves to registry.npmjs.org even from the repository root"

echo "PASS: the foundations tarball ships the contract and nothing else."
