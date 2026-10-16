/*
 * The front yard: a road from the workshop door to the picture's edge, pallets where the Clawds stack
 * a box per piece of work shipped, and a mailbox.
 */
import { at, box, frontDoor } from './house'
import type { Layout } from './house'
import { faces, mat, shade } from './iso'
import type { Canvas, Mat, Pt } from './iso'

const Y = {
  kerb: mat('ye', '#2b2925', '#8f8574'),
  stone: mat('yo', '#47433d', '#c9bfae'),
  seam: mat('yn', '#36332e', '#aa9f8c'),
  doormat: mat('ya', '#4e2d20', '#9c5a3c'),
  card: faces('yc', '#8a6440', '#cf9a5c'),
  tape: mat('yt', '#9c8058', '#ecd6a6'),
  pallet: faces('yp', '#4f3d2c', '#a8865e'),
  post: faces('yq', '#2e241b', '#6b4f36'),
  mailbox: faces('ym', '#6e2a26', '#c94f45'),
  flag: mat('yf', '#c9a227', '#ffd34a'),
}

// Boxes stack two by two, three high, on whole-pixel steps so stacks line up.
const BOX = 3
const STEP = 4
const BOX_H = 3
const PALLET = 2 * STEP
const LAYERS = 3
const PALLETS = 5

// Yard places on the plan: pallets by back corner, `drops` where a Clawd stacks from, `floor` to idle on.
type Yard = {
  road: { x0: number; x1: number; y0: number; y1: number }
  mailbox: Pt
  pallets: Pt[]
  drops: Pt[]
  floor: { x0: number; x1: number; y0: number; y1: number }
}

const yards = new WeakMap<Layout, Yard>()

export function yardOf(L: Layout): Yard {
  const known = yards.get(L)
  if (known) return known
  const d = frontDoor(L)
  // out until its near kerb meets the picture's left edge
  const road = { x0: d.mid - 6, x1: d.mid + 6, y0: L.ph, y1: d.mid + 6 + L.ox }
  // pallets along the road's far side, the mailbox past them
  const pallets = Array.from({ length: PALLETS }, (_, i) => ({ x: road.x0 - 2 - PALLET, y: road.y0 + 5 + i * (PALLET + 4) }))
  const mailbox = { x: road.x0 - 2.5, y: road.y0 + 6 + PALLETS * (PALLET + 4) }
  const yard = {
    road,
    mailbox,
    pallets,
    drops: pallets.map(p => ({ x: road.x0 + 2, y: p.y + PALLET / 2 })),
    floor: { x0: road.x0 + 2, x1: road.x1 - 2, y0: road.y0 + 6, y1: mailbox.y },
  }
  yards.set(L, yard)
  return yard
}

const quad = (cv: Canvas, L: Layout, x0: number, x1: number, y0: number, y1: number, m: typeof Y.stone) =>
  cv.poly([at(L, x0, y0), at(L, x1, y0), at(L, x1, y1), at(L, x0, y1)], m)

// The road: slabs in a running bond, kerbed both sides.
export function road(cv: Canvas, L: Layout): void {
  const r = yardOf(L).road
  quad(cv, L, r.x0 - 1, r.x1 + 1, r.y0, r.y1 + 1, Y.kerb)
  cv.layer()
  quad(cv, L, r.x0, r.x1, r.y0, r.y1, Y.stone)
  cv.layer()
  for (let y = r.y0 + 4, k = 0; y < r.y1; y += 4, k++) {
    quad(cv, L, r.x0, r.x1, y, y + 0.6, Y.seam)
    const x = (r.x0 + r.x1) / 2 + (k % 2 ? 3 : -3)
    quad(cv, L, x, x + 0.6, y + 0.6, Math.min(r.y1, y + 4), Y.seam)
  }
  cv.layer()
}

// A yard box: `tape` colour (else plain); `lands`: seconds until it lands, if in transit.
export type Parcel = { tape?: string; lands?: number }

// The yard's things with their depth (plan x + y), drawn back to front among the trees; `pile` by fill order.
export function yardPieces(L: Layout, pile: Map<number, Parcel>): { depth: number; draw: (cv: Canvas) => void }[] {
  const y = yardOf(L)
  const d = frontDoor(L)
  return [
    // the doormat, over the foot of the house's base
    { depth: d.mid + y.road.y0, draw: cv => (quad(cv, L, d.x0 + 1.5, d.x1 - 1.5, y.road.y0 + 0.5, y.road.y0 + 3.5, Y.doormat), cv.layer()) },
    { depth: y.mailbox.x + y.mailbox.y, draw: cv => mailbox(cv, L, pile.size > 0) },
    ...y.pallets.map((p, i) => ({ depth: p.x + p.y + PALLET, draw: (cv: Canvas) => pallet(cv, L, i, pile) })),
  ]
}

// The mailbox, its flag up once anything has been sent.
function mailbox(cv: Canvas, L: Layout, hasMail: boolean): void {
  const m = yardOf(L).mailbox
  box(cv, L, m.x - 0.5, m.y - 0.5, 1, 1, 7, Y.post)
  cv.layer()
  box(cv, L, m.x - 1.5, m.y - 2.5, 3, 5, 3, Y.mailbox, 7)
  cv.layer()
  const up = hasMail ? 3 : 0
  cv.poly([at(L, m.x + 1.5, m.y + 1, 8 + up), at(L, m.x + 1.5, m.y + 2.2, 8 + up), at(L, m.x + 1.5, m.y + 2.2, 9 + up), at(L, m.x + 1.5, m.y + 1, 9 + up)], Y.flag)
  cv.poly([at(L, m.x + 1.5, m.y + 1, 7.5), at(L, m.x + 1.5, m.y + 1.4, 7.5), at(L, m.x + 1.5, m.y + 1.4, 9 + up), at(L, m.x + 1.5, m.y + 1, 9 + up)], Y.flag)
  cv.layer()
}

// Box places in fill order: pallets and corners nearest the mailbox first, a layer at a time.
type Spot = { pallet: number; x: number; y: number; z: number }

const spotsOf = new WeakMap<Layout, Spot[]>()

export function boxSpots(L: Layout): Spot[] {
  const known = spotsOf.get(L)
  if (known) return known
  const { pallets: list, mailbox: m } = yardOf(L)
  const far = (x: number, y: number) => Math.hypot(x + BOX / 2 - m.x, y + BOX / 2 - m.y)
  const order = list.map((_, i) => i).sort((a, b) => {
    const pa = list[a] as Pt
    const pb = list[b] as Pt
    return far(pa.x + PALLET / 2, pa.y + PALLET / 2) - far(pb.x + PALLET / 2, pb.y + PALLET / 2)
  })
  const spots = order.flatMap(i => {
    const p = list[i] as Pt
    const slots = [0, 1, 2, 3].map(k => ({ x: p.x + 0.5 + (k % 2) * STEP, y: p.y + 0.5 + Math.floor(k / 2) * STEP }))
      .sort((a, b) => far(a.x, a.y) - far(b.x, b.y))
    return Array.from({ length: LAYERS }, (_, layer) => slots.map(s => ({ pallet: i, ...s, z: 1 + layer * BOX_H }))).flat()
  })
  spotsOf.set(L, spots)
  return spots
}

// Pallet `i` and its boxes, back to front, bottom to top.
function pallet(cv: Canvas, L: Layout, i: number, pile: Map<number, Parcel>): void {
  const p = yardOf(L).pallets[i] as Pt
  box(cv, L, p.x, p.y, PALLET, PALLET, 1, Y.pallet)
  cv.layer()
  const here = boxSpots(L)
    .flatMap((s, n) => {
      const parcel = pile.get(n)
      return s.pallet === i && parcel ? [{ ...s, parcel }] : []
    })
    .sort((a, b) => a.z - b.z || a.x + a.y - (b.x + b.y))
  for (const s of here) {
    const { lands } = s.parcel
    const tape = s.parcel.tape ? tapeOf(s.parcel.tape) : Y.tape
    cv.stamp(`ybox${tape.cls}`, at(L, s.x, s.y, s.z), sub => {
      box(sub, L, s.x, s.y, BOX, BOX, BOX_H, Y.card, s.z)
      sub.layer()
      sub.poly([at(L, s.x + 1.2, s.y, s.z + BOX_H), at(L, s.x + 1.8, s.y, s.z + BOX_H), at(L, s.x + 1.8, s.y + BOX, s.z + BOX_H), at(L, s.x + 1.2, s.y + BOX, s.z + BOX_H)], tape)
      sub.poly([at(L, s.x + 1.2, s.y + BOX, s.z + BOX_H), at(L, s.x + 1.8, s.y + BOX, s.z + BOX_H), at(L, s.x + 1.8, s.y + BOX, s.z + 1.5), at(L, s.x + 1.2, s.y + BOX, s.z + 1.5)], tape)
    }, undefined, lands === undefined ? '' : ' opacity="0"',
    lands === undefined ? '' : `<set attributeName="opacity" to="1" begin="${Math.max(0, lands).toFixed(2)}s" fill="freeze"/>`)
  }
}

// Tape in a session's colour, dimmer by night.
const tapeOf = (color: string): Mat => mat(`yt${color.slice(1)}`, shade(color, -0.35), color)

// The road, pallet and mailbox footprints on the picture.
export function yardShapes(L: Layout): { road: Pt[]; pallets: Pt[][]; mailbox: Pt } {
  const y = yardOf(L)
  const corners = (x0: number, x1: number, y0: number, y1: number) => [at(L, x0, y0), at(L, x1, y0), at(L, x1, y1), at(L, x0, y1)]
  return {
    road: corners(y.road.x0 - 1, y.road.x1 + 1, y.road.y0, y.road.y1 + 1),
    pallets: y.pallets.map(p => corners(p.x, p.x + PALLET, p.y, p.y + PALLET)),
    mailbox: at(L, y.mailbox.x, y.mailbox.y),
  }
}

// Top left of the day's box count, across the road from the mailbox.
export function signAt(L: Layout): Pt {
  const y = yardOf(L)
  return at(L, y.road.x1 + 3, y.mailbox.y - 4)
}
