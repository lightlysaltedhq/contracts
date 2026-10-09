#!/usr/bin/env node
// The one stylesheet both platforms serve: styles/salt.css, the six shared stylesheets in their load
// order (README, "Stylesheets"), minified with every comment stripped. Implementations serve this
// file byte for byte, and the conformance runner's stylesheet pin compares what they serve with it.
// esbuild is pinned in the lockfile, so the same sources always give the same bytes; the stylesheet
// gate (check_salt_stylesheets.mjs) fails when the committed bundle is not what this builds.
//
//   node scripts/build_salt_bundle.mjs [--check] [package-dir]
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

export const BUNDLE = 'salt.css'
export const LOAD_ORDER = ['base.css', 'sections.css', 'primitives.css', 'blocks.css', 'chrome.css', 'views.css']

/** The bundle's text, from a map of the sources by file name (`base.css` …). */
export function buildBundle(sources) {
  const missing = LOAD_ORDER.filter((f) => typeof sources[f] !== 'string')
  if (missing.length) throw new Error(`the bundle needs ${missing.join(', ')}`)
  const css = LOAD_ORDER.map((f) => sources[f]).join('\n')
  // No target: esbuild then lowers nothing, so the bundle keeps the sources' syntax.
  return transformSync(css, { loader: 'css', minify: true, legalComments: 'none', charset: 'utf8' }).code
}

/** The bundle built from a package directory's styles/. */
export const buildFrom = (dir) => buildBundle(Object.fromEntries(LOAD_ORDER.map((f) => [f, readFileSync(path.join(dir, 'styles', f), 'utf8')])))

/** Why the committed bundle in a package directory is not what its sources build, or null. */
export function bundleProblem(dir) {
  let committed = null
  try { committed = readFileSync(path.join(dir, 'styles', BUNDLE), 'utf8') } catch { /* reported below */ }
  if (committed === null) return `styles/${BUNDLE} is missing; build it with node scripts/build_salt_bundle.mjs`
  return committed === buildFrom(dir) ? null : `styles/${BUNDLE} is not what the sources build; rebuild it with node scripts/build_salt_bundle.mjs`
}

const here = path.dirname(fileURLToPath(import.meta.url))
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const check = args[0] === '--check'
  const dir = path.resolve((check ? args[1] : args[0]) ?? path.join(here, '..', 'salt-contract'))
  if (check) {
    const problem = bundleProblem(dir)
    if (problem) { console.log(`✗ ${problem}`); process.exit(1) }
    console.log(`PASS: styles/${BUNDLE} is the sources, built`)
  } else {
    const built = buildFrom(dir)
    writeFileSync(path.join(dir, 'styles', BUNDLE), built)
    console.log(`wrote styles/${BUNDLE} (${Buffer.byteLength(built)} bytes)`)
  }
}
