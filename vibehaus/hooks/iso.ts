/*
 * Isometric pixel drawing for the house: a 2:1 projection of the floor plan,
 * and a canvas that fills shapes on the picture's pixel grid, so walls,
 * floors and furniture have the stair-stepped edges of pixel art.
 *
 * Every fill is a material: its colours at night (the dark theme) and by day
 * (the light theme). The picture carries the night colours and a style that
 * swaps in the day ones when the app is in light mode.
 */

export type Pt = { x: number; y: number }

// A material: night and day colours, and a short class name for the style.
export type Mat = { night: string; day: string; cls: string }

// The three faces of a box: lit top, the side toward the left of the screen,
// the side toward the right, darkest.
export type Faces = { top: Mat; left: Mat; right: Mat }

export function shade(hex: string, f: number): string {
  const v = parseInt(hex.slice(1), 16)
  const c = (s: number) => {
    const ch = (v >> s) & 255
    return Math.max(0, Math.min(255, Math.round(f < 0 ? ch * (1 + f) : ch + (255 - ch) * f)))
  }
  return '#' + ((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0')
}

// mulberry32: a small seeded generator, so a picture is the same on every
// redraw.
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A material from its night and day colours; `faces` adds the box shades.
export function mat(cls: string, night: string, day: string): Mat {
  return { cls, night, day }
}

// Indoors by night: the day colour under warm lamplight, a little dimmer and
// shifted towards amber, so the house glows against the dark garden.
function lamplit(day: string): string {
  const v = parseInt(day.slice(1), 16)
  const ch = (s: number, f: number) => Math.min(255, Math.round(((v >> s) & 255) * f))
  return '#' + ((ch(16, 0.8) << 16) | (ch(8, 0.67) << 8) | ch(0, 0.54)).toString(16).padStart(6, '0')
}

export function warm(cls: string, day: string): Mat {
  return mat(cls, lamplit(day), day)
}

export function warmFaces(cls: string, day: string): Faces {
  return faces(cls, lamplit(day), day)
}

export function faces(cls: string, night: string, day: string): Faces {
  return {
    top: mat(`${cls}t`, shade(night, 0.14), shade(day, 0.18)),
    left: mat(`${cls}l`, night, day),
    right: mat(`${cls}r`, shade(night, -0.28), shade(day, -0.2)),
  }
}

// The pixel rows of a convex polygon: each row's run of pixels whose centres
// fall inside, left edges in and right edges out, so shapes sharing an edge
// tile without gaps or overlaps.
function rows(pts: Pt[]): [number, number, number][] {
  if (pts.length < 3) return []
  const ys = pts.map(p => p.y)
  const top = Math.floor(Math.min(...ys))
  const bottom = Math.ceil(Math.max(...ys))
  const out: [number, number, number][] = []
  for (let r = top; r < bottom; r++) {
    const yc = r + 0.5
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i] as Pt
      const b = pts[(i + 1) % pts.length] as Pt
      if ((a.y <= yc && yc < b.y) || (b.y <= yc && yc < a.y)) {
        const x = a.x + ((yc - a.y) * (b.x - a.x)) / (b.y - a.y)
        lo = Math.min(lo, x)
        hi = Math.max(hi, x)
      }
    }
    if (lo > hi) continue
    const c0 = Math.ceil(lo - 0.5 - 1e-9)
    const c1 = Math.ceil(hi - 0.5 - 1e-9)
    if (c1 > c0) out.push([r, c0, c1 - c0])
  }
  return out
}

// Paths for one picture, layer by layer: within a layer every fill of one
// material is one path; layers stack in the order they were opened.
export class Canvas {
  private parts: string[] = []
  private open = new Map<string, { m: Mat | string; d: string[] }>()
  readonly used = new Map<string, Mat>()
  // pieces drawn once and placed again by reference: where each was drawn
  private stamps = new Map<string, Pt>()
  private defs: string[] = []

  // Draws a piece that recurs (a desk, a plant, a stretch of wall) once, and
  // every later one as a copy moved over by whole pixels. `origin` is any
  // point of the piece, the same point on every copy; `fill` fills a piece
  // drawn with the `inherit` material, as a floor or wallpaper.
  stamp(name: string, origin: Pt, draw: (cv: Canvas) => void, fill?: string, attrs = '', inner = ''): void {
    // pieces at different half-pixel phases rasterise differently: one stamp each
    const id = `${name}${phaseOf(origin)}`
    const first = this.stamps.get(id)
    const paint = (fill ? ` fill="${fill}"` : '') + attrs
    const end = inner ? `>${inner}</use>` : '/>'
    if (!first) {
      const sub = new Canvas()
      draw(sub)
      for (const [k, m] of sub.used) this.used.set(k, m)
      this.defs.push(`<g id="${id}">${sub.svg()}</g>`)
      this.stamps.set(id, origin)
      this.raw(`<use href="#${id}"${paint}${end}`)
      return
    }
    const dx = Math.round(origin.x - first.x)
    const dy = Math.round(origin.y - first.y)
    this.raw(`<use href="#${id}" x="${dx}" y="${dy}"${paint}${end}`)
  }

  // Defines a piece once without placing it, for copies placed by hand, as
  // a tree whose crown sways about its own trunk. `draw` may hand back an
  // animation for the whole piece, as a sway.
  define(id: string, draw: (cv: Canvas) => string | void): void {
    if (this.stamps.has(id)) return
    const sub = new Canvas()
    const anim = draw(sub) ?? ''
    for (const [k, m] of sub.used) this.used.set(k, m)
    this.defs.push(`<g id="${id}">${anim}${sub.svg()}</g>`)
    this.stamps.set(id, { x: 0, y: 0 })
  }

  // The pieces stamped, for the picture's defs.
  stamped(): string {
    return this.defs.join('')
  }

  // Starts a new layer: anything drawn after it lies over everything before.
  layer(): void {
    for (const { m, d } of this.open.values()) {
      if (d.length === 0) continue
      this.parts.push(typeof m === 'string'
        ? `<path fill="${m}" d="${d.join('')}"/>`
        : `<path class="${m.cls}" d="${d.join('')}"/>`)
    }
    this.open.clear()
  }

  private runs(m: Mat | string, list: [number, number, number][]): void {
    if (list.length === 0) return
    const key = typeof m === 'string' ? m : m.cls
    if (typeof m !== 'string') this.used.set(m.cls, m)
    const slot = this.open.get(key) ?? { m, d: [] }
    this.open.set(key, slot)
    // each stretch of consecutive rows is one stair-stepped outline
    let start = 0
    for (let i = 1; i <= list.length; i++) {
      const prev = list[i - 1] as [number, number, number]
      const next = list[i]
      if (next && next[0] === prev[0] + 1) continue
      slot.d.push(outline(list.slice(start, i)))
      start = i
    }
  }

  poly(pts: Pt[], m: Mat | string): void {
    this.runs(m, rows(pts))
  }

  rect(x: number, y: number, w: number, h: number, m: Mat | string): void {
    if (w <= 0 || h <= 0) return
    this.runs(m, Array.from({ length: h }, (_, i) => [y + i, x, w] as [number, number, number]))
  }

  // Raw markup over everything drawn so far.
  raw(svg: string): void {
    this.layer()
    this.parts.push(svg)
  }

  svg(): string {
    this.layer()
    return this.parts.join('')
  }
}

// A point's place within its pixel, for telling stamps apart by it.
function phaseOf(p: Pt): string {
  const part = (v: number) => Math.round((((v % 1) + 1) % 1) * 2) % 2
  return part(p.x) || part(p.y) ? `-h${part(p.x)}${part(p.y)}` : ''
}

// The outline of a stack of pixel rows, one under the next: down the right
// side, back up the left, in small relative steps.
function outline(list: [number, number, number][]): string {
  const first = list[0] as [number, number, number]
  let d = `M${first[1]} ${first[0]}`
  let x = first[1]
  let down = 0
  const across = (to: number) => {
    if (down !== 0) {
      d += `v${down}`
      down = 0
    }
    if (to !== x) d += `h${to - x}`
    x = to
  }
  for (const [, left, w] of list) {
    across(left + w)
    down += 1
  }
  for (let i = list.length - 1; i >= 0; i--) {
    across((list[i] as [number, number, number])[1])
    down -= 1
  }
  return `${d}${down !== 0 ? `v${down}` : ''}z`
}

// The colours of every material a picture used, by night or by day.
export function styleOf(used: Iterable<Mat>, time: 'night' | 'day'): string {
  let css = ''
  for (const m of used) css += `.${m.cls}{fill:${m[time]}}`
  return css
}

// The path of a convex polygon's pixels, for a shape that animates on its
// own (a flame, a screen) rather than joining a material's path.
export function pathOf(pts: Pt[]): string {
  return rows(pts).map(([r, x, w]) => `M${x} ${r}h${w}v1h-${w}z`).join('')
}

// ---------- the clock ----------

// When the picture is drawn, in seconds. Anything that loops by itself (a
// crown swaying, a leaf falling, an eye blinking) starts where the clock has
// it in its loop, so a picture drawn afresh carries on exactly where the last
// one was, and a redraw never shows.
let clockS = 0

export function setClock(now: number): void {
  clockS = now / 1000
}

// `begin` for a loop of `dur` seconds, running `lead` seconds ahead.
export function loopBegin(dur: number, lead = 0): string {
  return `begin="-${((((clockS + lead) % dur) + dur) % dur).toFixed(2)}s"`
}
