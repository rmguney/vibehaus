/*
 * The house in the terminal: its floor plan from above, in the terminal's own
 * cells, so it stays crisp in any pane. It is turned a quarter, so a docked
 * pane, taller than wide, fits it big: the three rooms that run across the
 * desktop's picture run down here, two columns of them, with the yard by the
 * front door at the side. Each room is a box with its name over it, its own
 * floor, and the furniture the picture has, drawn flat and plain: desks and
 * their screens, bookshelves, the fireplace, the fridge and stove, the
 * workbench, beds, the TV and the couch. Above it all, the plan's meters.
 * Each agent is a Clawd as Claude Code draws its own, its role under it in
 * its colour, walking from room to room as it does in the picture; fires,
 * screens and lights flicker frame by frame.
 */
import type { Resident, Room, Track } from '../types'
import { ALL_ROOMS, doorX, doorY, frontDoor, house, ROOM_STYLE } from './house'
import type { Cell } from './house'
import type { Meter } from './scene'
import { bodyColor, colorFor, displayName, spotOf } from './scene'
import { yardOf } from './yard'

// a cell colour that is the terminal's own
export const DEFAULT = 0x01000000
const L = house()
const YARD = yardOf(L)
const ROAD = YARD.road
// The floor plan turned: its depth runs across and its width down. `x` and
// `y` below are the plan's own, `X` and `Y` the turned ones.
const ACROSS = L.ph
const DOWN = L.pw
const YARD_DEPTH = ROAD.y1 - L.ph

// the picture's colours by night
const C = {
  wall: '#cbb397', glass: '#9cc4ff', grass: '#1d3324', tuft: '#3f6b45', tree: '#2f6b3a', path: '#4d4842', ink: '#a8b0bc',
  amber: '#f5c47a', track: '#3a3f47', woodDark: '#9a6740', wood: '#b8834f', pine: '#d6b07a', white: '#f4f2ec', stone: '#9ea3aa',
  dark: '#24282e', brick: '#b5644f', brass: '#d8b25a', leaf: '#5fae62', linen: '#fbf9f4', blue: '#6f8fd6', green: '#79b89a',
  armchair: '#5d8f76', couch: '#c77fae', couchBack: '#a8618f', shade: '#f5dca0', red: '#d9584c', parcel: '#c9965a',
  mail: '#d0782e', zz: '#cfd8ff', steam: '#c9cdd3',
}
const BOOKS = ['#c75a5a', '#5a86c7', '#c7ad5a', '#5ac79a', '#9a5ac7', '#c7865a']
const RUGS: Partial<Record<Room, [string, string]>> = { library: ['#b85c5c', '#d07a7a'], lounge: ['#d9a9c9', '#e8bfd8'] }
const FIRE = ['#f5a623', '#ffd166', '#f26b3a']
const TV = ['#5ad0ff', '#ff6ad5', '#ffd34a', '#7df08a']
const LAMP = { working: '#4cf08c', waiting: '#f5ac45', failed: '#f2503f' }

// A Clawd as Claude Code draws its own, nine cells wide and three tall: a
// body with two eyes, its arms, its four legs, stepping while it walks.
const CLAWD = [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  ']
const STEPPING = '  ▝▝ ▘▘  '
const CLAWD_W = 9

// box drawing by a line's arms: up 1, right 2, down 4, left 8
const LINES = ' ╵╶└╷│┌├╴┘─┴┐┤┬┼'

// A letter a terminal draws one cell wide, which is all a Raster takes: the
// Latin ones, common punctuation, box drawing, blocks, a few shapes and the
// spinner's stars; anything else is drawn as a question mark.
const NARROW = /^[\x20-\x7e\u00a0-\u024f\u2010-\u2027\u2261\u2500-\u25a1\u25ac\u25b2\u25cb\u25cf\u2663\u29d7\u2722\u2736\u273b\u273d]$/
export const letter = (ch: string) => (NARROW.test(ch) ? ch.codePointAt(0) ?? 63 : 63)

export const hex = (c: string) => parseInt(c.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
// a colour taken toward black, for a floor that what stands on it reads on
const dim = (c: string, f: number) => {
  const n = hex(c)
  return (Math.round(((n >> 16) & 255) * f) << 16) | (Math.round(((n >> 8) & 255) * f) << 8) | Math.round((n & 255) * f)
}
const dimmed = (c: string, f: number) => `#${dim(c, f).toString(16).padStart(6, '0')}`

// One agent as the plan draws it: who, and its walk.
export type Walker = { c: Resident; t: Track }

// Something that changes frame by frame: a cell, and the glyphs and inks it
// takes turns in, a turn every `ms`.
type Flicker = { at: number; frames: [string, string][]; ms: number }

// A room's box in cells: the row its name is on, its floor's rows under it,
// its columns between its walls.
type Box = { head: number; top: number; bottom: number; left: number; right: number }

// The plan for a pane: its size; the cells that stay (walls, floors, the
// furniture, names, the yard, the meters) and the ones that flicker; which
// cells an agent may stand on; where a point of the floor plan falls; the
// box around a cell; the beds, for the agents napping in them.
export type Plan = {
  columns: number; rows: number
  base: Uint32Array; flickers: Flicker[]; walkable: Uint8Array
  cellOf: (x: number, y: number) => [number, number]
  boxOf: (col: number, row: number) => Box
  beds: [number, number][]
}

// How big the plan is in a pane `columns` wide and `bodyRows` tall: two
// rooms across with the yard beside them, three down, the meters over them;
// each room as tall as the pane allows up to about square, the list keeping
// a fifth of the pane under it, five rows at least. A room is never smaller
// than a Clawd needs, so a very short pane gives the list less, or none.
export function planSize(columns: number, bodyRows: number): { columns: number; across: number; down: number; rows: number } {
  const yard = Math.max(6, Math.min(18, Math.round(columns * 0.2)))
  const across = Math.max(CLAWD_W + 2, Math.floor((columns - yard - 1) / 2))
  const free = bodyRows - Math.max(5, Math.ceil(bodyRows / 5)) - 1
  const down = Math.max(5, Math.min(Math.round(across / 1.8), Math.floor((free - 1) / 3)))
  return { columns: 2 * across + 1 + yard, across, down, rows: 3 * down + 2 }
}

// What a desk's screen shows by the tool at it: code, a terminal, the web,
// files, or notes.
function screenOf(tool: string | undefined): string {
  if (!tool) return C.dark
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return '#5ad0ff'
  if (/^(Bash|PowerShell|Monitor|BashOutput)$/.test(tool)) return '#4cf08c'
  if (/^(WebFetch|WebSearch)$/.test(tool) || tool.startsWith('mcp__')) return '#52d2f5'
  if (/^(Read|Grep|Glob|LSP)$/.test(tool)) return '#e6c35c'
  return '#f4f1e8'
}

// The plan `columns` wide, its rooms `across` cells wide and `down` tall,
// walls included.
export function planOf(columns: number, across: number, down: number, meters: Meter[], boxes: number, residents: Resident[]): Plan {
  const top = 1
  const rows = top + 3 * down + 1
  const houseRight = 2 * across
  const yardCols = columns - houseRight - 1
  const base = new Uint32Array(columns * rows * 3)
  const walkable = new Uint8Array(columns * rows)
  const flickers: Flicker[] = []
  const at = (k: number, r: number) => r * columns + k
  const inside = (k: number, r: number) => k >= 0 && k < columns && r >= 0 && r < rows
  // a cell: its glyph and ink, and its paper when given (else the paper there)
  const set = (k: number, r: number, ch: string, ink: string | number, paper?: string | number) => {
    if (!inside(k, r)) return
    const i = at(k, r) * 3
    base[i] = letter(ch)
    base[i + 1] = typeof ink === 'number' ? ink : hex(ink)
    if (paper !== undefined) base[i + 2] = typeof paper === 'number' ? paper : hex(paper)
  }
  const write = (k: number, r: number, text: string, ink: string) => [...text].forEach((ch, i) => set(k + i, r, ch, ink))
  for (let i = 0; i < base.length; i += 3) base.set([0x20, DEFAULT, DEFAULT], i)

  // The turned plan's units to cells, the walls on whole cells: across, the
  // house's walls at the edges and the middle and the yard past it; down,
  // each room's first row its name, its floor under it.
  const colOf = (X: number) => (X <= ACROSS
    ? Math.max(0, Math.min(houseRight, Math.round(((X - 1) / (ACROSS - 2)) * houseRight)))
    : houseRight + Math.min(yardCols, Math.ceil(((X - ACROSS) / YARD_DEPTH) * yardCols)))
  const wallRow = (Y: number) => top + Math.max(0, Math.min(3 * down, Math.round(((Y - 1) / (DOWN - 2)) * 3 * down)))
  const rooms = Object.values(L.rooms)
  const boxOfRoom = (c: Cell): Box => {
    const head = wallRow(c.x - 1) + 1
    return { head, top: head + 1, bottom: wallRow(c.x + c.w + 1) - 1, left: colOf(c.y - 1), right: colOf(c.y + c.h + 1) }
  }
  const rowOf = (X: number, Y: number) => {
    const c = X <= ACROSS ? rooms.find(r => Y >= r.x && Y <= r.x + r.w) : undefined
    if (!c) return wallRow(Y)
    const b = boxOfRoom(c)
    return Math.min(b.bottom, b.top + Math.floor(((Y - c.x) / c.w) * (b.bottom - b.top + 1)))
  }
  const cellOf = (x: number, y: number): [number, number] => [colOf(y), rowOf(y, x)]
  // a rect of the floor plan as cells, at least one
  const fill = (x0: number, y0: number, x1: number, y1: number, paint: (k: number, r: number, i: number, j: number) => void) => {
    const [a, b] = [cellOf(x0 + 0.5, y0 + 0.5), cellOf(x1 - 0.5, y1 - 0.5)]
    const [k0, k1, r0, r1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])]
    for (let r = r0; r <= r1; r++) for (let k = k0; k <= k1; k++) paint(k, r, k - k0, r - r0)
  }

  // floors: planks in rows, tiles in a checker, carpet plain; over each, a
  // strip of its wallpaper with its name and what is being done there
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
      const doing = [...(busy.status === 'waiting' ? `wants ${busy.waitingTool ?? 'you'}` : busy.activity)]
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

  // The furniture, a little of each piece, placed on the plan as the
  // picture places it: so it stands against the walls it stands against
  // there, turned with the rest.
  const piece = (room: Room, x0: number, y0: number, x1: number, y1: number, paint: (k: number, r: number, i: number, j: number) => void) =>
    fill(R[room].x + x0, R[room].y + y0, R[room].x + x1, R[room].y + y1, paint)
  // a small thing: one cell, whatever the size of the pane
  const spot = (room: Room, x: number, y: number, ch: string, ink: string, paper?: string, frames?: [string, string][], ms = 500) => {
    const [k, r] = cellOf(R[room].x + x, R[room].y + y)
    set(k, r, ch, ink, paper)
    if (frames) flickers.push({ at: at(k, r), frames, ms })
  }
  // desks along the back wall of each work room, their screens lit by
  // whoever works there, in what that work looks like, a light by each
  for (const name of ALL_ROOMS) {
    if (name === 'lounge') continue
    for (let d = 0; d < 2; d++) {
      const sitter = residents.find(c => c.room === name && c.seat === d && (c.status === 'working' || c.status === 'waiting') && c.leaving === undefined)
      const lit = sitter ? screenOf(sitter.tool) : C.dark
      const x0 = 2 + 14 * d
      piece(name, x0, 1, x0 + 12, 7, (k, r, i, j) => {
        const isScreen = i === 0 && j > 0 && j < 3
        set(k, r, isScreen ? '▌' : ' ', lit, name === 'kitchen' ? C.stone : C.wood)
        if (isScreen && sitter) flickers.push({ at: at(k, r), frames: [['▌', lit], ['▌', lit], ['▌', dimmed(lit, 0.6)]], ms: 300 + j * 70 })
      })
      if (sitter) {
        const light = sitter.status === 'waiting' ? LAMP.waiting : sitter.isOk === false ? LAMP.failed : LAMP.working
        spot(name, x0 + 11, 4, '•', light, name === 'kitchen' ? C.stone : C.wood, [['•', light], ['•', C.woodDark]], 650)
      }
    }
  }
  // the library: shelves of books along the wall, a reading lamp
  piece('library', 0, 9, 5, 27, (k, r, i, j) => set(k, r, '▄', BOOKS[(i * 2 + j) % BOOKS.length] ?? C.red, BOOKS[(i * 2 + j + 3) % BOOKS.length] ?? C.blue))
  spot('library', 33.5, 3.5, '●', C.shade)
  // the study: the fireplace and its fire, an armchair, a plant and a lamp
  piece('study', 29, 1, 39, 6, (k, r) => set(k, r, '▐', C.dark, C.brick))
  for (const x of [32.5, 35.5]) spot('study', x, 4, '▲', FIRE[0] ?? C.red, C.dark, FIRE.map((f, n) => ['▲', FIRE[(n + Math.round(x)) % FIRE.length] ?? f]), 180)
  piece('study', 1, 16, 8, 23, (k, r, _, j) => set(k, r, j === 0 ? '▀' : ' ', C.armchair, C.green))
  spot('study', 3.5, 10.5, '♣', C.leaf)
  spot('study', 1.5, 26.5, '●', C.shade)
  // the sunroom: the telescope at the window, the radio and its light, a plant
  spot('sunroom', 6, 14, '╲', C.brass)
  spot('sunroom', 3.5, 21.5, '■', C.dark, C.wood)
  spot('sunroom', 3.5, 24, '•', LAMP.working, C.wood, [['•', LAMP.working], ['•', '#1f5f3a']], 700)
  spot('sunroom', 35.5, 4.5, '♣', C.leaf)
  // the kitchen: the fridge, the counter with the stove, a pot steaming on
  // it, and the coffee machine
  piece('kitchen', 0, 8, 6, 15, (k, r, _, j) => set(k, r, j === 0 ? '▀' : ' ', C.stone, C.white))
  piece('kitchen', 0, 15, 6, 27, (k, r) => set(k, r, ' ', DEFAULT, C.stone))
  spot('kitchen', 2.5, 17.5, '●', C.red, C.stone, [['●', C.red], ['●', C.red], ['~', C.steam]], 450)
  spot('kitchen', 2.5, 21, '○', C.dark, C.stone)
  spot('kitchen', 2.5, 24.5, '■', C.dark, C.stone, [['■', C.dark], ['■', C.red]], 1000)
  // the workshop: the workbench, a toolbox, a vise and a level on it, a plant
  piece('workshop', 0, 9, 7, 24, (k, r) => set(k, r, ' ', DEFAULT, C.pine))
  spot('workshop', 2.5, 12, '▬', C.red, C.pine)
  spot('workshop', 2.5, 18, '≡', C.dark, C.pine)
  spot('workshop', 4.5, 21.5, '▬', C.brass, C.pine)
  spot('workshop', 36.5, 36.5, '♣', C.leaf)
  // the lounge: two beds, their pillows by the wall, the TV and the couch
  // facing it, a plant
  for (let b = 0; b < 2; b++) {
    piece('lounge', 0, 1 + 11 * b, 15, 10 + 11 * b, (k, r, _, j) => set(k, r, j === 0 ? ' ' : '▄', b === 0 ? C.blue : C.green, j === 0 ? C.linen : b === 0 ? C.blue : C.green))
  }
  piece('lounge', 18, 0, 28, 4, (k, r, i) => {
    set(k, r, '▌', C.dark, C.wood)
    if (i === 0) flickers.push({ at: at(k, r), frames: TV.map(c => ['▌', c] as [string, string]), ms: 800 })
  })
  piece('lounge', 17, 13, 30, 18, (k, r, i) => set(k, r, i === 0 ? ' ' : '▐', C.couchBack, C.couch))
  spot('lounge', 36.5, 36.5, '♣', C.leaf)
  const beds: [number, number][] = [[8, 5.5], [8, 16.5]].map(([x, y]) => cellOf(R.lounge.x + (x ?? 0), R.lounge.y + (y ?? 0)))

  // The walls: every edge of every room, but its doorways, windows in the
  // outer walls.
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
  const walls = [top, top + down, top + 2 * down, top + 3 * down]
  for (const k of [0, across, houseRight]) line(k, top, k, top + 3 * down)
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
    // a doorway to the room that was beside it, now under it; and to the
    // one that was under it, now beside it
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
    if (c.x < 10) for (let k = b.left + 3; k < b.right - 3; k++) glass.add(at(k, top))
    if (c.x > L.pw - 50) for (let k = b.left + 3; k < b.right - 3; k++) glass.add(at(k, top + 3 * down))
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

  // The yard by the front door: a lawn with a tuft here and a tree there,
  // the road from the door to the street, the day's boxes stacked by it, the
  // mailbox at its end.
  const [roadTop, roadBottom] = [cellOf(ROAD.x0 + 1, L.ph + 1)[1], cellOf(ROAD.x1 - 1, L.ph + 1)[1]]
  for (let r = top; r < rows; r++) {
    for (let k = houseRight + 1; k < columns; k++) {
      const isRoad = r >= roadTop && r <= roadBottom
      const tuft = !isRoad && (k * 7 + r * 13) % 11 === 0
      set(k, r, tuft ? '"' : ' ', C.tuft, isRoad ? C.path : C.grass)
      walkable[at(k, r)] = 1
    }
  }
  for (const [x, y] of [[20, 100], [110, 120], [40, 128], [100, 105]] as [number, number][]) {
    const [k, r] = cellOf(x, y)
    if (r < roadTop - 1 || r > roadBottom + 1) set(k, r, '♣', C.tree)
  }
  const stack = `${'■'.repeat(Math.min(3, Math.max(0, boxes)))} ${boxes}`
  write(houseRight + 2, Math.max(top, roadTop - 2), stack, C.parcel)
  set(columns - 2, Math.max(top, roadTop - 1), '▐', C.mail)

  // the meters along the top: a label, a bar, how much is used
  let mk = 0
  for (const m of meters) {
    const p = m.percent
    const filled = p === undefined ? 0 : Math.round((Math.min(100, p) / 100) * 6)
    write(mk, 0, `${m.label} `, m.color)
    mk += m.label.length + 1
    for (let s = 0; s < 6; s++) set(mk + s, 0, '━', s < filled ? m.color : C.track)
    mk += 6
    const used = ` ${p === undefined ? '--' : `${Math.round(p)}%`}  `
    write(mk, 0, used, C.ink)
    mk += used.length
  }

  const boxOf = (k: number, r: number): Box => {
    const c = rooms.find(c => {
      const b = boxOfRoom(c)
      return k > b.left && k < b.right && r >= b.head && r <= b.bottom
    })
    return c ? boxOfRoom(c) : { head: top, top: top + 1, bottom: rows - 1, left: houseRight, right: columns }
  }
  return { columns, rows, base, flickers, walkable, cellOf, boxOf, beds }
}

// Where a walker stands in the plan at `now`, on a cell it may stand on;
// none while out of sight.
export function cellAt(plan: Plan, w: Walker, now: number): [number, number] | undefined {
  const p = spotOf(w.t, now)
  if (!p) return undefined
  // the picture's point back on the floor plan
  const [k, r] = plan.cellOf((p.x - L.ox) / 2 + (p.y - L.oy), p.y - L.oy - (p.x - L.ox) / 2)
  const ok = (dk: number, dr: number) => plan.walkable[(r + dr) * plan.columns + k + dk] === 1
  const near = [[0, 0], [1, 0], [-1, 0], [0, -1], [0, 1], [1, 1], [-1, -1], [1, -1], [-1, 1]].find(([dk, dr]) => ok(dk ?? 0, dr ?? 0))
  return near ? [k + (near[0] ?? 0), r + (near[1] ?? 0)] : [k, r]
}

// Where a walker's Clawd goes for its feet at `cell`: inside the room, its
// name under it, or over it where the room ends, or none in a room too small.
function spriteAt(plan: Plan, cell: [number, number]): { left: number; feet: number; name: number } {
  const [k, r] = cell
  const b = plan.boxOf(k, r)
  const feet = Math.max(b.top + 2, Math.min(b.bottom, r))
  const left = Math.max(b.left + 1, Math.min(b.right - CLAWD_W, k - 2))
  return { left, feet, name: feet + 1 <= b.bottom ? feet + 1 : feet - 3 > b.head ? feet - 3 : -1 }
}

// The cells a walker's Clawd and its name take, its feet at `cell`.
export function reachOf(plan: Plan, w: Walker, cell: [number, number]): [number, number, number, number] {
  const s = spriteAt(plan, cell)
  const name = displayName(w.c).length
  const mid = s.left + 4
  const row = s.name < 0 ? s.feet : s.name
  return [Math.min(s.left, mid - Math.floor(name / 2)), Math.min(s.feet - 2, row), Math.max(s.left + CLAWD_W, mid - Math.floor(name / 2) + name), Math.max(s.feet, row) + 1]
}

// The plan at `now`, as cells: codepoint, ink and paper each, row by row.
export function planCells(plan: Plan, walkers: Walker[], now: number): Uint32Array {
  const out = plan.base.slice()
  const { columns } = plan
  for (const f of plan.flickers) {
    const [ch, ink] = f.frames[Math.floor(now / f.ms) % f.frames.length] ?? [' ', '#000000']
    out[f.at * 3] = letter(ch)
    out[f.at * 3 + 1] = hex(ink)
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
  for (const { w, cell, before } of placed) {
    const s = spriteAt(plan, cell)
    const isWalking = before !== undefined && (before[0] !== cell[0] || before[1] !== cell[1])
    const body = w.c.status === 'waiting' ? C.amber : bodyColor(w.c)
    const lines = [CLAWD[0] ?? '', CLAWD[1] ?? '', isWalking && Math.floor(now / 250) % 2 ? STEPPING : CLAWD[2] ?? '']
    lines.forEach((line, j) => [...line].forEach((ch, i) => ch !== ' ' && put(s.left + i, s.feet - 2 + j, ch, body)))
    // a nap in a bed: z's rising
    if (!isWalking && plan.beds.some(([k, r]) => Math.abs(k - cell[0]) <= 3 && Math.abs(r - cell[1]) <= 2)) {
      put(s.left + CLAWD_W - 1, s.feet - 2 - (Math.floor(now / 700) % 2), 'z', C.zz, true)
    }
    if (w.c.status === 'waiting' && Math.floor(now / 500) % 2) put(s.left + CLAWD_W - 1, s.feet - 2, '!', C.amber, true)
  }
  // each name under its Clawd, centred, in its colour
  for (const { w, cell } of placed) {
    const s = spriteAt(plan, cell)
    if (s.name < 0) continue
    const name = [...displayName(w.c)]
    const b = plan.boxOf(s.left + 4, s.feet)
    const start = Math.max(b.left + 1, Math.min(b.right - name.length, s.left + 4 - Math.floor(name.length / 2)))
    if (name.some((_, i) => taken[s.name * columns + start + i])) continue
    name.forEach((ch, i) => put(start + i, s.name, ch, colorFor(w.c), true))
  }
  return out
}

// Cells as a Raster takes them: little-endian words, base64.
export function packCells(cells: Uint32Array): string {
  const bytes = new Uint8Array(cells.length * 4)
  const view = new DataView(bytes.buffer)
  cells.forEach((w, i) => view.setUint32(i * 4, w, true))
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}
