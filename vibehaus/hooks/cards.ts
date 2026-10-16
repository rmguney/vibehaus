/* Hover cards for the desktop, in the house's pixel font and scale. */
import { fitText, glyphText, wrapText } from './font'

const PX = 0.5
const LINE = 6

const BRIGHT = '#e8e8f0'
const DIM = '#8c96a0'

// Dark theme colours; light mode gives neutral text the light theme's greys and darkens colour for contrast.
const LIGHT_CARD = '@media (prefers-color-scheme: light){' +
  '.vh-p1{fill:#1f2328}.vh-p2{fill:#57606a}' +
  '.vh-ink{filter:brightness(.6) saturate(1.35)}.vh-cbg{fill:#ffffff}' +
  '}'
const NEUTRAL: Record<string, string> = { [BRIGHT]: 'vh-p1', [DIM]: 'vh-p2' }

// Pixel text that follows the theme, each glyph defined once in `glyphs`.
function say(text: string, x: number, y: number, color: string, glyphs: Map<string, string>): string {
  return glyphText(text, x, y, { color, cls: NEUTRAL[color] ?? 'vh-ink' }, (id, d) => glyphs.set(id, `<path id="${id}" d="${d}"/>`))
}

// A card `w` units wide, sized by the caller to the house's pixels. Kept, as cards repeat each redraw,
// the least recently drawn dropped first: a live agent's card, new each second, leaves the rest be.
const cards = new Map<string, string>()

export function cardSvg(lines: string[], color: string, w: number): string {
  const key = JSON.stringify([lines, color, w])
  const known = cards.get(key)
  if (known !== undefined) {
    cards.delete(key)
    cards.set(key, known)
    return known
  }
  const made = drawCard(lines, color, w)
  if (cards.size >= 300) cards.delete(cards.keys().next().value as string)
  cards.set(key, made)
  return made
}

function drawCard(lines: string[], color: string, w: number): string {
  const textW = w - 8
  const shown = lines.flatMap((line, i) => wrapText(line, textW, PX, 2).map(text => ({ text, i })))
  const h = 4 + shown.length * LINE + 1
  const tone = (i: number) => (i === 0 ? color : i === 1 ? BRIGHT : DIM)
  const frame =
    `<g class="vh-ink"><rect x="1" y="0" width="${w - 2}" height="1" fill="${color}"/><rect x="1" y="${h - 1}" width="${w - 2}" height="1" fill="${color}"/>` +
    `<rect x="0" y="1" width="1" height="${h - 2}" fill="${color}"/><rect x="${w - 1}" y="1" width="1" height="${h - 2}" fill="${color}"/></g>` +
    `<rect class="vh-cbg" x="1" y="1" width="${w - 2}" height="${h - 2}" fill="#0d1117"/>`
  const glyphs = new Map<string, string>()
  const text = shown.map((line, k) => say(fitText(line.text, textW, PX), 4, 3 + k * LINE, tone(line.i), glyphs)).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 8}" height="${h * 8}" shape-rendering="crispEdges" style="display:block"><style>${LIGHT_CARD}</style>` +
    `<defs>${[...glyphs.values()].join('')}</defs>${frame}${text}</svg>`
}
