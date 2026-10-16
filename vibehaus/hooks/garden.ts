/*
 * The garden: an autumn lawn round the house with trees, ponds, beds, stones and toadstools. Crowns sway,
 * leaves fall, fireflies wander by night. Drawn on the picture, not the floor plan, as its own picture
 * under the house's.
 */
import { TALL_WALL } from './house'
import type { Layout } from './house'
import { Canvas, loopBegin, mat, rng } from './iso'
import type { Mat, Pt } from './iso'
import { signAt, yardShapes } from './yard'

const G = {
  grass: mat('na', '#2f3b27', '#9aa24c'),
  lit: mat('nl', '#35432c', '#a7ae56'),
  shade: mat('nh', '#29341f', '#8c9443'),
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
  lamp: mat('ll', '#ffd27a', '#e8dcc0'),
  stone: mat('sn', '#3d4046', '#a9aeb5'),
  stoneLit: mat('sl', '#585c63', '#cfd3d8'),
  aster: mat('fa', '#6a4a9a', '#a77fe0'),
  mum: mat('fm', '#a8822a', '#ffd166'),
  rose: mat('fr', '#8f2a3a', '#e0566e'),
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

// Per kind: trunk height, crown half-sizes, lean in the wind and its beat.
const BUILD: Record<Kind, { trunk: number; rx: number; ry: number; lean: number; beat: number }> = {
  oak: { trunk: 12, rx: 14, ry: 10, lean: 2.4, beat: 4.6 },
  maple: { trunk: 11, rx: 11, ry: 12, lean: 2.4, beat: 4.1 },
  birch: { trunk: 15, rx: 8, ry: 12, lean: 3, beat: 3.6 },
  pine: { trunk: 5, rx: 11, ry: 16, lean: 1.2, beat: 5.2 },
  bush: { trunk: 0, rx: 7, ry: 4.5, lean: 2, beat: 3.3 },
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

// The house floor's four corners on the picture.
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

const pondAt = (L: Layout) => lerp(corners(L).bottom, corners(L).right, 0.42, 18)
const lampsAt = (L: Layout) => [lerp(corners(L).left, corners(L).bottom, 0.62, 9), lerp(corners(L).bottom, corners(L).right, 0.45, 9)]
const toadstoolsAt = (L: Layout) => [lerp(corners(L).left, corners(L).bottom, 0.5, 26), lerp(corners(L).bottom, corners(L).right, 0.2, 24), lerp(corners(L).left, corners(L).top, 0.24, -30)]

// How far a point lies outside a convex outline: 0 inside.
function outside(poly: Pt[], p: Pt): number {
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
}

// A clump of longer grass, `n` blades about (x, y).
function blades(cv: Canvas, r: () => number, x: number, y: number, n: number): void {
  for (let k = 0; k < n; k++) {
    const tall = 2 + Math.floor(r() * 4)
    const bx = Math.round(x + (k - n / 2) * 1.2 + r())
    cv.rect(bx, Math.round(y) - tall, 1, tall, k % 3 === 0 ? G.dark : G.blade)
    if (r() < 0.4) cv.rect(bx, Math.round(y) - tall, 1, 1, G.tip)
  }
}

// A pond about `at`, with a ripple and a leaf or two.
type Pond = { at: Pt; rx: number; ry: number }

function pond(cv: Canvas, { at: p, rx, ry }: Pond): void {
  const k = (n: number) => Math.round((n * rx) / 12)
  blob(cv, { x: p.x + 1, y: p.y + 1 }, rx + 1, ry + 0.5, G.dark)
  blob(cv, p, rx, ry, G.water)
  cv.layer()
  cv.rect(p.x - k(6), p.y - k(2), Math.max(2, k(5)), 1, G.ripple)
  cv.rect(p.x - k(2), p.y, 2, 1, LEAF[0] as Mat)
  if (rx < 9) return
  cv.rect(p.x + 3, p.y + 1, 4, 1, G.ripple)
  cv.rect(p.x + 6, p.y - 2, 1, 1, LEAF[2] as Mat)
}

function toadstool(cv: Canvas, p: Pt): void {
  cv.rect(p.x, p.y - 1, 1, 1, G.birch)
  cv.rect(p.x - 1, p.y - 2, 3, 1, G.cap)
}

// Lawn patterns, tiles of different sizes so repeats never line up; patches span the picture's width,
// wrapped at the edges.
const PATCHES = { w: 248, h: 173 }
// drawn once: the same for every picture
let patchTile: Canvas | undefined

function patchesTile(): Canvas {
  if (patchTile) return patchTile
  const patches = new Canvas()
  const lawn = rng(7)
  for (let n = Math.round((PATCHES.w * PATCHES.h) / 2600); n > 0; n--) {
    const p = { x: lawn() * PATCHES.w, y: lawn() * PATCHES.h }
    const m = lawn() < 0.5 ? G.lit : G.shade
    for (let k = 1 + Math.floor(lawn() * 3); k > 0; k--) {
      const q = { x: Math.round(p.x + (lawn() - 0.5) * 20), y: Math.round(p.y + (lawn() - 0.5) * 8) }
      const [rx, ry] = [7 + lawn() * 10, 3 + lawn() * 4]
      for (const dx of [0, -PATCHES.w, PATCHES.w]) {
        for (const dy of [0, -PATCHES.h, PATCHES.h]) {
          const c = { x: q.x + dx, y: q.y + dy }
          if (c.x + rx >= 0 && c.x - rx <= PATCHES.w && c.y + ry >= 0 && c.y - ry <= PATCHES.h) blob(patches, c, rx, ry, m)
        }
      }
    }
  }
  patchTile = patches
  return patches
}

export function gardenPatterns(cv: Canvas): string {
  const use = (m: Mat) => {
    cv.used.set(m.cls, m)
    return `class="${m.cls}"`
  }
  const patches = patchesTile()
  for (const [k, m] of patches.used) cv.used.set(k, m)
  const tile = (id: string, w: number, h: number, body: string) => `<pattern id="${id}" width="${w}" height="${h}" patternUnits="userSpaceOnUse">${body}</pattern>`
  const dots = (m: Mat, d: string) => `<path ${use(m)} d="${d}"/>`
  return tile('grass', 16, 12, `<rect width="16" height="12" ${use(G.grass)}/>` +
      dots(G.speck, 'M1 1h1v1h-1zM6 3h1v1h-1zM11 0h1v1h-1zM14 5h1v1h-1zM3 7h1v1h-1zM9 8h2v1h-2zM13 10h1v1h-1zM5 11h1v1h-1zM0 4h1v1h-1z') +
      dots(G.dark, 'M4 2h1v1h-1zM12 3h1v1h-1zM7 6h1v1h-1zM2 9h1v1h-1zM15 8h1v1h-1zM10 11h1v1h-1z') +
      dots(G.dry, 'M8 1h1v1h-1zM1 6h1v1h-1zM12 7h1v1h-1z') +
      dots(G.blade, 'M3 4h1v2h-1zM10 5h1v2h-1zM6 9h1v2h-1zM14 1h1v2h-1z')) +
    tile('tufts', 29, 23,
      dots(G.blade, 'M2 3h1v3h-1zM4 4h1v2h-1zM17 9h1v3h-1zM19 10h1v2h-1zM9 16h1v3h-1zM11 17h1v2h-1zM24 19h1v3h-1zM26 20h1v2h-1z') +
      dots(G.tip, 'M2 3h1v1h-1zM17 9h1v1h-1zM9 16h1v1h-1zM24 19h1v1h-1z') +
      dots(G.dark, 'M3 6h1v1h-1zM18 12h1v1h-1zM10 19h1v1h-1zM25 22h1v1h-1z')) +
    tile('leaves', 43, 37,
      dots(LEAF[0] as Mat, 'M5 7h2v1h-2zM30 22h1v1h-1z') + dots(LEAF[1] as Mat, 'M18 3h1v1h-1zM37 30h2v1h-2z') +
      dots(LEAF[2] as Mat, 'M12 26h2v1h-2zM40 12h1v1h-1z') + dots(LEAF[3] as Mat, 'M24 15h1v1h-1zM2 33h2v1h-2z')) +
    tile('patches', PATCHES.w, PATCHES.h, patches.svg()) +
    tile('flowers', 61, 47,
      dots(G.aster, 'M7 9h1v1h-1zM9 10h1v1h-1zM44 33h1v1h-1z') + dots(G.mum, 'M29 20h1v1h-1zM31 19h1v1h-1zM52 6h1v1h-1z') +
      dots(G.rose, 'M17 38h1v1h-1zM19 39h1v1h-1zM38 44h1v1h-1z') +
      dots(G.dark, 'M7 10h1v1h-1zM9 11h1v1h-1zM44 34h1v1h-1zM29 21h1v1h-1zM31 20h1v1h-1zM52 7h1v1h-1zM17 39h1v1h-1zM19 40h1v1h-1zM38 45h1v1h-1z'))
}

// A kind's crown about (0, 0), the trunk top; trees of a kind sway on one beat, as in one gust.
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
    const r = rng([...kind].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7))
    for (let i = 0; i < (kind === 'bush' ? 4 : 9); i++) {
      cv.rect(Math.round(c.x - rx * 0.7 + r() * rx * 1.4), Math.round(c.y - ry * 0.7 + r() * ry * 1.3), 1, 1, f)
    }
  }
  return `<animateTransform attributeName="transform" type="skewX" values="0;${lean};${(lean * 0.4).toFixed(1)};${(-lean * 0.5).toFixed(1)};0" dur="${beat}s" ${loopBegin(beat)} repeatCount="indefinite"/>`
}

// The house's trees: `u` along the edge from floor corner `from` to `to`, `dy` above it (behind) or below.
type Spot = { kind: Kind; from: 'top' | 'left' | 'right' | 'bottom'; to: 'top' | 'left' | 'right' | 'bottom'; u: number; dy: number }
const TREES: Spot[] = [
  // behind the house, over the back walls
  { kind: 'pine', from: 'left', to: 'top', u: 0.14, dy: -22 },
  { kind: 'oak', from: 'left', to: 'top', u: 0.36, dy: -26 },
  { kind: 'maple', from: 'left', to: 'top', u: 0.58, dy: -24 },
  { kind: 'birch', from: 'top', to: 'right', u: 0.4, dy: -24 },
  { kind: 'pine', from: 'top', to: 'right', u: 0.6, dy: -26 },
  { kind: 'oak', from: 'top', to: 'right', u: 0.8, dy: -22 },
  { kind: 'maple', from: 'top', to: 'right', u: 1.03, dy: -12 },
  // in front, in the two gaps below the front edges
  { kind: 'maple', from: 'left', to: 'bottom', u: 0.03, dy: 26 },
  { kind: 'birch', from: 'left', to: 'bottom', u: 0.7, dy: 30 },
  { kind: 'bush', from: 'left', to: 'bottom', u: 0.56, dy: 4 },
  { kind: 'bush', from: 'left', to: 'bottom', u: 0.66, dy: 14 },
  { kind: 'bush', from: 'bottom', to: 'right', u: 0.14, dy: 12 },
  { kind: 'bush', from: 'bottom', to: 'right', u: 0.72, dy: 20 },
  { kind: 'pine', from: 'bottom', to: 'right', u: 0.8, dy: 38 },
]

// Two lamp posts at the front, lit by night.
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

// One of the house's trees, in the house's picture.
function tree(cv: Canvas, L: Layout, t: Spot): void {
  treeAt(cv, t.kind, place(L, t), 'vh-h')
}

// A tree at `at`, one element: a copy of its kind. `ns` keeps definitions apart where pictures are
// laid into one.
function treeAt(cv: Canvas, kind: Kind, at: Pt, ns: string): void {
  const b = BUILD[kind]
  cv.define(`${ns}-crown-${kind}`, sub => crown(sub, kind))
  cv.define(`${ns}-tree-${kind}`, sub => {
    if (b.trunk > 0) {
      sub.rect(-1, -b.trunk, 1, b.trunk, kind === 'birch' ? G.birch : G.trunk)
      sub.rect(0, -b.trunk, 1, b.trunk, kind === 'birch' ? G.trunk : G.bark)
    }
    sub.raw(`<use href="#${ns}-crown-${kind}" y="${-b.trunk}"/>`)
  })
  cv.raw(`<use href="#${ns}-tree-${kind}" x="${at.x}" y="${at.y}"/>`)
}

export function treesBehind(cv: Canvas, L: Layout): void {
  for (const t of TREES) if (t.dy < 0) tree(cv, L, t)
}

// Front trees with their depth (the plan's x + y at the trunk), to sort among the yard's things.
export function frontTrees(L: Layout): { depth: number; draw: (cv: Canvas) => void }[] {
  return TREES.filter(t => t.dy >= 0).map(t => ({ depth: 2 * (place(L, t).y - L.oy), draw: (cv: Canvas) => tree(cv, L, t) }))
}

// Whether a point lies over the house, back walls included, with a margin.
const hulls = new WeakMap<Layout, Pt[]>()
function hullOf(L: Layout): Pt[] {
  const known = hulls.get(L)
  if (known) return known
  const c = corners(L)
  const up = (q: Pt) => ({ x: q.x, y: q.y - TALL_WALL })
  const hull = [up(c.left), up(c.top), up(c.right), c.right, c.bottom, c.left]
  hulls.set(L, hull)
  return hull
}

function overHouse(L: Layout, p: Pt): boolean {
  const hull = hullOf(L)
  return hull.every((a, i) => {
    const b = hull[(i + 1) % hull.length] as Pt
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) > -3 * Math.hypot(b.x - a.x, b.y - a.y)
  })
}

// Falling leaves: under the house where they fall behind it, else over all; a front tree's leaf that
// would cross the house tries again.
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
      const tried = leafPath(r, top, b, 24, 16)
      isBehind = t.dy < 0 && tried.some(p => overHouse(L, p))
      if (isBehind || tried.every(p => !overHouse(L, p))) path = tried
    }
    if (path.length === 0) continue
    out[isBehind ? 'behind' : 'front'] += fallingLeaf(cv, LEAF[i % LEAF.length] as Mat, path, r)
  }
  return out
}

// A leaf's path from the crown of a tree at `foot`, falling up to twice `fall`, drifting up to 8 + `drift`.
function leafPath(r: () => number, foot: Pt, b: (typeof BUILD)[Kind], fall: number, drift: number): Pt[] {
  const sx = Math.round(foot.x - b.rx * 0.6 + r() * b.rx * 1.2)
  const sy = Math.round(foot.y - b.trunk - b.ry * 1.5 + r() * b.ry)
  const f = fall + Math.round(r() * fall)
  const d = 8 + Math.round(r() * drift)
  return [0, 1, 2, 3, 4].map(k => ({ x: Math.round(sx + (d * k) / 4 + (k % 2 ? 3 : 0)), y: Math.round(sy + (f * k) / 4) }))
}

// One leaf drifting down `path`, on a beat of its own.
function fallingLeaf(cv: Canvas, leaf: Mat, path: Pt[], r: () => number): string {
  const dur = Math.round((6 + r() * 5) * 10) / 10
  const lead = Math.round(r() * 100) / 10
  cv.used.set(leaf.cls, leaf)
  return `<rect class="${leaf.cls}" width="2" height="1" opacity="0">` +
    `<animateTransform attributeName="transform" type="translate" values="${path.map(p => `${p.x} ${p.y}`).join(';')}" dur="${dur}s" ${loopBegin(dur, lead)} repeatCount="indefinite"/>` +
    `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.8;1" dur="${dur}s" ${loopBegin(dur, lead)} repeatCount="indefinite"/>` +
    `<animate attributeName="width" values="2;1" calcMode="discrete" dur="0.7s" ${loopBegin(0.7)} repeatCount="indefinite"/></rect>`
}

// ---------- the garden round the house ----------

// What grows past the house's trees, from a fixed seed, once per layout. Nothing stands on or reaches over
// the house, its trees, the road or the yard, so the house's picture over it never cuts one wrongly.
// `own`: the house's trees; `order`: back to front; `leafy`: those that drop leaves.
type Standing = { kind: Kind; at: Pt }
type Grove = {
  trees: Standing[]; ponds: Pond[]; beds: { at: Pt; n: number }[]; stones: Pt[]; clumps: Pt[]; toadstools: Pt[]
  own: Standing[]; order: Standing[]; leafy: Standing[]
}
const groves = new Map<string, Grove>()

function groveOf(L: Layout): Grove {
  const key = `${L.w}x${L.h}x${L.oy}`
  const known = groves.get(key)
  if (known) return known
  const r = rng(29)
  const c = corners(L)
  const up = (q: Pt, dy: number) => ({ x: q.x, y: q.y - dy })
  const hull = [up(c.left, TALL_WALL + 6), up(c.top, TALL_WALL + 6), up(c.right, TALL_WALL + 6), up(c.right, -6), up(c.bottom, -6), up(c.left, -6)]
  const yard = yardShapes(L)
  const sign = signAt(L)
  const own = TREES.map(t => ({ kind: t.kind, at: place(L, t) }))
  const lit = lampsAt(L)
  const wet0 = pondAt(L)
  // whether the house, its trees or the yard come within `m` of p
  const blocked = (p: Pt, m: number) =>
    outside(hull, p) < m || outside(yard.road, p) < m + 4 || yard.pallets.some(q => outside(q, p) < m + 4) ||
    Math.hypot(p.x - yard.mailbox.x, p.y - yard.mailbox.y) < m + 8 || Math.hypot(p.x - sign.x - 6, p.y - sign.y - 3) < m + 10 ||
    own.some(q => Math.hypot(p.x - q.at.x, (p.y - q.at.y) * 0.8) < m + 24) || lit.some(q => Math.hypot(p.x - q.x, p.y - q.y) < m + 6) ||
    Math.hypot((p.x - wet0.x) / 2, p.y - wet0.y) < m + 10
  // a tree's whole reach, trunk foot to crown top, kept clear
  const clear = (kind: Kind, at: Pt) => {
    const b = BUILD[kind]
    const top = at.y - b.trunk - 2 * b.ry
    return [at, { x: at.x - b.rx, y: at.y - b.trunk - b.ry }, { x: at.x + b.rx, y: at.y - b.trunk - b.ry }, { x: at.x, y: top }]
      .every(p => !blocked(p, 3))
  }
  const grove: Grove = { trees: [], ponds: [], beds: [], stones: [], clumps: [], toadstools: [], own, order: [], leafy: [] }
  const near = (at: Pt, list: Pt[], d: number) => list.some(q => Math.hypot(q.x - at.x, (q.y - at.y) * 1.5) < d)
  const spaced = (at: Pt, d: number) => !near(at, grove.trees.map(t => t.at), d)
  // candidate spots on a jittered grid, shuffled
  const spots = (step: number) => {
    const out: Pt[] = []
    for (let y = 42; y <= L.h - 4; y += step) for (let x = 6; x <= L.w - 6; x += step) out.push({ x: Math.round(x + (r() - 0.5) * step), y: Math.round(y + (r() - 0.5) * step) })
    for (let i = out.length - 1; i > 0; i--) {
      const k = Math.floor(r() * (i + 1))
      ;[out[i], out[k]] = [out[k] as Pt, out[i] as Pt]
    }
    return out
  }
  // up to `max` spots `gap` apart that pass `ok`
  const scatter = (step: number, max: number, gap: number, ok: (p: Pt) => boolean) => {
    const out: Pt[] = []
    for (const p of spots(step)) if (out.length < max && ok(p) && !near(p, out, gap)) out.push(p)
    return out
  }
  const pick = <T,>(list: T[]) => list[Math.floor(r() * list.length)] as T
  // copses of a kind or two, a bush or two at the edge
  const MIXES: Kind[][] = [['oak', 'maple'], ['birch'], ['pine'], ['maple', 'birch'], ['pine', 'oak'], ['oak', 'maple', 'birch'], ['pine', 'birch']]
  for (const p of scatter(23, Math.round(L.h / 46), 52, p => !blocked(p, 12))) {
    const mix = pick(MIXES)
    for (let n = 2 + Math.floor(r() * 4), tries = 0; n > 0 && tries < 30; tries++) {
      const at = { x: Math.round(p.x + (r() - 0.5) * 50), y: Math.round(p.y + (r() - 0.5) * 24) }
      const kind = pick(mix)
      if (spaced(at, 17) && clear(kind, at)) (grove.trees.push({ kind, at }), n--)
    }
    for (let n = Math.floor(r() * 3), tries = 0; n > 0 && tries < 12; tries++) {
      const at = { x: Math.round(p.x + (r() - 0.5) * 64), y: Math.round(p.y + 8 + r() * 10) }
      if (spaced(at, 13) && clear('bush', at)) (grove.trees.push({ kind: 'bush', at }), n--)
    }
  }
  // a lone tree or bush here and there
  for (const at of scatter(29, Math.round(L.h / 32), 28, p => spaced(p, 28))) {
    const kind = pick<Kind>(['oak', 'maple', 'birch', 'pine', 'bush', 'bush'])
    if (clear(kind, at)) grove.trees.push({ kind, at })
  }
  // ponds where clearest of trees: a big one or two, then smaller ones
  const wet = (p: Pt) => Math.min(99, ...grove.trees.map(t => Math.hypot((t.at.x - p.x) / 1.7, t.at.y - p.y)))
  const pondSpots = spots(13).filter(p => p.x > 20 && p.x < L.w - 20 && !blocked(p, 14)).map(p => ({ p, w: wet(p) })).sort((a, b) => b.w - a.w)
  const apart = (p: Pt, d: number) => grove.ponds.every(q => Math.hypot(q.at.x - p.x, (q.at.y - p.y) * 1.5) > d + q.rx)
  for (const { p, w } of pondSpots) if (grove.ponds.length < Math.max(1, Math.round(L.h / 300)) && w > 16 && apart(p, 90)) grove.ponds.push({ at: p, rx: 12, ry: 4.5 })
  for (const { p, w } of pondSpots) {
    if (grove.ponds.length >= Math.round(L.h / 300) + Math.round(L.h / 120)) break
    const rx = 6 + Math.floor(r() * 4)
    if (w > rx + 6 && apart(p, 36)) grove.ponds.push({ at: p, rx, ry: rx * 0.4 })
  }
  const dry = (p: Pt, m: number) => !blocked(p, m) && grove.ponds.every(q => Math.hypot((p.x - q.at.x) / (q.rx + 3), (p.y - q.at.y) / (q.ry + 2)) > 1.4)
  // reeds at the ponds' edges, longer grass about the lawn
  for (const q of grove.ponds) grove.clumps.push({ x: q.at.x + (r() < 0.5 ? -1 : 1) * Math.round(q.rx * 0.8), y: Math.round(q.at.y + q.ry * 0.5) })
  grove.clumps.push(...scatter(17, Math.round(L.h / 30), 22, p => dry(p, 2) && spaced(p, 10)))
  // flower beds, stones, toadstools at a few trees' feet
  grove.beds.push(...scatter(19, Math.round(L.h / 34), 28, p => dry(p, 6) && spaced(p, 16)).map(at => ({ at, n: Math.floor(r() * 3) })))
  for (const p of scatter(31, Math.round(L.h / 70), 40, p => dry(p, 3) && spaced(p, 10))) {
    grove.stones.push(p)
    if (r() < 0.5) grove.stones.push({ x: p.x + 4, y: p.y + 1 })
  }
  for (const t of grove.trees) if (t.kind !== 'bush' && r() < 0.18) grove.toadstools.push({ x: t.at.x + (r() < 0.5 ? -5 : 4), y: t.at.y + 2 })
  // nothing wholly off the picture
  grove.trees = grove.trees.filter(t => t.at.x + BUILD[t.kind].rx > 0 && t.at.x - BUILD[t.kind].rx < L.w)
  grove.toadstools = grove.toadstools.filter(p => p.x > -2 && p.x < L.w + 1)
  grove.order = [...grove.trees].sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x)
  grove.leafy = grove.trees.filter(t => t.kind !== 'pine' && t.kind !== 'bush')
  groves.set(key, grove)
  return grove
}

// The garden under the house; returns what drifts over it (leaves, fireflies). The house's own trees are
// in its picture. `band`: only what shows in those rows, as drawn in the whole.
export function garden(cv: Canvas, L: Layout, band = { y0: 0, y1: L.h }): string {
  const c = corners(L)
  const grove = groveOf(L)
  // whether a thing standing at y, `tall` above it, shows in the band
  const shows = (y: number, tall = 0) => y + 8 >= band.y0 && y - tall - 8 <= band.y1
  const [y0, y1] = [Math.max(0, band.y0), Math.min(L.h, band.y1)]
  cv.rect(0, y0, L.w, y1 - y0, 'url(#grass)')
  cv.layer()
  for (const id of ['patches', 'tufts', 'leaves', 'flowers']) cv.rect(0, y0, L.w, y1 - y0, `url(#${id})`)
  cv.layer()
  // round the house: clumps of long grass, its pond and toadstools
  const tufts = rng(8)
  const clumps = [
    lerp(c.left, c.bottom, 0.18, 22), lerp(c.left, c.bottom, 0.62, 16), lerp(c.bottom, c.right, 0.28, 20),
    lerp(c.bottom, c.right, 0.86, 16), lerp(c.left, c.top, 0.15, -20), lerp(c.top, c.right, 0.84, -16),
    { x: c.left.x - 4, y: c.left.y + 6 }, { x: c.right.x + 4, y: c.right.y + 6 },
  ]
  for (const p of clumps) blades(cv, tufts, p.x, p.y, 5 + Math.floor(tufts() * 3))
  grove.clumps.forEach((p, i) => shows(p.y, 6) && blades(cv, rng(200 + i), p.x, p.y, 3 + (i % 4)))
  pond(cv, { at: pondAt(L), rx: 12, ry: 4.5 })
  for (const p of grove.ponds) if (shows(p.at.y + p.ry, 2 * p.ry)) pond(cv, p)
  for (const p of [...toadstoolsAt(L), ...grove.toadstools]) if (shows(p.y)) toadstool(cv, p)
  for (const s of grove.stones) {
    if (!shows(s.y)) continue
    blob(cv, { x: s.x + 0.5, y: s.y + 0.5 }, 2.6, 1.6, G.stone)
    cv.rect(s.x - 1, s.y - 1, 2, 1, G.stoneLit)
  }
  // fallen leaves under every tree
  const litter = rng(9)
  for (const t of [...grove.own, ...grove.trees]) {
    const b = BUILD[t.kind]
    for (let i = 0; i < (t.kind === 'pine' ? 0 : 3); i++) {
      const [x, y, w, m] = [Math.round(t.at.x - b.rx + litter() * b.rx * 2), Math.round(t.at.y - 2 + litter() * 5), litter() < 0.5 ? 2 : 1, LEAF[Math.floor(litter() * LEAF.length)] as Mat]
      if (shows(y)) cv.rect(x, y, w, 1, m)
    }
  }
  cv.layer()
  // flower beds, each drawn once and copied
  for (const b of grove.beds) {
    if (!shows(b.at.y)) continue
    cv.stamp(`bed${b.n}`, b.at, sub => {
      const m = [G.aster, G.mum, G.rose][b.n] as Mat
      const br = rng(41 + b.n)
      for (let k = 0; k < 14; k++) {
        const p = { x: Math.round(b.at.x + (br() - 0.5) * 13), y: Math.round(b.at.y + (br() - 0.5) * 5) }
        sub.rect(p.x, p.y, 1, 1, G.dark)
        sub.rect(p.x, p.y - 1, 1, 1, k % 4 === 0 ? G.mum : m)
      }
    })
  }
  const crownOf = (kind: Kind) => BUILD[kind].trunk + 2 * BUILD[kind].ry
  for (const t of grove.order) if (shows(t.at.y, crownOf(t.kind))) treeAt(cv, t.kind, t.at, 'vh-g')
  let over = ''
  const { leafy } = grove
  const falling = Math.min(10, leafy.length)
  for (let i = 0; i < falling; i++) {
    const t = leafy[Math.floor((i * leafy.length) / falling)] as Standing
    if (!shows(t.at.y, crownOf(t.kind))) continue
    const r = rng(60 + i)
    over += fallingLeaf(cv, LEAF[i % LEAF.length] as Mat, leafPath(r, t.at, BUILD[t.kind], 20, 14), r)
  }
  const flies = rng(12)
  for (let i = 0; i < Math.min(12, Math.round(L.h / 45)); i++) {
    const p = { x: Math.round(L.w * 0.08 + flies() * L.w * 0.84), y: Math.round(10 + flies() * (L.h - 20)) }
    const dur = Math.round((5 + flies() * 4) * 10) / 10
    const lead = Math.round(flies() * 50) / 10
    if (overHouse(L, p) || !shows(p.y)) continue
    const loop = [[0, 0], [4, -3], [7, 1], [3, 4], [0, 0]].map(([dx, dy]) => `${p.x + (dx as number)} ${p.y + (dy as number)}`).join(';')
    over += `<rect class="vh-lamp" width="1" height="1" fill="#ffe08a" opacity="0">` +
      `<animateTransform attributeName="transform" type="translate" values="${loop}" dur="${dur}s" ${loopBegin(dur, lead)} repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" values="0;0.9;0.2;0.9;0" dur="${dur}s" ${loopBegin(dur, lead)} repeatCount="indefinite"/></rect>`
  }
  return over
}
