#!/usr/bin/env node
// The conformance runner's self-check (`npm run salt-conformance`): the runner, against the
// reference adapter over every fixture, with all four checks run as SC-017 requires. Field parity
// needs a committed snapshot, which the contract has none of, so this writes the Payload and the
// ACF snapshot the emitters give for one set of options to a temporary directory and runs the
// runner once for each platform. The stylesheet it pins is a copy of styles/salt.css, standing for
// the file an implementation serves: the runner refuses the package's own. Both runs must conform.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { payloadSnapshot } from '../salt-contract/emit/payload.mjs'
import { acfSnapshot } from '../salt-contract/emit/acf.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkg = path.join(here, '..', 'salt-contract')
const runner = path.join(pkg, 'conformance.mjs')
const adapter = `"${process.execPath}" "${path.join(here, 'salt_fixture_reference_adapter.mjs')}"`
// features, stats and process need icon options; the contract's own content icons serve.
const icons = JSON.parse(readFileSync(path.join(pkg, 'contract', 'sections.json'), 'utf8')).icons.content
const options = { icons: icons.map((value) => ({ value, label: value })) }

const dir = mkdtempSync(path.join(tmpdir(), 'salt-conformance-self-'))
let failed = false
try {
  writeFileSync(path.join(dir, 'options.json'), JSON.stringify(options))
  writeFileSync(path.join(dir, 'payload.json'), payloadSnapshot(options))
  writeFileSync(path.join(dir, 'acf.json'), acfSnapshot(options))
  copyFileSync(path.join(pkg, 'styles', 'salt.css'), path.join(dir, 'served.css'))
  for (const platform of ['payload', 'acf']) {
    const args = [runner, '--platform', `reference-${platform}`, '--adapter', adapter, `--${platform}-snapshot`, path.join(dir, `${platform}.json`),
      '--fields-options', path.join(dir, 'options.json'), '--styles', path.join(dir, 'served.css'), '--out', path.join(dir, platform)]
    try {
      execFileSync(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] })
      const { summary } = JSON.parse(readFileSync(path.join(dir, platform, 'conformance.json'), 'utf8'))
      console.log(`PASS: the reference adapter conforms with the ${platform} snapshot: ${summary.pass} section(s), all four checks each; ` +
        `${summary.files.pass} chrome, view and page file(s), fixtures and classes each.`)
    } catch (e) {
      failed = true
      process.stdout.write(e.stdout ?? '')
      console.log(`✗ the reference adapter does not conform with the ${platform} snapshot`)
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
