#!/usr/bin/env node
// The flex and grid containers the normaliser reads, derived from the shared stylesheets. A browser
// draws no white space between the children of a flex or grid container, so the normaliser drops
// it there and nowhere else.
//
// A container is a class whose rule, unconditionally (at the top level or inside @layer, never
// inside @media, @supports or @container), is a bare `.salt-*` selector setting display to flex,
// inline-flex, grid or inline-grid. A class that is a container only in some context (`.salt-grid
// .salt-card`, `.salt-drawer[open]`) is left out, so its white space keeps counting: the list can
// miss a container, never invent one.
//
//   node scripts/salt_normalise_containers.mjs [package-dir]          prints the list
//   node scripts/salt_normalise_containers.mjs [package-dir] --write  writes it into normalise.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function containersFrom(stylesDir) {
  const found = new Set()
  // salt.css is the others minified, so it adds nothing and is read in their form instead.
  for (const file of readdirSync(stylesDir).filter((f) => f.endsWith('.css') && f !== 'salt.css').sort()) {
    const css = readFileSync(path.join(stylesDir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const stack = []
    let start = 0
    for (let i = 0; i < css.length; i++) {
      if (css[i] === '{') {
        stack.push(css.slice(start, i).trim())
        start = i + 1
      } else if (css[i] === '}') {
        const prelude = stack.pop() ?? ''
        const body = css.slice(start, i)
        start = i + 1
        const conditional = stack.some((p) => p.startsWith('@') && !p.startsWith('@layer'))
        if (prelude.startsWith('@') || conditional) continue
        const display = /(?:^|;)\s*display\s*:\s*([a-z-]+)/.exec(body)?.[1]
        if (!['flex', 'inline-flex', 'grid', 'inline-grid'].includes(display)) continue
        for (const selector of prelude.split(',').map((s) => s.trim())) {
          if (/^\.salt-[a-z0-9_-]+$/.test(selector)) found.add(selector.slice(1))
        }
      } else if (css[i] === ';' && stack.length === 0) {
        start = i + 1
      }
    }
  }
  return [...found].sort()
}

const BEGIN = '// BEGIN containers (scripts/salt_normalise_containers.mjs --write)'
const END = '// END containers'

export function written(list) {
  return `${BEGIN}\nexport const CONTAINERS = new Set([\n${list.map((c) => `  '${c}',`).join('\n')}\n])\n${END}`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const here = path.dirname(fileURLToPath(import.meta.url))
  const dir = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(here, '..', 'salt-contract'))
  const list = containersFrom(path.join(dir, 'styles'))
  if (!args.includes('--write')) { console.log(list.join('\n')); process.exit(0) }
  const file = path.join(dir, 'normalise.mjs')
  const src = readFileSync(file, 'utf8')
  const from = src.indexOf(BEGIN)
  const to = src.indexOf(END)
  if (from === -1 || to === -1) { console.error(`${file} has no containers block to write`); process.exit(1) }
  writeFileSync(file, src.slice(0, from) + written(list) + src.slice(to + END.length))
  console.log(`wrote ${list.length} containers into ${path.relative(process.cwd(), file)}`)
}
