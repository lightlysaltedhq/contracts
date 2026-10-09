// The one normaliser both platforms run their HTML, and the fixtures' expected HTML, through before
// comparing them. Plain ESM, no dependencies, so Salt for Next.js and Salt for WordPress's test
// runner (Node) import the same file from the package they pin.
//
// It removes only differences a visitor cannot see or that the contract leaves to each platform:
//
// 1. Attribute order. Attributes are sorted by name; names and tag names are lower-cased, as an
//    HTML parser treats them.
// 2. Insignificant whitespace, by the CSS rule for collapsible white space, read from the elements:
//    a run collapses to one space, and goes only at a block boundary (the start or end of a
//    block's inline content, or beside a block-level element) or after another space. Between
//    two inline (phrasing) elements a run is one space and stays, whether it was typed or is a
//    template's line break, because a browser draws it: `<span>£49</span>\n<span>a month</span>`
//    shows "£49 a month" and differs from the two spans written together. Inside a flex or grid
//    container (CONTAINERS, derived from the shared stylesheets) white space between children is
//    never drawn, so it goes, and each child's own text is trimmed as a block's is. pre, textarea, script
//    and style keep theirs. Inside style attributes, the spaces around `:` and `;` go, and srcset
//    candidates are rejoined as `url descriptor, …`.
// 3. Boolean attribute forms. `hidden`, `hidden=""` and `hidden="hidden"` are one form, and any
//    attribute with an empty value (`data-divider=""`) is written bare.
// 4. Character references. Text and attribute values are decoded and re-escaped one way, so
//    `&#39;`, `&#x27;` and `'` agree.
// 5. The upload host. The scheme and host of every URL in src and srcset are dropped, since each
//    platform serves uploads from its own origin; the path still compares.
// 6. Class order. A class attribute's tokens are sorted; their order changes nothing.
// 7. Comments are dropped (React writes `<!-- -->` between adjacent text nodes), and the text
//    either side of one joins up.
// 8. Icon artwork. The children of svg.salt-icon are dropped: the glyph names are the contract and
//    the artwork stays each platform's own (SC-007). The svg's own attributes still compare.
//
// 9. Per-request values in the contact form (SC-016), and only these, become declared
//    placeholders: form.salt-contact__form's action ({{salt:form-action}}, platform-native under
//    SC-003), the value of its hidden formToken and challengeToken inputs ({{salt:form-token}},
//    {{salt:challenge-token}}) and the text of the challenge's label ({{salt:challenge-question}}).
//    Each is matched by element, class, name or id, never by pattern, so a field's type, name or
//    any other attribute still compares.
//
// Ids are not normalised: SC-012 makes every drawn id deterministic, so an id that differs is a
// real difference. Input must close its elements (both platforms' serialisers do); no implied end
// tags are inferred.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const RAW = new Set(['script', 'style', 'textarea', 'title'])
const KEEP_SPACE = new Set(['pre', 'textarea', 'script', 'style'])
const BOOLEAN = new Set(['allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls', 'default', 'defer',
  'disabled', 'formnovalidate', 'hidden', 'inert', 'ismap', 'itemscope', 'loop', 'multiple', 'muted', 'nomodule',
  'novalidate', 'open', 'playsinline', 'readonly', 'required', 'reversed', 'selected'])
// Inline-level elements: white space beside them is part of a line, not formatting.
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'button', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'img',
  'input', 'kbd', 'label', 'mark', 'q', 's', 'samp', 'select', 'small', 'span', 'strong', 'sub', 'sup', 'svg', 'textarea',
  'time', 'u', 'var', 'wbr'])
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—',
  ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®',
  trade: '™', pound: '£', euro: '€', times: '×', middot: '·', rarr: '→', larr: '←' }
// HTML's white space; \s would also take U+00A0, which is not collapsible.
const WS = /[ \t\n\r\f]+/g

// The classes the shared stylesheets make flex or grid containers, unconditionally. Generated from
// styles/ by scripts/salt_normalise_containers.mjs; the fixtures gate fails if they disagree.
// BEGIN containers (scripts/salt_normalise_containers.mjs --write)
export const CONTAINERS = new Set([
  'salt-button',
  'salt-carousel',
  'salt-carousel__controls',
  'salt-carousel__track',
  'salt-case-study-view__details',
  'salt-consent-banner',
  'salt-consent-banner__actions',
  'salt-consent-panel__actions',
  'salt-consent-panel__category',
  'salt-contact__field',
  'salt-contact__form',
  'salt-copy-link',
  'salt-copy-link__button',
  'salt-cta__actions',
  'salt-drawer__close',
  'salt-drawer__panel',
  'salt-footer__base',
  'salt-footer__inner',
  'salt-footer__link',
  'salt-footer__nav',
  'salt-footer__social',
  'salt-footer__social-link',
  'salt-grid',
  'salt-header__inner',
  'salt-header__phone',
  'salt-hero',
  'salt-hero__actions',
  'salt-logo',
  'salt-logos__item',
  'salt-media-text',
  'salt-media-text__actions',
  'salt-media-text__row',
  'salt-nav__item',
  'salt-nav__link',
  'salt-nav__list',
  'salt-nav__subitem',
  'salt-nav__sublink',
  'salt-nav__submenu',
  'salt-nav__toggle',
  'salt-pagination__link',
  'salt-pagination__list',
  'salt-post__footer',
  'salt-post__meta',
  'salt-post__tags',
  'salt-process__number',
  'salt-process__step',
  'salt-search__form',
  'salt-share',
  'salt-share__link',
  'salt-share__list',
  'salt-showcase__caption',
  'salt-showcase__group',
  'salt-showcase__index',
  'salt-showcase__panel',
  'salt-showcase__tags',
  'salt-stat',
  'salt-tabs',
  'salt-tabs__control',
  'salt-tabs__list',
  'salt-tabs__panels',
  'salt-tabs__tab',
  'salt-theme-toggle',
])
// END containers
const isContainer = (el) => el.attrs.some(([n, v]) => n === 'class' && v.split(WS).some((c) => CONTAINERS.has(c)))

export function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (m, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITIES[ref.toLowerCase()] ?? m
  })
}

const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/y

// A tree of { type: 'element', name, attrs: [[name, value]], children } and { type: 'text', value }.
export function parse(html) {
  const root = { type: 'element', name: '#root', attrs: [], children: [] }
  const stack = [root]
  const top = () => stack[stack.length - 1]
  let i = 0
  const text = (value) => { if (value) top().children.push({ type: 'text', value: decode(value) }) }
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) { text(html.slice(i)); break }
    text(html.slice(i, lt))
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      i = end === -1 ? html.length : end + 3
      continue
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') { const end = html.indexOf('>', lt); i = end === -1 ? html.length : end + 1; continue }
    const close = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/.exec(html.slice(lt, lt + 200))
    if (close) {
      const name = close[1].toLowerCase()
      const at = stack.findLastIndex((e) => e.name === name)
      if (at > 0) stack.length = at
      i = lt + close[0].length
      continue
    }
    const open = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt, lt + 200))
    if (!open) { text('<'); i = lt + 1; continue }
    const name = open[1].toLowerCase()
    const el = { type: 'element', name, attrs: [], children: [] }
    let j = lt + open[0].length
    let selfClosing = false
    for (;;) {
      while (j < html.length && /\s/.test(html[j])) j++
      if (j >= html.length) break
      if (html[j] === '>') { j++; break }
      if (html[j] === '/' && html[j + 1] === '>') { selfClosing = true; j += 2; break }
      if (html[j] === '/') { j++; continue }
      ATTR.lastIndex = j
      const m = ATTR.exec(html)
      if (!m) { j++; continue }
      const attr = m[1].toLowerCase()
      // HTML keeps the first of two attributes with one name.
      if (!el.attrs.some(([n]) => n === attr)) el.attrs.push([attr, decode(m[2] ?? m[3] ?? m[4] ?? '')])
      j = ATTR.lastIndex
    }
    top().children.push(el)
    i = j
    if (VOID.has(name) || selfClosing) continue
    if (RAW.has(name)) {
      const end = html.toLowerCase().indexOf(`</${name}`, i)
      const body = html.slice(i, end === -1 ? html.length : end)
      if (body) el.children.push({ type: 'text', value: name === 'script' || name === 'style' ? body : decode(body) })
      const gt = end === -1 ? -1 : html.indexOf('>', end)
      i = gt === -1 ? html.length : gt + 1
      continue
    }
    stack.push(el)
  }
  return root
}

const hasClass = (el, c) => el.attrs.some(([n, v]) => n === 'class' && v.split(WS).includes(c))

function dropComments(el) {
  // Comments never reach the tree; join the text nodes they separated.
  const out = []
  for (const child of el.children) {
    if (child.type === 'text' && out.at(-1)?.type === 'text') out.at(-1).value += child.value
    else out.push(child)
    if (child.type === 'element') dropComments(child)
  }
  el.children = out
}

function dropIconArtwork(el) {
  if (el.name === 'svg' && hasClass(el, 'salt-icon')) { el.children = []; return }
  for (const c of el.children) if (c.type === 'element') dropIconArtwork(c)
}

// The CSS rule for collapsible white space over one block's inline content. A run is the inline
// content between block boundaries; a space at either end of a run, or after a space, goes.
function collapse(block) {
  // A flex or grid container draws no white space between its children, and each child, text
  // included, is laid out as a block of its own.
  if (isContainer(block)) {
    for (const c of block.children) {
      if (c.type === 'text') c.value = c.value.replace(WS, ' ').trim()
      else if (!KEEP_SPACE.has(c.name)) collapse(c)
    }
    prune(block)
    return
  }
  let run = []
  const flush = () => {
    let prevSpace = true
    for (const item of run) {
      if (item === 'atom') { prevSpace = false; continue }
      if (item === 'break') { trimEnd(); prevSpace = true; continue }
      let v = item.value.replace(WS, ' ')
      if (prevSpace && v.startsWith(' ')) v = v.slice(1)
      if (v) prevSpace = v.endsWith(' ')
      item.value = v
    }
    trimEnd()
    run = []
  }
  // The trailing space of a run, wherever its last non-empty text sits.
  const trimEnd = () => {
    for (let k = run.length - 1; k >= 0; k--) {
      const item = run[k]
      if (item === 'atom' || item === 'break') return
      if (item.value === '') continue
      item.value = item.value.replace(/[ \t\n\r\f]+$/, '')
      return
    }
  }
  const walk = (el) => {
    for (const c of el.children) {
      if (c.type === 'text') { run.push(c); continue }
      if (KEEP_SPACE.has(c.name)) { flush(); continue }
      if (isContainer(c)) { if (INLINE.has(c.name)) run.push('atom'); else flush(); collapse(c); continue }
      if (!INLINE.has(c.name)) { flush(); collapse(c); continue }
      if (c.name === 'br') { run.push('break'); continue }
      if (VOID.has(c.name) || c.name === 'svg' || c.name === 'select' || c.name === 'textarea') { run.push('atom'); continue }
      walk(c)
    }
  }
  walk(block)
  flush()
  prune(block)
}

function prune(el) {
  el.children = el.children.filter((c) => c.type === 'element' || c.value !== '')
  for (const c of el.children) if (c.type === 'element' && !KEEP_SPACE.has(c.name)) prune(c)
}

const stripOrigin = (url) => url.replace(/^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/?#]*/i, '')

function attrValue(el, name, value) {
  if (name === 'class') return [...new Set(value.split(WS).filter(Boolean))].sort().join(' ')
  if (name === 'style') {
    return value.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const colon = d.indexOf(':')
      return colon === -1 ? d : `${d.slice(0, colon).trim()}:${d.slice(colon + 1).trim().replace(WS, ' ')}`
    }).join(';')
  }
  if (name === 'src') return stripOrigin(value.trim())
  if (name === 'srcset') {
    return value.split(/,(?=\s|$)|,(?=[^\s,]+\s+\d)/).map((c) => c.trim()).filter(Boolean)
      .map((c) => { const [url, ...rest] = c.split(WS); return [stripOrigin(url), ...rest].join(' ') }).join(', ')
  }
  return value
}

const escapeText = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttr = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

function serialise(node, parent) {
  if (node.type === 'text') return parent && (parent.name === 'script' || parent.name === 'style') ? node.value : escapeText(node.value)
  const attrs = node.attrs
    .map(([n, v]) => [n, attrValue(node, n, v)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([n, v]) => (v === '' || (BOOLEAN.has(n) && v.toLowerCase() === n) ? ` ${n}` : ` ${n}="${escapeAttr(v)}"`))
    .join('')
  const inner = node.children.map((c) => serialise(c, node)).join('')
  if (node.name === '#root') return inner
  return VOID.has(node.name) ? `<${node.name}${attrs}>` : `<${node.name}${attrs}>${inner}</${node.name}>`
}

export const PLACEHOLDERS = {
  action: '{{salt:form-action}}',
  formToken: '{{salt:form-token}}',
  challengeToken: '{{salt:challenge-token}}',
  question: '{{salt:challenge-question}}',
}
const attrOf = (el, name) => el.attrs.find(([n]) => n === name)?.[1]
const isContactForm = (el) => el.name === 'form' && hasClass(el, 'salt-contact__form')

/** Whether the normaliser masks this attribute of this element (inside the contact form or not). */
export function masks(el, name, insideForm) {
  if (name === 'action') return isContactForm(el)
  return insideForm && name === 'value' && el.name === 'input' && attrOf(el, 'type') === 'hidden' &&
    ['formToken', 'challengeToken'].includes(attrOf(el, 'name'))
}

function maskPerRequest(el, insideForm = false) {
  const inside = insideForm || isContactForm(el)
  el.attrs = el.attrs.map(([n, v]) => {
    if (!masks(el, n, inside)) return [n, v]
    return [n, n === 'action' ? PLACEHOLDERS.action : PLACEHOLDERS[attrOf(el, 'name')]]
  })
  if (inside && el.name === 'label' && /__challenge$/.test(attrOf(el, 'for') ?? '')) el.children = [{ type: 'text', value: PLACEHOLDERS.question }]
  for (const c of el.children) if (c.type === 'element') maskPerRequest(c, inside)
}

/** The canonical form of an HTML fragment: two fragments are equivalent when these are equal. */
export function normalise(html) {
  const root = parse(String(html))
  dropComments(root)
  dropIconArtwork(root)
  maskPerRequest(root)
  collapse(root)
  return serialise(root)
}

/** Whether two fragments are equivalent, with both canonical forms for a diff. */
export function compare(expected, actual) {
  const a = normalise(expected)
  const b = normalise(actual)
  return { equal: a === b, expected: a, actual: b }
}
