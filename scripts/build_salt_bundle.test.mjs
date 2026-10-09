// Proves the bundle check fails: styles/salt.css must be exactly what build_salt_bundle.mjs builds
// from the six sources, and the stylesheet gate's command line says so when it is not.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUNDLE, LOAD_ORDER, buildFrom, bundleProblem } from './build_salt_bundle.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkg = path.join(here, '..', 'salt-contract')
const gate = path.join(here, 'check_salt_stylesheets.mjs')

function copy(edit) {
  const dir = mkdtempSync(path.join(tmpdir(), 'salt-bundle-'))
  for (const part of ['styles', 'contract']) cpSync(path.join(pkg, part), path.join(dir, part), { recursive: true })
  edit(dir)
  return dir
}

test('the committed bundle is the sources, built, and building is deterministic', () => {
  assert.equal(bundleProblem(pkg), null)
  assert.equal(buildFrom(pkg), buildFrom(pkg))
  const bundle = readFileSync(path.join(pkg, 'styles', BUNDLE), 'utf8')
  assert.ok(!bundle.includes('/*'), 'comments are stripped')
  assert.ok(bundle.startsWith('@layer base{'), 'base.css comes first')
  assert.deepEqual(LOAD_ORDER, ['base.css', 'sections.css', 'primitives.css', 'blocks.css', 'chrome.css', 'views.css'])
})

for (const [what, edit, pattern] of [
  ['a source changed without a rebuild', (dir) => {
    const file = path.join(dir, 'styles', 'views.css')
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n.salt-view-extra { display: block; }\n`)
  }, /styles\/salt\.css is not what the sources build/],
  ['a bundle edited by hand', (dir) => writeFileSync(path.join(dir, 'styles', BUNDLE), `${readFileSync(path.join(pkg, 'styles', BUNDLE), 'utf8')} `), /is not what the sources build/],
  ['no bundle', (dir) => rmSync(path.join(dir, 'styles', BUNDLE)), /styles\/salt\.css is missing/],
  // Review Q6: the load order and styles/ must name the same sources.
  ['a source the load order does not name', (dir) => writeFileSync(path.join(dir, 'styles', 'forms.css'), '.salt-x { display: block; }\n'), /styles\/forms\.css is not in the bundle's load order/],
  ['a load-order source styles/ does not hold', (dir) => rmSync(path.join(dir, 'styles', 'views.css')), /the bundle's load order names styles\/views\.css, which styles\/ does not hold/],
]) {
  test(`the bundle check and the stylesheet gate fail ${what}`, () => {
    const dir = copy(edit)
    try {
      assert.match(bundleProblem(dir), pattern)
      const r = spawnSync(process.execPath, [gate, dir], { encoding: 'utf8' })
      assert.equal(r.status, 1, r.stdout)
      assert.match(r.stdout, pattern)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
