// Proves each check in check_salt_contract.mjs can fail, on a throwaway copy of a minimal package.
// A gate that has never been seen to fail is not known to check anything.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check_salt_contract.mjs')

function makePackage(edit = () => {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'salt-contract-gate-'))
  const files = {
    'package.json': {
      name: '@lightlysaltedhq/salt-contract',
      version: '0.1.0',
      private: true,
      files: ['contract', 'schema', 'styles', 'fixtures', 'README.md', 'CHANGELOG.md', 'RELEASE-POLICY.md', 'LICENSE'],
      exports: { './sections': './contract/sections.json', './package.json': './package.json' },
    },
    'schema/sections.schema.json': {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'sections.schema.json',
      type: 'object',
      required: ['version', 'sections'],
      properties: {
        $schema: { type: 'string' },
        version: { type: 'string' },
        sections: { type: 'array', items: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' } },
      },
      additionalProperties: false,
    },
    'contract/sections.json': { $schema: '../schema/sections.schema.json', version: '0.1.0', sections: ['hero'] },
  }
  const text = { 'README.md': '# salt-contract\n', 'CHANGELOG.md': '# Changelog\n', 'RELEASE-POLICY.md': '# Policy\n', 'LICENSE': 'MIT\n' }
  edit(files, text)
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    writeFileSync(path.join(dir, rel), JSON.stringify(body, null, 2) + '\n')
  }
  for (const [rel, body] of Object.entries(text)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    writeFileSync(path.join(dir, rel), body)
  }
  return dir
}

function run(dir) {
  try {
    const out = execFileSync(process.execPath, [script, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: `${e.stdout}${e.stderr}` }
  }
}

function expectFail(edit, pattern) {
  const dir = makePackage(edit)
  try {
    const r = run(dir)
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}:\n${r.out}`)
    assert.match(r.out, pattern)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('a minimal well-formed package passes', () => {
  const dir = makePackage()
  try {
    const r = run(dir)
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /PASS/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a contract file whose version is not the package version fails', () => {
  expectFail((f) => { f['contract/sections.json'].version = '0.0.9' }, /version says 0\.0\.9; package\.json says 0\.1\.0/)
})

test('a contract file with no version fails', () => {
  expectFail((f) => { delete f['contract/sections.json'].version }, /has no top-level version/)
})

test('a version key anywhere but the top level fails', () => {
  expectFail((f) => {
    f['schema/sections.schema.json'].properties.sections.items = { type: 'string' }
    f['contract/sections.json'].sections = ['hero']
    f['contract/sections.json'].specVersion = '1'
  }, /specVersion: a version key this gate does not rank/)
})

test('a contract file that does not declare its schema fails', () => {
  expectFail((f) => { delete f['contract/sections.json'].$schema }, /declares no \$schema/)
})

test('a contract file that breaks its schema fails, naming the path', () => {
  expectFail((f) => { f['contract/sections.json'].sections = ['Hero Banner'] }, /contract\/sections\.json.*\/sections\/0/)
})

test('a schema that does not compile fails', () => {
  expectFail((f) => { f['schema/sections.schema.json'].type = 'not-a-type' }, /does not compile/)
})

test('a colour literal in the contract fails', () => {
  expectFail((f) => { f['contract/sections.json'].note = 'brand is #1a2b3c' }, /colour value/)
})

test('a functional colour in a stylesheet fails', () => {
  expectFail((f, t) => { t['styles/sections.css'] = '.salt-hero { color: oklch(0.5 0.1 150); }\n' }, /styles\/sections\.css:1.*colour value/)
})

test('a named colour on a colour property in a stylesheet fails', () => {
  expectFail((f, t) => { t['styles/sections.css'] = '.salt-hero {\n  background-color: rebeccapurple;\n}\n' }, /styles\/sections\.css:2.*named colour/)
})

test('a stylesheet that reaches colours only through custom properties passes', () => {
  const dir = makePackage((f, t) => {
    t['styles/sections.css'] = '.salt-hero { color: var(--color-ink); background: color-mix(in oklch, var(--color-brand) 10%, transparent); border-color: currentColor; }\n'
  })
  try {
    const r = run(dir)
    assert.equal(r.code, 0, r.out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an export that is not in the tarball fails', () => {
  expectFail((f) => { f['package.json'].exports['./markup'] = './contract/markup.json' }, /exported path is not in the tarball: contract\/markup\.json/)
})

test('a file outside the declared directories in the tarball fails', () => {
  expectFail((f, t) => { f['package.json'].files.push('scratch'); t['scratch/notes.txt'] = 'x\n' }, /must not ship: package\/scratch\/notes\.txt/)
})
