// The default sizes, srcset and src of an image the fixtures draw, from contract/image-sizes.json
// (SC-016): which slot the image takes (the file's placements, read from where the img sits), the
// sizes that slot gives for the section's band, the candidate widths the srcset rule leaves, and
// the URLs the case's media record makes of them.

const classesOf = (el) => (el.attrs.find(([n]) => n === 'class')?.[1] ?? '').split(/\s+/).filter(Boolean)
const elementsOf = (el) => el.children.filter((c) => c.type === 'element')

/**
 * The slot an img takes, or null when no placement covers it. `ancestors` runs from the img's
 * parent outwards; `section` and `values` are the case's, with `defaults` for unset fields.
 */
export function slotOf(img, ancestors, outer, effective) {
  const cls = classesOf(img)
  // A section nested in a view (the archive's listing) is read as that section.
  const block = ancestors.find((a) => a.attrs.some(([n]) => n === 'data-block'))
  const section = block ? block.attrs.find(([n]) => n === 'data-block')[1] : outer
  const within = (c) => ancestors.find((a) => classesOf(a).includes(c))
  const columns = String(effective('columns') ?? '3')
  if (cls.includes('salt-section__media')) return { slot: 'full', band: false }
  if (cls.includes('salt-logo__image')) return { slot: 'logo', band: false }
  if (cls.includes('salt-hero__image')) return { slot: effective('variant') === 'split' ? 'half' : 'content', band: true }
  if (cls.includes('salt-media-text__image')) {
    const row = within('salt-media-text__row')
    const words = row && elementsOf(row).some((k) => classesOf(k).includes('salt-media-text__body'))
    return { slot: words ? 'half' : 'content', band: true }
  }
  if (cls.includes('salt-gallery__image')) {
    if ((effective('images') ?? []).length === 1) return { slot: 'content', band: true }
    if (within('salt-carousel__track')) return { slot: 'card', band: false }
    return { slot: 'card', band: true, columns }
  }
  if (cls.includes('salt-logos__image')) return { slot: 'thumb', band: false }
  if (cls.includes('salt-process__image')) return effective('layout') === 'cards' ? { slot: 'card', band: true, columns: '3' } : { slot: 'content', band: true }
  if (within('salt-showcase__caption')) return { slot: 'thumb', band: false }
  // The views (blog-views.tsx, catalogue-views.tsx): the post's image is the content slot, the
  // archive's portrait and the author box's photo thumbs, and a related card the card slot.
  if (within('salt-post__media')) return { slot: 'content', band: false }
  if (within('salt-archive__portrait') || within('salt-author-box__media')) return { slot: 'thumb', band: false }
  // The related list is a three-column .salt-grid straight in the view's main, which no shared
  // stylesheet gives a measure (nor does Salt for Next.js's core; only its example app's site.css
  // does), so it spans the full band.
  if (within('salt-related__list')) return { slot: 'card', band: true, columns: '3', fixedBand: 'full' }
  if (!within('salt-showcase__media')) return null
  if (section === 'collection-showcase') {
    const layout = effective('layout')
    const item = ancestors.find((a) => a.name === 'li')
    const list = item && ancestors[ancestors.indexOf(item) + 1]
    const first = list && elementsOf(list)[0] === item
    if (layout === 'list' || (layout === 'featured' && first)) return { slot: 'content', band: true }
    return { slot: 'card', band: true, columns }
  }
  if (section === 'carousel') {
    if (within('salt-carousel__track')) return { slot: 'card', band: false }
    if (!ancestors.some((a) => a.name === 'li')) return { slot: 'content', band: true }
    return { slot: 'card', band: true, columns: '3' }
  }
  if (section === 'listing') return { slot: 'card', band: true, columns: '3' }
  return null
}

/** The sizes a slot gives in a band, or undefined when the table has none. */
export function sizesOf(table, { slot, band, columns }, width) {
  const entry = table.slots[slot]
  if (!entry) return undefined
  if (!band || !entry.bands) return entry.sizes
  const value = entry.bands[width]
  return typeof value === 'string' ? value : value?.[columns ?? '3']
}

/**
 * A drawn slot's sizes (the logo): its drawn width in px, from the upload's aspect ratio and the
 * height the site draws it at, or the slot's default height.
 */
export function drawnSizes(table, slot, record, heightPx) {
  const drawn = table.slots[slot]?.drawn
  if (!drawn) return undefined
  return `${Math.round((record.width / record.height) * (heightPx ?? drawn.defaultHeightPx))}px`
}

/** The candidate widths the srcset rule leaves for a sizes value. */
export function widthsFor(table, sizes) {
  const shares = [...sizes.matchAll(/(?:^|\s)(1?\d?\d)vw/g)].map((m) => Number(m[1]))
  const floor = shares.length ? (table.srcset.viewportFloor * Math.min(...shares)) / 100 : 0
  return table.candidates.filter((w) => w >= floor)
}

/**
 * The expected src and srcset of a media record (its url holds {width}) for a sizes value: the
 * candidates the rule leaves, up to and including the upload's intrinsic width, and that width
 * itself when it is no candidate, since no platform can serve an image wider than its upload.
 */
export function sourcesOf(table, record, sizes) {
  const capped = widthsFor(table, sizes).filter((w) => w <= record.width)
  const widths = capped.includes(record.width) ? capped : [...capped, record.width]
  const at = (w) => record.url.replaceAll('{width}', String(w))
  return { src: at(widths.at(-1)), srcset: widths.map((w) => `${at(w)} ${w}w`).join(', ') }
}
