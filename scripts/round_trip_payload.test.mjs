// Proves the round trip's own machinery without a salt-nextjs checkout: its command line, and
// that importing it runs nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { classify, parseArguments } from './round_trip_payload.mjs'

test('R10: flags may come first, and the default checkout is the repository\'s sibling', () => {
  assert.deepEqual(parseArguments(['--check', '/x/salt-nextjs'], '/w/contracts/scripts'), { nextjs: '/x/salt-nextjs', check: true, suggest: false })
  assert.deepEqual(parseArguments(['/x/salt-nextjs', '--check'], '/w/contracts/scripts'), { nextjs: '/x/salt-nextjs', check: true, suggest: false })
  assert.deepEqual(parseArguments([], '/w/Products/Salt/contracts/scripts'), { nextjs: path.resolve('/w/Products/Salt/salt-nextjs'), check: false, suggest: false })
  assert.throws(() => parseArguments(['--chek']), /unknown option --chek/)
  assert.throws(() => parseArguments(['/a', '/b']), /one salt-nextjs checkout/)
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
