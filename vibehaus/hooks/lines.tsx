/*
 * The tasks list in text, the desktop's and the terminal's alike: the items
 * panel.ts lays out, line for line, in the surface's own font. A session's
 * heading folds it at a click, and each task of this session's still running
 * has a button that stops it. The Host's line is drawn as Claude Code draws
 * its own while it works: the spinner, the step under a glimmer, how long it
 * has run. What moves is made here twice: as a picture that plays by itself,
 * for the desktop, and as a Raster's cells the terminal repaints a frame at a
 * time.
 */
import type { Elements, RenderElement } from 'claude-code'
import type { TaskRow } from '../types'
import { CLAUDE, DIM, headOf, ICON, isLive, SHIMMER } from './panel'
import type { ListItem } from './panel'
import { DEFAULT, hex, letter } from './plan'

type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

// One line of the list: the task it belongs to, if a task's; whether it is a
// section's heading; and a Raster on it the terminal repaints, if any.
type Line = { row?: TaskRow; isHead?: boolean; el: RenderElement; live?: Live }
export type Live = { key: string; paint: (now: number) => Uint32Array }

// How a surface draws what moves: the Host's whole working line, and a
// running task's mark, two columns wide.
export type Marks = {
  host: (row: TaskRow, now: number) => { el: RenderElement; live?: Live }
  spin: (row: TaskRow, now: number) => { el: RenderElement; live?: Live }
}

// What a press does: fold a section, or stop one of this session's tasks.
export type Acts = { fold: (id: string) => void; stop: (row: TaskRow) => void }

export function linesOf(ui: Ui, items: ListItem[], now: number, marks: Marks, acts: Acts): Line[] {
  const { Box, Text, Button } = ui
  const lines: Line[] = []
  const gap = () => lines.push({ el: <Text> </Text> })
  // a task's first line: its mark, its title, how long, and its stop button
  const first = (r: TaskRow, mark: RenderElement) => {
    const live = isLive(r)
    const time = timeOf(r, now)
    const canStop = live && r.group !== 'Lead' && !r.session
    return (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" flexShrink={1} overflow="hidden">
          <Box width={2} flexShrink={0}>{mark}</Box>
          <Text wrap="truncate-end" color={r.state === 'waiting' ? ICON.waiting[1] : undefined} dimColor={!live}>{r.title}</Text>
        </Box>
        <Box flexDirection="row" flexShrink={0} columnGap={1}>
          {time && <Text dimColor>{time}</Text>}
          {canStop && <Button key={`vh-stop-${r.id}`} plain dimColor label="■" onPress={() => acts.stop(r)} />}
        </Box>
      </Box>
    )
  }
  // and its second: what it is, how it stands, and its tokens
  const second = (r: TaskRow) => (
    <Box flexDirection="row" justifyContent="space-between">
      {isLive(r) ? <Text dimColor wrap="truncate-end">  {r.detail}</Text> : <Text color="subtle" wrap="truncate-end">  {r.detail}</Text>}
      {r.usage && <Text color="subtle"> {r.usage}</Text>}
    </Box>
  )
  const still = (r: TaskRow) => <Text color={ICON[r.state][1]}>{ICON[r.state][0]}</Text>
  items.forEach((it, k) => {
    switch (it.kind) {
      case 'head': {
        if (k > 0) gap()
        const { lead, count } = headOf(it)
        lines.push({
          isHead: true,
          el: (
            <Box flexDirection="row" justifyContent="space-between">
              <Button key={`vh-fold-${it.id || 'this'}`} plain onPress={() => acts.fold(it.id)}>{lead}<Text bold color={it.name ? it.color : undefined}>{it.label}</Text></Button>
              <Text dimColor>{count}</Text>
            </Box>
          ),
        })
        return
      }
      case 'note':
        lines.push({ el: <Text dimColor wrap="truncate-end">{it.text}</Text> })
        return
      case 'host': {
        gap()
        const r = it.row
        const line = r.state === 'running' ? marks.host(r, now) : { el: first(r, still(r)) }
        lines.push({ row: r, el: line.el, ...(line.live ? { live: line.live } : {}) })
        lines.push({ row: r, el: second(r) })
        return
      }
      case 'group':
        gap()
        lines.push({ el: <Text color="subtle">{it.group}</Text> })
        return
      case 'more':
        lines.push({ el: <Text color="subtle">+{it.count} more</Text> })
        return
    }
    const r = it.row
    const spun = r.state === 'running' ? marks.spin(r, now) : undefined
    lines.push({ row: r, el: first(r, spun ? spun.el : still(r)), ...(spun?.live ? { live: spun.live } : {}) })
    lines.push({ row: r, el: second(r) })
  })
  return lines
}

// The lines cut into pages when the room they have is only known roughly:
// each page as many as may show (`fits`), the next starting at its first that
// might not (`sure`), so a line the pane's edge may cut comes again at the
// top of the next. A task's two lines stay together, no page ends on lines
// that head nothing under them, and a page that starts inside a section
// starts with its heading again.
export function pagesOf(lines: Line[], fits: number, sure: number): Line[][] {
  const pages: Line[][] = []
  const isSplit = (k: number) => k > 0 && k < lines.length && lines[k]?.row !== undefined && lines[k]?.row === lines[k - 1]?.row
  let start = 0
  while (start < lines.length) {
    const head = lines.slice(0, start + 1).reverse().find(l => l.isHead)
    const lead = lines[start]?.isHead || !head ? [] : [head]
    const room = Math.max(1, fits - lead.length)
    let end = Math.min(lines.length, start + room)
    while (end > start + 1 && isSplit(end)) end--
    if (end < lines.length) {
      let k = end
      while (k > start + 1 && !lines[k - 1]?.row) k--
      if (k > start + 1) end = k
    }
    let next = Math.min(end, start + Math.max(1, sure - lead.length))
    while (next > start + 1 && isSplit(next)) next--
    pages.push([...lead, ...lines.slice(start, end)])
    start = Math.max(start + 1, next)
  }
  return pages.length > 0 ? pages : [[]]
}

// ---------- what moves, as Claude Code moves it ----------

// The spinner: six glyphs played forwards then backwards, a frame every
// 120 ms.
export const SPIN_MS = 120
const SPIN_GLYPHS = ['·', '✢', '*', '✶', '✻', '✽']
const SPIN_SEQ = [0, 1, 2, 3, 4, 5, 5, 4, 3, 2, 1, 0]
const spinGlyph = (now: number) => SPIN_GLYPHS[SPIN_SEQ[Math.floor(now / SPIN_MS) % SPIN_SEQ.length] ?? 0] ?? '✻'

// The glimmer: three letters lit at a time, sweeping right to left a letter
// every 200 ms, with a pause past each end; the first lit letter at `now`
// for a line `n` letters long.
const GLIMMER_MS = 200
const glimmerAt = (n: number, now: number) => n + 10 - (Math.floor(now / GLIMMER_MS) % (n + 20)) - 1

// How long a task has run, or ran, as the chat words it: 42s, 13m 6s, 1h 2m.
function timeOf(r: TaskRow, now: number): string {
  return r.startedAt !== undefined ? elapsedText((r.endedAt ?? now) - r.startedAt) : ''
}

function elapsedText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`
}

// The step the Host's line shows, cut to `room` letters.
function stepOf(r: TaskRow, room: number): string[] {
  const letters = [...r.title]
  return letters.length > room ? [...letters.slice(0, Math.max(0, room - 1)), '…'] : letters
}

// ---------- the desktop's: pictures that play by themselves ----------

// A picture a column is 10 units wide and a row 24 tall in, drawn with
// the pane's text: shown as wide as its box, it comes out a row tall.
const COLUMN = 10
const ROW = 24
const FONT = `font-family="ui-monospace,'Cascadia Mono','SF Mono',Menlo,Consolas,monospace" font-size="16"`
const DIM_STYLE = `<style>.d{fill:${DIM}}@media (prefers-color-scheme: light){.d{fill:#6e7781}}</style>`
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const r3 = (n: number) => Math.round(n * 1000) / 1000

function picture(columns: number, inner: string): string {
  const w = columns * COLUMN
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${ROW}" width="${w * 4}" height="${ROW * 4}">${inner}</svg>`
}

// The spinner in the first column, on the clock's phase, so a redraw picks
// it up where it was.
function spinFrames(now: number): string {
  const dur = r3((SPIN_SEQ.length * SPIN_MS) / 1000)
  const begin = r3(-((now / 1000) % dur))
  const keyTimes = SPIN_SEQ.map((_, i) => r3(i / SPIN_SEQ.length)).join(';')
  return SPIN_GLYPHS.map((g, f) =>
    `<text x="${COLUMN / 2}" y="${ROW / 2}" text-anchor="middle" dominant-baseline="central" fill="${CLAUDE}" opacity="0" ${FONT}>${esc(g)}` +
    `<animate attributeName="opacity" values="${SPIN_SEQ.map(k => (k === f ? 1 : 0)).join(';')}" keyTimes="${keyTimes}" calcMode="discrete" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></text>`).join('')
}

// A running task's mark.
export function spinSvg(now: number): string {
  return picture(2, spinFrames(now))
}

// The Host's line across `columns`: the spinner, the step in Claude's colour
// under the glimmer, then how long it has run, the next dozen seconds of it
// drawn ahead, each shown in its turn.
export function hostSvg(r: TaskRow, now: number, columns: number): string {
  const started = r.startedAt ?? now
  const longest = elapsedText(now + 12000 - started).length
  const text = stepOf(r, Math.max(1, columns - 3 - longest))
  const n = text.length
  const x0 = 2 * COLUMN
  const at = (y: number) => `x="${x0}" y="${y}" dominant-baseline="central" textLength="${n * COLUMN}" lengthAdjust="spacing" ${FONT}`
  const steps = n + 20
  const dur = r3((steps * GLIMMER_MS) / 1000)
  const xs = Array.from({ length: steps }, (_, k) => x0 + (n + 10 - k - 1) * COLUMN).join(';')
  const keyTimes = Array.from({ length: steps }, (_, k) => r3(k / steps)).join(';')
  const glimmer =
    `<clipPath id="g"><rect x="0" y="0" width="${3 * COLUMN}" height="${ROW}"><animate attributeName="x" values="${xs}" keyTimes="${keyTimes}" calcMode="discrete" dur="${dur}s" begin="${r3(-((now / 1000) % dur))}s" repeatCount="indefinite"/></rect></clipPath>`
  const ran = now - started
  const tick = 1000 - (ran % 1000)
  const timeX = x0 + (n + 1) * COLUMN
  const times = Array.from({ length: 12 }, (_, i) => {
    const shown = i === 0 ? '' : `<set attributeName="visibility" to="visible" begin="${r3((tick + (i - 1) * 1000) / 1000)}s"${i < 11 ? ' dur="1s"' : ''}/>`
    return `<text x="${timeX}" y="${ROW / 2}" dominant-baseline="central" class="d" visibility="${i === 0 ? 'visible' : 'hidden'}" ${FONT}>${elapsedText(ran + i * 1000)}${shown}` +
      (i === 0 ? `<set attributeName="visibility" to="hidden" begin="${r3(tick / 1000)}s"/>` : '') + '</text>'
  }).join('')
  const step = esc(text.join(''))
  return picture(columns,
    `${DIM_STYLE}${glimmer}${spinFrames(now)}<text ${at(ROW / 2)} fill="${CLAUDE}">${step}</text>` +
    `<text ${at(ROW / 2)} fill="${SHIMMER}" clip-path="url(#g)">${step}</text>${times}`)
}

// ---------- the terminal's: cells a frame at a time ----------

// One row of cells `width` wide, from letters and their colours, blank on.
function rowCells(letters: { ch: string; color: string }[], width: number): Uint32Array {
  const cells = new Uint32Array(width * 3)
  for (let i = 0; i < width; i++) cells.set([0x20, DEFAULT, DEFAULT], i * 3)
  letters.slice(0, width).forEach((l, i) => cells.set([letter(l.ch), hex(l.color), DEFAULT], i * 3))
  return cells
}

// A running task's mark: the spinner's star.
export function spinCells(now: number): Uint32Array {
  return rowCells([{ ch: spinGlyph(now), color: CLAUDE }], 1)
}

// The Host's line `width` cells wide, as the desktop draws it.
export function hostCells(r: TaskRow, now: number, width: number): Uint32Array {
  const time = elapsedText(now - (r.startedAt ?? now))
  const text = stepOf(r, Math.max(1, width - 3 - time.length))
  const lit = glimmerAt(text.length, now)
  return rowCells([
    { ch: spinGlyph(now), color: CLAUDE }, { ch: ' ', color: CLAUDE },
    ...text.map((ch, i) => ({ ch, color: i >= lit && i < lit + 3 ? SHIMMER : CLAUDE })),
    ...[...` ${time}`].map(ch => ({ ch, color: DIM })),
  ], width)
}
