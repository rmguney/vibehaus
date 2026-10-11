/*
 * Vibehaus's own pixel font: capitals and digits on a 5x7 grid, lowercase
 * with a 5-row x-height, ascenders and two rows of descenders, all drawn as
 * SVG rectangles on the same pixel grid as the art, so text stays crisp at
 * any size the picture is shown at. Letters have their own widths; each is
 * followed by one blank column.
 */

const GLYPHS: Record<string, string[]> = {
  ' ': ['...'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  a: ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####'],
  b: ['#....', '#....', '#.##.', '##..#', '#...#', '#...#', '####.'],
  c: ['.....', '.....', '.###.', '#....', '#....', '#...#', '.###.'],
  d: ['....#', '....#', '.##.#', '#..##', '#...#', '#...#', '.####'],
  e: ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.'],
  f: ['..##', '.#..', '.#..', '###.', '.#..', '.#..', '.#..'],
  g: ['.....', '.....', '.####', '#...#', '#...#', '#...#', '.####', '....#', '.###.'],
  h: ['#....', '#....', '#.##.', '##..#', '#...#', '#...#', '#...#'],
  i: ['.#.', '...', '##.', '.#.', '.#.', '.#.', '###'],
  j: ['..#', '...', '.##', '..#', '..#', '..#', '..#', '#.#', '.#.'],
  k: ['#...', '#...', '#..#', '#.#.', '##..', '#.#.', '#..#'],
  l: ['##.', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  m: ['.....', '.....', '##.#.', '#.#.#', '#.#.#', '#...#', '#...#'],
  n: ['.....', '.....', '#.##.', '##..#', '#...#', '#...#', '#...#'],
  o: ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
  p: ['.....', '.....', '####.', '#...#', '#...#', '#...#', '####.', '#....', '#....'],
  q: ['.....', '.....', '.####', '#...#', '#...#', '#...#', '.####', '....#', '....#'],
  r: ['.....', '.....', '#.##.', '##..#', '#....', '#....', '#....'],
  s: ['.....', '.....', '.####', '#....', '.###.', '....#', '####.'],
  t: ['.#..', '.#..', '####', '.#..', '.#..', '.#.#', '..#.'],
  u: ['.....', '.....', '#...#', '#...#', '#...#', '#..##', '.##.#'],
  v: ['.....', '.....', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  w: ['.....', '.....', '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'],
  x: ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  y: ['.....', '.....', '#...#', '#...#', '#...#', '#...#', '.####', '....#', '.###.'],
  z: ['.....', '.....', '#####', '...#.', '..#..', '.#...', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '.': ['..', '..', '..', '..', '..', '##', '##'],
  ',': ['..', '..', '..', '..', '..', '##', '.#', '#.'],
  ':': ['..', '##', '##', '..', '##', '##', '..'],
  ';': ['..', '##', '##', '..', '##', '##', '.#', '#.'],
  '!': ['#', '#', '#', '#', '#', '.', '#'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  "'": ['#', '#'],
  '"': ['#.#', '#.#'],
  '`': ['#.', '.#'],
  '-': ['....', '....', '....', '####'],
  '_': ['.....', '.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..'],
  '=': ['.....', '.....', '#####', '.....', '#####'],
  '*': ['.....', '..#..', '#.#.#', '.###.', '#.#.#', '..#..'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '|': ['#', '#', '#', '#', '#', '#', '#', '#'],
  '(': ['..#', '.#.', '#..', '#..', '#..', '.#.', '..#'],
  ')': ['#..', '.#.', '..#', '..#', '..#', '.#.', '#..'],
  '[': ['###', '#..', '#..', '#..', '#..', '#..', '###'],
  ']': ['###', '..#', '..#', '..#', '..#', '..#', '###'],
  '{': ['..##', '.#..', '.#..', '#...', '.#..', '.#..', '..##'],
  '}': ['##..', '..#.', '..#.', '...#', '..#.', '..#.', '##..'],
  '<': ['...#', '..#.', '.#..', '#...', '.#..', '..#.', '...#'],
  '>': ['#...', '.#..', '..#.', '...#', '..#.', '.#..', '#...'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  '%': ['##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '@': ['.###.', '#...#', '#.###', '#.#.#', '#.###', '#....', '.###.'],
  $: ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '^': ['..#..', '.#.#.', '#...#'],
  '~': ['.....', '.....', '.#...', '#.#.#', '...#.'],
  '…': ['.....', '.....', '.....', '.....', '.....', '.....', '#.#.#'],
  '·': ['..', '..', '..', '##', '##'],
  '⧗': ['#####', '.###.', '..#..', '..#..', '.#.#.', '#...#', '#####'],
  '♥': ['.....', '.#.#.', '#####', '#####', '.###.', '..#..'],
  '♪': ['..###', '..#.#', '..#..', '..#..', '###..', '###..'],
  // the tasks list's state marks
  '○': ['.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
  '◦': ['.....', '.....', '.###.', '.#.#.', '.###.'],
  '◷': ['.###.', '#.#.#', '#.#.#', '#.###', '#...#', '#...#', '.###.'],
  '✓': ['.....', '....#', '....#', '...#.', '#.#..', '.#...'],
  '✕': ['.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  '■': ['....', '....', '####', '####', '####', '####'],
  '⊘': ['.....', '.###.', '#..##', '#.#.#', '##..#', '.###.'],
  // a section of the list, open or folded
  '▾': ['.....', '.....', '#####', '.###.', '..#..'],
  '▸': ['...', '#..', '##.', '###', '##.', '#..'],
}
GLYPHS[String.fromCharCode(92)] = ['#....', '#....', '.#...', '..#..', '...#.', '....#', '....#']

const UNKNOWN = ['#####', '#...#', '#...#', '#...#', '#...#', '#...#', '#####']

// Accented letters lose their marks, a dotless i and the like become their
// plain forms, and long dashes and curly quotes their plain ones too.
const FOLD: Record<string, string> = { 'ı': 'i', 'İ': 'I', 'ß': 'ss' }
for (const [code, plain] of [[0x2014, '-'], [0x2013, '-'], [0x201c, '"'], [0x201d, '"'], [0x2018, "'"], [0x2019, "'"]] as const) {
  FOLD[String.fromCharCode(code)] = plain
}
const MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g')

// joiners, variation selectors and skin tones, which only shape the emoji
// beside them
const SHAPERS = /[\u200d\ufe0e\ufe0f]|\ud83c[\udffb-\udfff]/g

function normalize(text: string): string[] {
  return [...[...text.replace(SHAPERS, '')].map(ch => FOLD[ch] ?? ch).join('').normalize('NFD').replace(MARKS, '').normalize('NFC')]
}

const glyphOf = (ch: string): string[] => GLYPHS[ch] ?? (/\s/.test(ch) ? (GLYPHS[' '] as string[]) : UNKNOWN)

const widthOf = (g: string[]) => g[0]?.length ?? 5

// How wide `text` runs at `px` units a pixel.
export function textWidth(text: string, px: number): number {
  const chars = normalize(text)
  if (chars.length === 0) return 0
  return (chars.reduce((n, ch) => n + widthOf(glyphOf(ch)) + 1, 0) - 1) * px
}

// Cuts `text` to fit `maxWidth`, ending in "…" when it had to cut.
export function fitText(text: string, maxWidth: number, px: number): string {
  if (textWidth(text, px) <= maxWidth) return text
  const chars = normalize(text)
  let out = ''
  for (const ch of chars) {
    if (textWidth(`${out}${ch}…`, px) > maxWidth) break
    out += ch
  }
  return `${out.trimEnd()}…`
}

// Breaks `text` into lines that fit `maxWidth`, at spaces where it can; a
// word too long for a line is cut. At most `maxLines`, the last one ending in
// "…" when text was left over.
export function wrapText(text: string, maxWidth: number, px: number, maxLines: number): string[] {
  const lines: string[] = []
  let rest = text.trim()
  while (rest.length > 0 && lines.length < maxLines) {
    if (textWidth(rest, px) <= maxWidth) {
      lines.push(rest)
      rest = ''
      break
    }
    let cut = 0
    for (let i = 1; i <= rest.length; i++) {
      if (textWidth(rest.slice(0, i), px) > maxWidth) break
      cut = i
    }
    const space = rest.lastIndexOf(' ', cut)
    const end = space > 0 ? space : Math.max(1, cut)
    lines.push(rest.slice(0, end).trimEnd())
    rest = rest.slice(end).trimStart()
  }
  if (rest.length > 0 && lines.length > 0) {
    lines[lines.length - 1] = fitText(`${lines[lines.length - 1]} ${rest}`, maxWidth, px)
  }
  return lines
}

const r2 = (n: number) => Math.round(n * 100) / 100

type Rect = [x: number, y: number, w: number, h: number]

// A bitmap's lit pixels as few rectangles: each run across a row grows down
// while the rows below light the same span, so strokes cost one rectangle.
export function rectsOf(rows: string[]): Rect[] {
  const used = rows.map(row => [...row].map(() => false))
  const lit = (x: number, y: number) => rows[y]?.[x] === '#' && used[y]?.[x] === false
  const out: Rect[] = []
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!lit(x, y)) continue
      let w = 1
      while (lit(x + w, y)) w++
      let h = 1
      while (Array.from({ length: w }, (_, k) => lit(x + k, y + h)).every(Boolean)) h++
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) (used[yy] as boolean[])[xx] = true
      out.push([x, y, w, h])
    }
  })
  return out
}

const glyphRects = new Map<string, Rect[]>()

function rectsOfChar(ch: string): Rect[] {
  const known = glyphRects.get(ch)
  if (known) return known
  const rects = rectsOf(glyphOf(ch))
  glyphRects.set(ch, rects)
  return rects
}

export const pathOf = (rects: Rect[], dx = 0, dy = 0) =>
  rects.map(([x, y, w, h]) => `M${x + dx} ${y + dy}h${w}v${h}h${-w}z`).join('')

// The outline of `text` in whole font pixels from its top-left corner. Kept,
// since names repeat.
const outlines = new Map<string, string>()

function outline(text: string): string {
  const known = outlines.get(text)
  if (known !== undefined) return known
  let d = ''
  let cx = 0
  for (const ch of normalize(text)) {
    d += pathOf(rectsOfChar(ch), cx)
    cx += widthOf(glyphOf(ch)) + 1
  }
  if (outlines.size > 500) outlines.clear()
  outlines.set(text, d)
  return d
}

// Characters stacked one above another, `step` font pixels apart, as one
// outline: the reel an odometer digit rolls through.
export function reel(chars: string[], step: number): string {
  return chars.map((ch, k) => pathOf(rectsOfChar(ch), 0, k * step)).join('')
}

// `text` as one path, its top-left corner (the top of its capitals) at
// (x, y); `anchor` places it by its start, middle or end, as text-anchor would.
// `cls` names a class the picture's style recolours in the light theme.
export function pixelText(
  text: string, x: number, y: number,
  { px = 0.5, color, anchor = 'start', cls }: { px?: number; color: string; anchor?: 'start' | 'middle' | 'end'; cls?: string },
): string {
  const d = outline(text)
  if (!d) return ''
  const w = textWidth(text, px)
  const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x
  return `<path${cls ? ` class="${cls}"` : ''} transform="translate(${r2(left)} ${r2(y)}) scale(${Math.round(px * 1000) / 1000})" fill="${color}" d="${d}"/>`
}
