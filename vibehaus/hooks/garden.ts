/*
 * The garden: autumn lawn filling the picture around the house, its edge
 * ragged with tufts of long grass, under oaks, maples and birches in full
 * colour, a few dark pines, and shrubs. The trees stand in the four gaps the
 * house leaves at the picture's corners, clear of every room. Crowns sway in
 * the wind and leaves come loose and drift down.
 *
 * All of it is drawn on the picture itself, not on the floor plan.
 */
import { TALL_WALL } from './house'
import type { Layout } from './house'
import { loopBegin, mat } from './iso'
import type { Canvas, Mat, Pt } from './iso'
import { yardShapes } from './yard'

const G = {
  grass: mat('na', '#2f3b27', '#9aa24c'),
  speck: mat('ns', '#3a4730', '#b3b35a'),
  dry: mat('nd', '#4a4228', '#c9a85a'),
  dark: mat('nk', '#232c1d', '#6f7a34'),
  blade: mat('nb', '#4e5d36', '#c2c76a'),
  tip: mat('nt', '#6b6a3a', '#e6d27a'),
  trunk: mat('tk', '#33241a', '#6b4429'),
  bark: mat('tl', '#24190f', '#4e301c'),
  birch: mat('tb', '#8d877b', '#e9e3d6'),
  cap: mat('mr', '#8f2a22', '#d93a2c'),
  water: mat('wa', '#16202e', '#5d8fb0'),
  ripple: mat('wr', '#2a3a52', '#9cc6e0'),
  post: mat('lp', '#1c1f24', '#3a3f47'),
  soil: mat('so', '#2a1d14', '#7a5634'),
  lamp: mat('ll', '#ffd27a', '#e8dcc0'),
}

type Kind = 'oak' | 'maple' | 'birch' | 'pine' | 'bush'

// Crown colours: shadow, body, light, and a fleck.
const CROWNS: Record<Exclude<Kind, 'pine'>, [Mat, Mat, Mat, Mat]> = {
  oak: [mat('c1', '#5a2416', '#8e3a1e'), mat('c2', '#a24a1c', '#e2702a'), mat('c3', '#c9762c', '#ffa64a'), mat('c4', '#d9a23a', '#ffd166')],
  maple: [mat('m1', '#4a1716', '#7e2320'), mat('m2', '#8c2620', '#cf3a2a'), mat('m3', '#b4432c', '#f0663e'), mat('m4', '#d0782e', '#ff9b45')],
  birch: [mat('y1', '#5e4a1a', '#a37a22'), mat('y2', '#a8822a', '#e8b23a'), mat('y3', '#c9a43c', '#ffd35a'), mat('y4', '#e0c060', '#fff0a0')],
  bush: [mat('h1', '#262d1c', '#4f5a2a'), mat('h2', '#3f4a24', '#7f8f3a'), mat('h3', '#9a4f1c', '#e07a2c'), mat('h4', '#c9a23a', '#ffd166')],
}
const PINE = [mat('p1', '#142219', '#1f3a28'), mat('p2', '#1d3324', '#2e5a3a'), mat('p3', '#284a31', '#3f7a4c')]
const LEAF = [mat('l1', '#b5541f', '#e8762a'), mat('l2', '#8f2a22', '#d23c2c'), mat('l3', '#b08a2a', '#f0b43a'), mat('l4', '#7a3a1a', '#b85a26')]

// How each kind is built: trunk height, crown half-width and half-height,
// and how far it leans in the wind, on its own beat.
const BUILD: Record<Kind, { trunk: number; rx: number; ry: number; lean: number; beat: number }> = {
  oak: { trunk: 12, rx: 14, ry: 10, lean: 2.4, beat: 4.6 },
  maple: { trunk: 11, rx: 11, ry: 12, lean: 2.4, beat: 4.1 },
  birch: { trunk: 15, rx: 8, ry: 12, lean: 3, beat: 3.6 },
  pine: { trunk: 5, rx: 11, ry: 16, lean: 1.2, beat: 5.2 },
  bush: { trunk: 0, rx: 7, ry: 4.5, lean: 2, beat: 3.3 },
}

// A seeded generator, so the garden is the same on every redraw.
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A rounded blob: an octagon about `c`.
function blob(cv: Canvas, c: Pt, rx: number, ry: number, m: Mat | string): void {
  const a = rx * 0.45
  const b = ry * 0.45
  cv.poly([
    { x: c.x - a, y: c.y - ry }, { x: c.x + a, y: c.y - ry }, { x: c.x + rx, y: c.y - b }, { x: c.x + rx, y: c.y + b },
    { x: c.x + a, y: c.y + ry }, { x: c.x - a, y: c.y + ry }, { x: c.x - rx, y: c.y + b }, { x: c.x - rx, y: c.y - b },
  ], m)
}

// The four corners of the house's floor, on the picture.
function corners(L: Layout) {
  return {
    top: { x: L.ox, y: L.oy },
    left: { x: L.ox - L.ph, y: L.oy + L.ph / 2 },
    right: { x: L.ox + L.pw, y: L.oy + L.pw / 2 },
    bottom: { x: L.ox + L.pw - L.ph, y: L.oy + (L.pw + L.ph) / 2 },
  }
}

const lerp = (a: Pt, b: Pt, u: number, dy = 0): Pt => ({ x: Math.round(a.x + (b.x - a.x) * u), y: Math.round(a.y + (b.y - a.y) * u + dy) })

// ---------- the lawn ----------

// The lawn's edge is where a soft field around everything that stands on it
// fades out: the house, each tree and bush, the road with its pallets and
// mailbox, the pond and the lamps. Their fields melt into one
// another, so the lawn hugs the house, swells round the trees and bridges
// the gaps between them without running far past anything, and a faint
// ripple keeps the edge from looking drawn with a compass.
type Field = { reach: number; dist: (p: Pt) => number }

const EDGE = 0.32
// how far the soil shows under the grass's lower edge
const SOIL = 3

const around = (c: Pt, core: number, reach: number): Field => ({ reach, dist: p => Math.max(0, Math.hypot(p.x - c.x, p.y - c.y) - core) })

// 0 inside a convex outline, else the way out to its nearest edge.
function within(poly: Pt[], reach: number): Field {
  return {
    reach,
    dist: p => {
      let pos = false
      let neg = false
      let best = Infinity
      poly.forEach((a, i) => {
        const b = poly[(i + 1) % poly.length] as Pt
        const ex = b.x - a.x
        const ey = b.y - a.y
        const cross = ex * (p.y - a.y) - ey * (p.x - a.x)
        if (cross > 0) pos = true
        if (cross < 0) neg = true
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / (ex * ex + ey * ey || 1)))
        best = Math.min(best, Math.hypot(p.x - a.x - t * ex, p.y - a.y - t * ey))
      })
      return pos && neg ? best : 0
    },
  }
}

// A smooth, seeded wobble between 0 and 1, `scale` pixels across.
function wobble(seed: number, scale: number): (p: Pt) => number {
  const at = (i: number, j: number) => (Math.imul(Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ seed, 2654435761) >>> 0) / 4294967296
  const ease = (t: number) => t * t * (3 - 2 * t)
  return p => {
    const x = p.x / scale
    const y = p.y / scale
    const i = Math.floor(x)
    const j = Math.floor(y)
    const u = ease(x - i)
    const v = ease(y - j)
    const a = at(i, j)
    const b = at(i + 1, j)
    const c = at(i, j + 1)
    const d = at(i + 1, j + 1)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
}

const pondAt = (L: Layout) => lerp(corners(L).bottom, corners(L).right, 0.42, 18)
const lampsAt = (L: Layout) => [lerp(corners(L).left, corners(L).bottom, 0.62, 9), lerp(corners(L).bottom, corners(L).right, 0.45, 9)]
const toadstoolsAt = (L: Layout) => [lerp(corners(L).left, corners(L).bottom, 0.5, 26), lerp(corners(L).bottom, corners(L).right, 0.2, 24), lerp(corners(L).left, corners(L).top, 0.24, -30)]

function fields(L: Layout): Field[] {
  const c = corners(L)
  const up = (q: Pt, dy: number) => ({ x: q.x, y: q.y - dy })
  const yard = yardShapes(L)
  const pond = pondAt(L)
  return [
    // the house, its tall back walls and the base under its front edges
    within([up(c.left, TALL_WALL), up(c.top, TALL_WALL), up(c.right, TALL_WALL), up(c.right, -3), up(c.bottom, -3), up(c.left, -3)], 15),
    ...TREES.map(t => around(place(L, t), 2, BUILD[t.kind].rx + (t.kind === 'bush' ? 6 : 9))),
    within(yard.road, 10),
    ...yard.pallets.map(p => within(p, 9)),
    around(yard.mailbox, 1, 9),
    { reach: 9, dist: (p: Pt) => Math.max(0, Math.hypot((p.x - pond.x) / 13, (p.y - pond.y) / 5) - 1) * 5 },
    ...lampsAt(L).map(p => around(p, 1, 9)),
  ]
}

// The lawn as one pixel per point of the picture, worked out once.
let lawnMask: Uint8Array | undefined

function lawn(L: Layout): Uint8Array {
  if (lawnMask) return lawnMask
  const all = fields(L)
  const ripple = wobble(5, 9)
  const mask = new Uint8Array(L.w * L.h)
  for (let y = 0; y < L.h - SOIL - 1; y++) {
    for (let x = 0; x < L.w; x++) {
      const p = { x: x + 0.5, y: y + 0.5 }
      let f = (ripple(p) - 0.5) * 0.16
      for (const k of all) {
        const t = k.dist(p) / k.reach
        if (t < 1) f += (1 - t * t) ** 2
      }
      if (f >= EDGE) mask[y * L.w + x] = 1
    }
  }
  lawnMask = mask
  return mask
}

// The lawn's pixel runs, row by row, `dy` rows lower; with `keep`, only the
// pixels it keeps.
function runsOf(L: Layout, dy = 0, keep: (x: number, y: number) => boolean = () => true): [number, number, number][] {
  const mask = lawn(L)
  const out: [number, number, number][] = []
  for (let y = 0; y < L.h; y++) {
    let start = -1
    for (let x = 0; x <= L.w; x++) {
      const on = x < L.w && mask[y * L.w + x] === 1 && keep(x, y)
      if (on && start < 0) start = x
      if (!on && start >= 0) {
        out.push([y + dy, start, x - start])
        start = -1
      }
    }
  }
  return out
}

const onLawn = (L: Layout, p: Pt) => {
  const x = Math.floor(p.x)
  const y = Math.floor(p.y)
  return x >= 0 && y >= 0 && x < L.w && y < L.h && lawn(L)[y * L.w + x] === 1
}

// The lawn: mottled grass on a little soil, light along its upper edge with
// a tuft here and there, clumps of longer grass, fallen leaves, a pond and a
// few toadstools.
export function ground(cv: Canvas, L: Layout): void {
  const r = rng(7)
  const c = corners(L)
  const mask = lawn(L)
  const isLawn = (x: number, y: number) => x >= 0 && y >= 0 && x < L.w && y < L.h && mask[y * L.w + x] === 1
  // the soil, showing under the grass's lower edge, a dark seam over it
  cv.region(runsOf(L, SOIL), G.soil)
  cv.layer()
  cv.region(runsOf(L, 1), G.dark)
  cv.layer()
  cv.region(runsOf(L), 'url(#grass)')
  cv.layer()
  // light along the top edge, and a tuft every so often standing up from it
  const top = (x: number, y: number) => !isLawn(x, y - 1)
  cv.region(runsOf(L, 0, top), G.blade)
  cv.layer()
  const tuft = wobble(11, 5)
  for (const [y, x0, w] of runsOf(L, 0, top)) {
    for (let x = x0; x < x0 + w; x++) {
      if (tuft({ x, y }) < 0.78 || (x + y) % 3 !== 0) continue
      cv.rect(x, y - 2, 1, 2, G.blade)
      cv.rect(x, y - 2, 1, 1, G.tip)
    }
  }
  cv.layer()
  const blades = (x: number, y: number, n: number) => {
    for (let k = 0; k < n; k++) {
      const tall = 2 + Math.floor(r() * 4)
      const bx = Math.round(x + (k - n / 2) * 1.2 + r())
      cv.rect(bx, Math.round(y) - tall, 1, tall, k % 3 === 0 ? G.dark : G.blade)
      if (r() < 0.4) cv.rect(bx, Math.round(y) - tall, 1, 1, G.tip)
    }
  }
  const clumps = [
    lerp(c.left, c.bottom, 0.18, 22), lerp(c.left, c.bottom, 0.62, 16), lerp(c.bottom, c.right, 0.28, 20),
    lerp(c.bottom, c.right, 0.86, 16), lerp(c.left, c.top, 0.15, -20), lerp(c.top, c.right, 0.84, -16),
    { x: c.left.x - 4, y: c.left.y + 6 }, { x: c.right.x + 4, y: c.right.y + 6 },
  ]
  for (const p of clumps) if (onLawn(L, p)) blades(p.x, p.y, 5 + Math.floor(r() * 3))
  // a pond in the gap at the right, a leaf or two afloat
  const pond = pondAt(L)
  blob(cv, { x: pond.x + 1, y: pond.y + 1 }, 13, 5, G.dark)
  blob(cv, pond, 12, 4.5, G.water)
  cv.layer()
  cv.rect(pond.x - 6, pond.y - 2, 5, 1, G.ripple)
  cv.rect(pond.x + 3, pond.y + 1, 4, 1, G.ripple)
  cv.rect(pond.x - 2, pond.y, 2, 1, LEAF[0] as Mat)
  cv.rect(pond.x + 6, pond.y - 2, 1, 1, LEAF[2] as Mat)
  for (const p of toadstoolsAt(L).filter(q => onLawn(L, q))) {
    cv.rect(p.x, p.y - 1, 1, 1, G.birch)
    cv.rect(p.x - 1, p.y - 2, 3, 1, G.cap)
  }
  // leaves fallen on the lawn, thickest under the trees
  for (const t of TREES) {
    const at = place(L, t)
    const b = BUILD[t.kind]
    for (let i = 0; i < (t.kind === 'pine' ? 0 : 4); i++) {
      const p = { x: Math.round(at.x - b.rx + r() * b.rx * 2), y: Math.round(at.y - 2 + r() * 5) }
      const wide = r() < 0.5
      const leaf = LEAF[Math.floor(r() * LEAF.length)] as Mat
      if (onLawn(L, p)) cv.rect(p.x, p.y, wide ? 2 : 1, 1, leaf)
    }
  }
  for (let i = 0; i < 40; i++) {
    const p = { x: r() * L.w, y: r() * L.h }
    if (!onLawn(L, p)) continue
    cv.rect(Math.round(p.x), Math.round(p.y), r() < 0.5 ? 2 : 1, 1, LEAF[Math.floor(r() * LEAF.length)] as Mat)
  }
  cv.layer()
}

// The grass, a mottled pattern on the picture's own grid.
export function gardenPatterns(cv: Canvas): string {
  const use = (m: Mat) => {
    cv.used.set(m.cls, m)
    return `class="${m.cls}"`
  }
  return `<pattern id="grass" width="6" height="4" patternUnits="userSpaceOnUse"><rect width="6" height="4" ${use(G.grass)}/>` +
    `<path ${use(G.speck)} d="M1 0h1v1h-1zM4 2h1v1h-1zM2 3h2v1h-2z"/><path ${use(G.dry)} d="M5 1h1v1h-1z"/></pattern>`
}

// One kind's crown about the top of its trunk, (0, 0), swaying in the wind;
// every tree of the kind sways on the same beat, as in one gust.
function crown(cv: Canvas, kind: Kind): string {
  const { rx, ry, lean, beat } = BUILD[kind]
  const c = { x: 0, y: -ry + (kind === 'bush' ? 1 : 3) }
  if (kind === 'pine') {
    const [s, b, l] = PINE as [Mat, Mat, Mat]
    for (let k = 0; k < 4; k++) {
      const y = c.y + ry - 2 - k * 8
      const w = rx - k * 2.5
      cv.poly([{ x: c.x, y: y - 11 }, { x: c.x + w, y: y + 1 }, { x: c.x - w, y: y + 1 }], s)
      cv.poly([{ x: c.x - 0.5, y: y - 11 }, { x: c.x + w - 3, y: y - 1 }, { x: c.x - w + 1, y: y }], k % 2 ? l : b)
      cv.layer()
    }
  } else {
    const [s, b, l, f] = CROWNS[kind]
    blob(cv, { x: c.x + 1, y: c.y + 1 }, rx, ry, s)
    cv.layer()
    blob(cv, c, rx - 1, ry - 1, b)
    blob(cv, { x: c.x - rx * 0.45, y: c.y - ry * 0.25 }, rx * 0.55, ry * 0.55, b)
    cv.layer()
    blob(cv, { x: c.x - rx * 0.3, y: c.y - ry * 0.45 }, rx * 0.45, ry * 0.4, l)
    blob(cv, { x: c.x + rx * 0.35, y: c.y - ry * 0.2 }, rx * 0.35, ry * 0.35, l)
    cv.layer()
    const r = rng(kind.length * 31)
    for (let i = 0; i < (kind === 'bush' ? 4 : 9); i++) {
      cv.rect(Math.round(c.x - rx * 0.7 + r() * rx * 1.4), Math.round(c.y - ry * 0.7 + r() * ry * 1.3), 1, 1, f)
    }
  }
  return `<animateTransform attributeName="transform" type="skewX" values="0;${lean};${(lean * 0.4).toFixed(1)};${(-lean * 0.5).toFixed(1)};0" dur="${beat}s" ${loopBegin(beat)} repeatCount="indefinite"/>`
}

// Where the trees stand, around the house's corners: `from` and `to` name
// two corners of the house's floor, `u` how far along that edge, `dy` how far
// above (behind the house) or below (in front of it) the edge.
type Spot = { kind: Kind; from: 'top' | 'left' | 'right' | 'bottom'; to: 'top' | 'left' | 'right' | 'bottom'; u: number; dy: number }
const TREES: Spot[] = [
  // behind the house: over the back walls, left and right
  { kind: 'pine', from: 'left', to: 'top', u: 0.14, dy: -22 },
  { kind: 'oak', from: 'left', to: 'top', u: 0.36, dy: -26 },
  { kind: 'maple', from: 'left', to: 'top', u: 0.58, dy: -24 },
  { kind: 'birch', from: 'top', to: 'right', u: 0.4, dy: -24 },
  { kind: 'pine', from: 'top', to: 'right', u: 0.6, dy: -26 },
  { kind: 'oak', from: 'top', to: 'right', u: 0.8, dy: -22 },
  { kind: 'maple', from: 'top', to: 'right', u: 1.03, dy: -12 },
  // in front of the house: the two gaps below its front edges
  { kind: 'maple', from: 'left', to: 'bottom', u: 0.03, dy: 26 },
  { kind: 'birch', from: 'left', to: 'bottom', u: 0.7, dy: 30 },
  { kind: 'bush', from: 'left', to: 'bottom', u: 0.56, dy: 4 },
  { kind: 'bush', from: 'left', to: 'bottom', u: 0.66, dy: 14 },
  { kind: 'bush', from: 'bottom', to: 'right', u: 0.14, dy: 12 },
  { kind: 'bush', from: 'bottom', to: 'right', u: 0.72, dy: 20 },
  { kind: 'pine', from: 'bottom', to: 'right', u: 0.8, dy: 38 },
]

// Two lamp posts by the front of the house, lit by night.
export function lamps(cv: Canvas, L: Layout): string {
  let glow = ''
  for (const p of lampsAt(L)) {
    cv.rect(p.x, p.y - 12, 1, 12, G.post)
    cv.rect(p.x - 1, p.y - 15, 3, 3, G.post)
    cv.rect(p.x, p.y - 14, 1, 1, G.lamp)
    glow += `<ellipse class="vh-lamp" cx="${p.x}" cy="${p.y - 13}" rx="7" ry="5" fill="#ffcf7a" opacity="0.18"/>` +
      `<ellipse class="vh-lamp" cx="${p.x}" cy="${p.y}" rx="9" ry="3" fill="#ffcf7a" opacity="0.1"/>`
  }
  cv.layer()
  return glow
}

function place(L: Layout, t: Spot): Pt {
  const c = corners(L)
  return lerp(c[t.from], c[t.to], t.u, t.dy)
}

// A tree on the lawn: its trunk, and its kind's swaying crown.
function tree(cv: Canvas, L: Layout, t: Spot): void {
  const at = place(L, t)
  const b = BUILD[t.kind]
  if (b.trunk > 0) {
    cv.rect(at.x - 1, at.y - b.trunk, 1, b.trunk, t.kind === 'birch' ? G.birch : G.trunk)
    cv.rect(at.x, at.y - b.trunk, 1, b.trunk, t.kind === 'birch' ? G.trunk : G.bark)
    cv.layer()
  }
  // the crown, drawn once per kind about its own pivot, placed on the trunk
  cv.define(`crown-${t.kind}`, { x: 0, y: 0 }, sub => crown(sub, t.kind))
  cv.raw(`<use href="#crown-${t.kind}" x="${at.x}" y="${at.y - b.trunk}"/>`)
}

export function treesBehind(cv: Canvas, L: Layout): void {
  for (const t of TREES) if (t.dy < 0) tree(cv, L, t)
}

// The trees in front of the house, each with how near it stands (the plan's
// x + y, from where its trunk meets the lawn), to be drawn back to front
// among the yard's things.
export function frontTrees(L: Layout): { depth: number; draw: (cv: Canvas) => void }[] {
  return TREES.filter(t => t.dy >= 0).map(t => ({ depth: 2 * (place(L, t).y - L.oy), draw: (cv: Canvas) => tree(cv, L, t) }))
}

// Whether a point of the picture lies over the house, its tall back walls
// included, with a little room to spare.
function overHouse(L: Layout, p: Pt): boolean {
  const c = corners(L)
  const up = (q: Pt) => ({ x: q.x, y: q.y - TALL_WALL })
  const hull = [up(c.left), up(c.top), up(c.right), c.right, c.bottom, c.left]
  return hull.every((a, i) => {
    const b = hull[(i + 1) % hull.length] as Pt
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) > -3 * Math.hypot(b.x - a.x, b.y - a.y)
  })
}

// Leaves coming loose from the crowns and drifting down on the wind: drawn
// under the house where they fall behind it, and over everything elsewhere;
// one from a tree in front that would cross the house tries another path.
export function weather(cv: Canvas, L: Layout): { behind: string; front: string } {
  const r = rng(11)
  const out = { behind: '', front: '' }
  const from = TREES.filter(t => t.kind !== 'pine' && t.kind !== 'bush')
  for (let i = 0; i < 7; i++) {
    const t = from[i % from.length] as Spot
    const b = BUILD[t.kind]
    const top = place(L, t)
    let path: Pt[] = []
    let isBehind = false
    for (let tries = 0; tries < 6 && path.length === 0; tries++) {
      const sx = Math.round(top.x - b.rx * 0.6 + r() * b.rx * 1.2)
      const sy = Math.round(top.y - b.trunk - b.ry * 1.5 + r() * b.ry)
      const fall = 24 + Math.round(r() * 24)
      const drift = 8 + Math.round(r() * 16)
      const tried = [0, 1, 2, 3, 4].map(k => ({ x: Math.round(sx + (drift * k) / 4 + (k % 2 ? 3 : 0)), y: Math.round(sy + (fall * k) / 4) }))
      isBehind = t.dy < 0 && tried.some(p => overHouse(L, p))
      if (isBehind || tried.every(p => !overHouse(L, p))) path = tried
    }
    if (path.length === 0) continue
    const dur = Math.round((6 + r() * 5) * 10) / 10
    const lead = Math.round(r() * 100) / 10
    const leaf = LEAF[i % LEAF.length] as Mat
    cv.used.set(leaf.cls, leaf)
    out[isBehind ? 'behind' : 'front'] += `<rect class="${leaf.cls}" width="2" height="1" opacity="0">` +
      `<animateTransform attributeName="transform" type="translate" values="${path.map(p => `${p.x} ${p.y}`).join(';')}" dur="${dur}s" ${loopBegin(dur, lead)} repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.8;1" dur="${dur}s" ${loopBegin(dur, lead)} repeatCount="indefinite"/>` +
      `<animate attributeName="width" values="2;1" calcMode="discrete" dur="0.7s" ${loopBegin(0.7)} repeatCount="indefinite"/></rect>`
  }
  return out
}
