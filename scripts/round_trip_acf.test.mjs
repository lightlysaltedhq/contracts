// Proves the ACF round trip's own machinery without a salt-wordpress checkout: its command line,
// and that importing it runs nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { classify } from './_round_trip.mjs'
import { parseArguments } from './round_trip_acf.mjs'

test('R10: flags may come anywhere; the checkout is a path or SALT_WORDPRESS_DIR, never a guess', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'salt-wordpress-'))
  try {
    mkdirSync(path.join(dir, 'inc', 'fields'), { recursive: true })
    assert.throws(() => parseArguments([tmpdir()], {}), /salt-wordpress checkout not found/)
    assert.deepEqual(parseArguments(['--check', dir], {}), { wordpress: dir, check: true, suggest: false })
    assert.deepEqual(parseArguments([dir, '--suggest'], {}), { wordpress: dir, check: false, suggest: true })
    assert.deepEqual(parseArguments([], { SALT_WORDPRESS_DIR: dir }), { wordpress: dir, check: false, suggest: false })
    assert.throws(() => parseArguments([], {}), /pass a salt-wordpress checkout or set SALT_WORDPRESS_DIR/)
    assert.throws(() => parseArguments([path.join(dir, 'nope')], {}), /salt-wordpress checkout not found: .*nope/)
    assert.throws(() => parseArguments(['--chek', dir], {}), /unknown option --chek/)
    assert.throws(() => parseArguments([dir, dir], {}), /one salt-wordpress checkout/)
    assert.throws(() => parseArguments(['--check', '--suggest', dir], {}), /--check and --suggest cannot be used together/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('R9: every entry on the reviewed list cites a note or record the contract really holds', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'salt-contract')
  const list = JSON.parse(readFileSync(path.join(root, 'reports', 'round-trip-acf.expected.json'), 'utf8'))
  // Every WordPress note in the contract, by kind.
  const notes = { owes: new Set(), note: new Set(), formerly: new Set(), values: new Set(), layouts: new Set() }
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk)
    if (!x || typeof x !== 'object') return
    const wp = x.platforms?.wordpress
    if (wp) {
      if (wp.owes) notes.owes.add(wp.owes)
      if (wp.note) notes.note.add(wp.note)
      if (wp.formerly && typeof [wp.formerly].flat()[0] === 'string') notes.formerly.add([wp.formerly].flat().join(', '))
      // A query's values are keyed by part, and a part's row cites its own map.
      if (wp.values) for (const v of [wp.values, ...Object.values(wp.values).filter((x) => typeof x === 'object')]) notes.values.add(JSON.stringify(v))
      for (const f of Array.isArray(wp.formerly) ? wp.formerly : []) {
        if (f?.name) notes.layouts.add(f.name)
        if (f?.when) notes.layouts.add(`${f.name} when ${f.when}`)
      }
    }
    Object.values(x).forEach(walk)
  }
  for (const f of readdirSync(path.join(root, 'contract', 'fields'))) walk(JSON.parse(readFileSync(path.join(root, 'contract', 'fields', f), 'utf8')))
  walk(JSON.parse(readFileSync(path.join(root, 'contract', 'sections.json'), 'utf8')))
  assert.ok(list.length > 0)
  for (const e of list) {
    assert.deepEqual(Object.keys(e), ['section', 'path', 'kind', 'difference', 'evidence'])
    const m = /^(owes|note|formerly|values|parent owes|[a-zA-Z]+ owes|sections\.json formerly): (.+)$/.exec(e.evidence)
    assert.ok(m, JSON.stringify(e))
    const [, kind, cited] = m
    const pool = kind === 'sections.json formerly' ? notes.layouts : kind.endsWith('owes') ? notes.owes : notes[kind]
    assert.ok(pool.has(cited), `${JSON.stringify(e)} cites text the contract does not hold`)
  }
})

test('R9: a difference is expected only when the reviewed list names it exactly', () => {
  const list = [{ section: 'contact', path: 'showPhone', kind: 'name', difference: 'stored as show_phone', evidence: 'formerly: show_phone' }]
  const row = (kind, text) => ({ section: 'contact', at: 'showPhone', kind, text })
  assert.deepEqual(classify([row('name', 'stored as show_phone')], list).expected.map((r) => r.evidence), ['formerly: show_phone'])
  const later = classify([row('type', 'type text; salt-wordpress textarea')], list)
  assert.equal(later.unexpected.length, 1)
  assert.deepEqual(later.unseen, list)
})

test('S7: a committed report checked out with CRLF line endings is still current', async () => {
  const { reportIsCurrent } = await import('./round_trip_acf.mjs')
  const text = '# ACF round trip\n\na | b\n'
  assert.equal(reportIsCurrent(text.replace(/\n/g, '\r\n'), text), true)
  assert.equal(reportIsCurrent(text.replace('a', 'c'), text), false)
})
