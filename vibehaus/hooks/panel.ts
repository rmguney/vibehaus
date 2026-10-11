/*
 * The tasks list, a section for each session in the house: its name, which
 * folds it, a line of what it has going, the Host's line, then every
 * subagent, shell, monitor and workflow, grouped by kind, running ones first.
 * Laid out here as items, which the desktop and the terminal draw in their
 * own text (lines.tsx); and drawn here as a picture in the house's pixel
 * font, for a surface that only shows pictures (the mobile app), live between
 * redraws by itself: Claude Code's spinner and every running time are SMIL
 * timelines anchored to the clock, so a redraw picks them up mid-count. The
 * house's hover cards are drawn here too.
 */
import type { Household, TaskRow, TaskStats } from '../types'
import { fitText, pathOf, pixelText, rectsOf, reel, textWidth, wrapText } from './font'

const PX = 0.5
const PAD = 4
const LINE = 6
const MAX_ROWS = 30
// the picture is refused past 131,072 characters
const MAX_SOURCE = 120000

const BRIGHT = '#e8e8f0'
export const DIM = '#8c96a0'
const FAINT = '#6b7380'

// The panel follows the app's light or dark appearance by itself: its colours
// are the dark theme's, and this style swaps in the light theme's when shown
// in light mode. Neutral text takes the light theme's greys; anything coloured
// is darkened to keep its contrast.
const LIGHT_PANEL = '@media (prefers-color-scheme: light){' +
  '.vh-p1{fill:#1f2328}.vh-p2{fill:#57606a}.vh-p3{fill:#8c959f}' +
  '.vh-ink{filter:brightness(.6) saturate(1.35)}.vh-cbg{fill:#ffffff}' +
  '}'
const NEUTRAL: Record<string, string> = { [BRIGHT]: 'vh-p1', [DIM]: 'vh-p2', [FAINT]: 'vh-p3' }
const classOf = (color: string) => NEUTRAL[color] ?? 'vh-ink'

// Pixel text whose colour follows the theme.
function say(text: string, x: number, y: number, o: { color: string; anchor?: 'start' | 'middle' | 'end' }): string {
  return pixelText(text, x, y, { ...o, cls: classOf(o.color) })
}
export const CLAUDE = '#d97757'
export const SHIMMER = '#f2b49a'

// A row's state mark, Claude Code's own; running, its spinner.
export const ICON: Record<TaskRow['state'], [string, string]> = {
  running: ['', CLAUDE],
  pending: ['○', DIM],
  waiting: ['◷', '#f5c47a'],
  idle: ['◦', DIM],
  done: ['✓', '#80e090'],
  failed: ['✕', '#f08080'],
  stopped: ['⊘', DIM],
}

// The background tasks' kinds, in the list's order; the lead's row stands
// before them all, as the Host's line.
type Kind = Exclude<TaskRow['group'], 'Lead'>
const KINDS: Kind[] = ['Agents', 'Shells', 'Monitors', 'Workflows', 'Other']
const NOUN: Record<Kind, [string, string]> = {
  Agents: ['agent', 'agents'],
  Shells: ['shell', 'shells'],
  Monitors: ['monitor', 'monitors'],
  Workflows: ['workflow', 'workflows'],
  Other: ['task', 'tasks'],
}

export const isLive = (r: TaskRow) => r.state === 'running' || r.state === 'waiting' || r.state === 'pending'
const r2 = (n: number) => Math.round(n * 100) / 100
const r3 = (n: number) => Math.round(n * 1000) / 1000

// ---------- Claude Code's spinner, in pixels ----------

// Its six glyphs (· ✢ * ✶ ✻ ✽) as 7x7 stars, as tall as a capital, played
// forwards then backwards, a frame every 120 ms, as Claude Code plays them.
const STAR = [
  ['.......', '.......', '.......', '...#...', '.......', '.......', '.......'],
  ['.......', '.......', '...#...', '..###..', '...#...', '.......', '.......'],
  ['.......', '.......', '..#.#..', '...#...', '..#.#..', '.......', '.......'],
  ['.......', '...#...', '..###..', '.#####.', '..###..', '...#...', '.......'],
  ['.......', '.#.#.#.', '..###..', '.#####.', '..###..', '.#.#.#.', '.......'],
  ['#..#..#', '.#.#.#.', '..###..', '#######', '..###..', '.#.#.#.', '#..#..#'],
]
const SPIN_SEQ = [0, 1, 2, 3, 4, 5, 5, 4, 3, 2, 1, 0]
const FRAME_S = 0.12

// One spinner, defined once and placed on every running row; its phase is
// the clock's, so a redraw never restarts it and every row turns together.
function spinnerDef(now: number): string {
  const dur = r3(SPIN_SEQ.length * FRAME_S)
  const begin = r3(-((now / 1000) % dur))
  const keyTimes = SPIN_SEQ.map((_, i) => r3(i / SPIN_SEQ.length)).join(';')
  const frames = STAR.map((rows, f) =>
    `<path d="${pathOf(rectsOf(rows))}" opacity="0"><animate attributeName="opacity" values="${SPIN_SEQ.map(k => (k === f ? 1 : 0)).join(';')}" ` +
    `keyTimes="${keyTimes}" calcMode="discrete" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></path>`)
  return `<g id="spin" fill="${CLAUDE}" class="vh-ink">${frames.join('')}</g>`
}

// ---------- running times, as odometers ----------

// Each digit is a reel of glyphs seen through a one-digit window, stepping on
// with the clock: the seconds every second, the tens every ten, and so on.
const REEL_STEP = 9
type Digit = { period: number; mod: 6 | 10 } | ':'

function reelDefs(): string {
  return `<path id="r10" d="${reel([...'0123456789'], REEL_STEP)}"/><path id="r6" d="${reel([...'012345'], REEL_STEP)}"/>` +
    `<clipPath id="win"><rect x="0" y="0" width="5" height="7"/></clipPath>`
}

// Minutes and seconds, with room to count past an hour as 60, 61...; from
// forty minutes on, hours too, and from nine hours tens of hours, so a long
// run never wraps between redraws.
function digitsFor(seconds: number): Digit[] {
  const rest: Digit[] = [':', { period: 600, mod: 6 }, { period: 60, mod: 10 }, ':', { period: 10, mod: 6 }, { period: 1, mod: 10 }]
  if (seconds < 40 * 60) return [{ period: 600, mod: 10 }, { period: 60, mod: 10 }, ':', { period: 10, mod: 6 }, { period: 1, mod: 10 }]
  if (seconds < 9 * 3600) return [{ period: 3600, mod: 10 }, ...rest]
  return [{ period: 36000, mod: 10 }, { period: 3600, mod: 10 }, ...rest]
}

function clockText(seconds: number): string {
  const s = Math.floor(seconds)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return s < 3600 ? `${p2(Math.floor(s / 60))}:${p2(s % 60)}` : `${Math.floor(s / 3600)}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`
}

const clockWidth = (digits: Digit[]) => (digits.reduce((w, d) => w + (d === ':' ? 3 : 6), 0) - 1) * PX

// A row's time, right-aligned at `right`: counting while the task runs,
// fixed once it has ended.
function clock(right: number, y: number, seconds: number, isCounting: boolean, color: string): { svg: string; width: number } {
  if (!isCounting) {
    const text = clockText(seconds)
    return { svg: say(text, right, y, { color, anchor: 'end' }), width: textWidth(text, PX) }
  }
  const digits = digitsFor(seconds)
  const width = clockWidth(digits)
  let x = right - width
  let svg = ''
  for (const d of digits) {
    if (d === ':') {
      svg += say(':', x, y, { color })
      x += 3 * PX
      continue
    }
    const dur = d.period * d.mod
    const values = Array.from({ length: d.mod }, (_, k) => `0 ${-k * REEL_STEP}`).join(';')
    const keyTimes = Array.from({ length: d.mod }, (_, k) => r3(k / d.mod)).join(';')
    svg += `<g transform="translate(${r2(x)} ${r2(y)}) scale(${r3(PX)})" clip-path="url(#win)"><use href="#r${d.mod}" fill="${color}" class="${classOf(color)}">` +
      `<animateTransform attributeName="transform" type="translate" values="${values}" keyTimes="${keyTimes}" calcMode="discrete" ` +
      `dur="${dur}s" begin="${r3(-(seconds % dur))}s" repeatCount="indefinite"/></use></g>`
    x += 6 * PX
  }
  return { svg, width }
}

// ---------- the glimmer on the lead's running line ----------

// As Claude Code's own line glimmers: three letters lit at a time, sweeping
// right to left a letter every 200 ms, with a pause past each end.
let glimmers = 0

function glimmerText(text: string, x: number, y: number, now: number): string {
  const n = [...text].length
  const adv = textWidth(text, PX) / Math.max(1, n)
  const steps = n + 20
  const dur = r3(steps * 0.2)
  const xs = Array.from({ length: steps }, (_, k) => r2(x + (n + 10 - k - 1) * adv)).join(';')
  const keyTimes = Array.from({ length: steps }, (_, k) => r3(k / steps)).join(';')
  const id = `gl${glimmers++}`
  return say(text, x, y, { color: CLAUDE }) +
    `<clipPath id="${id}"><rect x="${r2(x)}" y="${r2(y - 1)}" width="${r2(adv * 3)}" height="${LINE}">` +
    `<animate attributeName="x" values="${xs}" keyTimes="${keyTimes}" calcMode="discrete" dur="${dur}s" begin="${r3(-((now / 1000) % dur))}s" repeatCount="indefinite"/></rect></clipPath>` +
    `<g clip-path="url(#${id})">${say(text, x, y, { color: SHIMMER })}</g>`
}

// ---------- the panel ----------

function counts(rows: TaskRow[]): string[] {
  return KINDS
    .map(g => [g, rows.filter(r => r.group === g).length] as const)
    .filter(([, n]) => n > 0)
    .map(([g, n]) => `${n} ${NOUN[g][n === 1 ? 0 : 1]}`)
}

function statsLine(stats: TaskStats): string {
  return [
    stats.shippedToday > 0 ? `${stats.shippedToday} shipped today` : '',
    stats.toolsPerMinute > 0 ? `${stats.toolsPerMinute} tool${stats.toolsPerMinute === 1 ? '' : 's'} a minute` : '',
  ].filter(Boolean).join(' · ')
}

// The list's sections: one for each session in the house, this one first
// (id ''), or this one alone, under its own title. This one starts open and
// every other session's folded to its heading; the ones in `toggled` were
// turned the other way by a click on their heading.
type Section = { id: string; name: string; label: string; color: string; rows: TaskRow[]; isFolded: boolean }

const isFoldedIn = (toggled: string[], id: string) => (id === '' ? toggled.includes(id) : !toggled.includes(id))

function sectionsOf(rows: TaskRow[], households: Household[], toggled: string[], title: string): Section[] {
  if (households.length < 2) return [{ id: '', name: '', label: title || 'Tasks', color: BRIGHT, rows, isFolded: isFoldedIn(toggled, '') }]
  return households.map(h => ({ id: h.id, name: h.name, label: h.name, color: h.color, rows: rows.filter(r => (r.session ?? '') === h.id), isFolded: isFoldedIn(toggled, h.id) }))
}

// The list as it reads, an item a line (a task's row two): what the picture
// and the text lists all draw. A heading's `name` is the session's, with
// others in the house, its `label` what it shows; `live`: how many of its
// tasks run.
export type ListItem =
  | { kind: 'head'; id: string; name: string; label: string; color: string; live: number; isFolded: boolean }
  | { kind: 'note'; text: string }
  | { kind: 'host'; row: TaskRow }
  | { kind: 'group'; group: Kind }
  | { kind: 'row'; row: TaskRow }
  | { kind: 'more'; count: number }

// At most `limit` rows; the rest of a section counted under "+n more".
function itemsOf(sections: Section[], stats: TaskStats, limit: number): ListItem[] {
  const items: ListItem[] = []
  let shown = 0
  sections.forEach((sec, i) => {
    items.push({ kind: 'head', id: sec.id, name: sec.name, label: sec.label, color: sec.color, live: sec.rows.filter(isLive).length, isFolded: sec.isFolded })
    if (sec.isFolded) return
    const tally = counts(sec.rows)
    const extra = i === 0 ? statsLine(stats) : ''
    items.push({ kind: 'note', text: [tally.length > 0 ? tally.join(' · ') : 'Nothing in the background', extra].filter(Boolean).join(' · ') })
    for (const r of sec.rows.filter(r => r.group === 'Lead')) items.push({ kind: 'host', row: r })
    let hidden = 0
    for (const g of KINDS) {
      const these = sec.rows.filter(r => r.group === g)
      if (these.length === 0) continue
      if (shown >= limit) {
        hidden += these.length
        continue
      }
      items.push({ kind: 'group', group: g })
      for (const r of these) {
        if (shown >= limit) {
          hidden++
          continue
        }
        shown++
        items.push({ kind: 'row', row: r })
      }
    }
    if (hidden > 0) items.push({ kind: 'more', count: hidden })
  })
  return items
}

// The list's items for the desktop and the terminal, which draw them in
// their own text; `title` names this session's section while it is alone.
export function listItems(rows: TaskRow[], stats: TaskStats, households: Household[], toggled: string[], title: string): ListItem[] {
  return itemsOf(sectionsOf(rows, households, toggled, title), stats, MAX_ROWS)
}

// A section's heading: a mark for whether it is folded before its name, and
// how many of its tasks run, worded as the app's own background tasks are.
export const headOf = (it: Extract<ListItem, { kind: 'head' }>) => ({
  lead: it.isFolded ? '▸ ' : '▾ ',
  count: `${it.live} running`,
})


// What the panel says, for a reader that cannot see it: one line per thing.
function altOf(items: ListItem[]): string {
  const lines = items.map(it => {
    switch (it.kind) {
      case 'head': return `Tasks${it.name ? ` from "${it.name}"` : ''} · ${headOf(it).count}${it.isFolded ? ' · folded' : ''}`
      case 'note': return it.text
      case 'group': return it.group
      case 'host':
      case 'row': return [it.row.title, it.row.detail, it.row.usage ?? ''].filter(Boolean).join(' · ')
      case 'more': return `+${it.count} more`
    }
  })
  return lines.filter(Boolean).join('\n').slice(0, 4000)
}

// The panel as drawn: its picture, what it says, its size.
type Panel = { source: string; alt: string }

function draw(items: ListItem[], now: number, w: number): string {
  glimmers = 0
  const parts: string[] = []
  let y = PAD
  const textX = PAD + 6
  items.forEach((it, k) => {
    switch (it.kind) {
      case 'head': {
        if (k > 0) y += 6
        const { lead, count } = headOf(it)
        // the name in its session's colour
        const room = w - 2 * PAD - textWidth(lead, PX) - textWidth(` ${count}`, PX) - 4
        const name = fitText(it.label, room, PX)
        parts.push(say(lead, PAD, y, { color: BRIGHT }), say(name, PAD + textWidth(lead, PX), y, { color: it.color }))
        parts.push(say(count, w - PAD, y, { color: DIM, anchor: 'end' }))
        y += LINE + 1
        return
      }
      case 'note':
        parts.push(say(fitText(it.text, w - 2 * PAD, PX), PAD, y, { color: DIM }))
        y += LINE
        return
      case 'group':
        y += 3
        parts.push(say(it.group, PAD, y, { color: FAINT }))
        y += LINE + 1
        return
      case 'more':
        y += 2
        parts.push(say(`+${it.count} more`, PAD, y, { color: FAINT }))
        y += LINE
        return
      case 'host':
        y += 3
    }
    const r = it.row
    const [glyph, color] = ICON[r.state]
    parts.push(r.state === 'running'
      ? `<use href="#spin" transform="translate(${r2(PAD)} ${r2(y)}) scale(${r3(PX)})"/>`
      : say(glyph, PAD, y, { color }))
    const time = r.startedAt !== undefined
      ? clock(w - PAD, y, Math.max(0, ((r.endedAt ?? now) - r.startedAt) / 1000), isLive(r), DIM)
      : { svg: '', width: 0 }
    parts.push(time.svg)
    const titleRoom = w - textX - PAD - time.width - 4
    const title = fitText(r.title, titleRoom, PX)
    parts.push(it.kind === 'host' && r.state === 'running'
      ? glimmerText(title, textX, y, now)
      : say(title, textX, y, { color: isLive(r) ? BRIGHT : DIM }))
    y += LINE
    const usageWidth = r.usage ? textWidth(r.usage, PX) : 0
    if (r.usage) parts.push(say(r.usage, w - PAD, y, { color: FAINT, anchor: 'end' }))
    const detail = fitText(r.detail, w - textX - PAD - usageWidth - (usageWidth > 0 ? 4 : 0), PX)
    parts.push(say(detail, textX, y, { color: isLive(r) ? DIM : FAINT }))
    y += LINE + 3
  })
  const h = Math.ceil(y + PAD)
  const inner = `<style>${LIGHT_PANEL}</style><defs>${spinnerDef(now)}${reelDefs()}</defs>${parts.join('')}`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 8}" height="${h * 8}" shape-rendering="crispEdges" style="display:block">${inner}</svg>`
}

// The panel at `w` units wide, the house picture's own width, so both share
// a scale; the sections folded as `toggled` has them. A list too long to draw sheds
// rows from the end, under a "+n more" line.
export function tasksPanel(rows: TaskRow[], stats: TaskStats, now: number, w: number, households: Household[], toggled: string[], title: string): Panel {
  const sections = sectionsOf(rows, households, toggled, title)
  let limit = MAX_ROWS
  let items = itemsOf(sections, stats, limit)
  let source = draw(items, now, w)
  while (source.length > MAX_SOURCE && limit > 1) {
    limit--
    items = itemsOf(sections, stats, limit)
    source = draw(items, now, w)
  }
  return { source, alt: altOf(items) }
}

// ---------- hover cards ----------

// A hover card in the house's pixel style, `w` units wide (sized by the caller
// so its pixels match the house's): a frame with notched corners in `color`,
// the first line as its title in that colour, the rest below it.
// Long lines wrap: the second (the task itself) to `taskLines` lines, others
// to two. Cards are kept, since the same ones are drawn redraw after redraw.
const cards = new Map<string, string>()

export function cardSvg(lines: string[], color: string, w: number, taskLines = 4): string {
  const key = JSON.stringify([lines, color, w, taskLines])
  const known = cards.get(key)
  if (known !== undefined) return known
  const made = drawCard(lines, color, w, taskLines)
  if (cards.size > 300) cards.clear()
  cards.set(key, made)
  return made
}

function drawCard(lines: string[], color: string, w: number, taskLines: number): string {
  const textW = w - 8
  const wrapped = lines.flatMap((line, i) => wrapText(line, textW, PX, i === 1 ? taskLines : 2).map(text => ({ text, i })))
  const shown = wrapped.slice(0, 14)
  const h = 4 + shown.length * LINE + 1
  const tone = (i: number) => (i === 0 ? color : i === 1 ? BRIGHT : DIM)
  const frame =
    `<g class="vh-ink"><rect x="1" y="0" width="${w - 2}" height="1" fill="${color}"/><rect x="1" y="${h - 1}" width="${w - 2}" height="1" fill="${color}"/>` +
    `<rect x="0" y="1" width="1" height="${h - 2}" fill="${color}"/><rect x="${w - 1}" y="1" width="1" height="${h - 2}" fill="${color}"/></g>` +
    `<rect class="vh-cbg" x="1" y="1" width="${w - 2}" height="${h - 2}" fill="#0d1117"/>`
  const text = shown.map((line, k) => say(fitText(line.text, textW, PX), 4, 3 + k * LINE, { color: tone(line.i) })).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 8}" height="${h * 8}" shape-rendering="crispEdges" style="display:block"><style>${LIGHT_PANEL}</style>${frame}${text}</svg>`
}
