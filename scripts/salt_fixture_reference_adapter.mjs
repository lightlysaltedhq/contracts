#!/usr/bin/env node
// A reference adapter for the fixtures' adapter protocol (salt-contract/README.md, "The adapter
// protocol"): one case input as JSON on stdin, that case's HTML on stdout, exit 0. It renders
// nothing itself: it finds the fixture whose input equals stdin and writes its expected HTML, so
// the conformance runner can be tested end to end before either platform's adapter exists.
//
//   node scripts/salt_fixture_reference_adapter.mjs [package-dir] < fixtures/hero/empty.json
import { readdirSync, readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(process.argv[2] ?? path.join(here, '..', 'salt-contract'))
let input
try { input = JSON.parse(readFileSync(0, 'utf8')) } catch (e) { process.stderr.write(`stdin is not a case input: ${e.message}\n`); process.exit(2) }
// The case names its fixture set under its kind's key: section, chrome or view.
const id = input?.section ?? input?.chrome ?? input?.view ?? input?.page ?? ''
const sdir = path.join(dir, 'fixtures', String(id))
let names = []
try { names = readdirSync(sdir).filter((f) => f.endsWith('.json')) } catch { /* reported below */ }
const match = names.find((f) => isDeepStrictEqual(JSON.parse(readFileSync(path.join(sdir, f), 'utf8')), input))
if (!match) { process.stderr.write(`no fixture of ${JSON.stringify(id)} has this input\n`); process.exit(1) }
process.stdout.write(readFileSync(path.join(sdir, match.replace(/\.json$/, '.html')), 'utf8'))
