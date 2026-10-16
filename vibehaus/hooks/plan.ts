/*
 * The house in the terminal: its floor plan from above in cells, crisp in any pane. Turned a quarter so a
 * tall docked pane fits it big, the furniture drawn flat. Agents are Clawds as Claude Code draws its own,
 * named in their colour, walking room to room; fires, screens and lights flicker.
 */
import type { Resident, Room, Track } from '../types'
import { ALL_ROOMS, doorX, doorY, frontDoor, house, ROOM_STYLE } from './house'
import type { Cell } from './house'
import { appFor, bodyColor, colorFor, displayName, LAYOUT, spotOf } from './scene'
import type { App } from './scene'
import { yardOf } from './yard'

// the terminal's own colour
const DEFAULT = 0x01000000
const L = house()
const YARD = yardOf(L)
const ROAD = YARD.road
// The plan turned: depth runs across, width down; `x`, `y` are the plan's own, `X`, `Y` turned.
const ACROSS = L.ph
const DOWN = L.pw
const YARD_DEPTH = ROAD.y1 - L.ph

// the picture's colours by night
const C = {
  wall: '#cbb397', glass: '#9cc4ff', grass: '#1d3324', tuft: '#3f6b45', blade: '#5c8a4c', tree: '#2f6b3a', path: '#4d4842',
  amber: '#f5c47a', woodDark: '#9a6740', wood: '#b8834f', pine: '#d6b07a', white: '#f4f2ec', stone: '#9ea3aa',
  dark: '#24282e', brick: '#b5644f', brass: '#d8b25a', leaf: '#5fae62', linen: '#fbf9f4', blue: '#6f8fd6', green: '#79b89a',
  armchair: '#5d8f76', couch: '#c77fae', couchBack: '#a8618f', shade: '#f5dca0', red: '#d9584c', parcel: '#c9965a',
  mail: '#d0782e', zz: '#cfd8ff', steam: '#c9cdd3',
}
const BOOKS = ['#c75a5a', '#5a86c7', '#c7ad5a', '#5ac79a', '#9a5ac7', '#c7865a']
const RUGS: Partial<Record<Room, [string, string]>> = { library: ['#b85c5c', '#d07a7a'], lounge: ['#d9a9c9', '#e8bfd8'] }
const FIRE = ['#f5a623', '#ffd166', '#f26b3a']
const TV = ['#5ad0ff', '#ff6ad5', '#ffd34a', '#7df08a']
const LAMP = { working: '#4cf08c', waiting: '#f5ac45', failed: '#f2503f' }

// Claude Code's own Clawd, nine cells by three, its legs stepping as it walks.
const CLAWD = [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  ']
const STEPPING = '  ▝▝ ▘▘  '
const CLAWD_W = 9

// box drawing by a line's arms: up 1, right 2, down 4, left 8
const LINES = ' ╵╶└╷│┌├╴┘─┴┐┤┬┼'

// What a terminal draws one cell wide, all a Raster takes; anything else becomes a question mark.
const NARROW = /^[\x20-\x7e\u00a0-\u00ac\u00ae-\u024f\u2010-\u2027\u2261\u2500-\u25a1\u25ac\u25b2\u25cb\u25cf\u2663\u273d]$/
const letter = (ch: string) => (NARROW.test(ch) ? ch.codePointAt(0) ?? 63 : 63)

// A cell per letter: joiners, variation selectors and skin tones dropped, so a joined emoji is one
// letter (a question mark: two cells wide).
const SHAPER = /^(?:[\ufe0e\ufe0f]|[\u{1f3fb}-\u{1f3ff}])$/u
function lettersOf(text: string): string[] {
  const out: string[] = []
  let joined = false
  for (const ch of text) {
    if (ch === '\u200d') joined = true
    else if (SHAPER.test(ch)) continue
    else if (joined) joined = false
    else out.push(ch)
  }
  return out
}

// colours as numbers, each parsed once: the plan is rebuilt every redraw
const inks = new Map<string, number>()
const hex = (c: string) => {
  let n = inks.get(c)
  if (n === undefined) {
    n = parseInt(c.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
    if (inks.size > 512) inks.clear()
    inks.set(c, n)
  }
  return n
}
// a colour toward black, so things read on a floor
const dim = (c: string, f: number) => {
  const n = hex(c)
  return (Math.round(((n >> 16) & 255) * f) << 16) | (Math.round(((n >> 8) & 255) * f) << 8) | Math.round((n & 255) * f)
}
const dimmed = (c: string, f: number) => `#${dim(c, f).toString(16).padStart(6, '0')}`

// A cell of lawn, now and then a tuft in one of two greens.
const TUFTS = ['"', ',', "'", '"']
function grassAt(k: number, row: number): [string, string] {
  const n = ((Math.imul(k, 73856093) ^ Math.imul(row, 19349663)) >>> 0) % 19
  return n < TUFTS.length ? [TUFTS[n] as string, n % 2 ? C.blade : C.tuft] : [' ', C.tuft]
}

// One agent: who, and its walk.
export type Walker = { c: Resident; t: Track }

// A cell cycling glyphs and inks every `ms`. Turns land on BEATs of whole house frames, so frames
// between change nothing and are not sent.
const BEAT = 400
type Flicker = { at: number; frames: [string, string][]; ms: number }
type Frames = { at: number; frames: [number, number][]; ms: number }

// A room's box in cells: name row, floor rows below, columns between its walls.
type Box = { head: number; top: number; bottom: number; left: number; right: number }

// The plan for a pane: fixed cells, flickers, where agents may stand, beds for naps.
export type Plan = {
  columns: number; rows: number
  base: Uint32Array; flickers: Frames[]; walkable: Uint8Array
  cellOf: (x: number, y: number) => [number, number]
  boxOf: (col: number, row: number) => Box
  beds: [number, number][]
}

// The plan's size in a pane `columns` by `bodyRows`: rooms two across and three down beside the yard, each
// up to about square; rooms and yard each fit a Clawd, all within what a Raster takes.
type PlanSize = { columns: number; across: number; down: number; rows: number }
export const RASTER_COLUMNS = 512
export const RASTER_ROWS = 256

export function planSize(columns: number, bodyRows: number): PlanSize {
  const yard = Math.max(CLAWD_W + 1, Math.min(18, Math.round(columns * 0.2)))
  const across = Math.max(CLAWD_W + 2, Math.min(Math.floor((RASTER_COLUMNS - yard - 1) / 2), Math.floor((columns - yard - 1) / 2)))
  const down = Math.max(5, Math.min(Math.floor((RASTER_ROWS - 1) / 3), Math.round(across / 1.8), Math.floor((bodyRows - 1) / 3)))
  return { columns: 2 * across + 1 + yard, across, down, rows: 3 * down + 1 }
}

// desk screen colours by tool, as in the picture
const SCREENS: Record<App, string> = { code: '#5ad0ff', diff: '#5ad0ff', term: '#4cf08c', web: '#52d2f5', files: '#e6c35c', notes: '#f4f1e8' }
const screenOf = (tool: string | undefined) => (tool ? SCREENS[appFor(tool)] : C.dark)

// The plan: rooms `across` cells wide and `down` tall, walls included.
export function planOf(size: PlanSize, boxes: number, residents: Resident[]): Plan {
  const { columns, across, down, rows } = size
  const houseRight = 2 * across
  const yardCols = columns - houseRight - 1
  const base = new Uint32Array(columns * rows * 3)
  const walkable = new Uint8Array(columns * rows)
  const flickers: Flicker[] = []
  const at = (k: number, r: number) => r * columns + k
  const inside = (k: number, r: number) => k >= 0 && k < columns && r >= 0 && r < rows
  // a cell; its paper only if given
  const set = (k: number, r: number, ch: string, ink: string | number, paper?: string | number) => {
    if (!inside(k, r)) return
    const i = at(k, r) * 3
    base[i] = letter(ch)
    base[i + 1] = typeof ink === 'number' ? ink : hex(ink)
    if (paper !== undefined) base[i + 2] = typeof paper === 'number' ? paper : hex(paper)
  }
  const write = (k: number, r: number, text: string, ink: string) => lettersOf(text).forEach((ch, i) => set(k + i, r, ch, ink))
  for (let i = 0; i < base.length; i += 3) {
    base[i] = 0x20
    base[i + 1] = DEFAULT
    base[i + 2] = DEFAULT
  }

  // Turned plan units to cells, walls on whole cells, each room's name row above its floor.
  const colOf = (X: number) => (X <= ACROSS
    ? Math.max(0, Math.min(houseRight, Math.round(((X - 1) / (ACROSS - 2)) * houseRight)))
    : houseRight + Math.min(yardCols, Math.ceil(((X - ACROSS) / YARD_DEPTH) * yardCols)))
  const wallRow = (Y: number) => Math.max(0, Math.min(3 * down, Math.round(((Y - 1) / (DOWN - 2)) * 3 * down)))
  const rooms = Object.values(L.rooms)
  const boxOfRoom = (c: Cell): Box => {
    const head = wallRow(c.x - 1) + 1
    return { head, top: head + 1, bottom: wallRow(c.x + c.w + 1) - 1, left: colOf(c.y - 1), right: colOf(c.y + c.h + 1) }
  }
  const roomBoxes = rooms.map(boxOfRoom)
  const rowOf = (X: number, Y: number) => {
    const i = X <= ACROSS ? rooms.findIndex(r => Y >= r.x && Y <= r.x + r.w) : -1
    const c = rooms[i]
    const b = roomBoxes[i]
    if (!c || !b) return wallRow(Y)
    return Math.min(b.bottom, b.top + Math.floor(((Y - c.x) / c.w) * (b.bottom - b.top + 1)))
  }
  const cellOf = (x: number, y: number): [number, number] => [colOf(y), rowOf(y, x)]
  // a rect of the floor plan as cells, at least one
  const fill = (x0: number, y0: number, x1: number, y1: number, paint: (k: number, r: number, i: number, j: number) => void) => {
    const [a, b] = [cellOf(x0 + 0.5, y0 + 0.5), cellOf(x1 - 0.5, y1 - 0.5)]
    const [k0, k1, r0, r1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])]
    for (let r = r0; r <= r1; r++) for (let k = k0; k <= k1; k++) paint(k, r, k - k0, r - r0)
  }

  // floors (planks in rows, tiles checkered, carpet plain) under a wallpaper strip: name and activity
  for (const name of ALL_ROOMS) {
    const c = L.rooms[name]
    const style = ROOM_STYLE[name]
    const b = boxOfRoom(c)
    for (let r = b.head; r <= b.bottom; r++) {
      for (let k = b.left + 1; k < b.right; k++) {
        const shade = style.kind === 'tiles' ? ((k + r) % 2 ? 0.3 : 0.25) : style.kind === 'planks' ? (r % 2 ? 0.3 : 0.26) : 0.28
        set(k, r, ' ', DEFAULT, r === b.head ? dim(style.paper.night, 0.32) : dim(style.floor.night, shade))
        if (r > b.head) walkable[at(k, r)] = 1
      }
    }
    write(b.left + 2, b.head, name, style.ink)
    const busy = residents.find(m => m.room === name && (m.status === 'working' || m.status === 'waiting') && m.leaving === undefined)
    if (busy) {
      const doing = lettersOf(busy.status === 'waiting' ? `wants ${busy.waitingTool ?? 'you'}` : busy.activity)
      const from = b.left + name.length + 4
      const room = b.right - 1 - from
      if (room > 3) write(from, b.head, doing.length > room ? `${doing.slice(0, room - 1).join('')}…` : doing.join(''), busy.status === 'waiting' ? C.amber : dimmed(style.ink, 0.75))
    }
  }

  // the rugs, under everything on them
  const R = L.rooms
  for (const [name, [edge, middle]] of Object.entries(RUGS) as [Room, [string, string]][]) {
    const [x0, y0, x1, y1] = name === 'library' ? [12, 15, 34, 33] : [15, 21, 37, 36]
    const [a, b] = [cellOf(R[name].x + x0, R[name].y + y0), cellOf(R[name].x + x1, R[name].y + y1)]
    const [k0, k1, r0, r1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])]
    for (let r = r0; r <= r1; r++) {
      for (let k = k0; k <= k1; k++) set(k, r, ' ', DEFAULT, dim(r === r0 || r === r1 || k === k0 || k === k1 ? edge : middle, 0.55))
    }
  }

  // Furniture, a little of each piece, against the same walls as in the picture.
  const piece = (room: Room, x0: number, y0: number, x1: number, y1: number, paint: (k: number, r: number, i: number, j: number) => void) =>
    fill(R[room].x + x0, R[room].y + y0, R[room].x + x1, R[room].y + y1, paint)
  // a small thing: one cell at any pane size
  const spot = (room: Room, x: number, y: number, ch: string, ink: string, paper?: string, frames?: [string, string][], ms = BEAT) => {
    const [k, r] = cellOf(R[room].x + x, R[room].y + y)
    set(k, r, ch, ink, paper)
    if (frames) flickers.push({ at: at(k, r), frames, ms })
  }
  // desks on each work room's back wall, screens lit by whoever works there, a light by each
  for (const name of ALL_ROOMS) {
    if (name === 'lounge') continue
    for (let d = 0; d < 2; d++) {
      const sitter = residents.find(c => c.room === name && c.seat === d && (c.status === 'working' || c.status === 'waiting') && c.leaving === undefined)
      const lit = sitter ? screenOf(sitter.tool) : C.dark
      const x0 = 2 + 14 * d
      piece(name, x0, 1, x0 + 12, 7, (k, r, i, j) => {
        const isScreen = i === 0 && j > 0 && j < 3
        set(k, r, isScreen ? '▌' : ' ', lit, name === 'kitchen' ? C.stone : C.wood)
        if (isScreen && sitter) flickers.push({ at: at(k, r), frames: [['▌', lit], ['▌', lit], ['▌', dimmed(lit, 0.6)]], ms: BEAT * j })
      })
      if (sitter) {
        const light = sitter.status === 'waiting' ? LAMP.waiting : sitter.isOk === false ? LAMP.failed : LAMP.working
        spot(name, x0 + 11, 4, '•', light, name === 'kitchen' ? C.stone : C.wood, [['•', light], ['•', C.woodDark]], 2 * BEAT)
      }
    }
  }
  // library: bookshelves, reading lamp
  piece('library', 0, 9, 5, 27, (k, r, i, j) => set(k, r, '▄', BOOKS[(i * 2 + j) % BOOKS.length] ?? C.red, BOOKS[(i * 2 + j + 3) % BOOKS.length] ?? C.blue))
  spot('library', 33.5, 3.5, '●', C.shade)
  // study: fireplace, armchair, plant, lamp
  piece('study', 29, 1, 39, 6, (k, r) => set(k, r, '▐', C.dark, C.brick))
  for (const x of [32.5, 35.5]) spot('study', x, 4, '▲', FIRE[0] ?? C.red, C.dark, FIRE.map((f, n) => ['▲', FIRE[(n + Math.round(x)) % FIRE.length] ?? f]), BEAT)
  piece('study', 1, 16, 8, 23, (k, r, _, j) => set(k, r, j === 0 ? '▀' : ' ', C.armchair, C.green))
  spot('study', 3.5, 10.5, '♣', C.leaf)
  spot('study', 1.5, 26.5, '●', C.shade)
  // sunroom: telescope, radio, plant
  spot('sunroom', 6, 14, '╲', C.brass)
  spot('sunroom', 3.5, 21.5, '■', C.dark, C.wood)
  spot('sunroom', 3.5, 24, '•', LAMP.working, C.wood, [['•', LAMP.working], ['•', '#1f5f3a']], 2 * BEAT)
  spot('sunroom', 35.5, 4.5, '♣', C.leaf)
  // kitchen: fridge, stove and steaming pot, coffee machine
  piece('kitchen', 0, 8, 6, 15, (k, r, _, j) => set(k, r, j === 0 ? '▀' : ' ', C.stone, C.white))
  piece('kitchen', 0, 15, 6, 27, (k, r) => set(k, r, ' ', DEFAULT, C.stone))
  spot('kitchen', 2.5, 17.5, '●', C.red, C.stone, [['●', C.red], ['●', C.red], ['~', C.steam]], BEAT)
  spot('kitchen', 2.5, 21, '○', C.dark, C.stone)
  spot('kitchen', 2.5, 24.5, '■', C.dark, C.stone, [['■', C.dark], ['■', C.red]], 3 * BEAT)
  // workshop: workbench, toolbox, vise, level, plant
  piece('workshop', 0, 9, 7, 24, (k, r) => set(k, r, ' ', DEFAULT, C.pine))
  spot('workshop', 2.5, 12, '▬', C.red, C.pine)
  spot('workshop', 2.5, 18, '≡', C.dark, C.pine)
  spot('workshop', 4.5, 21.5, '▬', C.brass, C.pine)
  spot('workshop', 36.5, 36.5, '♣', C.leaf)
  // lounge: two beds, TV, couch, plant
  for (let b = 0; b < 2; b++) {
    piece('lounge', 0, 1 + 11 * b, 15, 10 + 11 * b, (k, r, _, j) => set(k, r, j === 0 ? ' ' : '▄', b === 0 ? C.blue : C.green, j === 0 ? C.linen : b === 0 ? C.blue : C.green))
  }
  piece('lounge', 18, 0, 28, 4, (k, r, i) => {
    set(k, r, '▌', C.dark, C.wood)
    if (i === 0) flickers.push({ at: at(k, r), frames: TV.map(c => ['▌', c] as [string, string]), ms: 2 * BEAT })
  })
  piece('lounge', 17, 13, 30, 18, (k, r, i) => set(k, r, i === 0 ? ' ' : '▐', C.couchBack, C.couch))
  spot('lounge', 36.5, 36.5, '♣', C.leaf)
  const beds: [number, number][] = [[8, 5.5], [8, 16.5]].map(([x, y]) => cellOf(R.lounge.x + (x ?? 0), R.lounge.y + (y ?? 0)))

  // The walls, but for doorways, with windows in the outer walls.
  const arms = new Uint8Array(columns * rows)
  const line = (k0: number, r0: number, k1: number, r1: number) => {
    for (let r = r0; r <= r1; r++) {
      for (let k = k0; k <= k1; k++) {
        const i = at(k, r)
        if (k0 === k1 && r0 !== r1) arms[i] = (arms[i] ?? 0) | (r > r0 ? 1 : 0) | (r < r1 ? 4 : 0)
        else arms[i] = (arms[i] ?? 0) | (k > k0 ? 8 : 0) | (k < k1 ? 2 : 0)
      }
    }
  }
  const walls = [0, down, 2 * down, 3 * down]
  for (const k of [0, across, houseRight]) line(k, 0, k, 3 * down)
  for (const r of walls) line(0, r, houseRight, r)
  const gap = (k0: number, r0: number, k1: number, r1: number) => {
    for (let r = r0; r <= r1; r++) {
      for (let k = k0; k <= k1; k++) {
        arms[at(k, r)] = 0
        walkable[at(k, r)] = 1
      }
    }
  }
  for (const c of rooms) {
    // doorways to the rooms once beside it (now below) and once below it (now beside)
    if (c.col < 2) {
      const r = boxOfRoom(c).bottom + 1
      gap(colOf(doorY(c) - 3), r, colOf(doorY(c) + 3), r)
    }
    if (c.row < 1) gap(across, cellOf(doorX(c), c.y + c.h - 1)[1], across, cellOf(doorX(c), c.y + c.h - 1)[1])
  }
  const door = frontDoor(L)
  gap(houseRight, cellOf(door.x0 + 2, L.ph - 2)[1], houseRight, cellOf(door.x1 - 2, L.ph - 2)[1])
  const glass = new Set<number>()
  for (const c of rooms) {
    const b = boxOfRoom(c)
    if (c.y < L.ph / 2) for (let r = b.top + 1; r < b.bottom; r++) glass.add(at(0, r))
    if (c.x < 10) for (let k = b.left + 3; k < b.right - 3; k++) glass.add(at(k, 0))
    if (c.x > L.pw - 50) for (let k = b.left + 3; k < b.right - 3; k++) glass.add(at(k, 3 * down))
  }
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < columns; k++) {
      const i = at(k, r)
      if (!arms[i]) continue
      const has = (dk: number, dr: number) => inside(k + dk, r + dr) && (arms[at(k + dk, r + dr)] ?? 0) > 0
      const a = (arms[i] as number) & ((has(0, -1) ? 1 : 0) | (has(1, 0) ? 2 : 0) | (has(0, 1) ? 4 : 0) | (has(-1, 0) ? 8 : 0))
      walkable[i] = 0
      const isGlass = glass.has(i) && (a === 10 || a === 5)
      set(k, r, isGlass ? (a === 10 ? '═' : '║') : LINES[a] ?? ' ', isGlass ? C.glass : C.wall, DEFAULT)
    }
  }

  // The yard: lawn, trees, road, the day's boxes, mailbox.
  const [roadTop, roadBottom] = [cellOf(ROAD.x0 + 1, L.ph + 1)[1], cellOf(ROAD.x1 - 1, L.ph + 1)[1]]
  for (let r = 0; r < rows; r++) {
    for (let k = houseRight + 1; k < columns; k++) {
      const isRoad = r >= roadTop && r <= roadBottom
      const [ch, ink] = isRoad ? [' ', C.tuft] : grassAt(k, r)
      set(k, r, ch, ink, isRoad ? C.path : C.grass)
      walkable[at(k, r)] = 1
    }
  }
  for (const [x, y] of [[20, 100], [110, 120], [40, 128], [100, 105]] as [number, number][]) {
    const [k, r] = cellOf(x, y)
    if (r < roadTop - 1 || r > roadBottom + 1) set(k, r, '♣', C.tree)
  }
  const count = `${boxes}`
  const squares = Math.max(0, Math.min(3, boxes, columns - houseRight - 3 - count.length))
  write(houseRight + 2, roadTop - 2, `${'■'.repeat(squares)}${squares > 0 ? ' ' : ''}${count}`, C.parcel)
  set(columns - 2, roadTop - 1, '▐', C.mail)

  // the room a cell is in, for a doorway either one; past the house, the yard
  const yard: Box = { head: 0, top: 1, bottom: rows - 1, left: houseRight, right: columns }
  const boxOf = (k: number, r: number): Box => (k >= houseRight ? yard
    : roomBoxes.find(b => k > b.left && k < b.right && r >= b.head && r <= b.bottom) ??
      roomBoxes.find(b => k >= b.left && k <= b.right && r >= b.head - 1 && r <= b.bottom + 1) ?? yard)
  // one flicker per cell, the first; none where a wall covers it in a tiny pane
  const flickering = new Set<number>()
  const frames = flickers
    .filter(f => !arms[f.at] && !flickering.has(f.at) && flickering.add(f.at))
    .map(f => ({ at: f.at, ms: f.ms, frames: f.frames.map(([ch, ink]): [number, number] => [letter(ch), hex(ink)]) }))
  return { columns, rows, base, flickers: frames, walkable, cellOf, boxOf, beds }
}

// A cell the walker may stand on at `now`; none out of sight.
export function cellAt(plan: Plan, w: Walker, now: number): [number, number] | undefined {
  const p = spotOf(w.t, now)
  if (!p) return undefined
  // the picture's point back on the floor plan
  const { ox, oy } = LAYOUT
  const [k, r] = plan.cellOf((p.x - ox) / 2 + (p.y - oy), p.y - oy - (p.x - ox) / 2)
  const ok = (dk: number, dr: number) => k + dk >= 0 && k + dk < plan.columns && plan.walkable[(r + dr) * plan.columns + k + dk] === 1
  const near = [[0, 0], [1, 0], [-1, 0], [0, -1], [0, 1], [1, 1], [-1, -1], [1, -1], [-1, 1]].find(([dk, dr]) => ok(dk ?? 0, dr ?? 0))
  return near ? [k + (near[0] ?? 0), r + (near[1] ?? 0)] : [k, r]
}

// A Clawd's place, feet at `cell`, in the room; its name's row below, else above, else none.
function spriteAt(plan: Plan, cell: [number, number]): { left: number; feet: number; name: number } {
  const [k, r] = cell
  const b = plan.boxOf(k, r)
  const feet = Math.max(b.top + 2, Math.min(b.bottom, r))
  const left = Math.max(b.left + 1, Math.min(b.right - CLAWD_W, k - 2))
  return { left, feet, name: feet + 1 <= b.bottom ? feet + 1 : feet - 3 > b.head ? feet - 3 : -1 }
}

// A name's columns, centred under its Clawd in the room, to one past its last; none if it cannot fit.
function nameSpan(plan: Plan, w: Walker, s: { left: number; feet: number; name: number }): [number, number] | undefined {
  if (s.name < 0) return undefined
  const length = lettersOf(displayName(w.c)).length
  const b = plan.boxOf(s.left + 4, s.feet)
  const start = Math.max(b.left + 1, Math.min(b.right - length, s.left + 4 - Math.floor(length / 2)))
  return start >= 0 && start + length <= plan.columns ? [start, start + length] : undefined
}

// The cells a Clawd and its name cover, feet at `cell`.
export function reachOf(plan: Plan, w: Walker, cell: [number, number]): [number, number, number, number] {
  const s = spriteAt(plan, cell)
  const span = nameSpan(plan, w, s)
  const row = span ? s.name : s.feet
  return [
    Math.max(0, Math.min(s.left, span?.[0] ?? s.left)), Math.max(0, Math.min(s.feet - 2, row)),
    Math.min(plan.columns, Math.max(s.left + CLAWD_W, span?.[1] ?? 0)), Math.min(plan.rows, Math.max(s.feet, row) + 1),
  ]
}

// The garden for rows a taller pane leaves above or below the plan; fixed per size.
const AUTUMN = ['#e2702a', '#cf3a2a', '#e8b23a', '#f0663e']
const FLOWERS = ['#e48aa6', '#b89ae6', '#f2cf5c', '#f4f2ec']

const gardens = new Map<string, string>()

// Garden rows packed for a Raster, once per size.
export function gardenRaster(columns: number, rows: number, side: 'above' | 'below'): string {
  const key = `${columns}x${rows}:${side}`
  const known = gardens.get(key)
  if (known !== undefined) return known
  if (gardens.size > 16) gardens.clear()
  const packed = packCells(gardenCells(columns, rows, side))
  gardens.set(key, packed)
  return packed
}

function gardenCells(columns: number, rows: number, side: 'above' | 'below'): Uint32Array {
  const cells = new Uint32Array(columns * rows * 3)
  let seed = (columns * 131 + rows * 7 + (side === 'above' ? 0 : 977)) >>> 0
  const r = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296
  const pick = <T,>(list: T[]) => list[Math.floor(r() * list.length)] as T
  const taken = new Set<number>()
  const set = (k: number, row: number, ch: string, ink: string, bg = C.grass) => {
    if (k < 0 || k >= columns || row < 0 || row >= rows || taken.has(row * columns + k)) return false
    cells.set([letter(ch), hex(ink), hex(bg)], (row * columns + k) * 3)
    return true
  }
  for (let row = 0; row < rows; row++) {
    for (let k = 0; k < columns; k++) {
      const [ch, ink] = grassAt(k, side === 'above' ? -1 - row : 1000 + row)
      set(k, row, ch, ink)
    }
  }
  const area = columns * rows
  // a pond, its far corners off
  const pond = (pw: number, ph: number) => {
    const pk = 1 + Math.floor(r() * Math.max(1, columns - pw - 2))
    const pr = Math.floor(r() * Math.max(1, rows - ph + 1))
    for (let dr = 0; dr < ph; dr++) {
      for (let dk = dr === ph - 1 && ph > 1 ? 1 : 0; dk < pw - (dr === ph - 1 && ph > 1 ? 1 : 0); dk++) {
        if (set(pk + dk, pr + dr, (pk + dk + pr) % 3 === 0 ? '~' : ' ', C.glass, '#16202e')) taken.add((pr + dr) * columns + pk + dk)
      }
    }
  }
  if (rows >= 4 && columns >= 16) for (let n = Math.max(1, Math.round(area / 1200)); n > 0; n--) pond(6 + Math.floor(r() * 4), 2)
  for (let n = Math.round(area / 400); n > 0; n--) pond(3 + Math.floor(r() * 3), 1)
  // a tree, and its leaves round it
  const plant = (k: number, row: number, isPine: boolean, ink: string) => {
    if (!set(k, row, isPine ? '▲' : '♣', ink)) return
    taken.add(row * columns + k)
    if (!isPine) for (let m = Math.floor(r() * 2); m > 0; m--) set(k + pick([-2, -1, 1, 2]), row + pick([0, 0, 1]), pick(['·', ',']), ink)
  }
  // copses of two to four, pines or one autumn colour
  for (let n = Math.round(area / 90); n > 0; n--) {
    const [k, row] = [Math.floor(r() * columns), Math.floor(r() * rows)]
    const isPine = r() < 0.3
    const ink = isPine ? C.tree : pick(AUTUMN)
    for (let m = 2 + Math.floor(r() * 3); m > 0; m--) plant(k + Math.round((r() - 0.5) * 7), row + Math.round((r() - 0.5) * 3), isPine, ink)
  }
  for (let n = Math.round(area / 115); n > 0; n--) {
    const isPine = r() < 0.3
    plant(Math.floor(r() * columns), Math.floor(r() * rows), isPine, isPine ? C.tree : pick(AUTUMN))
  }
  // flowers in twos and threes
  for (let n = Math.round(area / 40); n > 0; n--) {
    const k = Math.floor(r() * columns)
    const row = Math.floor(r() * rows)
    const ink = pick(FLOWERS)
    for (let m = 2 + Math.floor(r() * 2), dk = 0; m > 0; m--, dk += 1 + Math.floor(r() * 2)) set(k + dk, row + (m % 2), pick(['*', '✽', '·']), ink)
  }
  // leaves blown about the lawn
  for (let n = Math.round(area / 34); n > 0; n--) set(Math.floor(r() * columns), Math.floor(r() * rows), pick(['·', ',', '`']), pick(AUTUMN))
  return cells
}

// The plan at `now`: codepoint, ink and paper per cell, row by row.
export function planCells(plan: Plan, walkers: Walker[], now: number): Uint32Array {
  const out = plan.base.slice()
  const { columns } = plan
  for (const f of plan.flickers) {
    const [ch, ink] = f.frames[Math.floor(now / f.ms) % f.frames.length] ?? [0x20, 0]
    out[f.at * 3] = ch
    out[f.at * 3 + 1] = ink
  }
  const taken = new Uint8Array(columns * plan.rows)
  const put = (k: number, r: number, ch: string, ink: string, isWord = false) => {
    const i = r * columns + k
    if (k < 0 || k >= columns || r < 0 || r >= plan.rows || (isWord && taken[i])) return false
    taken[i] = 1
    out[i * 3] = letter(ch)
    out[i * 3 + 1] = hex(ink)
    return true
  }
  // the Clawds first, nearest the front last, so a word never hides one
  const placed = walkers
    .map(w => ({ w, cell: cellAt(plan, w, now), before: cellAt(plan, w, now - 250) }))
    .filter((p): p is typeof p & { cell: [number, number] } => p.cell !== undefined)
    .sort((a, b) => a.cell[1] - b.cell[1])
    .map(p => ({ ...p, s: spriteAt(plan, p.cell) }))
  for (const { w, cell, before, s } of placed) {
    const isWalking = before !== undefined && (before[0] !== cell[0] || before[1] !== cell[1])
    const body = w.c.status === 'waiting' ? C.amber : bodyColor(w.c)
    const lines = [CLAWD[0] ?? '', CLAWD[1] ?? '', isWalking && Math.floor(now / (BEAT / 2)) % 2 ? STEPPING : CLAWD[2] ?? '']
    lines.forEach((line, j) => [...line].forEach((ch, i) => ch !== ' ' && put(s.left + i, s.feet - 2 + j, ch, body)))
    // a nap in a bed: z's rising
    if (!isWalking && plan.beds.some(([k, r]) => Math.abs(k - cell[0]) <= 3 && Math.abs(r - cell[1]) <= 2)) {
      put(s.left + CLAWD_W - 1, s.feet - 2 - (Math.floor(now / (2 * BEAT)) % 2), 'z', C.zz, true)
    }
    if (w.c.status === 'waiting' && Math.floor(now / BEAT) % 2) put(s.left + CLAWD_W - 1, s.feet - 2, '!', C.amber, true)
  }
  // the names, under their Clawds
  for (const { w, s } of placed) {
    const span = nameSpan(plan, w, s)
    if (!span) continue
    const [start] = span
    const name = lettersOf(displayName(w.c))
    if (name.some((_, i) => taken[s.name * columns + start + i])) continue
    name.forEach((ch, i) => put(start + i, s.name, ch, colorFor(w.c), true))
  }
  return out
}

// Cells as a Raster takes them: little-endian words in base64; on Claude Code's little-endian machines
// the bytes go as they are.
const LITTLE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1

export function packCells(cells: Uint32Array): string {
  let bytes = new Uint8Array(cells.buffer, cells.byteOffset, cells.byteLength)
  if (!LITTLE) {
    bytes = new Uint8Array(cells.length * 4)
    const view = new DataView(bytes.buffer)
    cells.forEach((w, i) => view.setUint32(i * 4, w, true))
  }
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64
  if (native) return native.call(bytes)
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x2000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x2000) as unknown as number[])
  return btoa(text)
}
