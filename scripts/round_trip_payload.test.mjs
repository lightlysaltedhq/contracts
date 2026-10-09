// Proves the round trip's own machinery without a salt-nextjs checkout: its command line, and
// that importing it runs nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { classify, parseArguments } from './round_trip_payload.mjs'

// A directory shaped like a salt-nextjs checkout, as far as parseArguments looks.
function fakeCheckout() {
  const dir = mkdtempSync(path.join(tmpdir(), 'salt-nextjs-'))
  mkdirSync(path.join(dir, 'packages', 'core', 'src', 'blocks'), { recursive: true })
  writeFileSync(path.join(dir, 'packages', 'core', 'src', 'blocks', 'index.ts'), '')
  return dir
}

test('R10, S2: flags may come anywhere; the checkout is given or SALT_NEXTJS_DIR, never guessed', () => {
  const dir = fakeCheckout()
  try {
    assert.deepEqual(parseArguments(['--check', dir], {}), { nextjs: dir, check: true, suggest: false })
    assert.deepEqual(parseArguments([dir, '--check'], {}), { nextjs: dir, check: true, suggest: false })
    assert.deepEqual(parseArguments([], { SALT_NEXTJS_DIR: dir }), { nextjs: dir, check: false, suggest: false })
    assert.throws(() => parseArguments([], {}), /pass the salt-nextjs checkout, or set SALT_NEXTJS_DIR/)
    assert.throws(() => parseArguments(['/no/such/salt-nextjs'], {}), /salt-nextjs checkout not found at \/no\/such\/salt-nextjs/)
    assert.throws(() => parseArguments(['--chek', dir], {}), /unknown option --chek/)
    assert.throws(() => parseArguments(['/a', '/b'], {}), /one salt-nextjs checkout/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('R9: a difference is expected only when the reviewed list names it exactly', () => {
  const list = [{ section: 'contact', path: 'showPhone', kind: 'missing', difference: 'not in salt-nextjs', evidence: 'owes: the field' }]
  const row = (kind, text) => ({ section: 'contact', at: 'showPhone', kind, text })
  // The listed difference is expected, with the list's evidence.
  assert.deepEqual(classify([row('missing', 'not in salt-nextjs')], list).expected.map((r) => r.evidence), ['owes: the field'])
  // The same field owing something does not cover a new kind of difference, or new wording.
  const later = classify([row('type', 'type text; salt-nextjs textarea'), row('missing', 'gone')], list)
  assert.equal(later.unexpected.length, 2)
  assert.deepEqual(later.unseen, list)
})

test('R9: every entry on the committed list cites the note or ruling that accounts for it', () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'salt-contract', 'reports', 'round-trip-payload.expected.json')
  const list = JSON.parse(readFileSync(file, 'utf8'))
  assert.ok(list.length > 0)
  for (const e of list) {
    assert.deepEqual(Object.keys(e), ['section', 'path', 'kind', 'difference', 'evidence'])
    assert.match(e.evidence, /^(owes|formerly|values|note|sections\.json formerly): \S/, JSON.stringify(e))
    assert.doesNotMatch(e.evidence, /undefined/, JSON.stringify(e))
  }
})

test('S3: --check and --suggest together are refused, as --suggest would skip the check and pass', () => {
  const dir = fakeCheckout()
  try {
    assert.throws(() => parseArguments(['--check', '--suggest', dir], {}), /--check and --suggest cannot be used together/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
