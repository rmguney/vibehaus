/*
 * The house: six rooms seen from above at an angle, near walls cut down (see house.ts, furniture.ts).
 * Working agents type at the desk for their kind of work; idle ones drift through moods, use the
 * furniture and huddle up to talk in runes.
 *
 * Plans are made on the floor plan and projected into layered SVGs (garden, house, agents), animated
 * with SMIL timelines anchored to the clock so a redraw picks every agent up mid-stride.
 */
import type { Resident, Place, Room, Track } from '../types'
import { fitText, glyphText, pixelText, textWidth } from './font'
import { desk, deskAt, furniture, machine } from './furniture'
import { frontTrees, garden, gardenPatterns, lamps, treesBehind, weather } from './garden'
import { boxSpots, road, signAt, yardOf, yardPieces } from './yard'
import type { Parcel } from './yard'
import { ALL_ROOMS, at, doorX, doorY, floor, floorBottom, freeFloor, frontDoor, frontWalls, house, patterns, ROOM_STYLE, shell, stretch, T, TALL_WALL, windowOn } from './house'
import type { Cell, Dir, Layout } from './house'
import { Canvas, loopBegin, pathOf, rng, setClock, shade, styleOf } from './iso'
import type { Pt } from './iso'

// Seconds in every idle loop, shared so meetings and props line up.
const LOOP = 90
// Pixel text: each font pixel half an art pixel; an agent's name smaller.
const PX = 0.5
const NAME_PX = 0.375

const CLAUDE_ORANGE = '#d97757'

const ACC = { work: '#4cf08c', data: '#52d2f5', alert: '#f2503f' }
const MACHINE_GLOW: Record<Exclude<Room, 'lounge'>, string> = {
  library: '#e6c35c', sunroom: ACC.data, kitchen: ACC.work, workshop: '#e6c35c', study: ACC.work,
}
const PROP_FAIL = '#f25a5a'
const LAMP = { idle: '#f59a3a', working: '#4cf08c', waiting: '#f5ac45', failed: ACC.alert }
const PHOSPHOR = '#66f5a0'

type Span = [number, number]
type Run = { x: number; y: number; w: number; h: number; c: string }

// ---------- things agents say ----------

const LINES_UNWIND = ['five minutes', 'long day of tokens', 'this couch gets it', 'just resting my eyes']
const LINES_BORED = ['anyone need a hand?', 'high score time', 'one more game', 'beat that']
const LINES_STANDBY = ['ping me', 'ready', 'all yours', 'say the word']
const LINES_BROWSE = ['hm, interesting', 'never read this one', 'where was that file', 'good reference']
const LINES_LOOK = ['nice work', 'ooh', 'go on', 'that compiles?']
const LINES_FIRE = ['so toasty', 'crackle crackle', 'cozy', 'warming up']
const LINES_READ = ['one more chapter', 'plot twist!', 'good book', 'ahh, cozy']
const LINES_MAIL = ['no mail today', 'a postcard!', 'bills, bills', 'look at that stack']
const LINES_SHIP = ['shipped!', 'one more box', 'special delivery', 'stack it high']
const LINES_SNACK = ['just one bite', 'who ate my sandwich', 'midnight snack', 'mmm, leftovers']
const LINES_STARS = ['so many stars', 'is that a satellite?', 'clear skies', 'a comet!']
const LINES_RADIO = ['good song', 'turn it up', 'static again', 'this station rocks']
const LINES_TINKER = ['almost...', 'tap tap', 'needs a screw', 'there we go']
const LINES_TV = ['one more episode', 'no spoilers', 'plot twist!', 'cozy night in']
const LINES_COFFEE = ['decaf again?', 'smells like progress', 'refill', 'brew time']
const LINES_SLEEP = ['zzz', 'back soon', 'nap protocol', 'dreaming in json']
const LINES_ERROR = ['oops', 'that did not work', 'hmm, error', 'retrying…', 'ugh']
const LINES_WAVE = ['hi!', 'o/', 'hello!', 'hey you', 'hiya!']
const LINES_SPIN = ['wheee', 'whee!', 'so dizzy', 'again!']
const LINES_MOON = ['smooth', 'hee-hee', 'like butter', 'look ma']
const LINES_JUGGLE = ['look!', 'ta-da', 'watch this', 'no bugs dropped']
const LINES_SNEEZE = ['achoo!', 'ah-choo', 'bless me', 'dusty logs']
const LINES_STUMBLE = ['oof!', 'whoops', 'nobody saw that', 'who put that there']
const LINES_YAWN = ['*yawn*', 'so sleepy', 'mmh', 'is it friday']
const LINES_HOP = ['♪', 'yay!', 'tests pass!', 'woo']
const LINES_HIGHFIVE = ['yeah!', 'nice!', 'teamwork', 'up top!']
const LINES_DANCE = ['♪', '♪♪', 'groovy', 'dance break']
const LINES_WIN = ['ha!', 'again?', 'too easy', 'undefeated']
const LINES_LOSE = ['nooo', 'best of 3', 'rigged', 'rematch!']
const THROWS = ['rock!', 'paper!', 'scissors!']
const BEATS: Record<string, string> = { 'rock!': 'scissors!', 'paper!': 'rock!', 'scissors!': 'paper!' }

// ---------- helpers ----------

function hash(text: string): number {
  let n = 2166136261
  for (const ch of text) n = Math.imul(n ^ ch.charCodeAt(0), 16777619) >>> 0
  return n
}

const between = (r: () => number, a: number, b: number) => a + r() * (b - a)
const pick = <T>(list: readonly T[], r: () => number): T => list[Math.floor(r() * list.length) % list.length] as T
const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const k4 = (n: number) => n.toFixed(4)

// By code points, so an emoji is never split.
export function clip(text: string, max: number): string {
  const chars = [...text]
  return chars.length > max ? chars.slice(0, Math.max(1, max - 1)).join('') + '…' : text
}

// Own entries only: an agent type named like one of an object's built-in keys is a name like any other.
export const own = <T>(table: Record<string, T>, key: string): T | undefined =>
  (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined)

function rect(r: Run, extra = ''): string {
  return `<rect x="${r1(r.x)}" y="${r1(r.y)}" width="${r.w}" height="${r.h}" fill="${r.c}"${extra}/>`
}

function blinkAnim(attr: string, on: string, off: string, periodMs: number): string {
  const dur = periodMs / 1000
  return `<animate attributeName="${attr}" values="${on};${off}" keyTimes="0;0.5" calcMode="discrete" dur="${dur}s" ${loopBegin(dur)} repeatCount="indefinite"/>`
}

// The on (1) and off (0) steps of `spans` in a timeline `total` seconds long.
type Step = { t: number; v: number }
function stepsOf(spans: Span[], total: number): Step[] {
  const merged = spans
    .map(([a, b]) => [Math.max(0, a), Math.min(total, b)] as Span)
    .filter(([a, b]) => b > a)
    .sort((p, q) => p[0] - q[0])
  if (merged.length === 0) return [{ t: 0, v: 0 }]
  const points: Step[] = [{ t: 0, v: (merged[0] as Span)[0] <= 0 ? 1 : 0 }]
  for (const [a, b] of merged) {
    if (a > 0) points.push({ t: a, v: 1 })
    if (b < total) points.push({ t: b, v: 0 })
  }
  const clean: Step[] = []
  for (const p of points) {
    const last = clean[clean.length - 1]
    if (last && p.t / total - last.t / total < 0.0002) { last.v = p.v; continue }
    if (last && last.v === p.v) continue
    clean.push({ ...p })
  }
  return clean
}

function stepAnim(attr: string, values: string[], steps: Step[], total: number, begin: number, isLoop: boolean): string {
  const repeat = isLoop ? 'repeatCount="indefinite"' : 'fill="freeze"'
  return `${attr} values="${values.join(';')}" keyTimes="${steps.map(p => k4(p.t / total)).join(';')}" calcMode="discrete" dur="${r2(Math.max(0.1, total))}s" begin="-${r2(begin)}s" ${repeat}/>`
}

// A discrete 0/1 opacity track, on inside `spans`, looping or held at its end.
function track(spans: Span[], total: number, begin: number, isLoop: boolean): { attr: string; anim: string } {
  const steps = stepsOf(spans, total)
  const attr = ` opacity="${steps[0]?.v ?? 0}"`
  if (steps.length === 1) return { attr, anim: '' }
  return { attr, anim: stepAnim('<animate attributeName="opacity"', steps.map(p => String(p.v)), steps, total, begin, isLoop) }
}

function group(content: string, t: { attr: string; anim: string }): string {
  if (t.attr === ' opacity="0"' && !t.anim) return ''
  return `<g${t.attr}>${t.anim}${content}</g>`
}

// ---------- pixel art ----------

const JUGGLE = ['#f2503f', '#52d2f5', '#ffd166']

const KIND_COLOR: Record<string, string> = {
  main: '#ffd166',
  Explore: '#5ad0ff',
  Plan: '#e0a0ff',
  'general-purpose': '#7df08a',
  shell: '#5affd0',
  monitor: '#ff8a5a',
  workflow: '#ff6a9a',
}
const OTHER_COLORS = ['#5cc8f5', '#f58c5c', '#80e88c', '#d9a3f5', '#f5d05c', '#5cf5cc', '#f5709c']

export function colorFor(c: Resident): string {
  return teamOf(c.session ?? '') ?? own(KIND_COLOR, c.kind) ?? OTHER_COLORS[hash(c.kind) % OTHER_COLORS.length] ?? '#5cc8f5'
}

// A session's colour; none while it is alone in the house.
const teamOf = (session: string): string | undefined => hues.get(session)

// With several sessions, each colours its names, rings and tape; alone, names keep their kind's colour.
const SESSION_COLORS = ['#ffd166', '#5ad0ff', '#f56fcf', '#7df08a', '#7b8cff', '#c9a0ff', '#5affd0', '#e4e6f0']
let hues = new Map<string, string>()

// `sessions` oldest first, this one as '' (`self`), so every house picks the same colours.
export function paintSessions(sessions: string[], self: string): void {
  hues = new Map()
  if (sessions.length < 2) return
  const taken = new Set<number>()
  for (const id of sessions) {
    let k = hash('session:' + (id || self)) % SESSION_COLORS.length
    while (taken.has(k) && taken.size < SESSION_COLORS.length) k = (k + 1) % SESSION_COLORS.length
    taken.add(k)
    hues.set(id, SESSION_COLORS[k] ?? '#ffd166')
  }
}

// Members saved before `taskType` existed are told apart by their name.
export function taskTypeOf(c: Resident): string {
  if (c.taskType) return c.taskType
  return c.isBackground && c.name.startsWith('Background ') ? c.kind : 'subagent'
}

// Everyone goes by a one-word role, homely and a little silly; background work goes by its chore.
const BUILT_IN_ROLES: Record<string, string> = {
  Explore: 'Snoop',
  Plan: 'Schemer',
  'general-purpose': 'Handyman',
  'claude-code-guide': 'Granny',
  'statusline-setup': 'Plumber',
}
const ROLE_HINTS: [RegExp, string][] = [
  [/review|critic|audit|lint/i, 'Inspector'],
  [/test|qa\b|verif/i, 'Taster'],
  [/secur|vuln|pentest/i, 'Watchdog'],
  [/fix|debug|bug|repair/i, 'Mouser'],
  [/(^|[-_ ])ui([-_ ]|$)|front|design|css|style/i, 'Decorator'],
  [/setup|config|deploy|infra|ops|install|(^|[-_ ])ci([-_ ]|$)/i, 'Plumber'],
  [/data|sql|(^|[-_ ])db([-_ ]|$)|analy|metric/i, 'Bookkeeper'],
  [/doc|write|readme|scribe|copy/i, 'Scribbler'],
  [/guide|help|question|oracle/i, 'Granny'],
  [/explor|research|search|find|scout/i, 'Snoop'],
  [/plan|architect|strateg/i, 'Schemer'],
  [/build|implement|code|dev|engineer/i, 'Tinkerer'],
]
const WORK_ROLES: Record<string, string> = { shell: 'Cook', monitor: 'Neighbor', workflow: 'Butler' }

export function displayName(c: Resident): string {
  if (c.kind === 'main') return 'Host'
  const type = taskTypeOf(c)
  if (type !== 'subagent') return own(WORK_ROLES, type) ?? 'Gremlin'
  return own(BUILT_IN_ROLES, c.kind) ?? ROLE_HINTS.find(([hint]) => hint.test(c.kind))?.[1] ?? 'Handyman'
}

export function bodyColor(c: Resident): string {
  return c.status === 'done' ? '#7a7a88' : CLAUDE_ORANGE
}

// ---------- glyph chatter ----------

// A made-up script: each glyph is a few strokes on a 3x4 grid.
const GLYPHS: number[][][] = [
  [[0, 0, 3, 0], [1.5, 0, 1.5, 4]],
  [[0, 4, 1.5, 0], [1.5, 0, 3, 4]],
  [[0, 0, 0, 4], [0, 4, 3, 4]],
  [[0, 2, 3, 2], [3, 0, 3, 4]],
  [[0, 0, 3, 4], [0, 4, 3, 0]],
  [[0, 1, 3, 1], [0, 3, 3, 3]],
  [[1.5, 0, 1.5, 4], [0, 2, 1.5, 0]],
  [[0, 0, 3, 0], [3, 0, 0, 4], [0, 4, 3, 4]],
  [[0, 4, 0, 1], [0, 1, 3, 1], [3, 1, 3, 4]],
  [[0, 0, 3, 2], [3, 2, 0, 4]],
  [[1.5, 0, 1.5, 1], [1.5, 3, 1.5, 4], [0, 2, 3, 2]],
  [[0, 0, 0, 4], [3, 0, 3, 4], [0, 0, 3, 0]],
  [[0, 4, 3, 0], [0, 1, 1, 0]],
  [[0, 0, 1.5, 2], [3, 0, 1.5, 2], [1.5, 2, 1.5, 4]],
]

// Each agent favours its own handful of glyphs, so it has an accent.
function accentOf(seed: number): number[] {
  const r = rng(seed ^ 0xa5a5a5a5)
  const mine = GLYPHS.map((_, i) => i).filter(() => r() < 0.5)
  return mine.length >= 4 ? mine : [0, 3, 6, 9]
}

function chatterLine(seed: number, accent: number[]): number[][] {
  const r = rng(seed)
  return Array.from({ length: r() < 0.55 ? 1 : 2 }, () =>
    Array.from({ length: r() < 0.5 ? 2 : 3 }, () => accent[Math.floor(r() * accent.length)] ?? 0))
}

function runeBubble(phrase: number[][]): string {
  let x = 0
  let d = ''
  for (const word of phrase) {
    for (const glyph of word) {
      for (const [x1, y1, x2, y2] of GLYPHS[glyph] ?? []) d += `M${r1(x + (x1 ?? 0))} ${y1 ?? 0}L${r1(x + (x2 ?? 0))} ${y2 ?? 0}`
      x += 4.2
    }
    x += 2
  }
  const w = Math.max(6, x - 1.6)
  return `<g transform="translate(${r1(-w / 2)} -24)"><rect x="-2" y="-2" width="${r1(w + 4)}" height="8" fill="#f4f1e8"/><rect x="${r1(w / 2 - 1)}" y="6" width="2" height="2" fill="#f4f1e8"/>` +
    `<path d="${d}" stroke="#2b261f" stroke-width="0.7" fill="none" stroke-linecap="square"/></g>`
}

// Speech bubble text width; every line an agent says fits.
const BUBBLE = 56

function textBubble(text: string, color = '#1a1a1a'): string {
  const fill = '#f4f1e8'
  const t = fitText(text, BUBBLE, PX)
  const w = r1(textWidth(t, PX) + 4)
  return `<g transform="translate(${r1(-w / 2)} -25)"><rect x="0" y="0" width="${w}" height="6" fill="${fill}"/><rect x="${r1(w / 2 - 1)}" y="6" width="2" height="2" fill="${fill}"/>` +
    `${agentText(t, 2, 1.2, { color })}</g>`
}

// ---------- layout and routes ----------

// One layout for every picture: the house amid 440 units of garden above and below; a pane shows what fits.
export const LAYOUT = stretch(house(), 440)

const heading = (dx: number, dy: number): Dir => (Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N'))
const BACK = { E: 'W', W: 'E', N: 'S', S: 'N' } as const

function cellAt(L: Layout, col: number, row: number): Cell {
  return L.rooms[L.grid[row]?.[col] ?? 'lounge']
}

// Through the doorways, row then column, the yard by the front door; `lane` lets two walkers pass abreast.
function route(L: Layout, fromPlace: Place, from: Pt, toPlace: Place, to: Pt, lane = 0): Pt[] {
  if (fromPlace === 'yard' || toPlace === 'yard') {
    if (fromPlace === toPlace) return [from, to]
    const d = frontDoor(L)
    const inside = { x: d.mid + lane, y: L.ph - T - 10 }
    const outside = { x: d.mid + lane, y: L.ph + 6 }
    return toPlace === 'yard'
      ? [...route(L, fromPlace, from, 'workshop', inside, lane), outside, to]
      : [from, outside, ...route(L, 'workshop', inside, toPlace, to, lane)]
  }
  const pts: Pt[] = [from]
  let { col, row } = L.rooms[fromPlace]
  const target = L.rooms[toPlace]
  while (col !== target.col) {
    const step = target.col > col ? 1 : -1
    const cur = cellAt(L, col, row)
    const left = step > 0 ? cur : cellAt(L, col - 1, row)
    const edge = left.x + left.w
    const y = doorY(cur) + lane
    pts.push({ x: step > 0 ? edge - 12 : edge + T + 12, y }, { x: step > 0 ? edge + T + 12 : edge - 12, y })
    col += step
  }
  while (row !== target.row) {
    const step = target.row > row ? 1 : -1
    const cur = cellAt(L, col, row)
    const top = step > 0 ? cur : cellAt(L, col, row - 1)
    const edge = top.y + top.h
    const x = doorX(cur) + lane
    pts.push({ x, y: step > 0 ? edge - 12 : edge + T + 12 }, { x, y: step > 0 ? edge + T + 12 : edge - 12 })
    row += step
  }
  pts.push(to)
  return pts
}

const laneOf = (id: string) => (hash('lane:' + id) % 5) - 2

// A doorway's gap counts as the place the walker was in.
function roomAt(L: Layout, p: Pt, fallback: Place): Place {
  if (p.y > L.ph) return 'yard'
  for (const room of ALL_ROOMS) {
    const c = L.rooms[room]
    if (p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h) return room
  }
  return fallback
}

// A room half a body clear of its walls, or the road out front.
function floorOf(L: Layout, place: Place): { x0: number; x1: number; y0: number; y1: number } {
  if (place === 'yard') return yardOf(L).floor
  const c = L.rooms[place]
  return { x0: c.x + 4, x1: c.x + c.w - 4, y0: c.y + 4, y1: floorBottom(c) }
}

function onFloor(L: Layout, place: Place, p: Pt): Pt {
  const f = floorOf(L, place)
  return { x: Math.max(f.x0, Math.min(f.x1, p.x)), y: Math.max(f.y0, Math.min(f.y1, p.y)) }
}

function floorSpot(L: Layout, place: Place, r: () => number): Pt {
  const f = place === 'yard' ? yardOf(L).floor : freeFloor(place, L.rooms[place])
  return { x: Math.round(between(r, f.x0, f.x1)), y: Math.round(between(r, f.y0, f.y1)) }
}

// Two desks to a work room; extra workers stand about.
const DESKS = 2

function workSpot(c: Cell, i: number): Pt {
  if (i < DESKS) return { x: deskAt(c, i).x + 6, y: c.y + 11 }
  // past the desks, a floor grid; a bigger crowd fills its gaps, then the gaps' gaps
  const k = i - DESKS
  const rows = Math.max(1, Math.floor((floorBottom(c) - (c.y + 19)) / 6) + 1)
  const pass = Math.floor(k / (4 * rows))
  return { x: c.x + 10 + (k % 4) * 7 + (pass % 2) * 3.5, y: Math.min(c.y + 19 + (Math.floor(k / 4) % rows) * 6 + (pass % 3) * 2, floorBottom(c)) }
}

// ---------- props agents use ----------

type Pose = 'stand' | 'sit' | 'sleep'
type Drive = 'rest' | 'stim'
// `absorbed`: holds attention, so no glancing about
type Prop = { id: string; room: Place; spot: Pt; face: Dir; dwell: Span; pose: Pose; drive: Drive; lines: string[]; absorbed?: boolean }

// What there is to do, a spot beside each piece of furniture.
function furnish(L: Layout): Prop[] {
  const props: Prop[] = []
  const r = L.rooms
  const add = (room: Room, id: string, x: number, y: number, face: Dir, pose: Pose, drive: Drive, dwell: Span, lines: string[], absorbed = false) =>
    props.push({ id, room, spot: { x: r[room].x + x, y: r[room].y + y }, face, dwell, pose, drive, lines, absorbed })
  add('lounge', 'bed1', 8, 5.5, 'S', 'sleep', 'rest', [24, 40], LINES_SLEEP)
  add('lounge', 'bed2', 8, 16.5, 'S', 'sleep', 'rest', [24, 40], LINES_SLEEP)
  add('lounge', 'couch1', 21, 15, 'N', 'sit', 'rest', [15, 32], [...LINES_UNWIND, ...LINES_TV])
  add('lounge', 'couch2', 26, 15, 'N', 'sit', 'stim', [16, 30], LINES_BORED, true)
  add('study', 'fire', 34, 10, 'N', 'stand', 'rest', [6, 12], LINES_FIRE)
  add('study', 'armchair', 6, 19.5, 'E', 'sit', 'rest', [10, 24], LINES_READ, true)
  add('kitchen', 'fridge', 11, 11.5, 'W', 'stand', 'rest', [4, 8], LINES_SNACK)
  add('kitchen', 'coffee', 11, 24, 'W', 'stand', 'rest', [5, 10], LINES_COFFEE)
  add('library', 'shelf', 10, 17, 'W', 'stand', 'stim', [12, 22], LINES_BROWSE, true)
  add('sunroom', 'telescope', 6, 19, 'N', 'stand', 'stim', [8, 16], LINES_STARS, true)
  add('sunroom', 'radio', 10, 22.5, 'W', 'stand', 'stim', [5, 10], LINES_RADIO)
  add('workshop', 'bench', 12, 16, 'W', 'stand', 'stim', [8, 14], LINES_TINKER)
  const m = yardOf(L).mailbox
  props.push({ id: 'mailbox', room: 'yard', spot: { x: m.x + 3.5, y: m.y + 1 }, face: 'W', dwell: [4, 8], pose: 'stand', drive: 'stim', lines: LINES_MAIL })
  return props
}
const PROPS = furnish(LAYOUT)

// ---------- temperament and moods ----------

function temperament(id: string) {
  const r = rng(hash('temper:' + id))
  return {
    pace: between(r, 0.85, 1.2),
    restless: between(r, 0.5, 1.4),
    curious: between(r, 0.4, 1.2),
    homebody: between(r, 0.4, 1.2),
    chatty: between(r, 0.5, 1.3),
  }
}

// Moods take turns every few minutes, each agent on its own clock.
const MOODS = [
  { tag: 'busy', rest: 0.7, stim: 1.0, restless: 1.3 },
  { tag: 'wander', rest: 0.75, stim: 1.5, restless: 1.1 },
  { tag: 'unwind', rest: 1.5, stim: 0.8, restless: 0.75 },
  { tag: 'doze', rest: 1.3, stim: 0.6, restless: 0.5 },
]
const MOOD_MS = 200000

// A mood holds for a whole idle stretch, so a redraw never swaps the plan.
function moodOf(id: string, idleSince: number) {
  const index = (hash(id) + Math.floor(idleSince / MOOD_MS)) % MOODS.length
  return { index, ...(MOODS[index] ?? MOODS[0]!) }
}

// ---------- planning an idle loop ----------

const mod = (n: number) => ((n % LOOP) + LOOP) % LOOP

type Key = { t: number; p: Pt; room: Place }

function posAt(keys: Key[], t: number): Key {
  let prev = keys[0] as Key
  for (const k of keys) {
    if (k.t >= t) {
      const span = k.t - prev.t
      const u = span > 0 ? (t - prev.t) / span : 1
      return { t, p: { x: prev.p.x + (k.p.x - prev.p.x) * u, y: prev.p.y + (k.p.y - prev.p.y) * u }, room: u >= 1 ? k.room : prev.room }
    }
    prev = k
  }
  return prev
}
type Say = { t0: number; t1: number; text: string }
// A meeting; `talk` is glyph chatter.
type Appointment = {
  t0: number; t1: number; room: Room; spot: Pt; face: Dir
  talk: Span[]; hop: Span[]; spark: Span[]; says: Say[]; spins: { t: number; dir: Dir }[]
}

class Plan {
  keys: Key[]
  walk: Span[] = []
  sit: Span[] = []
  sleep: Span[] = []
  faces: { t: number; dir: Dir }[] = [{ t: 0, dir: 'S' }]
  says: Say[] = []
  talk: Span[] = []
  // goofing about
  hop: Span[] = []
  wave: Span[] = []
  juggle: Span[] = []
  spark: Span[] = []
  t = 0
  room: Place
  at: Pt
  speed: number
  private L: Layout
  private r: () => number
  private lane: number
  constructor(room: Place, at: Pt, speed: number, L: Layout, r: () => number, lane = 0) {
    this.room = room
    this.at = at
    this.speed = speed
    this.L = L
    this.r = r
    this.lane = lane
    this.keys = [{ t: 0, p: at, room }]
  }

  face(dir: Dir, t = this.t): void {
    this.faces.push({ t, dir })
  }

  hold(seconds: number): void {
    if (seconds <= 0) return
    this.t += seconds
    this.keys.push({ t: this.t, p: this.at, room: this.room })
  }

  // `backwards`: a moonwalk
  walkTo(room: Place, to: Pt, backwards = false): void {
    this.walkAlong(room, route(this.L, this.room, this.at, room, to, this.lane), this.at, to, backwards, true)
  }

  // `stops`: maybe one short pause on the way
  private walkAlong(room: Place, pts: Pt[], last: Pt, to: Pt, backwards: boolean, stops: boolean): void {
    const start = this.t
    const end = pts[pts.length - 1]
    for (const p of pts.slice(1)) {
      const dx = p.x - last.x
      const dy = p.y - last.y
      const d = Math.hypot(dx, dy)
      if (d < 0.5) continue
      const dir = heading(dx, dy)
      this.face(backwards ? BACK[dir] : dir)
      this.t += d / this.speed
      this.keys.push({ t: this.t, p, room: p === end ? room : roomAt(this.L, p, this.room) })
      last = p
      if (stops && p !== end && this.r() < 0.06) {
        this.walk.push([start, this.t])
        this.room = roomAt(this.L, p, this.room)
        this.at = p
        this.hold(between(this.r, 0.3, 0.8))
        const rest = pts.slice(pts.indexOf(p))
        return this.walkAlong(room, rest, p, to, false, false)
      }
    }
    this.walk.push([start, this.t])
    this.room = room
    this.at = to
  }

  travel(room: Place, to: Pt): number {
    const pts = route(this.L, this.room, this.at, room, to, this.lane)
    let d = 0
    for (let i = 1; i < pts.length; i++) d += Math.hypot((pts[i] as Pt).x - (pts[i - 1] as Pt).x, (pts[i] as Pt).y - (pts[i - 1] as Pt).y)
    return d / this.speed + 0.8
  }

  // squeeze a routine that ran long back into the loop
  fit(total: number): void {
    if (this.t <= total) return
    const f = total / this.t
    const s = (span: Span): Span => [span[0] * f, span[1] * f]
    this.keys = this.keys.map(k => ({ ...k, t: k.t * f }))
    this.walk = this.walk.map(s)
    this.sit = this.sit.map(s)
    this.sleep = this.sleep.map(s)
    this.talk = this.talk.map(s)
    this.hop = this.hop.map(s)
    this.wave = this.wave.map(s)
    this.juggle = this.juggle.map(s)
    this.spark = this.spark.map(s)
    this.faces = this.faces.map(x => ({ t: x.t * f, dir: x.dir }))
    this.says = this.says.map(x => ({ t0: x.t0 * f, t1: x.t1 * f, text: x.text }))
    this.t = total
  }

  say(text: string, seconds = 4.2): void {
    this.says.push({ t0: this.t, t1: this.t + seconds, text })
  }

  // a look to one side and back
  glance(): void {
    const back = this.faces[this.faces.length - 1]?.dir ?? 'S'
    this.face(this.r() < 0.5 ? 'W' : 'E')
    this.hold(between(this.r, 0.5, 1.2))
    this.face(back)
  }
}

// Props are booked on the house's clock so no two agents share one; `offset` maps own time to it.
type Bookings = Map<string, Span[]>

function book(bookings: Bookings, id: string, span: Span, offset: number): boolean {
  const a = mod(span[0] + offset)
  const len = Math.min(LOOP, span[1] - span[0])
  const pieces: Span[] = a + len <= LOOP ? [[a, a + len]] : [[a, LOOP], [0, a + len - LOOP]]
  const list = bookings.get(id) ?? []
  if (pieces.some(([x, y]) => list.some(([p, q]) => x < q && p < y))) return false
  list.push(...pieces)
  bookings.set(id, list)
  return true
}

type IdleContext = {
  bookings: Bookings
  offset: number
  // idle agents so far: the more, the less each talks
  crowd: number
  // desks the lead may look in on
  watch: { room: Room; spot: Pt }[]
  // where workers stand: an idle agent starting on one steps off it
  busy: Pt[]
}

const near = (a: Pt, b: Pt, d = 6) => Math.hypot(a.x - b.x, a.y - b.y) < d

// ---------- goofing about ----------

// Bits of silliness an idle agent gets up to, by mood.
type Antic = 'hop' | 'spin' | 'moonwalk' | 'wave' | 'juggle' | 'sneeze' | 'stumble' | 'doze' | 'yawn'
const ANTICS: Record<string, Antic[]> = {
  busy: ['juggle', 'hop', 'spin', 'wave', 'sneeze', 'stumble'],
  wander: ['moonwalk', 'spin', 'wave', 'hop', 'stumble', 'juggle'],
  unwind: ['yawn', 'wave', 'hop', 'sneeze', 'doze', 'moonwalk'],
  doze: ['doze', 'yawn', 'stumble', 'sneeze'],
}
const SPIN_DIRS: Dir[] = ['S', 'E', 'N', 'W']

// One antic on the spot, if it fits before `deadline` with time to get `back`.
function goof(plan: Plan, L: Layout, kind: Antic, r: () => number, chatty: number, deadline: number, back: { room: Place; spot: Pt }): boolean {
  const left = deadline - plan.travel(back.room, back.spot)
  const fitsIn = (seconds: number) => plan.t + seconds <= left
  const maybeSay = (lines: string[], chance = 0.7, seconds = 2.4) => {
    if (r() < chance * chatty) plan.say(pick(lines, r), seconds)
  }
  switch (kind) {
    case 'hop': {
      const dur = between(r, 1.6, 2.6)
      if (!fitsIn(dur)) return false
      plan.face('S')
      maybeSay(LINES_HOP)
      plan.hop.push([plan.t, plan.t + dur])
      plan.hold(dur)
      return true
    }
    case 'spin': {
      const dur = 1.8
      if (!fitsIn(dur + 0.4)) return false
      maybeSay(LINES_SPIN)
      for (let k = 0; k < 12; k++) plan.face(SPIN_DIRS[k % 4] as Dir, plan.t + k * 0.15)
      plan.hold(dur)
      plan.face('S')
      plan.hold(0.4)
      return true
    }
    case 'moonwalk': {
      if (plan.room === 'yard' || roomAt(L, plan.at, 'yard') !== plan.room) return false
      const room = L.rooms[plan.room]
      const dx = (r() < 0.5 ? -1 : 1) * between(r, 12, 20)
      const spot = { x: Math.max(room.x + 8, Math.min(room.x + room.w - 10, plan.at.x + dx)), y: plan.at.y }
      if (Math.abs(spot.x - plan.at.x) < 6) return false
      const there = plan.travel(plan.room, spot) * 1.7
      if (!fitsIn(there + 0.8)) return false
      maybeSay(LINES_MOON, 0.6, 2.8)
      const speed = plan.speed
      plan.speed = speed * 0.6
      plan.walkTo(plan.room, spot, true)
      plan.speed = speed
      plan.hold(0.8)
      return true
    }
    case 'wave': {
      const dur = 2.2
      if (!fitsIn(dur)) return false
      plan.face('S')
      maybeSay(LINES_WAVE, 0.9)
      plan.wave.push([plan.t, plan.t + dur])
      plan.hold(dur)
      return true
    }
    case 'juggle': {
      const dur = between(r, 3, 5)
      if (!fitsIn(dur)) return false
      plan.face('S')
      maybeSay(LINES_JUGGLE, 0.5)
      plan.juggle.push([plan.t, plan.t + dur])
      plan.hold(dur)
      return true
    }
    case 'sneeze': {
      if (!fitsIn(1.8)) return false
      plan.say(pick(LINES_SNEEZE, r), 1.6)
      plan.hop.push([plan.t + 0.3, plan.t + 0.5])
      plan.hold(1.8)
      return true
    }
    case 'stumble': {
      if (!fitsIn(2)) return false
      plan.say(pick(LINES_STUMBLE, r), 1.8)
      plan.sit.push([plan.t, plan.t + 0.7])
      plan.hold(2)
      return true
    }
    case 'doze': {
      const dur = between(r, 4, 7)
      if (!fitsIn(dur)) return false
      plan.face('S')
      plan.sleep.push([plan.t, plan.t + dur])
      plan.hold(dur)
      return true
    }
    case 'yawn': {
      if (!fitsIn(2.6)) return false
      plan.face('S')
      plan.say(pick(LINES_YAWN, r), 2.2)
      plan.hold(2.6)
      return true
    }
  }
}

// Depends only on the agent, the house, its huddle and the agents idle before it.
function planIdle(
  L: Layout, props: Prop[], c: Resident, home: { room: Place; at: Pt }, appts: Appointment[], ctx: IdleContext,
): Plan {
  const p = temperament(c.id)
  const ph = moodOf(c.id, c.idleSince ?? 0)
  const r = rng(hash(`${c.id}:${ph.index}`))
  const plan = new Plan(home.room, home.at, speedOf(c), L, r, laneOf(c.id))
  const talkChance = 0.35 / Math.sqrt(Math.max(1, ctx.crowd))

  // starting on a busy desk: step off, and come back only as the loop ends
  const onBusy = ctx.busy.some(b => near(b, home.at))
  const base = onBusy ? { room: home.room, at: onFloor(L, home.room, { x: home.at.x, y: home.at.y + 9 }) } : home
  if (onBusy) plan.walkTo(base.room, base.at)
  plan.hold(between(r, 0.4, 1.6))
  const queue = [...appts].sort((a, b) => a.t0 - b.t0)
  const endBy = LOOP - 0.5 - (onBusy ? plan.travel(home.room, home.at) : 0)

  // whether going, staying and going on to `back` all end by the deadline
  const fits = (room: Place, spot: Pt, dwell: number, deadline: number, back: { room: Place; spot: Pt }, go = plan.travel(room, spot)) => {
    const saved = { room: plan.room, at: plan.at }
    plan.room = room
    plan.at = spot
    const ret = plan.travel(back.room, back.spot)
    plan.room = saved.room
    plan.at = saved.at
    return plan.t + go + dwell + ret <= deadline
  }

  let guard = 0
  while (guard++ < 40) {
    const next = queue[0]
    const deadline = next ? next.t0 : endBy
    const back = next ? { room: next.room, spot: next.spot } : { room: base.room, spot: base.at }

    // what it feels like: rest, something to do, or nothing
    const wRest = 38 * (0.6 + 0.7 * p.homebody) * ph.rest
    const wStim = (36 * (0.6 + 0.7 * p.curious) + 14 * p.restless) * ph.stim
    const wContent = 30
    const roll = r() * (wRest + wStim + wContent)
    const drive: Drive | 'content' = roll < wRest ? 'rest' : roll < wRest + wStim ? 'stim' : 'content'

    let done = false
    // the lead looks in on whoever is working, a few seconds each
    if (ctx.watch.length > 0 && r() < 0.45) {
      const w = pick(ctx.watch, r)
      const spot = onFloor(L, w.room, { x: w.spot.x + (r() < 0.5 ? -7 : 7), y: w.spot.y + 11 })
      const dwell = between(r, 3, 6)
      const go = plan.travel(w.room, spot)
      if (fits(w.room, spot, dwell, deadline, back, go) && book(ctx.bookings, `watch:${w.room}:${w.spot.x}`, [plan.t + go, plan.t + go + dwell], ctx.offset)) {
        plan.walkTo(w.room, spot)
        plan.face('N')
        if (r() < talkChance) plan.say(pick(LINES_LOOK, r))
        plan.hold(dwell)
        done = true
      }
    }
    if (!done && drive !== 'content') {
      const options = props.filter(o => o.drive === drive && (o.pose !== 'sleep' || ph.tag === 'doze' || ph.tag === 'unwind'))
      if (options.length > 0) {
        const o = pick(options, r)
        const dwell = between(r, o.dwell[0], o.dwell[1])
        const go = plan.travel(o.room, o.spot)
        if (fits(o.room, o.spot, dwell, deadline, back, go) && book(ctx.bookings, o.id, [plan.t + go - 0.5, plan.t + go + dwell + 0.5], ctx.offset)) {
          plan.walkTo(o.room, o.spot)
          plan.face(o.face)
          const t0 = plan.t
          if (r() < talkChance) plan.say(pick(o.lines, r))
          // glancing about now and then, unless absorbed
          let left = dwell
          while (left > 0) {
            const chunk = Math.min(left, between(r, 3.5, 7.5))
            plan.hold(chunk)
            left -= chunk
            if (left > 1.5 && o.pose === 'stand' && !o.absorbed && r() < 0.4) {
              const t = plan.t
              plan.glance()
              plan.face(o.face)
              left -= plan.t - t
            }
          }
          if (o.pose === 'sit') plan.sit.push([t0, plan.t])
          if (o.pose === 'sleep') {
            plan.sleep.push([t0, plan.t])
            plan.face('S', t0)
          }
          done = true
        }
      }
      if (!done && drive === 'stim' && r() < 0.6) {
        // explore: a stroll to another room
        const room = pick(ALL_ROOMS, r)
        const spot = floorSpot(L, room, r)
        const dwell = between(r, 1.5, 4)
        if (fits(room, spot, dwell + 1.2, deadline, back)) {
          plan.walkTo(room, spot)
          plan.hold(dwell)
          plan.glance()
          done = true
        }
      }
      if (!done && drive === 'rest' && c.kind === 'main' && r() < 0.5) {
        // a step to whichever side has room
        const f = floorOf(L, base.room)
        const spot = onFloor(L, base.room, { x: base.at.x + (base.at.x + 6 > f.x1 ? -6 : 6), y: base.at.y })
        const dwell = between(r, 3, 7)
        if (fits(base.room, spot, dwell, deadline, back)) {
          plan.walkTo(base.room, spot)
          plan.face('N')
          if (r() < talkChance) plan.say(pick(LINES_STANDBY, r))
          plan.hold(dwell)
          done = true
        }
      }
    }
    if (!done && r() < 0.3 * p.restless * ph.restless) {
      done = goof(plan, L, pick(ANTICS[ph.tag] ?? ANTICS.busy ?? ['hop'], r), r, p.chatty, deadline, back)
    }
    if (!done) {
      // content: stand, look round or stroll; lengths drawn first so no deadline is overrun
      const x = r() * 100
      const left = deadline - plan.travel(back.room, back.spot)
      const stand = between(r, 4, 10)
      const settle = between(r, 2, 4.5)
      if (x < 55 && plan.t + stand <= left) {
        plan.hold(stand)
        done = true
      } else if (x < 80 && plan.t + 1.2 + settle <= left) {
        plan.glance()
        plan.hold(settle)
        done = true
      } else {
        const spot = floorSpot(L, plan.room, r)
        const pause = between(r, 1.5, 4)
        if (fits(plan.room, spot, pause, deadline, back)) {
          plan.walkTo(plan.room, spot)
          plan.hold(pause)
          done = true
        }
      }
    }
    if (done) continue

    // nothing fits: keep the next appointment, unless it cannot be reached in time
    if (!next) break
    queue.shift()
    const go = plan.travel(next.room, next.spot)
    if (plan.t + go > next.t0 + 1) continue
    plan.hold(Math.max(0, next.t0 - plan.t - go))
    plan.walkTo(next.room, next.spot)
    plan.hold(Math.max(0, next.t0 - plan.t))
    plan.face(next.face)
    plan.talk.push(...next.talk)
    plan.hop.push(...next.hop)
    plan.spark.push(...next.spark)
    plan.says.push(...next.says)
    for (const f of next.spins) plan.face(f.dir, f.t)
    plan.hold(next.t1 - plan.t)
  }
  plan.walkTo(base.room, base.at)
  plan.face('S')
  if (onBusy) {
    // arrive back on the starting spot exactly as the loop comes round
    plan.hold(LOOP - plan.t - plan.travel(home.room, home.at) + 0.8)
    plan.walkTo(home.room, home.at)
  }
  plan.hold(LOOP - plan.t)
  plan.fit(LOOP)
  return plan
}

// Huddles: two or three idle agents chatter in glyphs, high-five, dance or play rock, paper, scissors.
// An agent's id picks its meeting time, so its plan changes only with its meeting group (huddleKey).
const MEETINGS = [14, 40, 64]

const slotOf = (c: Resident) => hash('meet:' + c.id) % MEETINGS.length
const joins = (c: Resident, slot: number) => rng(hash(`joins:${slot}:${c.id}`))() < 0.45 * temperament(c.id).chatty + 0.3

// The meeting group with each loop start, since who can come depends on it.
function huddleKey(L: Layout, c: Resident, idle: Resident[]): string {
  const slot = slotOf(c)
  return idle.filter(o => slotOf(o) === slot).map(o => `${o.id}@${t0Of(o, L)}`).sort().join('|')
}

function huddles(L: Layout, idle: Resident[], offsetOf: (c: Resident) => number): Map<string, Appointment[]> {
  const out = new Map<string, Appointment[]>()
  MEETINGS.forEach((g0, slot) => {
    const members = idle.filter(c => slotOf(c) === slot).sort((a, b) => (a.id < b.id ? -1 : 1))
    const r = rng(hash(`huddle:${slot}:${members.map(m => m.id).join('|')}`))
    const kind = pick(['chat', 'chat', 'highfive', 'dance', 'rps'] as const, r)
    const hold = kind === 'chat' ? between(r, 8, 14) : kind === 'highfive' ? between(r, 4, 5) : kind === 'dance' ? between(r, 7, 10) : between(r, 6.5, 7.5)
    // an agent whose loop would end mid-meeting sits out; under two, the meeting is off
    const comes = (m: Resident) => {
      const t0 = mod(g0 - offsetOf(m))
      return t0 >= 6 && t0 + hold <= LOOP - 18
    }
    const party = members.filter(m => joins(m, slot) && comes(m)).slice(0, 3)
    if (party.length < 2) return
    const throws = party.map(() => pick(THROWS, r))
    const winner = BEATS[throws[0] ?? ''] === throws[1] ? 0 : BEATS[throws[1] ?? ''] === throws[0] ? 1 : -1
    const room = pick(['lounge', 'study', 'lounge', 'sunroom', 'library'] as Room[], r)
    const f = freeFloor(room, L.rooms[room])
    const center = { x: Math.round(between(r, f.x0 + 9, f.x1 - 9)), y: Math.round(between(r, f.y0 + 1, f.y1 - 5)) }
    const offsets = party.length === 2 ? [-7, 7] : [-9, 0, 9]
    party.forEach((m, idx) => {
      const t0 = mod(g0 - offsetOf(m))
      const spot = { x: center.x + (offsets[idx] ?? 0), y: center.y + (party.length === 3 && idx === 1 ? 5 : 0) }
      const face: Dir = party.length === 3 && idx === 1 ? 'N' : (offsets[idx] ?? 0) < 0 ? 'E' : 'W'
      const mine = rng(hash(`${kind}:${slot}:${m.id}`))
      const appt: Appointment = { t0, t1: t0 + hold, room, spot, face, talk: [], hop: [], spark: [], says: [], spins: [] }
      if (kind === 'chat') {
        for (let k = 0; k * 2 < hold; k++) {
          if (k % party.length === idx) appt.talk.push([t0 + k * 2, t0 + k * 2 + 1.5])
        }
      } else if (kind === 'highfive') {
        appt.hop.push([t0 + 1, t0 + 1.36])
        if (idx === 0) appt.spark.push([t0 + 1.1, t0 + 1.8])
        appt.says.push({ t0: t0 + 1.4 + idx * 0.3, t1: t0 + 3.4 + idx * 0.3, text: pick(LINES_HIGHFIVE, mine) })
      } else if (kind === 'dance') {
        appt.hop.push([t0 + 0.6 + idx * 0.18, t0 + hold - 0.6])
        if (idx % 2 === 1) {
          for (let k = 0; t0 + 1.5 + k * 0.3 < t0 + hold - 1; k++) appt.spins.push({ t: t0 + 1.5 + k * 0.3, dir: SPIN_DIRS[k % 4] as Dir })
          appt.spins.push({ t: t0 + hold - 1, dir: face })
        }
        appt.says.push({ t0: t0 + 0.8 + idx * 1.6, t1: t0 + 2.8 + idx * 1.6, text: pick(LINES_DANCE, mine) })
      } else {
        if (idx === 0) appt.says.push({ t0: t0 + 0.3, t1: t0 + 2, text: 'rock, paper...' })
        appt.says.push({ t0: t0 + 2.2, t1: t0 + 4, text: idx < 2 ? throws[idx] ?? 'rock!' : 'go go go' })
        const result = winner === -1 ? 'again!' : idx === winner ? pick(LINES_WIN, mine) : idx < 2 ? pick(LINES_LOSE, mine) : 'ooh'
        appt.says.push({ t0: t0 + 4.3, t1: t0 + 6.2, text: result })
        if (idx === winner) appt.hop.push([t0 + 4.3, t0 + 5])
      }
      out.set(m.id, [...(out.get(m.id) ?? []), appt])
    })
  })
  return out
}

// A spot of its own clear of the furniture, so a crowd that went idle together does not stack up.
function idleHome(L: Layout, c: Resident): { room: Room; at: Pt } {
  const f = freeFloor(c.room, L.rooms[c.room])
  const h = hash('home:' + c.id)
  return { room: c.room, at: { x: f.x0 + (h % Math.max(1, Math.floor(f.x1 - f.x0))), y: f.y0 + ((h >>> 5) % Math.max(1, Math.floor(f.y1 - f.y0))) } }
}

// ---------- drawing an agent ----------

type AgentDraw = {
  at: Pt
  // a box on its head, out to the pallets
  carry?: Span[]
  motion: string
  total: number
  begin: number
  isLoop: boolean
  walk: Span[]
  sit: Span[]
  sleep: Span[]
  faces: { t: number; dir: Dir }[]
  typing?: boolean
  bubbles: string
  hop?: Span[]
  wave?: Span[]
  juggle?: Span[]
  spark?: Span[]
  // drops the name a line, so neighbours at desks do not overprint
  nameDy?: number
}

// A face at `total` gets no span, so a finished walk keeps its last step's pose for the few seconds until
// the hooks end the errand. Holding the end longer shifts the next plans' timelines, and they jump.
function faceSpans(faces: { t: number; dir: Dir }[], total: number): Record<Dir, Span[]> {
  const out: Record<Dir, Span[]> = { N: [], S: [], E: [], W: [] }
  const sorted = [...faces].sort((a, b) => a.t - b.t)
  sorted.forEach((f, i) => {
    const end = sorted[i + 1]?.t ?? total
    if (end > f.t) out[f.dir].push([f.t, end])
  })
  return out
}

function invert(spans: Span[], total: number): Span[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0])
  const out: Span[] = []
  let t = 0
  for (const [a, b] of sorted) {
    if (a > t) out.push([t, a])
    t = Math.max(t, b)
  }
  if (t < total) out.push([t, total])
  return out
}

// Clawd is a block seen at the house's angle, feet at (0, 0).
const iso = (x: number, y: number, z: number): Pt => ({ x: x - y, y: (x + y) / 2 - z })

// Pixels of one colour as one path: [x, y, w, h] each.
function pix(color: string, boxes: number[][]): string {
  return `<path fill="${color}" d="${boxes.map(([x, y, w, h]) => `M${r1(x ?? 0)} ${r1(y ?? 0)}h${w}v${h}h-${w}z`).join('')}"/>`
}

// Shared parts are defined once per picture and placed by reference.
let bodyDefs = new Map<string, string>()

function part(id: string, draw: () => string): string {
  if (!bodyDefs.has(id)) bodyDefs.set(id, `<g id="${id}">${draw()}</g>`)
  return `<use href="#${id}"/>`
}

// Font glyphs, defined once for all the agents' words.
const glyph = (id: string, d: string) => {
  if (!bodyDefs.has(id)) bodyDefs.set(id, `<path id="${id}" d="${d}"/>`)
}

const agentText = (text: string, x: number, y: number, opts: Parameters<typeof pixelText>[3]) => glyphText(text, x, y, opts, glyph)

// One pose: legs standing (`s`), stepping (`w`) or tucked (`n`), body `wide` across x or along y.
function poseOf(color: string, wide: 'x' | 'y', legs: 's' | 'w' | 'n', typing: boolean): string {
  const id = `ps${wide}${legs}${typing ? 't' : ''}${color.slice(1)}`
  if (!bodyDefs.has(id)) bodyDefs.set(id, `<g id="${id}">${legs === 'n' ? '' : clawdLegs(color, wide, legs === 'w')}${clawdBody(color, wide, typing)}</g>`)
  return id
}

// Every pose in a strip seen through a one-pose window, so one sliding animation does for all.
const POSE_GAP = 48
const POSE_WINDOW = '<clipPath id="vh-pose"><rect x="-20" y="-30" width="40" height="38"/></clipPath>'

function poseStrip(color: string, typing: boolean, across: Span[], along: Span[], walk: Span[], still: Span[], d: AgentDraw): string {
  const total = d.total
  const inside = (spans: Span[], t: number) => spans.some(([a, b]) => t >= a && t < b)
  const edges = [...new Set([0, ...[across, along, walk, still].flatMap(list => list.flat())])].filter(t => t >= 0 && t < total).sort((a, b) => a - b)
  const poses: string[] = []
  const steps: Step[] = []
  edges.forEach((t0, i) => {
    const mid = (t0 + (edges[i + 1] ?? total)) / 2
    const wide = inside(across, mid) ? 'x' : inside(along, mid) ? 'y' : undefined
    const legs = inside(walk, mid) ? 'w' : inside(still, mid) ? 's' : 'n'
    let v = -1
    if (wide) {
      const id = poseOf(color, wide, legs, wide === 'x' && typing)
      v = poses.indexOf(id)
      if (v < 0) v = poses.push(id) - 1
    }
    if (steps[steps.length - 1]?.v !== v) steps.push({ t: t0, v })
  })
  const only = poses[0]
  if (only !== undefined && poses.length === 1 && steps.every(p => p.v === 0)) return `<use href="#${only}"/>`
  if (!bodyDefs.has('vh-pose')) bodyDefs.set('vh-pose', POSE_WINDOW)
  const strip = poses.map((id, i) => `<use href="#${id}"${i ? ` x="${i * POSE_GAP}"` : ''}/>`).join('')
  const values = steps.map(p => (p.v < 0 ? '-9999 0' : `${-p.v * POSE_GAP} 0`))
  const slide = steps.length > 1
    ? `<g>${stepAnim('<animateTransform attributeName="transform" type="translate"', values, steps, total, d.begin, d.isLoop)}`
    : `<g transform="translate(${values[0] ?? '0 0'})">`
  return `<g clip-path="url(#vh-pose)">${slide}${strip}</g></g>`
}

// `wide` across x faces S or N, along y faces E or W; typing, the arms take turns going up.
function clawdBody(color: string, wide: 'x' | 'y', typing: boolean): string {
  return part(`cb${wide}${typing ? 't' : ''}${color.slice(1)}`, () => {
    const w = wide === 'x' ? 8 : 4.5
    const d = wide === 'x' ? 4.5 : 8
    const [x0, x1, y0, y1, z0, z1] = [-w / 2, w / 2, -d / 2, d / 2, 3, 10]
    const top = [iso(x0, y0, z1), iso(x1, y0, z1), iso(x1, y1, z1), iso(x0, y1, z1)]
    const left = [iso(x0, y1, z1), iso(x1, y1, z1), iso(x1, y1, z0), iso(x0, y1, z0)]
    const right = [iso(x1, y0, z1), iso(x1, y1, z1), iso(x1, y1, z0), iso(x1, y0, z0)]
    const a = ARMS[wide]
    const nub = (p: Pt, lift = 0) => [p.x, p.y - lift, 2, 2]
    const arms = (front: boolean) => {
      const p = front ? a.front : a.back
      if (!typing) return pix(color, [nub(p)])
      const [up, down] = front ? [1, 0] : [0, 1]
      return `<g>${pix(color, [nub(p, up)])}${blinkAnim('opacity', '1', '0', 330)}</g><g>${pix(color, [nub(p, down)])}${blinkAnim('opacity', '0', '1', 330)}</g>`
    }
    return arms(false) + `<path fill="${shade(color, 0.22)}" d="${pathOf(top)}"/><path fill="${color}" d="${pathOf(left)}"/>` +
      `<path fill="${shade(color, -0.26)}" d="${pathOf(right)}"/>` + arms(true)
  })
}

// The session's ring at an agent's feet: an outline over a faint wash.
function teamRing(color: string): string {
  return part(`ring${color.slice(1)}`, () => {
    const inside = (x: number, y: number, rx: number, ry: number) => ((x + 0.5) / rx) ** 2 + ((y + 0.5) / ry) ** 2 <= 1
    const line: number[][] = []
    const wash: number[][] = []
    for (let y = -5; y <= 5; y++) {
      for (let x = -9; x <= 9; x++) {
        const run = inside(x, y, 8.2, 4.1) ? (inside(x, y, 6.4, 2.9) ? wash : line) : undefined
        const last = run?.[run.length - 1]
        if (!run) continue
        if (last && last[1] === y && (last[0] ?? 0) + (last[2] ?? 0) === x) last[2] = (last[2] ?? 0) + 1
        else run.push([x, y, 1, 1])
      }
    }
    return `<g opacity="0.18">${pix(color, wash)}</g><g opacity="0.8">${pix(color, line)}</g>`
  })
}

// A taped box icon, 5x4.
const TAPE = '#ecd6a6'

function boxIcon(tape: string): string {
  return pix('#e2b57a', [[0, 0, 5, 1]]) + pix('#c9965a', [[0, 1, 5, 3]]) + pix('#9a6c3c', [[4, 1, 1, 3]]) + pix(tape, [[2, 0, 1, 4]])
}

// ---------- hats ----------

// A hat per role, the same from every side: [x, y, w, h] pixels per colour, the brim's row at y -12.
const HATS: Record<string, [string, number[][]][]> = {
  // a crown with a jewel
  Host: [['#ffd166', [[-2, -12, 5, 1], [-2, -13, 1, 1], [0, -13, 1, 1], [2, -13, 1, 1]]], ['#e84a5f', [[0, -12, 1, 1]]]],
  // a checked deerstalker
  Snoop: [['#7a532e', [[-3, -12, 7, 1], [0, -15, 1, 1]]], ['#b5844f', [[-2, -13, 5, 1], [-1, -14, 3, 1]]], ['#dcae74', [[-1, -13, 1, 1], [1, -13, 1, 1]]]],
  // a wizard's pointed hat with a star
  Schemer: [['#5e3c9c', [[-3, -12, 7, 1]]], ['#8e5fd6', [[-2, -13, 5, 1], [-1, -14, 3, 1], [0, -15, 2, 1], [1, -16, 1, 1]]], ['#ffe066', [[0, -14, 1, 1]]]],
  // a hard hat with a ridge
  Handyman: [['#c9971f', [[-3, -12, 7, 1]]], ['#f5c242', [[-2, -13, 5, 1], [-1, -14, 3, 1]]], ['#ffe9a3', [[0, -14, 1, 2]]]],
  // silver hair in a bun, a flower in it
  Granny: [['#cfd2dc', [[-2, -12, 5, 1], [-1, -14, 3, 2]]], ['#9da1b0', [[1, -13, 1, 1]]], ['#ff8fb8', [[2, -13, 1, 1]]]],
  // a flat red cap
  Plumber: [['#a32c29', [[-3, -12, 7, 1]]], ['#d64541', [[-2, -13, 5, 1]]], ['#ffffff', [[0, -13, 1, 1]]]],
  // a peaked cap with a badge
  Inspector: [['#1b1b26', [[-2, -12, 5, 1]]], ['#3a5a94', [[-3, -13, 7, 1], [-2, -14, 5, 1]]], ['#ffd166', [[0, -12, 1, 1]]]],
  // lab goggles pushed up
  Taster: [['#3a3a48', [[-3, -12, 7, 1]]], ['#8fd3ff', [[-2, -14, 2, 2], [1, -14, 2, 2]]], ['#ffffff', [[-2, -14, 1, 1], [1, -14, 1, 1]]]],
  // floppy dog's ears
  Watchdog: [['#8b5a2b', [[-2, -12, 5, 1], [-3, -12, 1, 3], [3, -12, 1, 3]]], ['#b07a45', [[-1, -13, 3, 1]]]],
  // cat ears
  Mouser: [['#a3a3b2', [[-2, -12, 5, 1], [-2, -13, 1, 2], [2, -13, 1, 2]]], ['#f2a0b5', [[-1, -13, 1, 1], [1, -13, 1, 1]]]],
  // a beret worn to one side
  Decorator: [['#d1477a', [[-2, -12, 6, 1], [-1, -13, 5, 1]]], ['#9e2f58', [[2, -14, 1, 1]]]],
  // a green eyeshade
  Bookkeeper: [['#2d6e46', [[-2, -13, 5, 1]]], ['#5fd08a', [[-3, -12, 7, 1]]]],
  // a quill tucked in a band
  Scribbler: [['#7a5a3a', [[-2, -12, 5, 1]]], ['#f3ead2', [[1, -13, 1, 1], [1, -14, 2, 1], [2, -15, 2, 1], [3, -16, 1, 1]]]],
  // a propeller beanie (spun in hatOf)
  Tinkerer: [['#4a7fd6', [[-2, -12, 5, 1]]], ['#e2483d', [[-1, -13, 1, 1]]], ['#f5c242', [[0, -13, 1, 1]]], ['#4cbf6a', [[1, -13, 1, 1]]], ['#5a5a68', [[0, -14, 1, 1]]]],
  // a chef's toque
  Cook: [['#b9bab4', [[-2, -12, 5, 1], [3, -15, 1, 2], [2, -16, 1, 1], [2, -13, 1, 1]]], ['#f7f7f2', [[-2, -13, 4, 1], [-3, -15, 6, 2], [-2, -16, 4, 1]]], ['#dcddd8', [[-1, -15, 1, 1], [0, -16, 1, 1]]]],
  // a wide straw sun hat
  Neighbor: [['#e2c27a', [[-4, -12, 9, 1], [-2, -14, 5, 1]]], ['#d9534f', [[-2, -13, 5, 1]]]],
  // a top hat
  Butler: [['#2e2e3a', [[-3, -12, 7, 1], [-2, -16, 5, 3]]], ['#6c6c84', [[-2, -16, 1, 3]]], ['#d4d4de', [[-2, -13, 5, 1]]]],
  // little horns
  Gremlin: [['#c0392b', [[-2, -12, 1, 1], [-2, -13, 1, 1], [-3, -14, 1, 1], [2, -12, 1, 1], [2, -13, 1, 1], [3, -14, 1, 1]]]],
}

function hatOf(c: Resident): string {
  const role = displayName(c)
  return part(`hat-${role}`, () => {
    const hat = (own(HATS, role) ?? []).map(([color, boxes]) => pix(color, boxes)).join('')
    if (role !== 'Tinkerer') return hat
    // the propeller: blades across, then end on, turning
    return hat + `<g>${pix('#c9ccd6', [[-2, -15, 5, 1]])}${blinkAnim('opacity', '1', '0', 240)}</g><g>${pix('#c9ccd6', [[0, -15, 1, 1]])}${blinkAnim('opacity', '0', '1', 240)}</g>`
  })
}
// Eyes on the side facing you; none from behind.
const EYES: Record<'S' | 'E', [Pt, Pt]> = {
  S: [iso(-2.2, 2.25, 9), iso(1.6, 2.25, 9)],
  E: [iso(2.25, -1.6, 9), iso(2.25, 2.2, 9)],
}
// An arm at each end; the back one is drawn first so the body hides its root.
const ARMS: Record<'x' | 'y', { back: Pt; front: Pt }> = {
  x: { back: { x: -6.6, y: -10.3 }, front: { x: 4.6, y: -5.7 } },
  y: { back: { x: 4.6, y: -10.3 }, front: { x: -6.6, y: -5.7 } },
}

// Four three-pixel posts along the long side, back ones first; walking, diagonal pairs lift in turn.
function clawdLegs(color: string, wide: 'x' | 'y', walking: boolean): string {
  return part(`lg${wide}${walking ? 'w' : 's'}${color.slice(1)}`, () => {
    const [ax, ay] = wide === 'x' ? [2.6, 1.2] : [1.2, 2.6]
    const corners = [[-ax, -ay], [ax, -ay], [-ax, ay], [ax, ay]] as const
    const post = (cx: number, cy: number, z0: number) => {
      const [x0, x1, y0, y1, z1] = [cx - 0.7, cx + 0.7, cy - 0.7, cy + 0.7, 3]
      return `<path fill="${shade(color, -0.12)}" d="${pathOf([iso(x0, y1, z1), iso(x1, y1, z1), iso(x1, y1, z0), iso(x0, y1, z0)])}"/>` +
        `<path fill="${shade(color, -0.34)}" d="${pathOf([iso(x1, y0, z1), iso(x1, y1, z1), iso(x1, y1, z0), iso(x1, y0, z0)])}"/>`
    }
    const frame = (lifted: (i: number) => boolean) => corners.map(([cx, cy], i) => post(cx, cy, lifted(i) ? 1 : 0)).join('')
    if (!walking) return frame(() => false)
    return `<g>${frame(i => i === 0 || i === 3)}${blinkAnim('opacity', '1', '0', 360)}</g><g>${frame(i => i === 1 || i === 2)}${blinkAnim('opacity', '0', '1', 360)}</g>`
  })
}

function agentSvg(c: Resident, d: AgentDraw): string {
  const tk = (spans: Span[]) => track(spans, d.total, d.begin, d.isLoop)
  const body = bodyColor(c)
  const faces = faceSpans(d.faces, d.total)
  const sleeping = d.sleep
  const across = [...faces.S, ...faces.N]
  const along = [...faces.E, ...faces.W]
  const team = teamOf(c.session ?? '')
  const hat = hatOf(c)
  // the ring stays on the floor: not lifted by hops, hidden while sitting or lying
  const ring = team ? group(teamRing(team), tk(invert([...d.sit, ...d.sleep], d.total))) : ''
  const carry = d.carry ?? []
  const tape = team ?? TAPE
  const load = carry.length > 0 ? group(part(`load${tape.slice(1)}`, () => `<g transform="translate(-2.5 -16)">${boxIcon(tape)}</g>`), tk(carry)) : ''
  const capped = carry.length > 0 ? group(hat, tk(invert(carry, d.total))) : hat
  // eyes blink out of step with the others
  const aph = (hash(c.id) % 600) / 100
  const blink = `<animate attributeName="opacity" values="1;0" keyTimes="0;0.96" calcMode="discrete" dur="4s" ${loopBegin(4, aph * 0.9)} repeatCount="indefinite"/>`
  const eyes = (['S', 'E'] as const).map(dir => {
    const [a, b] = EYES[dir]
    const awake = faces[dir].flatMap(s => subtract(s, sleeping))
    return group(`<g>${rect({ x: r1(a.x), y: r1(a.y), w: 1, h: 2, c: '#1a1a1a' })}${rect({ x: r1(b.x), y: r1(b.y), w: 1, h: 2, c: '#1a1a1a' })}${blink}</g>`, tk(awake))
  }).join('')
  const [ca, cb] = EYES.S
  const closed = group(rect({ x: r1(ca.x - 0.5), y: r1(ca.y + 1), w: 2, h: 1, c: '#1a1a1a' }) + rect({ x: r1(cb.x - 0.5), y: r1(cb.y + 1), w: 2, h: 1, c: '#1a1a1a' }), tk(sleeping))
  // legs step while walking and tuck away when sitting or lying
  const stillLegs = invert([...d.walk, ...d.sit, ...d.sleep], d.total)
  const frame = poseStrip(body, !!d.typing, across, along, d.walk, stillLegs, d)
  // sitting drops the body 2px; sleeping lays it in the bed
  const lowered = [...d.sit, ...d.sleep]
  const drop = lowered.length > 0 ? discreteShift(lowered, d.total, d.begin, d.isLoop, '0 2') : ''
  // breathing
  const breath = r1(3.2 + (aph % 1.5))
  const bob = `<animateTransform attributeName="transform" type="translate" values="0 0;0 -0.6;0 0" dur="${breath}s" ${loopBegin(breath, aph)} repeatCount="indefinite" additive="sum"/>`
  const zz = group(`<g>${agentText('z', 5, -15, { color: '#cfd8ff' })}<animateTransform attributeName="transform" type="translate" values="0 0;0 -6" dur="2s" ${loopBegin(2)} repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur="2s" ${loopBegin(2)} repeatCount="indefinite"/></g>`, tk(sleeping))
  // the name under the feet, clear of the ring
  const nameY = (team ? 4.4 : 2) + (d.nameDy ?? 0)
  const name = agentText(fitText(`${c.isBackground ? '⧗ ' : ''}${displayName(c)}`, 26, NAME_PX), 0, nameY, { px: NAME_PX, color: colorFor(c), anchor: 'middle', cls: 'vh-ink' })
  const gauge = c.context !== undefined ? contextGauge(c.context, nameY + 4) : ''
  // hopping: up a beat, down a beat
  const ups = (d.hop ?? []).flatMap(([a, b]) => {
    const beats: Span[] = []
    for (let t = a; t < b; t += 0.36) beats.push([t, Math.min(b, t + 0.18)])
    return beats
  })
  const hop = ups.length > 0 ? discreteShift(ups, d.total, d.begin, d.isLoop, '0 -2') : ''
  // a hand up, waving side to side
  const wave = (d.wave ?? []).length > 0
    ? group(
      `<g>${rect({ x: 6, y: -9, w: 2, h: 2, c: body })}${rect({ x: 8, y: -13, w: 2, h: 3, c: body })}${blinkAnim('opacity', '1', '0', 300)}</g>` +
      `<g>${rect({ x: 6, y: -9, w: 2, h: 2, c: body })}${rect({ x: 6, y: -14, w: 2, h: 3, c: body })}${blinkAnim('opacity', '0', '1', 300)}</g>`,
      tk(d.wave ?? []))
    : ''
  // three balls in the air, a third of a throw apart
  const juggle = (d.juggle ?? []).length > 0
    ? group(JUGGLE.map((color, i) =>
      `<rect width="1" height="1" fill="${color}"><animate attributeName="x" values="-5;-2;3;0;-5" dur="0.9s" ${loopBegin(0.9, i * 0.3)} repeatCount="indefinite"/>` +
      `<animate attributeName="y" values="-8;-20;-8;-10;-8" dur="0.9s" ${loopBegin(0.9, i * 0.3)} repeatCount="indefinite"/></rect>`).join(''), tk(d.juggle ?? []))
    : ''
  // a high-five's spark
  const spark = (d.spark ?? []).length > 0
    ? group(`<g fill="#ffe08a">${rect({ x: 6, y: -15, w: 3, h: 1, c: '#ffe08a' })}${rect({ x: 7, y: -16, w: 1, h: 3, c: '#ffe08a' })}` +
      `${rect({ x: 5, y: -17, w: 1, h: 1, c: '#fff6c8' })}${rect({ x: 9, y: -17, w: 1, h: 1, c: '#fff6c8' })}${rect({ x: 5, y: -13, w: 1, h: 1, c: '#fff6c8' })}${rect({ x: 9, y: -13, w: 1, h: 1, c: '#fff6c8' })}` +
      `${blinkAnim('opacity', '1', '0.4', 200)}</g>`, tk(d.spark ?? []))
    : ''

  return `<g transform="translate(${r1(d.at.x)} ${r1(d.at.y)})" opacity="${c.status === 'done' ? 0.62 : 1}">${d.motion}${ring}` +
    `<g>${drop}<g>${hop}<g>${bob}${frame}${eyes}${closed}${capped}${load}${zz}${wave}${juggle}</g></g></g>${spark}${d.bubbles}${name}${gauge}</g>`
}

// The lead's context window fill, under its name.
function contextGauge(percent: number, y: number): string {
  const filled = Math.round(Math.max(0, Math.min(100, percent)) / 12.5)
  const color = percent >= 90 ? '#f2503f' : percent >= 75 ? '#f5ac45' : '#4cf08c'
  let out = ''
  for (let i = 0; i < 8; i++) {
    out += `<rect x="${r1(-6.6 + i * 1.7)}" y="${y}" width="1.3" height="1" fill="${i < filled ? color : '#3a3f4c'}"/>`
  }
  return `<g>${out}</g>`
}

function subtract(span: Span, cut: Span[]): Span[] {
  let parts: Span[] = [span]
  for (const [a, b] of cut) {
    parts = parts.flatMap(([x, y]) => {
      if (b <= x || a >= y) return [[x, y] as Span]
      const out: Span[] = []
      if (a > x) out.push([x, a])
      if (b < y) out.push([b, y])
      return out
    })
  }
  return parts
}

function discreteShift(spans: Span[], total: number, begin: number, isLoop: boolean, by: string): string {
  const steps = stepsOf(spans, total)
  if (steps.length === 1) return steps[0]?.v === 1 ? `<animateTransform attributeName="transform" type="translate" values="${by}" dur="1s" fill="freeze"/>` : ''
  return stepAnim('<animateTransform attributeName="transform" type="translate"', steps.map(p => (p.v === 1 ? by : '0 0')), steps, total, begin, isLoop)
}

function motionOf(all: Key[], total: number, begin: number, isLoop: boolean): string {
  // a run of keys at one spot needs only its ends
  const at = (k: Key | undefined) => (k ? `${r1(k.p.x)} ${r1(k.p.y)}` : '')
  const keys = all.filter((k, i) => i === 0 || i === all.length - 1 || at(k) !== at(all[i - 1]) || at(k) !== at(all[i + 1]))
  if (keys.length < 2) return ''
  const values = keys.map(at).join(';')
  const times = keys.map((k, i) => (i === 0 ? '0' : i === keys.length - 1 ? '1' : k4(Math.min(1, k.t / total)))).join(';')
  const repeat = isLoop ? 'repeatCount="indefinite"' : 'fill="freeze"'
  return `<animateTransform attributeName="transform" type="translate" values="${values}" keyTimes="${times}" dur="${r2(Math.max(0.1, total))}s" begin="-${r2(begin)}s" ${repeat}/>`
}

function sayBubbles(says: { t0: number; t1: number; text: string }[], total: number, begin: number, isLoop: boolean): string {
  return says.map(s => group(textBubble(s.text), track([[s.t0, s.t1]], total, begin, isLoop))).join('')
}

function talkBubbles(c: Resident, spans: Span[], total: number, begin: number, isLoop: boolean): string {
  if (spans.length === 0) return ''
  const dialect = accentOf(hash(c.id))
  // two phrases, alternating turn by turn
  const a = spans.filter((_, i) => i % 2 === 0)
  const b = spans.filter((_, i) => i % 2 === 1)
  return group(runeBubble(chatterLine(hash(c.id + ':a'), dialect)), track(a, total, begin, isLoop)) +
    group(runeBubble(chatterLine(hash(c.id + ':b'), dialect)), track(b, total, begin, isLoop))
}

// ---------- desks and machines ----------

export type App = 'code' | 'diff' | 'term' | 'web' | 'files' | 'notes'

// What a desk screen shows for each of Claude Code's tools (older builds' among them).
export function appFor(tool: string | undefined): App {
  if (!tool) return 'notes'
  if (/^(Edit|MultiEdit|NotebookEdit)$/.test(tool)) return 'diff'
  if (/^Write$/.test(tool)) return 'code'
  if (/^(Read|Grep|Glob|LSP|NotebookRead)$/.test(tool)) return 'files'
  if (/^(Bash|PowerShell|Monitor|BashOutput|KillShell|TaskStop)$/.test(tool)) return 'term'
  if (/^(WebFetch|WebSearch)$/.test(tool) || tool.startsWith('mcp__')) return 'web'
  return 'notes'
}

// A tiny screen's line of text: a new length every half second, now and then a word lit.
const LINE_SHAPES = [[0, 5], [2, 3], [0, 6], [1, 4], [2, 2], [0, 3], [1, 5], [0, 2]]
function scrollLine(x: number, y: number, wmax: number, seed: number, color: string, hot: string, still = false): string {
  const r = rng(seed * 7919 + 13)
  const steps = LINE_SHAPES.map(() => LINE_SHAPES[Math.floor(r() * LINE_SHAPES.length)] ?? [0, 3])
  // a picture short of room keeps screens still, on their first line
  if (still) {
    const [ind, len] = steps[0] ?? [0, 3]
    return `<rect x="${x + (ind ?? 0)}" y="${y}" width="${Math.max(1, Math.min(len ?? 3, wmax - (ind ?? 0)))}" height="1" fill="${color}"/>`
  }
  const xs = steps.map(([ind]) => x + (ind ?? 0)).join(';')
  const ws = steps.map(([ind, len]) => Math.max(1, Math.min(len ?? 3, wmax - (ind ?? 0)))).join(';')
  const lit = steps.map(() => (r() < 0.3 ? 1 : 0)).join(';')
  const times = steps.map((_, i) => k4(i / steps.length)).join(';')
  const anim = (attr: string, values: string) => `<animate attributeName="${attr}" values="${values}" keyTimes="${times}" calcMode="discrete" dur="${steps.length * 0.5}s" ${loopBegin(steps.length * 0.5)} repeatCount="indefinite"/>`
  return `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}">${anim('x', xs)}${anim('width', ws)}</rect>` +
    `<rect x="${x}" y="${y}" width="1" height="1" fill="${hot}" opacity="0">${anim('x', xs)}${anim('opacity', lit)}</rect>`
}

const SCREEN_W = 7
const SCREEN_H = 4

function screen(app: App, x: number, y: number, seed: number, isFailed: boolean, still: boolean): string {
  const w = SCREEN_W
  const h = SCREEN_H
  let out = ''
  if (app === 'term') {
    // a prompt with a blinking cursor
    out += rect({ x, y, w, h, c: '#080b0d' })
    for (let j = 0; j < h - 1; j++) out += scrollLine(x, y + j, w, seed + j, '#8fd6a8', '#f0fff4', still)
    out += rect({ x, y: y + h - 1, w: 1, h: 1, c: ACC.work }) + `<rect x="${x + 2}" y="${y + h - 1}" width="1" height="1" fill="#f0fff4">${blinkAnim('opacity', '1', '0', 500)}</rect>`
  } else if (app === 'diff') {
    // removed lines in red, added in green
    out += rect({ x, y, w, h, c: '#101418' })
    for (let j = 0; j < h; j++) out += scrollLine(x, y + j, w, seed + j, j % 3 === 1 ? '#f08080' : j % 3 === 2 ? '#80e090' : '#8c96a0', '#ffffff', still)
  } else if (app === 'web') {
    // a browser bar over blue text
    out += rect({ x, y, w, h, c: '#0c1826' }) + rect({ x, y, w, h: 1, c: '#34587a' })
    for (let j = 1; j < h; j++) out += scrollLine(x, y + j, w, seed + j * 3, ACC.data, '#eaf8ff', still)
  } else if (app === 'files') {
    // a folder icon per row
    out += rect({ x, y, w, h, c: '#15130b' })
    for (let j = 0; j < h; j++) out += rect({ x, y: y + j, w: 1, h: 1, c: '#e6c35c' }) + scrollLine(x + 2, y + j, w - 2, seed + j, '#b8b0a0', '#fff2b0', still)
  } else if (app === 'code') {
    out += rect({ x, y, w, h, c: '#101418' })
    for (let j = 0; j < h; j++) out += scrollLine(x, y + j, w, seed + j * 2, '#c8d0d8', '#9fd0ff', still)
  } else {
    // thinking: soft green notes that breathe
    out += rect({ x, y, w, h, c: '#0e1612' })
    for (let j = 0; j < h; j++) out += scrollLine(x, y + j, w, seed + j, PHOSPHOR, '#e8fff0', still)
    out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#0e1612" opacity="0"><animate attributeName="opacity" values="0;0.3;0" dur="3s" ${loopBegin(3)} repeatCount="indefinite"/></rect>`
  }
  if (isFailed) out += rect({ x, y, w, h, c: PROP_FAIL }, ' opacity="0.35"')
  return out
}

// A machine's fading glow as a tool call comes back.
function flash(p: Pt, w: number, h: number, color: string, since: number): string {
  const age = Math.max(0, since)
  if (age >= 1) return ''
  return `<ellipse cx="${r1(p.x)}" cy="${r1(p.y)}" rx="${w / 2 + 2}" ry="${h / 2 + 2}" fill="${color}" opacity="0"><animate attributeName="opacity" values="0.45;0" dur="1s" begin="-${r2(age)}s" fill="freeze"/></ellipse>`
}

// ---------- where everyone is going ----------

type Worker = { resident: Resident; spot: Pt; room: Room; seat: number }
type Motion = {
  keys: Key[]
  t0: number
  total: number
  isLoop: boolean
  walk: Span[]
  sit: Span[]
  sleep: Span[]
  faces: { t: number; dir: Dir }[]
  says: { t0: number; t1: number; text: string }[]
  talk: Span[]
  hop: Span[]
  wave: Span[]
  juggle: Span[]
  spark: Span[]
  born?: number
  from?: Pt
  lead?: Pt
  // a courier's box: carried until `dropAt` seconds in, then on the pallet
  carry?: Span[]
  dropAt?: number
  // a visitor's time in sight, on the road
  shown?: Span
}

// let go by its session: walks out to the street, whatever it was doing
const isLeaving = (c: Resident) => c.leaving !== undefined
const isWorking = (c: Resident) => !isLeaving(c) && (c.status === 'working' || c.status === 'waiting')
// finished, taking its box out before it idles
const isCourier = (c: Resident) => c.carrying === true && !isWorking(c) && !isLeaving(c)
// a visitor on its way in from the street
const isArriving = (c: Resident) => c.arriving !== undefined && !isWorking(c) && !isCourier(c) && !isLeaving(c)
// on a walk with an end
const isOnErrand = (c: Resident) => isCourier(c) || isArriving(c) || isLeaving(c)
const layoutKey = (L: Layout) => `${L.pw}x${L.ph}`
const anchorOf = (c: Resident, L: Layout) => (c.anchor && c.anchor.key === layoutKey(L) ? c.anchor : undefined)
const speedOf = (c: Resident) => (c.kind === 'main' ? 17 : 14) * temperament(c.id).pace
// Heading to a new task is a brisk walk.
const rushOf = (c: Resident) => speedOf(c) * 1.5

// Each worker's desk: the sticky one the hooks gave it, or for older saves the lowest free one.
function seatsOf(L: Layout, list: Resident[]): Worker[] {
  const used = new Map<Room, Set<number>>()
  const usedIn = (room: Room) => used.get(room) ?? used.set(room, new Set()).get(room)!
  const working = list.filter(isWorking)
  for (const c of working) if (c.seat !== undefined) usedIn(c.room).add(c.seat)
  return working.map(c => {
    let seat = c.seat
    if (seat === undefined) {
      seat = 0
      while (usedIn(c.room).has(seat)) seat++
      usedIn(c.room).add(seat)
    }
    return { resident: c, spot: workSpot(L.rooms[c.room], seat), room: c.room, seat }
  })
}

// The first idle plan and book first, so a newcomer never changes an older plan.
function idleOrder(list: Resident[]): Resident[] {
  return list.filter(c => !isWorking(c) && !isOnErrand(c)).sort((a, b) => (a.idleSince ?? 0) - (b.idleSince ?? 0) || (a.id < b.id ? -1 : 1))
}

const t0Of = (c: Resident, L: Layout) => anchorOf(c, L)?.t ?? c.idleSince ?? 0

function idleStart(L: Layout, c: Resident): { room: Place; at: Pt } {
  const a = anchorOf(c, L)
  return a ? { room: a.room, at: { x: a.x, y: a.y } } : idleHome(L, c)
}

// Visitors come and go by the road's end, each in its own lane.
function streetOf(L: Layout, id: string): Pt {
  const r = yardOf(L).road
  return { x: (r.x0 + r.x1) / 2 + laneOf(id) * 1.5, y: r.y1 - 12 }
}

// Another session's new member: waits unseen at the street, sets off `wait` seconds from now, walks in.
export function arrive(c: Resident, now: number, wait = 0): Resident {
  const L = LAYOUT
  const p = streetOf(L, c.id)
  return { ...c, anchor: { t: now, x: p.x, y: p.y, room: 'yard', key: layoutKey(L) }, arriving: now + Math.round(wait * 1000) }
}

// Starts a timeline, a visitor first waiting unseen; returns when it sets off.
function setOff(m: Motion, c: Resident, at: Pt, room: Place): number {
  m.keys.push({ t: 0, p: at, room })
  const wait = c.arriving !== undefined ? Math.max(0, (c.arriving - m.t0) / 1000) : 0
  if (wait > 0) {
    m.keys.push({ t: wait, p: at, room })
    m.shown = [wait, Infinity]
  }
  return wait
}

// Appends a walk through the doorways from time t; returns when it arrives.
function walkPath(L: Layout, m: Motion, fromRoom: Place, from: Pt, toRoom: Place, to: Pt, speed: number, t: number, lane = 0): number {
  const start = t
  let last = from
  const pts = route(L, fromRoom, from, toRoom, to, lane)
  for (const p of pts.slice(1)) {
    const dx = p.x - last.x
    const dy = p.y - last.y
    const d = Math.hypot(dx, dy)
    if (d < 0.5) continue
    m.faces.push({ t, dir: heading(dx, dy) })
    t += d / speed
    m.keys.push({ t, p, room: p === pts[pts.length - 1] ? toRoom : roomAt(L, p, fromRoom) })
    last = p
  }
  if (t > start) m.walk.push([start, t])
  return t
}

const blank = (t0: number): Motion => ({
  keys: [], t0, total: 0.01, isLoop: false, walk: [], sit: [], sleep: [], faces: [], says: [], talk: [], hop: [], wave: [], juggle: [], spark: [],
})

// Every agent's timeline, from where it stood when its plan last changed, so a new plan is a walk, not
// a jump. `idle` false skips the idle.
function motionsOf(L: Layout, props: Prop[], list: Resident[], now: number, idle = true): { workers: Worker[]; motions: Map<string, Motion> } {
  const workers = seatsOf(L, list)
  const motions = new Map<string, Motion>()

  for (const w of workers) {
    const c = w.resident
    const a = anchorOf(c, L)
    let m: Motion
    if (!a && c.spawnedAt !== undefined) {
      // new: appears by the first desk of the room its parent was in (not the parent's own desk if it
      // sat at another), gets its parcel, then walks to its own desk
      const room = c.spawnRoom ?? 'study'
      const lead = workSpot(L.rooms[room], 0)
      const from = { x: lead.x + 10, y: Math.min(lead.y + 8, floorBottom(L.rooms[room])) }
      m = { ...blank(c.spawnedAt), born: c.spawnedAt, from, lead }
      m.keys.push({ t: 0, p: from, room }, { t: 0.9, p: from, room })
      m.faces.push({ t: 0, dir: 'S' })
      m.total = walkPath(L, m, room, from, c.room, w.spot, rushOf(c), 0.9, laneOf(c.id))
    } else if (a) {
      const from = { x: a.x, y: a.y }
      m = blank(a.t)
      m.total = Math.max(0.01, walkPath(L, m, a.room, from, c.room, w.spot, rushOf(c), setOff(m, c, from, a.room), laneOf(c.id)))
    } else {
      m = blank(now)
      m.keys.push({ t: 0, p: w.spot, room: c.room })
    }
    m.faces.push({ t: m.total, dir: c.status === 'waiting' ? 'S' : 'N' })
    motions.set(c.id, m)
  }

  // couriers: out to the pallets and back in to where they will idle
  for (const c of list.filter(isCourier)) {
    const a = anchorOf(c, L)
    const start = a ? { room: a.room, at: { x: a.x, y: a.y } } : idleHome(L, c)
    const drop = dropOf(L, c)
    const home = idleHome(L, c)
    // no anchor or end time (another session's, older build): timed from its last move so the walk ends
    const m = blank(a?.t ?? c.doneAt ?? c.movedAt)
    let t = walkPath(L, m, start.room, start.at, 'yard', drop.at, speedOf(c), setOff(m, c, start.at, start.room), laneOf(c.id))
    m.faces.push({ t, dir: drop.face })
    m.dropAt = t + SET_DOWN / 2
    m.carry = [[0, m.dropAt]]
    m.says.push({ t0: m.dropAt, t1: m.dropAt + 2.4, text: pick(LINES_SHIP, rng(hash('ship:' + c.id))) })
    t += SET_DOWN
    m.keys.push({ t, p: drop.at, room: 'yard' })
    t = walkPath(L, m, 'yard', drop.at, home.room, home.at, speedOf(c), t, laneOf(c.id))
    m.faces.push({ t, dir: 'S' })
    m.total = Math.max(0.01, t)
    motions.set(c.id, m)
  }

  // visitors: in from the street, or back out of sight at its end
  for (const c of list.filter(isArriving)) {
    const start = idleStart(L, c)
    const home = idleHome(L, c)
    const m = blank(anchorOf(c, L)?.t ?? now)
    const t = walkPath(L, m, start.room, start.at, home.room, home.at, speedOf(c), setOff(m, c, start.at, start.room), laneOf(c.id))
    m.faces.push({ t, dir: 'S' })
    m.total = Math.max(0.01, t)
    motions.set(c.id, m)
  }
  for (const c of list.filter(isLeaving)) {
    const start = idleStart(L, c)
    const m = blank(anchorOf(c, L)?.t ?? c.leaving ?? now)
    m.keys.push({ t: 0, p: start.at, room: start.room })
    const t = walkPath(L, m, start.room, start.at, 'yard', streetOf(L, c.id), speedOf(c), 0, laneOf(c.id))
    m.shown = [0, t]
    m.total = t + 0.1
    motions.set(c.id, m)
  }

  if (!idle) return { workers, motions }
  const idleList = idleOrder(list)
  const resting = restingOf(idleList)
  const awake = idleList.filter(c => !resting.has(c.id))
  const meetings = huddles(L, awake, c => mod(t0Of(c, L) / 1000))
  const bookings: Bookings = new Map()
  const busy = workers.map(w => w.spot)
  for (const c of idleList.filter(c => resting.has(c.id))) {
    const start = idleStart(L, c)
    motions.set(c.id, { ...blank(t0Of(c, L)), keys: [{ t: 0, p: start.at, room: start.room }], total: LOOP, isLoop: true, sleep: [[0, LOOP]], faces: [{ t: 0, dir: 'S' }] })
  }
  awake.forEach((c, k) => {
    const plan = planIdle(L, props, c, idleStart(L, c), meetings.get(c.id) ?? [], {
      bookings,
      offset: mod(t0Of(c, L) / 1000),
      crowd: k + 1,
      watch: watchedBy(c, workers).map(w => ({ room: w.room, spot: w.spot })),
      busy,
    })
    motions.set(c.id, {
      keys: plan.keys, t0: t0Of(c, L), total: LOOP, isLoop: true,
      walk: plan.walk, sit: plan.sit, sleep: plan.sleep, faces: plan.faces, says: plan.says, talk: plan.talk,
      hop: plan.hop, wave: plan.wave, juggle: plan.juggle, spark: plan.spark,
    })
  })
  return { workers, motions }
}

// Seconds a courier spends setting its box down.
const SET_DOWN = 1.2

// Where a courier sets its box down: beside its pallet, or at the mailbox once the pallets are full.
function dropOf(L: Layout, c: Resident): { at: Pt; face: Dir } {
  const y = yardOf(L)
  const spot = boxSpots(L)[c.box ?? 0]
  if (!spot) return { at: { x: y.mailbox.x + 3.5, y: y.mailbox.y + 1 }, face: 'W' }
  const d = y.drops[spot.pallet] as Pt
  return { at: { x: d.x, y: d.y + ((c.box ?? 0) % 2 ? 1.5 : -1.5) }, face: 'W' }
}

// When each errand ends (clock ms, by id).
export function errandEnds(list: Resident[], now: number): Map<string, number> {
  const L = LAYOUT
  const { motions } = motionsOf(L, PROPS, list, now, false)
  const out = new Map<string, number>()
  for (const c of list) {
    const m = motions.get(c.id)
    if (m && !m.isLoop && (isCourier(c) || isLeaving(c) || c.arriving !== undefined)) out.set(c.id, m.t0 + m.total * 1000)
  }
  return out
}

function localTime(m: Motion, now: number): number {
  const s = (now - m.t0) / 1000
  return m.isLoop ? mod(s) : Math.max(0, Math.min(s, m.total))
}

// Whom an idle lead looks in on: its own session's agents at work.
const watchedBy = (c: Resident, workers: Worker[]) =>
  (c.kind === 'main' ? workers.filter(w => w.resident.id !== c.id && w.resident.session === c.session) : [])

// What an idle plan is made from; any change means a new plan, so the agent is pinned first.
function idleSig(L: Layout, c: Resident, idle: Resident[], seniors: Resident[], workers: Worker[]): string {
  const start = idleStart(L, c).at
  const onBusy = workers.some(w => near(w.spot, start)) ? 1 : 0
  const watch = watchedBy(c, workers).map(w => `${w.room}${w.seat}`).join(',')
  return `i:${c.idleSince ?? 0}:${originOf(L, c)}:${huddleKey(L, c, idle)}:${seniors.map(s => `${s.id}@${t0Of(s, L)}`).join(',')}:${onBusy}:${watch}`
}

// Where a plan sets out from: the anchor, or a newcomer's spawn and room.
function originOf(L: Layout, c: Resident): string {
  const a = anchorOf(c, L)
  return a ? `a${a.t}:${a.room}:${a.x},${a.y}` : `n${c.spawnedAt ?? ''}:${c.spawnRoom ?? ''}:${c.room}`
}

// Everything each agent's plan is made from, by id.
function signatures(L: Layout, list: Resident[]): Map<string, string> {
  const out = new Map<string, string>()
  const workers = seatsOf(L, list)
  for (const w of workers) out.set(w.resident.id, `w:${w.room}:${w.seat}:${originOf(L, w.resident)}:${w.resident.arriving ?? ''}`)
  for (const c of list.filter(isCourier)) out.set(c.id, `c:${c.box ?? 0}:${c.room}:${c.doneAt ?? 0}:${originOf(L, c)}:${c.arriving ?? ''}`)
  for (const c of list.filter(isArriving)) out.set(c.id, `v:${c.arriving}:${c.room}:${originOf(L, c)}`)
  for (const c of list.filter(isLeaving)) out.set(c.id, `l:${c.leaving}:${originOf(L, c)}`)
  const idle = idleOrder(list)
  const resting = restingOf(idle)
  const awake = idle.filter(c => !resting.has(c.id))
  for (const c of idle) if (resting.has(c.id)) out.set(c.id, `r:${originOf(L, c)}`)
  awake.forEach((c, k) => out.set(c.id, idleSig(L, c, awake, awake.slice(0, k), workers)))
  return out
}

// All but the last few to go idle doze where they stand, so a crowd stays light to draw; leads never do.
const AWAKE = 6
function restingOf(idle: Resident[]): Set<string> {
  const others = idle.filter(c => c.kind !== 'main')
  return new Set(others.slice(0, Math.max(0, others.length - AWAKE)).map(c => c.id))
}

// On every household change, pins anyone whose plan will change where it is shown now; a pin can change
// others' plans, so it repeats until none do.
export function reanchor(prev: Resident[], next: Resident[], now: number): Resident[] {
  const L = LAYOUT
  const before = signatures(L, prev)
  let shown: Map<string, Motion> | undefined
  const out = [...next]
  const pin = (i: number) => {
    const c = out[i] as Resident
    shown ??= motionsOf(L, PROPS, prev, now).motions
    const m = shown.get(c.id)
    if (!m || m.keys.length === 0) return
    const at = posAt(m.keys, localTime(m, now))
    const p = { x: r1(at.p.x), y: r1(at.p.y) }
    // the room it stands in, so pinned past a doorway its next walk starts beyond the wall
    out[i] = { ...c, anchor: { t: now, ...p, room: roomAt(L, p, at.room), key: layoutKey(L) } }
  }
  const pinned = new Set<string>()
  for (let changed = true; changed;) {
    changed = false
    for (const [id, sig] of signatures(L, out)) {
      const was = before.get(id)
      if (pinned.has(id) || was === undefined || was === sig) continue
      pin(out.findIndex(x => x.id === id))
      pinned.add(id)
      changed = true
    }
  }
  return out
}

// A timeline as plain data for the hooks to replay: hover zones and the terminal's floor plan.
function trackOf(L: Layout, id: string, m: Motion): Track {
  const keys = m.keys.flatMap(k => { const p = at(L, k.p.x, k.p.y); return [r2(k.t), r1(p.x), r1(p.y)] })
  return { id, t0: m.t0, total: r2(m.total), isLoop: m.isLoop, keys, ...(m.shown ? { shown: m.shown } : {}) }
}

// Where a drawn agent is at `ms`, as the picture plays its track; undefined while out of sight.
export function spotOf(t: Track, ms: number): { x: number; y: number } | undefined {
  const n = Math.floor(t.keys.length / 3)
  if (n === 0) return undefined
  const total = Math.max(0.01, t.total)
  const raw = (ms - t.t0) / 1000
  const s = t.isLoop ? ((raw % total) + total) % total : Math.max(0, Math.min(raw, total))
  if (t.shown && !(s >= t.shown[0] && s < t.shown[1])) return undefined
  const time = (i: number) => (i === 0 ? 0 : i === n - 1 ? total : Math.min(total, t.keys[i * 3] ?? 0))
  let i = 0
  while (i + 1 < n && time(i + 1) <= s) i++
  const x = t.keys[i * 3 + 1] ?? 0
  const y = t.keys[i * 3 + 2] ?? 0
  if (i + 1 >= n || s <= time(i)) return { x, y }
  const f = (s - time(i)) / Math.max(0.001, time(i + 1) - time(i))
  return { x: x + ((t.keys[i * 3 + 4] ?? 0) - x) * f, y: y + ((t.keys[i * 3 + 5] ?? 0) - y) * f }
}

// ---------- the plan's meters ----------

// One exp bar: a plan window (five-hour, weekly), percent used, reset time (clock ms); no percent if unread.
export type Meter = { label: string; percent?: number; color: string; resets?: number }

export function meterColor(m: Meter): string {
  const p = m.percent ?? 0
  return p >= 90 ? '#f2503f' : p >= 75 ? '#f5ac45' : m.color
}

// The plan's windows as exp bars top right, for a picture shown without a band above the prompt.
function meterPanel(L: Layout, meters: Meter[]): string {
  const W = 60
  const ROW = 7
  const x0 = L.w - W
  // in the house's own stretch of the picture
  const y0 = L.extra ?? 0
  const parts: string[] = []
  meters.forEach((m, i) => {
    const y = y0 + i * ROW
    const known = m.percent !== undefined
    const p = m.percent ?? 0
    const color = meterColor(m)
    parts.push(pixelText(m.label.toUpperCase(), x0, y, { color: known ? color : '#6b7380', cls: 'vh-ink' }))
    parts.push(pixelText(known ? `${Math.round(p)}%` : '--', x0 + W, y, { color: known ? '#d8dee9' : '#6b7380', anchor: 'end', cls: 'vh-mp' }))
    // ten cells between the label and the percent
    const filled = Math.round((Math.min(100, p) / 100) * 10)
    let full = ''
    let lit = ''
    let empty = ''
    for (let k = 0; k < 10; k++) {
      const cx = x0 + 17 + k * 3
      if (k < filled) {
        full += `M${cx} ${y + 1}h2v2h-2z`
        lit += `M${cx} ${y}h2v1h-2z`
      } else empty += `M${cx} ${y}h2v3h-2z`
    }
    if (full) parts.push(`<path fill="${color}" d="${full}"/><path fill="${shade(color, 0.45)}" d="${lit}"/>`)
    if (empty) parts.push(`<path class="vh-me" fill="#3a3f4c" d="${empty}"/>`)
  })
  return parts.join('')
}

// ---------- where things are, for hover cards over the picture ----------

// Hover zones are fractions of this, so they fit at any size.
export type HouseGrid = { w: number; h: number }

// `tall`: the whole tall picture; else the house's own stretch of it.
export function houseGrid(tall = false): HouseGrid {
  const L = LAYOUT
  return { w: L.w, h: tall ? L.h : L.h - 2 * (L.extra ?? 0) }
}

// Colours are the dark theme's; this style swaps in light ones in light mode. Classes start `vh-` so
// nothing collides with the page around.
const LIGHT_HOUSE = '.vh-ink{filter:brightness(.6) saturate(1.35)}' +
  '.vh-glow{fill:#fff4d6}.vh-plate{fill:#ffffff}.vh-lamp{display:none}' +
  '.vh-sh{fill:#1a7f37}.vh-mp{fill:#24292f}.vh-me{fill:#eef1f5}'

// A whole garden or house picture, styled for the materials `cv` used, by night and day.
function frame(L: Layout, cv: Canvas, body: string): string {
  const used = [...cv.used.values()]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.w} ${L.h}" width="${L.w * 8}" height="${L.h * 8}" shape-rendering="crispEdges" style="display:block">` +
    `<style>${styleOf(used, 'night')}@media (prefers-color-scheme: light){${LIGHT_HOUSE}${styleOf(used, 'day')}}</style>${body}</svg>`
}

// ---------- the house ----------

// The surface refuses Svg past SVG_LIMIT characters; the house and each agent overlay keep to MAX_SOURCE.
export const SVG_LIMIT = 131072
const MAX_SOURCE = 126000
// The most agents drawn at once, ranked as castOf says.
const MAX_DRAWN = 40

// The house's pictures and tracks of exactly the agents drawn, so hovers never find one left out.
// `boxes`: each yard box's session, in order ('' for this one).
export function housePicture(list: Resident[], boxes: string[], now: number): { layers: string[]; tracks: Track[] } {
  const k = castOf(list, now)
  setClock(now)
  const layers = [houseLayerIn(k, boxes, now, MAX_SOURCE), ...agentLayers(LAYOUT, agentSprites(LAYOUT, now, k.motions, k.drawnWorkers, k.errands, k.idle), MAX_SOURCE)]
  return { layers, tracks: tracksOf(k) }
}

// The tracks alone, for a surface that draws its own house.
export function houseTracks(list: Resident[], now: number): Track[] {
  return tracksOf(castOf(list, now))
}

// Who is drawn and how each moves, up to MAX_DRAWN; every working desk lights regardless.
type Cast = { workers: Worker[]; drawnWorkers: Worker[]; motions: Map<string, Motion>; errands: Resident[]; idle: Resident[]; list: Resident[] }
function castOf(list: Resident[], now: number): Cast {
  const { workers, motions } = motionsOf(LAYOUT, PROPS, list, now)
  const idleAll = idleOrder(list)
  const resting = restingOf(idleAll)
  const isLead = (c: Resident) => c.kind === 'main'
  const leads = [...workers.filter(w => isLead(w.resident)).map(w => w.resident), ...idleAll.filter(isLead)]
  // leads always; then workers, errands, the awake idle (latest first), the dozing
  let room = Math.max(0, MAX_DRAWN - leads.length)
  const take = <T>(items: T[]) => {
    const kept = items.slice(0, room)
    room -= kept.length
    return kept
  }
  const drawnWorkers = [...workers.filter(w => isLead(w.resident)), ...take(workers.filter(w => !isLead(w.resident)))]
  const errands = take(list.filter(isOnErrand))
  const others = idleAll.filter(c => !isLead(c)).reverse()
  const idle = [...idleAll.filter(isLead), ...take([...others.filter(c => !resting.has(c.id)), ...others.filter(c => resting.has(c.id))])]
  return { workers, drawnWorkers, motions, errands, idle, list }
}

function tracksOf(k: Cast): Track[] {
  const ids = [...k.drawnWorkers.map(w => w.resident.id), ...k.errands.map(c => c.id), ...k.idle.map(c => c.id)]
  return ids.flatMap(id => { const m = k.motions.get(id); return m && m.keys.length > 0 ? [trackOf(LAYOUT, id, m)] : [] })
}

// The house within `max` characters: stilled if need be, then without the day's boxes.
function houseLayerIn(k: Cast, boxes: string[], now: number, max: number, meters?: Meter[]): string {
  const house = houseLayer(LAYOUT, k.list, boxes, now, k.motions, k.workers, k.errands, meters, false)
  if (house.length <= max) return house
  const still = houseLayer(LAYOUT, k.list, boxes, now, k.motions, k.workers, k.errands, meters, true)
  return still.length <= max ? still : houseLayer(LAYOUT, k.list, [], now, k.motions, k.workers, k.errands, meters, true)
}

// The garden under the house. `reach`: how much height round the house can show; the rest is undrawn.
export function gardenPicture(now: number, reach = Infinity): string {
  setClock(now)
  const L = LAYOUT
  const half = Math.max(houseGrid().h, Math.min(L.h, reach + 60)) / 2
  const picture = gardenLayer(L, { y0: L.h / 2 - half, y1: L.h / 2 + half })
  // past the limit, only the house's own stretch of it
  return picture.length <= SVG_LIMIT ? picture : gardenLayer(L, { y0: L.extra ?? 0, y1: L.h - (L.extra ?? 0) })
}

function gardenLayer(L: Layout, band?: { y0: number; y1: number }): string {
  const cv = new Canvas()
  const defs = gardenPatterns(cv)
  const over = garden(cv, L, band)
  return frame(L, cv, `<defs>${defs}${cv.stamped()}</defs>${cv.svg()}${over}`)
}

// The house's stretch as one picture, garden and plan bars included; within `max` characters, the
// house is stilled and agents left off as need be.
export function svg(list: Resident[], boxes: string[], now: number, meters?: Meter[], max = Infinity): string {
  return onePicture(list, boxes, now, meters, max).source
}

// The same, with the tracks of the agents it draws.
export function onePicture(list: Resident[], boxes: string[], now: number, meters?: Meter[], max = Infinity): { source: string; tracks: Track[] } {
  const L = LAYOUT
  const y0 = L.extra ?? 0
  const { w, h } = houseGrid()
  const size = (layer: string) => layer.replace(`width="${L.w * 8}" height="${L.h * 8}"`, `width="${L.w}" height="${L.h}"`)
  const k = castOf(list, now)
  setClock(now)
  const under = gardenLayer(L, { y0, y1: y0 + h })
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${y0} ${w} ${h}" width="${w * 8}" height="${h * 8}">`
  const room = max - open.length - '</svg>'.length - under.length
  const sprites = agentSprites(L, now, k.motions, k.drawnWorkers, k.errands, k.idle)
  const [everyone] = agentLayers(L, sprites, Infinity, true)
  const house = houseLayerIn(k, boxes, now, room - (everyone?.length ?? 0), meters)
  const [agents] = agentLayers(L, sprites, room - house.length, true)
  return { source: `${open}${[under, house, ...(agents ? [agents] : [])].map(size).join('')}</svg>`, tracks: tracksOf(k) }
}

// The shared parts an agent's picture uses, and the parts those use.
function partsOf(svg: string): string[] {
  const ids = new Set<string>()
  const visit = (text: string) => {
    for (const m of text.matchAll(/(?:href="#|url\(#)([\w-]+)/g)) {
      const id = m[1] as string
      if (ids.has(id) || !bodyDefs.has(id)) continue
      ids.add(id)
      visit(bodyDefs.get(id) ?? '')
    }
  }
  visit(svg)
  return [...ids]
}

// Agents over the house, farthest first, in as few `max`-character pictures as hold them. `once`: one
// picture of those that fit, lowest `rank` first.
type Sprite = { depth: number; svg: string; rank: number }

function agentLayers(L: Layout, sprites: Sprite[], max: number, once = false): string[] {
  if (once) {
    const chosen = new Set<Sprite>()
    const used = new Set<string>()
    let size = 600
    for (const s of [...sprites].sort((a, b) => a.rank - b.rank)) {
      const ids = partsOf(s.svg).filter(id => !used.has(id))
      const more = ids.reduce((n, id) => n + (bodyDefs.get(id)?.length ?? 0), 0) + s.svg.length
      if (size + more > max) continue
      for (const id of ids) used.add(id)
      size += more
      chosen.add(s)
    }
    return agentLayers(L, sprites.filter(s => chosen.has(s)), Infinity)
  }
  const pictures: string[] = []
  let parts = new Map<string, string>()
  let body = ''
  let size = 0
  const close = () => {
    if (body) pictures.push(overlay(L, [...parts.values()].join(''), body))
    parts = new Map()
    body = ''
    size = 0
  }
  for (const s of sprites) {
    const ids = partsOf(s.svg)
    const more = ids.filter(id => !parts.has(id)).reduce((n, id) => n + (bodyDefs.get(id)?.length ?? 0), 0)
    if (600 + size + more + s.svg.length > max && body) close()
    for (const id of ids) {
      if (parts.has(id)) continue
      const def = bodyDefs.get(id) ?? ''
      parts.set(id, def)
      size += def.length
    }
    body += s.svg
    size += s.svg.length
  }
  close()
  return pictures
}

function overlay(L: Layout, defs: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.w} ${L.h}" width="${L.w * 8}" height="${L.h * 8}" shape-rendering="crispEdges" style="display:block">` +
    `<style>@media (prefers-color-scheme: light){${LIGHT_HOUSE}}</style><defs>${defs}</defs>${body}</svg>`
}

// How hot a desk runs: recent tool calls, each fading over about eight seconds.
function heatOf(c: Resident, now: number): number {
  return Math.min(1, (c.calls ?? []).reduce((sum, t) => sum + Math.exp(-Math.max(0, now - t) / 8000), 0) / 3)
}

// Everything but the agents and the garden under it.
function houseLayer(
  L: Layout, list: Resident[], boxes: string[], now: number,
  motions: Map<string, Motion>, workers: Worker[], errands: Resident[], meters: Meter[] | undefined, still: boolean,
): string {
  const cv = new Canvas()
  const patternDefs = patterns(cv)
  // the road and the trees behind the house first
  road(cv, L)
  treesBehind(cv, L)
  const leaves = weather(cv, L)
  cv.raw(leaves.behind)
  shell(cv, L)
  // windows in the outer walls: library, two in the sunroom, kitchen counter
  windowOn(cv, L, 'x', L.rooms.library.x + 12, L.rooms.library.x + 26, 8, 19, 1)
  windowOn(cv, L, 'x', L.rooms.sunroom.x + 3, L.rooms.sunroom.x + 17, 8, 19, 2)
  windowOn(cv, L, 'x', L.rooms.sunroom.x + 21, L.rooms.sunroom.x + 35, 8, 19, 3)
  windowOn(cv, L, 'y', L.rooms.kitchen.y + 15, L.rooms.kitchen.y + 27, 8, 19, 4)

  // the rooms, back to front, so nearer furniture stands over farther
  const order = [...ALL_ROOMS].sort((a, b) => L.rooms[a].col + L.rooms[a].row - (L.rooms[b].col + L.rooms[b].row) || L.rooms[a].col - L.rooms[b].col)
  const labels: string[] = []
  for (const room of order) {
    const c = L.rooms[room]
    const here = workers.filter(w => w.room === room)
    const isBusy = here.length > 0
    const extra = furniture(cv, L, room, c)
    if (extra) cv.raw(extra)
    if (room !== 'lounge') {
      // each desk lit by whoever holds that seat
      for (let i = 0; i < DESKS; i++) {
        const sitter = here.find(w => w.seat === i)?.resident
        const d = desk(cv, L, room, c, i)
        const status = !sitter ? 'idle' : sitter.status === 'waiting' ? 'waiting' : sitter.isOk === false ? 'failed' : 'working'
        let out = ''
        if (sitter) {
          out += `<g transform="matrix(1 0.5 0 1 ${r1(d.screen.x)} ${r1(d.screen.y)})">${screen(appFor(sitter.tool), 0, 0, hash(`${room}${i}`) % 6, status === 'failed', still)}</g>`
          // a desk making calls in quick succession glows brighter, then cools
          const glow = r1(0.08 + 0.32 * heatOf(sitter, now))
          out += `<ellipse cx="${r1(d.screen.x + 3.5)}" cy="${r1(d.screen.y + 3.8)}" rx="6" ry="5" fill="${PHOSPHOR}" opacity="${glow}"><animate attributeName="opacity" values="${glow};0.08" dur="8s" fill="freeze"/></ellipse>`
          const failAge = sitter.isOk === false && sitter.resultAt ? Math.max(0, (now - sitter.resultAt) / 1000) : undefined
          if (failAge !== undefined && failAge < 1) {
            out += `<ellipse cx="${r1(d.screen.x + 3.5)}" cy="${r1(d.screen.y + 6)}" rx="9" ry="8" fill="${ACC.alert}" opacity="0"><animate attributeName="opacity" values="0.35;0.1;0.35;0.1;0.35;0" keyTimes="0;0.2;0.4;0.6;0.8;1" calcMode="discrete" dur="1s" begin="-${r2(failAge)}s" fill="freeze"/></ellipse>`
          }
        }
        const pulse = status === 'working' ? `<animate attributeName="opacity" values="0.4;1;0.4" dur="1.3s" ${loopBegin(1.3)} repeatCount="indefinite"/>`
          : status === 'failed' ? blinkAnim('opacity', '1', '0.4', 1000) : status === 'idle' ? `<animate attributeName="opacity" values="1;0.15;1" dur="2.4s" ${loopBegin(2.4)} repeatCount="indefinite"/>` : ''
        out += `<rect x="${Math.round(d.light.x)}" y="${Math.round(d.light.y)}" width="1" height="1" fill="${LAMP[status]}">${pulse}</rect>`
        cv.raw(out)
      }
      const latest = here.map(w => w.resident).filter(w => w.resultAt).sort((a, b) => (b.resultAt ?? 0) - (a.resultAt ?? 0))[0]
      const m = machine(L, room, c)
      if (latest?.resultAt && m) cv.raw(flash(m.at, m.w, m.h, latest.isOk === false ? PROP_FAIL : MACHINE_GLOW[room], (now - latest.resultAt) / 1000))
    }

    // lamps: a work room dims half a minute after its last work; the lounge stays lit
    const lamp = (opacity: string, anim = '') => floor(cv, L, c, '#ffcf7a', ` class="vh-glow" opacity="${opacity}"`, anim)
    if (room === 'lounge') lamp('0.1')
    else if (isBusy) lamp('0.16')
    else {
      const last = Math.max(0, ...list.filter(m => m.room === room).map(m => m.resultAt ?? m.movedAt ?? 0))
      if (last > 0 && now - last < 32000) lamp('0.16', `<animate attributeName="opacity" values="0.16;0" dur="2s" begin="${r2((last + 30000 - now) / 1000)}s" fill="freeze"/>`)
    }

    // the room's label is its current activity
    const top = [...here].sort((p, q) => q.resident.movedAt - p.resident.movedAt)[0]
    if (top) {
      const label = fitText(top.resident.activity + (here.length > 1 ? ` +${here.length - 1}` : ''), 44, PX)
      // on a tall outer wall if the room has one, else over its left low wall
      const spot = c.row === 0 ? at(L, c.x + c.w / 2, T, TALL_WALL - 3) : c.col === 0 ? at(L, T, c.y + c.h / 2, TALL_WALL - 3) : at(L, c.x, c.y + c.h / 2, 11)
      const w = textWidth(label, PX) + 4
      labels.push(`<rect class="vh-plate" x="${r1(spot.x - w / 2)}" y="${r1(spot.y - 1)}" width="${r1(w)}" height="6" fill="#0b0d10" opacity="0.55"/>` +
        pixelText(label, Math.round(spot.x), Math.round(spot.y), { color: ROOM_STYLE[room].ink, anchor: 'middle', cls: 'vh-ink' }))
    }
  }
  frontWalls(cv, L)
  // yard and front trees, back to front; a courier's box lands as it is set down
  const pile = new Map<number, Parcel>(boxes.map((session, i) => [i, { tape: teamOf(session) }]))
  for (const c of errands) {
    const m = motions.get(c.id)
    if (m?.dropAt !== undefined) pile.set(c.box ?? 0, { tape: teamOf(c.session ?? ''), lands: (m.t0 - now) / 1000 + m.dropAt })
  }
  for (const piece of [...frontTrees(L), ...yardPieces(L, pile)].sort((a, b) => a.depth - b.depth)) piece.draw(cv)
  // today's box count
  const sign = signAt(L)
  const [sx, sy] = [Math.round(sign.x), Math.round(sign.y)]
  labels.push(`<g transform="translate(${sx} ${sy})">${boxIcon(TAPE)}</g>` +
    pixelText(String(boxes.length), sx + 6.5, sy + 0.5, { color: '#9adcb0', cls: 'vh-sh' }))
  cv.raw(lamps(cv, L))

  const body = `<defs>${patternDefs}${cv.stamped()}</defs>` + cv.svg() + labels.join('') + leaves.front
  return frame(L, cv, body + (meters && meters.length > 0 ? meterPanel(L, meters) : ''))
}

// Everyone, as sprites with how near each stands, to be laid farthest first.
function agentSprites(L: Layout, now: number, motions: Map<string, Motion>, workers: Worker[], errands: Resident[], idle: Resident[]): Sprite[] {
  bodyDefs = new Map()
  const P = (p: Pt) => at(L, p.x, p.y)
  const sprites: Sprite[] = []
  // ranks: leads, workers, errands, idle
  const rankOf = (c: Resident, rank: number) => (c.kind === 'main' ? 0 : rank)
  const depth = (p: Pt) => p.x + p.y

  // workers: to the desk, then typing, backs to you
  for (const w of workers) {
    const c = w.resident
    const m = motions.get(c.id) ?? blank(now)
    const age = localTime(m, now)
    const bornAge = m.born !== undefined ? Math.max(0, (now - m.born) / 1000) : Infinity
    const from = m.from
    const leadAt = m.lead ?? workSpot(L.rooms.study, 0)
    const isWalking = m.walk.length > 0 && age < m.total
    const waiting = c.status === 'waiting'
    let bubbles = ''
    if (waiting) {
      // waiting on a permission prompt: an amber sign naming the tool
      const ask = fitText(c.waitingTool ? `APPROVE ${c.waitingTool}?` : 'AWAITING APPROVAL', 56, PX)
      const w2 = textWidth(ask, PX) + 7
      bubbles += `<g transform="translate(${r1(-w2 / 2)} -24)"><rect x="0" y="0" width="${r1(w2)}" height="6" fill="#1a1004" opacity="0.75"/>` +
        `<g>${agentText(ask, 2, 1.3, { color: '#f5c47a' })}<animate attributeName="opacity" values="0.6;1;0.6" dur="2s" ${loopBegin(2)} repeatCount="indefinite"/></g>` +
        `<rect x="${r1(w2 - 3)}" y="1.5" width="1.2" height="3" fill="#f7dcae">${blinkAnim('opacity', '1', '0', 1000)}</rect></g>`
    } else if (bornAge < 4.2) {
      bubbles += group(textBubble('on my way'), track([[0, 4.2]], 4.3, bornAge, false))
    } else if (c.isOk === false && c.resultAt && (now - c.resultAt) / 1000 < 4.2) {
      const age2 = Math.max(0, (now - c.resultAt) / 1000)
      bubbles += group(textBubble(pick(LINES_ERROR, rng(hash(c.id + c.resultAt))), '#ff4a3d'), track([[0, 4.2]], 4.3, age2, false))
    } else if (!isWalking) {
      // working dots
      bubbles += [0, 1, 2].map(i => `<rect x="${-2 + i * 2}" y="-19" width="1" height="1" fill="#fff"><animate attributeName="opacity" values="0;1;0" dur="0.9s" ${loopBegin(0.9, -i * 0.3)} repeatCount="indefinite"/></rect>`).join('')
    }
    const total = Math.max(m.total, 0.02)
    const keys = m.keys.map(k => ({ ...k, p: P(k.p) }))
    let svg = agentSvg(c, {
      at: P(w.spot),
      motion: isWalking ? motionOf(keys, total, age, false) : '',
      total, begin: Math.min(age, total), isLoop: false,
      walk: isWalking ? m.walk : [], sit: [], sleep: [],
      faces: isWalking ? m.faces : [{ t: 0, dir: waiting ? 'S' : 'N' }],
      typing: !isWalking && !waiting,
      bubbles,
      nameDy: w.seat % 2 === 1 ? 4 : 0,
    })
    // a parcel in the new agent's colour tossed over from the lead
    if (bornAge < 0.8 && c.id !== 'main') {
      const a = P(leadAt)
      const b = P(from ?? w.spot)
      const values: string[] = []
      for (let i = 0; i <= 8; i++) {
        const u = i / 8
        const ease = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2
        values.push(`${r1(a.x + (b.x - a.x) * ease - 2)} ${r1(a.y - 8 + (b.y - a.y) * ease - Math.sin(u * Math.PI) * 9)}`)
      }
      svg += `<g opacity="1"><animateTransform attributeName="transform" type="translate" values="${values.join(';')}" dur="0.8s" begin="-${r2(bornAge)}s" fill="freeze"/>` +
        `<animate attributeName="opacity" values="1;0" keyTimes="0;0.99" calcMode="discrete" dur="0.8s" begin="-${r2(bornAge)}s" fill="freeze"/>` +
        `${rect({ x: 0, y: 0, w: 4, h: 4, c: colorFor(c) })}${rect({ x: 0, y: 0, w: 4, h: 1, c: shade(colorFor(c), 0.45) })}</g>`
    }
    // rings where it appears
    if (bornAge < 1.5 && from) {
      const f = P(from)
      for (let i = 0; i < 3; i++) {
        svg += `<ellipse cx="${r1(f.x)}" cy="${r1(f.y)}" rx="0" ry="0" fill="none" stroke="${colorFor(c)}" stroke-width="0.6" opacity="0">` +
          `<animate attributeName="rx" values="1;10" dur="1s" begin="${r2(i * 0.25 - bornAge)}s" fill="freeze"/><animate attributeName="ry" values="0.5;5" dur="1s" begin="${r2(i * 0.25 - bornAge)}s" fill="freeze"/>` +
          `<animate attributeName="opacity" values="0.9;0" dur="1s" begin="${r2(i * 0.25 - bornAge)}s" fill="freeze"/></ellipse>`
      }
    }
    if (m.shown) svg = group(svg, track([m.shown], total, Math.min(age, total), false))
    sprites.push({ depth: depth(isWalking ? posAt(m.keys, age).p : w.spot), svg, rank: rankOf(c, 1) })
  }

  // couriers and visitors
  for (const c of errands) {
    const m = motions.get(c.id)
    if (!m || m.keys.length === 0) continue
    const age = localTime(m, now)
    const keys = m.keys.map(k => ({ ...k, p: P(k.p) }))
    const svg = agentSvg(c, {
      at: (keys[0] as Key).p,
      motion: motionOf(keys, m.total, age, false),
      total: m.total, begin: age, isLoop: false,
      walk: m.walk, sit: [], sleep: [], faces: m.faces, carry: m.carry,
      bubbles: sayBubbles(m.says, m.total, age, false),
    })
    sprites.push({ depth: depth(posAt(m.keys, age).p), svg: m.shown ? group(svg, track([m.shown], m.total, age, false)) : svg, rank: rankOf(c, 2) })
  }

  // idle agents, looping from where the plan last changed
  for (const c of idle) {
    const m = motions.get(c.id)
    if (!m || m.keys.length === 0) continue
    const begin = localTime(m, now)
    const bubbles = sayBubbles(m.says, LOOP, begin, true) + talkBubbles(c, m.talk, LOOP, begin, true)
    const keys = m.keys.map(k => ({ ...k, p: P(k.p) }))
    sprites.push({
      depth: depth(posAt(m.keys, begin).p),
      rank: rankOf(c, 3),
      svg: agentSvg(c, {
        at: (keys[0] as Key).p,
        motion: motionOf(keys, LOOP, begin, true),
        total: LOOP, begin, isLoop: true,
        walk: m.walk, sit: m.sit, sleep: m.sleep, faces: m.faces,
        hop: m.hop, wave: m.wave, juggle: m.juggle, spark: m.spark,
        bubbles,
      }),
    })
  }

  return sprites.sort((a, b) => a.depth - b.depth)
}
