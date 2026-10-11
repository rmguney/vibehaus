/*
 * The house: six rooms on one floor, seen from above at an angle, the walls
 * nearest you cut down so every room shows. The plan is laid out in floor
 * units (x to the lower right of the picture, y to the lower left); `at`
 * projects a point of it, at a height, onto the picture.
 *
 * Back row, left to right: library, study and sunroom; front row: kitchen,
 * workshop and the bedroom lounge. The two outer walls at the back stand
 * full height, papered, with windows; the walls between rooms are low, with
 * a doorway in each, and a front door opens on the yard from the workshop.
 */
import type { Room } from '../types'
import { Canvas, faces, mat, warm, warmFaces } from './iso'
import type { Faces, Mat, Pt } from './iso'

export type Dir = 'N' | 'S' | 'E' | 'W'
export type Cell = { x: number; y: number; w: number; h: number; col: number; row: number }
// `w` and `h`: the picture's size; `pw` and `ph`: the plan's; `ox`, `oy`:
// where the plan's corner lands in the picture.
export type Layout = { w: number; h: number; pw: number; ph: number; ox: number; oy: number; grid: Room[][]; rooms: Record<Room, Cell> }

// A room's floor is S units each way; walls are T thick.
const S = 40
export const T = 2
export const TALL_WALL = 26
const LOW_WALL = 5
const PAD = 3
// room above the back walls for the labels on them
const HEADROOM = 4
// room around the house for the garden: either side, above for the trees
// behind it, and below for the island's dirt edge
const SIDE = 14
const TREES = 10
const BELOW = 14

const HOUSE: Room[][] = [['library', 'study', 'sunroom'], ['kitchen', 'workshop', 'lounge']]
export const ALL_ROOMS: Room[] = ['study', 'library', 'workshop', 'kitchen', 'sunroom', 'lounge']

export function house(): Layout {
  const rooms = {} as Record<Room, Cell>
  HOUSE.forEach((line, row) => line.forEach((room, col) => {
    rooms[room] = { x: T + col * (S + T), y: T + row * (S + T), w: S, h: S, col, row }
  }))
  const pw = T + 3 * (S + T)
  const ph = T + 2 * (S + T)
  const ox = ph + PAD + SIDE
  const oy = TALL_WALL + PAD + HEADROOM + TREES
  return { w: pw + ph + 2 * (PAD + SIDE), h: Math.ceil((pw + ph) / 2 + oy + PAD + BELOW), pw, ph, ox, oy, grid: HOUSE, rooms }
}

// A point of the plan at height z, on the picture.
export function at(L: Layout, x: number, y: number, z = 0): Pt {
  return { x: x - y + L.ox, y: (x + y) / 2 - z + L.oy }
}

// Doorways: each wall between two rooms has one, ten units wide, near the
// front end of the wall, clear of the furniture along the back.
const DOOR = 32
export const doorY = (c: Cell) => c.y + DOOR
export const doorX = (c: Cell) => c.x + DOOR
export const floorBottom = (c: Cell) => c.y + c.h - 3

// The front door, in the workshop's front wall, where the road out to the
// mailbox starts: its span along the wall, and its middle.
export function frontDoor(L: Layout): { x0: number; x1: number; mid: number } {
  const mid = L.rooms.workshop.x + 21
  return { x0: mid - 5, x1: mid + 5, mid }
}

// Where idle agents may stand about in a room, clear of its furniture.
export function freeFloor(room: Room, c: Cell): { x0: number; x1: number; y0: number; y1: number } {
  if (room === 'lounge') return { x0: c.x + 17, x1: c.x + c.w - 4, y0: c.y + 23, y1: c.y + c.h - 3 }
  return { x0: c.x + 11, x1: c.x + c.w - 5, y0: c.y + 15, y1: c.y + c.h - 3 }
}

// ---------- materials ----------

const MAT = {
  slab: faces('ks', '#40362e', '#9c8a76'),
  trim: warmFaces('kt', '#f3ebde'),
  low: warmFaces('kw', '#e8dfd1'),
  glass: mat('kg', '#141c33', '#a9daf5'),
  star: mat('kx', '#f7e7a6', '#a9daf5'),
  cloud: mat('kc', '#141c33', '#ffffff'),
  moon: mat('km', '#f1e3a8', '#fff3b8'),
  frame: warm('kf', '#fbf8f1'),
}

// Each room's wallpaper (with its stripe) and floor (with its seams or
// second tile), and the colour its name is written in.
export const ROOM_STYLE: Record<Room, { paper: Mat; stripe: Mat; floor: Mat; seam: Mat; kind: 'planks' | 'tiles' | 'carpet'; ink: string }> = {
  library: { paper: warm('pl', '#7aa587'), stripe: warm('ql', '#8bb697'), floor: warm('fl', '#a26f47'), seam: warm('gl', '#86593a'), kind: 'planks', ink: '#9fe0b4' },
  study: { paper: warm('pb', '#7b98c8'), stripe: warm('qb', '#8aa6d3'), floor: warm('fb', '#b3814f'), seam: warm('gb', '#946840'), kind: 'planks', ink: '#9cc4ff' },
  sunroom: { paper: warm('pc', '#86c7bc'), stripe: warm('qc', '#97d2c8'), floor: warm('fc', '#cf9271'), seam: warm('gc', '#bb7c5c'), kind: 'tiles', ink: '#8ef0d8' },
  kitchen: { paper: warm('pe', '#d4e3e8'), stripe: warm('qe', '#e4eef1'), floor: warm('fe', '#e3e9ec'), seam: warm('ge', '#bcc8cf'), kind: 'tiles', ink: '#ff9aa2' },
  workshop: { paper: warm('pw', '#d8b38a'), stripe: warm('qw', '#e1c09a'), floor: warm('fw', '#cda46d'), seam: warm('gw', '#b38b56'), kind: 'planks', ink: '#ffc27a' },
  lounge: { paper: warm('pq', '#c3b2df'), stripe: warm('qq', '#cfc0e7'), floor: warm('fq', '#bcadd9'), seam: warm('gq', '#c8bbe2'), kind: 'carpet', ink: '#d6b8ff' },
}

// ---------- patterns ----------

// Floor and wallpaper patterns on the picture's own grid: planks with seams
// running along the floor, tiles in a checker, carpet with a soft weave, and
// paper with thin upright stripes.
export function patterns(cv: Canvas): string {
  const parts: string[] = []
  const use = (m: Mat) => {
    cv.used.set(m.cls, m)
    return `class="${m.cls}" fill="${m.night}"`
  }
  for (const room of ALL_ROOMS) {
    const s = ROOM_STYLE[room]
    if (s.kind === 'planks') {
      // a seam every four units across the planks, a joint now and then
      let seam = ''
      for (let i = 0; i < 8; i++) seam += `<rect x="${i}" y="${Math.floor(i / 2)}" width="1" height="1"/>`
      parts.push(`<pattern id="f-${room}" width="8" height="4" patternUnits="userSpaceOnUse"><rect width="8" height="4" ${use(s.floor)}/><g ${use(s.seam)}>${seam}</g></pattern>`)
    } else if (s.kind === 'tiles') {
      parts.push(`<pattern id="f-${room}" width="8" height="4" patternUnits="userSpaceOnUse"><rect width="8" height="4" ${use(s.floor)}/>` +
        `<path ${use(s.seam)} d="M3 0h2v1h2v2h-2v1h-2v-1h-2v-2h2z"/></pattern>`)
    } else {
      parts.push(`<pattern id="f-${room}" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" ${use(s.floor)}/>` +
        `<path ${use(s.seam)} d="M0 0h1v1h-1zM2 2h1v1h-1z"/></pattern>`)
    }
    if (HOUSE[0]?.includes(room) || HOUSE.some(line => line[0] === room)) {
      parts.push(`<pattern id="w-${room}" width="4" height="1" patternUnits="userSpaceOnUse"><rect width="4" height="1" ${use(s.paper)}/><rect x="3" width="1" height="1" ${use(s.stripe)}/></pattern>`)
    }
  }
  return parts.join('')
}

// A box drawn once for its size and material, and copied for every other of
// the same: stretches of wall, mostly.
function boxStamp(cv: Canvas, L: Layout, tag: string, x: number, y: number, w: number, d: number, h: number, f: Faces, z = 0): void {
  cv.stamp(`${tag}${w}x${d}x${h}`, at(L, x, y, z), sub => box(sub, L, x, y, w, d, h, f, z))
}

// ---------- boxes and faces ----------

// A box standing on the plan: `x`, `y` its back corner, `w` along x, `d`
// along y, `h` tall from height `z`. Only the three faces you can see.
export function box(cv: Canvas, L: Layout, x: number, y: number, w: number, d: number, h: number, f: Faces, z = 0): void {
  const z1 = z + h
  cv.poly([at(L, x, y, z1), at(L, x + w, y, z1), at(L, x + w, y + d, z1), at(L, x, y + d, z1)], f.top)
  cv.poly([at(L, x, y + d, z1), at(L, x + w, y + d, z1), at(L, x + w, y + d, z), at(L, x, y + d, z)], f.left)
  cv.poly([at(L, x + w, y, z1), at(L, x + w, y + d, z1), at(L, x + w, y + d, z), at(L, x + w, y, z)], f.right)
}

// A patch on the face of a wall or box that looks along y (it runs along
// x): from x0 to x1, heights z0 to z1, at depth y.
export function faceY(cv: Canvas, L: Layout, y: number, x0: number, x1: number, z0: number, z1: number, m: Mat | string): void {
  cv.poly([at(L, x0, y, z1), at(L, x1, y, z1), at(L, x1, y, z0), at(L, x0, y, z0)], m)
}

// The same on a face that looks along x (it runs along y).
export function faceX(cv: Canvas, L: Layout, x: number, y0: number, y1: number, z0: number, z1: number, m: Mat | string): void {
  cv.poly([at(L, x, y0, z1), at(L, x, y1, z1), at(L, x, y1, z0), at(L, x, y0, z0)], m)
}

// ---------- the shell: base, floors, walls ----------

export function shell(cv: Canvas, L: Layout): void {
  // the house stands on a low base: only its two front sides show
  faceY(cv, L, L.ph, 0, L.pw, -3, 0, MAT.slab.left)
  faceX(cv, L, L.pw, 0, L.ph, -3, 0, MAT.slab.right)
  cv.layer()
  for (const room of ALL_ROOMS) floor(cv, L, L.rooms[room], `url(#f-${room})`)
  cv.layer()
  // the two outer walls at the back, full height, papered room by room: of
  // the bare wall, only the tops, the ends, a band along the top and the
  // pillars between rooms show
  const top = (pts: Pt[]) => cv.poly(pts, MAT.trim.top)
  top([at(L, 0, 0, TALL_WALL), at(L, T, T, TALL_WALL), at(L, T, L.ph, TALL_WALL), at(L, 0, L.ph, TALL_WALL)])
  top([at(L, 0, 0, TALL_WALL), at(L, L.pw, 0, TALL_WALL), at(L, L.pw, T, TALL_WALL), at(L, T, T, TALL_WALL)])
  faceY(cv, L, L.ph, 0, T, 0, TALL_WALL, MAT.trim.left)
  faceX(cv, L, L.pw, 0, T, 0, TALL_WALL, MAT.trim.right)
  faceX(cv, L, T, T, L.ph, TALL_WALL - 1, TALL_WALL, MAT.trim.right)
  faceY(cv, L, T, T, L.pw, TALL_WALL - 1, TALL_WALL, MAT.trim.left)
  // the inside of each wall's front end, past the last room's paper
  faceX(cv, L, T, L.ph - T, L.ph, 0, TALL_WALL - 1, MAT.trim.right)
  faceY(cv, L, T, L.pw - T, L.pw, 0, TALL_WALL - 1, MAT.trim.left)
  for (const room of ALL_ROOMS) {
    const c = L.rooms[room]
    if (c.col === 0) cv.stamp('wy', at(L, T, c.y), sub => faceX(sub, L, T, c.y, c.y + c.h, 0, TALL_WALL - 1, 'inherit'), `url(#w-${room})`)
    if (c.row === 0) cv.stamp('wx', at(L, c.x, T), sub => faceY(sub, L, T, c.x, c.x + c.w, 0, TALL_WALL - 1, 'inherit'), `url(#w-${room})`)
    if (c.col === 0 && c.row > 0) faceX(cv, L, T, c.y - T, c.y, 0, TALL_WALL - 1, MAT.trim.right)
    if (c.row === 0 && c.col > 0) faceY(cv, L, T, c.x - T, c.x, 0, TALL_WALL - 1, MAT.trim.left)
  }
  cv.layer()
  for (const room of ALL_ROOMS) {
    const c = L.rooms[room]
    // a skirting board along the foot of the papered walls
    if (c.col === 0) faceX(cv, L, T, c.y, c.y + c.h, 0, 2, MAT.trim.right)
    if (c.row === 0) faceY(cv, L, T, c.x, c.x + c.w, 0, 2, MAT.trim.left)
  }
  cv.layer()
  // low walls between rooms, a doorway in each
  for (const room of ALL_ROOMS) {
    const c = L.rooms[room]
    if (c.col > 0) {
      boxStamp(cv, L, 'lw', c.x - T, c.y - (c.row > 0 ? T : 0), T, DOOR - 5 + (c.row > 0 ? T : 0), LOW_WALL, MAT.low)
      boxStamp(cv, L, 'lw', c.x - T, c.y + DOOR + 5, T, c.h - DOOR - 5, LOW_WALL, MAT.low)
    }
    if (c.row > 0) {
      boxStamp(cv, L, 'lw', c.x, c.y - T, DOOR - 5, T, LOW_WALL, MAT.low)
      boxStamp(cv, L, 'lw', c.x + DOOR + 5, c.y - T, c.w - DOOR - 5, T, LOW_WALL, MAT.low)
    }
  }
  cv.layer()
}

// A room's floor, filled: with its own pattern, or a lamp's light over it.
export function floor(cv: Canvas, L: Layout, c: Cell, fill: string, attrs = '', inner = ''): void {
  cv.stamp('fl', at(L, c.x, c.y), sub => sub.poly([at(L, c.x, c.y), at(L, c.x + c.w, c.y), at(L, c.x + c.w, c.y + c.h), at(L, c.x, c.y + c.h)], 'inherit'), fill, attrs, inner)
}

// The cut-down walls along the front edges, drawn last of the house so they
// sit in front of the floors.
export function frontWalls(cv: Canvas, L: Layout): void {
  // in room-long stretches, each drawn once and copied along; the front
  // door's stretch in two pieces either side of a doorstep
  const d = frontDoor(L)
  for (let x = 0; x < L.pw; x += S + T) {
    const w = Math.min(S + T, L.pw - x)
    if (d.x0 > x && d.x1 < x + w) {
      cv.poly([at(L, d.x0, L.ph - T), at(L, d.x1, L.ph - T), at(L, d.x1, L.ph), at(L, d.x0, L.ph)], MAT.trim.top)
      box(cv, L, x, L.ph - T, d.x0 - x, T, 3, MAT.low)
      box(cv, L, d.x1, L.ph - T, x + w - d.x1, T, 3, MAT.low)
    } else boxStamp(cv, L, 'fw', x, L.ph - T, w, T, 3, MAT.low)
  }
  for (let y = 0; y < L.ph - T; y += S + T) boxStamp(cv, L, 'fw', L.pw - T, y, T, Math.min(S + T, L.ph - T - y), 3, MAT.low)
  cv.layer()
}

// A window on a back wall: a frame, the sky in it (stars and a moon by night,
// a cloud by day) and a cross of glazing bars. `along` says which wall.
export function windowOn(cv: Canvas, L: Layout, along: 'x' | 'y', a0: number, a1: number, z0: number, z1: number, seed: number): void {
  const origin = along === 'x' ? at(L, a0, T, z1) : at(L, T, a0, z1)
  cv.stamp(`win-${along}${a1 - a0}x${z1 - z0}s${seed}`, origin, sub => windowDrawn(sub, L, along, a0, a1, z0, z1, seed))
}

function windowDrawn(cv: Canvas, L: Layout, along: 'x' | 'y', a0: number, a1: number, z0: number, z1: number, seed: number): void {
  const face = (b0: number, b1: number, c0: number, c1: number, m: Mat) => (along === 'x'
    ? faceY(cv, L, T, b0, b1, c0, c1, m)
    : faceX(cv, L, T, b0, b1, c0, c1, m))
  face(a0, a1, z0, z1, MAT.frame)
  face(a0 + 1, a1 - 1, z0 + 1, z1 - 1, MAT.glass)
  cv.layer()
  const mid = Math.round((a0 + a1) / 2)
  const span = a1 - a0 - 2
  // a few stars, the same each time for the same window
  for (let i = 0; i < 4; i++) {
    const u = a0 + 1.5 + ((seed * 7 + i * 5) % Math.max(1, span - 1))
    const v = z0 + 2 + ((seed + i * 3) % Math.max(1, z1 - z0 - 4))
    face(u, u + 1, v, v + 1, MAT.star)
  }
  if (seed % 2 === 0) face(a1 - 4, a1 - 2, z1 - 4, z1 - 2, MAT.moon)
  face(a0 + 2, a0 + 6, z1 - 4, z1 - 3, MAT.cloud)
  cv.layer()
  face(mid, mid + 1, z0 + 1, z1 - 1, MAT.frame)
  face(a0 + 1, a1 - 1, Math.round((z0 + z1) / 2), Math.round((z0 + z1) / 2) + 1, MAT.frame)
  cv.layer()
}
