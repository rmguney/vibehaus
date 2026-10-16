/*
 * Vibehaus's pixel font, 5x7 with descenders, as SVG rectangles on the art's pixel grid so text stays
 * crisp at any size. Widths vary; a blank column follows each letter.
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
}
GLYPHS[String.fromCharCode(92)] = ['#....', '#....', '.#...', '..#..', '...#.', '....#', '....#']

const UNKNOWN = ['#####', '#...#', '#...#', '#...#', '#...#', '#...#', '#####']

// Accents dropped; dotless i, ß, long dashes and curly quotes made plain.
const FOLD: Record<string, string> = { 'ı': 'i', 'İ': 'I', 'ß': 'ss' }
for (const [code, plain] of [[0x2014, '-'], [0x2013, '-'], [0x201c, '"'], [0x201d, '"'], [0x2018, "'"], [0x2019, "'"]] as const) {
  FOLD[String.fromCharCode(code)] = plain
}
const MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g')

// joiners, variation selectors and skin tones, which only shape the emoji beside them
const SHAPERS = /[\u200d\ufe0e\ufe0f]|\ud83c[\udffb-\udfff]/g

function normalize(text: string): string[] {
  return [...[...text.replace(SHAPERS, '')].map(ch => FOLD[ch] ?? ch).join('').normalize('NFD').replace(MARKS, '').normalize('NFC')]
}

const glyphOf = (ch: string): string[] => GLYPHS[ch] ?? (/\s/.test(ch) ? (GLYPHS[' '] as string[]) : UNKNOWN)

const widthOf = (g: string[]) => g[0]?.length ?? 5

// Width of `text` at `px` units a pixel.
export function textWidth(text: string, px: number): number {
  const chars = normalize(text)
  if (chars.length === 0) return 0
  return (chars.reduce((n, ch) => n + widthOf(glyphOf(ch)) + 1, 0) - 1) * px
}

// Cuts `text` to `maxWidth`, ending in "…" when cut.
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

// Wraps at spaces, cutting overlong words; at most `maxLines`, the last ending in "…" if text is left.
export function wrapText(text: string, maxWidth: number, px: number, maxLines: number): string[] {
  const lines: string[] = []
  // by code points, so an emoji is never split
  let rest = text.trim()
  while (rest.length > 0 && lines.length < maxLines) {
    if (textWidth(rest, px) <= maxWidth) {
      lines.push(rest)
      rest = ''
      break
    }
    const chars = [...rest]
    let cut = 0
    for (let i = 1; i <= chars.length; i++) {
      if (textWidth(chars.slice(0, i).join(''), px) > maxWidth) break
      cut = i
    }
    const space = chars.lastIndexOf(' ', cut)
    const end = space > 0 ? space : Math.max(1, cut)
    lines.push(chars.slice(0, end).join('').trimEnd())
    rest = chars.slice(end).join('').trimStart()
  }
  if (rest.length > 0 && lines.length > 0) {
    lines[lines.length - 1] = fitText(`${lines[lines.length - 1]} ${rest}`, maxWidth, px)
  }
  return lines
}

const r2 = (n: number) => Math.round(n * 100) / 100

type Rect = [x: number, y: number, w: number, h: number]

// Lit pixels as few rectangles: each run in a row grows down while rows below match it.
function rectsOf(rows: string[]): Rect[] {
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

// by letter; letters the font lacks share one box, so the map never outgrows the font
function rectsOfChar(ch: string): Rect[] {
  const glyph = glyphOf(ch)
  const key = glyph === UNKNOWN ? '' : ch
  const known = glyphRects.get(key)
  if (known) return known
  const rects = rectsOf(glyph)
  glyphRects.set(key, rects)
  return rects
}

const pathOf = (rects: Rect[], dx = 0, dy = 0) =>
  rects.map(([x, y, w, h]) => `M${x + dx} ${y + dy}h${w}v${h}h${-w}z`).join('')

// Outlines in font pixels from the top-left, kept since names repeat.
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

// One path, its capitals' top at (x, y), `anchor` as text-anchor; `cls` a class the light theme recolours.
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

// As pixelText, but each glyph defined once through `define` and reused: far shorter once letters repeat.
export function glyphText(
  text: string, x: number, y: number,
  { px = 0.5, color, anchor = 'start', cls }: { px?: number; color: string; anchor?: 'start' | 'middle' | 'end'; cls?: string },
  define: (id: string, d: string) => void,
): string {
  let uses = ''
  let cx = 0
  for (const ch of normalize(text)) {
    const rects = rectsOfChar(ch)
    if (rects.length > 0) {
      const id = `gl${(ch.codePointAt(0) ?? 63).toString(36)}`
      define(id, pathOf(rects))
      uses += `<use href="#${id}"${cx ? ` x="${cx}"` : ''}/>`
    }
    cx += widthOf(glyphOf(ch)) + 1
  }
  if (!uses) return ''
  const w = textWidth(text, px)
  const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x
  return `<g${cls ? ` class="${cls}"` : ''} transform="translate(${r2(left)} ${r2(y)}) scale(${Math.round(px * 1000) / 1000})" fill="${color}">${uses}</g>`
}
