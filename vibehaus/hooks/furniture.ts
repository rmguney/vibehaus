/*
 * The furniture of each room, built of boxes on the plan: desks with their
 * monitors along the back of every work room, and each room's own pieces:
 * bookshelves and a lamp in the library, a fireplace and a reading armchair
 * in the study, a telescope and a radio in the sunroom, a fridge, a stove and
 * a coffee machine in the kitchen, a workbench in the workshop, and beds, a
 * TV and a couch in the bedroom lounge. Flames, screens and steam move.
 */
import type { Room } from '../types'
import { box, faceX, faceY, at } from './house'
import type { Cell, Layout } from './house'
import { faces, loopBegin, mat, pathOf, warm, warmFaces } from './iso'
import type { Canvas, Mat, Pt } from './iso'

const F = {
  woodDark: warmFaces('wd', '#9a6740'),
  wood: warmFaces('wm', '#b8834f'),
  pine: warmFaces('wp', '#d6b07a'),
  white: warmFaces('wh', '#f4f2ec'),
  stone: warmFaces('st', '#c9cbcf'),
  dark: faces('dk', '#1c2024', '#3a4047'),
  brick: warmFaces('br', '#b5644f'),
  brass: warmFaces('bs', '#d8b25a'),
  leaf: warmFaces('lf', '#5fae62'),
  pot: warmFaces('pt', '#c4714e'),
  linen: warmFaces('ln', '#fbf9f4'),
  blue: warmFaces('bb', '#6f8fd6'),
  green: warmFaces('bg', '#79b89a'),
  couch: warmFaces('cu', '#c77fae'),
  shade: warmFaces('ls', '#f5dca0'),
  red: warmFaces('rd', '#d9584c'),
}
const RUG = {
  library: [warm('rl', '#b85c5c'), warm('rm', '#d07a7a')],
  lounge: [warm('rq', '#d9a9c9'), warm('rr', '#e8bfd8')],
} as const
const BOOKS = [
  warm('b1', '#c75a5a'), warm('b2', '#5a86c7'), warm('b3', '#c7ad5a'),
  warm('b4', '#5ac79a'), warm('b5', '#9a5ac7'), warm('b6', '#c7865a'),
]
const HOLE = mat('ho', '#0d0b0a', '#3a2a24')
const DESK_BODY: Record<Room, typeof F.wood> = {
  library: F.woodDark, study: F.wood, sunroom: F.pine, kitchen: F.white, workshop: F.pine, lounge: F.wood,
}

// Desk i of a work room: its back corner on the plan.
export const deskAt = (c: Cell, i: number): { x: number; y: number } => ({ x: c.x + 2 + 14 * i, y: c.y + 1 })

// A desk against the back wall, a monitor on it facing the room. Says where
// the screen's top left corner is, for the screen's own drawing, slanted to
// lie on the monitor's face, and where the desk's status light sits.
export function desk(cv: Canvas, L: Layout, room: Room, c: Cell, i: number): { screen: Pt; light: Pt } {
  const d = deskAt(c, i)
  const body = DESK_BODY[room]
  cv.stamp(`desk-${body.top.cls}${room === 'kitchen' ? 's' : ''}`, at(L, d.x, d.y), sub => {
    box(sub, L, d.x, d.y, 12, 6, 5, body)
    box(sub, L, d.x - 0.5, d.y, 13, 6.5, 1, room === 'kitchen' ? F.stone : body, 5)
    sub.layer()
    // the monitor on its stand
    box(sub, L, d.x + 5.5, d.y + 1.5, 1, 1, 2, F.dark, 6)
    box(sub, L, d.x + 2, d.y + 1, 8, 1, 6, F.dark, 8)
  })
  return { screen: at(L, d.x + 2.5, d.y + 2, 13), light: at(L, d.x + 10.5, d.y + 5.5, 6) }
}

function plant(cv: Canvas, L: Layout, x: number, y: number, tall: boolean): void {
  cv.stamp(tall ? 'plant-t' : 'plant', at(L, x, y), sub => {
    box(sub, L, x, y, 3, 3, 3, F.pot)
    sub.layer()
    box(sub, L, x - 0.5, y - 0.5, 4, 4, tall ? 5 : 3, F.leaf, 3)
    sub.layer()
    box(sub, L, x + 0.5, y + 0.5, 2, 2, tall ? 3 : 2, F.leaf, tall ? 8 : 6)
  })
}

function rug(cv: Canvas, L: Layout, x: number, y: number, w: number, d: number, m: readonly [Mat, Mat]): void {
  cv.poly([at(L, x, y), at(L, x + w, y), at(L, x + w, y + d), at(L, x, y + d)], m[1])
  cv.poly([at(L, x + 1.5, y + 1.5), at(L, x + w - 1.5, y + 1.5), at(L, x + w - 1.5, y + d - 1.5), at(L, x + 1.5, y + d - 1.5)], m[0])
  cv.layer()
}

// Something that flickers or glows, drawn as pixels with its own animation.
function lit(pts: Pt[], fill: string, anim: string, cls = ''): string {
  return `<path${cls ? ` class="${cls}"` : ''} fill="${fill}" d="${pathOf(pts)}">${anim}</path>`
}

// Steam curling up from a point, one wisp after another.
function steam(p: Pt): string {
  return [0, 1].map(i => `<rect x="${Math.round(p.x) + i}" y="${Math.round(p.y)}" width="1" height="1" fill="#e8e8f0" opacity="0">` +
    `<animate attributeName="y" values="${Math.round(p.y)};${Math.round(p.y) - 6}" dur="2.4s" ${loopBegin(2.4, i * 1.2)} repeatCount="indefinite"/>` +
    `<animate attributeName="opacity" values="0;0.6;0" dur="2.4s" ${loopBegin(2.4, i * 1.2)} repeatCount="indefinite"/></rect>`).join('')
}

function library(cv: Canvas, L: Layout, c: Cell): void {
  rug(cv, L, c.x + 12, c.y + 15, 22, 18, RUG.library)
  for (let k = 0; k < 2; k++) {
    const y = c.y + 9 + 9 * k
    cv.stamp('shelf', at(L, c.x, y), sub => {
      box(sub, L, c.x, y, 5, 8, 18, F.woodDark)
      sub.layer()
      for (const z of [2, 8, 14]) {
        for (let j = 0; j < 4; j++) {
          const tall = 3 + ((j * 3 + z) % 2)
          faceX(sub, L, c.x + 5, y + 0.5 + 2 * j, y + 2 + 2 * j, z, z + tall, BOOKS[(j * 2 + z) % BOOKS.length] as Mat)
        }
      }
    })
  }
  // a reading lamp by the window
  box(cv, L, c.x + 33, c.y + 3, 1, 1, 12, F.brass)
  box(cv, L, c.x + 31.5, c.y + 1.5, 4, 4, 3, F.shade, 12)
  cv.layer()
}

function study(cv: Canvas, L: Layout, c: Cell): void {
  // the fireplace and its chimney breast on the back wall
  box(cv, L, c.x + 30, c.y, 8, 2, 25, F.brick)
  box(cv, L, c.x + 29, c.y, 10, 4, 11, F.brick)
  box(cv, L, c.x + 28.5, c.y, 11, 5, 1, F.woodDark, 11)
  faceY(cv, L, c.y + 4, c.x + 31, c.x + 37, 1, 8, HOLE)
  cv.layer()
  const fire = lit([at(L, c.x + 32, c.y + 4, 1), at(L, c.x + 36, c.y + 4, 1), at(L, c.x + 35, c.y + 4, 5), at(L, c.x + 34, c.y + 4, 7), at(L, c.x + 33, c.y + 4, 4)], '#f5a623',
    `<animate attributeName="fill" values="#f5a623;#ffd166;#f26b3a;#f5a623" dur="0.9s" ${loopBegin(0.9)} repeatCount="indefinite"/>`)
  const embers = lit([at(L, c.x + 33, c.y + 4, 1), at(L, c.x + 35, c.y + 4, 1), at(L, c.x + 34.5, c.y + 4, 3), at(L, c.x + 33.5, c.y + 4, 3)], '#fff1b0',
    `<animate attributeName="opacity" values="1;0.4;0.8;1" dur="0.6s" ${loopBegin(0.6)} repeatCount="indefinite"/>`)
  cv.raw(fire + embers)
  // a reading armchair by the wall, turned to the fire, and a floor lamp
  plant(cv, L, c.x + 2, c.y + 9, true)
  box(cv, L, c.x + 1, c.y + 26, 1, 1, 11, F.brass)
  box(cv, L, c.x - 0.5, c.y + 24.5, 4, 4, 3, F.shade, 11)
  cv.layer()
  box(cv, L, c.x + 1, c.y + 16, 2, 7, 7, F.green)
  cv.layer()
  box(cv, L, c.x + 3, c.y + 16, 5, 7, 3, F.green)
  cv.layer()
  box(cv, L, c.x + 3, c.y + 16, 5, 1.5, 5, F.green)
  cv.layer()
  box(cv, L, c.x + 3, c.y + 21.5, 5, 1.5, 5, F.green)
  cv.layer()
}

function sunroom(cv: Canvas, L: Layout, c: Cell): string {
  // a telescope on its tripod, aimed at the window
  const tx = c.x + 6
  const ty = c.y + 14
  box(cv, L, tx - 2, ty, 1, 1, 6, F.woodDark)
  box(cv, L, tx + 1, ty, 1, 1, 6, F.woodDark)
  box(cv, L, tx, ty + 2, 1, 1, 6, F.woodDark)
  cv.layer()
  cv.poly([at(L, tx - 1, ty + 2, 8), at(L, tx + 4, ty - 3, 13), at(L, tx + 4, ty - 3, 11), at(L, tx - 1, ty + 2, 6)], F.brass.left)
  cv.layer()
  // the radio on a side table
  box(cv, L, c.x + 1, c.y + 20, 5, 5, 5, F.wood)
  box(cv, L, c.x + 1.5, c.y + 21, 4, 3, 3, F.dark, 5)
  cv.layer()
  const light = at(L, c.x + 5.5, c.y + 23, 7)
  plant(cv, L, c.x + 34, c.y + 3, true)
  return `<rect x="${Math.round(light.x)}" y="${Math.round(light.y)}" width="1" height="1" fill="#4cf08c"><animate attributeName="opacity" values="1;0.2;1" dur="1.4s" ${loopBegin(1.4)} repeatCount="indefinite"/></rect>`
}

function kitchen(cv: Canvas, L: Layout, c: Cell): string {
  box(cv, L, c.x, c.y + 8, 6, 7, 21, F.white)
  faceX(cv, L, c.x + 6, c.y + 13.5, c.y + 14.2, 9, 15, F.stone.right)
  faceX(cv, L, c.x + 6, c.y + 8, c.y + 15, 17, 17.6, F.stone.right)
  cv.layer()
  box(cv, L, c.x, c.y + 15, 6, 12, 7, F.white)
  box(cv, L, c.x - 0.5, c.y + 15, 7, 12.5, 1, F.stone, 7)
  cv.layer()
  // two burners, a pot on one, and a coffee machine at the end of the counter
  for (const y of [c.y + 16.5, c.y + 20]) cv.poly([at(L, c.x + 1, y, 8), at(L, c.x + 4, y, 8), at(L, c.x + 4, y + 2.5, 8), at(L, c.x + 1, y + 2.5, 8)], HOLE)
  cv.layer()
  box(cv, L, c.x + 1, c.y + 16.5, 3, 2.5, 2, F.red, 8)
  box(cv, L, c.x + 1, c.y + 23, 3, 3, 4, F.dark, 8)
  cv.layer()
  const pot = at(L, c.x + 2.5, c.y + 17.5, 10)
  const cup = at(L, c.x + 2.5, c.y + 24, 12)
  return steam(pot) + `<rect x="${Math.round(cup.x)}" y="${Math.round(cup.y)}" width="1" height="1" fill="#f2503f"><animate attributeName="opacity" values="1;0.3;1" dur="2s" ${loopBegin(2)} repeatCount="indefinite"/></rect>`
}

function workshop(cv: Canvas, L: Layout, c: Cell): void {
  box(cv, L, c.x, c.y + 9, 7, 15, 6, F.pine)
  box(cv, L, c.x - 0.5, c.y + 9, 8, 15.5, 1, F.woodDark, 6)
  cv.layer()
  box(cv, L, c.x + 1, c.y + 11, 3, 4, 2, F.red, 7)
  box(cv, L, c.x + 1.5, c.y + 18, 2, 2, 3, F.dark, 7)
  box(cv, L, c.x + 4, c.y + 20, 2, 3, 1, F.brass, 7)
  cv.layer()
  plant(cv, L, c.x + 35, c.y + 35, false)
}

function lounge(cv: Canvas, L: Layout, c: Cell): string {
  rug(cv, L, c.x + 15, c.y + 21, 22, 15, RUG.lounge)
  for (let k = 0; k < 2; k++) {
    const y = c.y + 1 + 11 * k
    box(cv, L, c.x, y, 1, 9, 7, F.woodDark)
    cv.layer()
    box(cv, L, c.x + 1, y, 14, 9, 3, F.woodDark)
    box(cv, L, c.x + 1.5, y + 0.5, 13, 8, 2, F.linen, 3)
    box(cv, L, c.x + 5, y + 0.5, 9.5, 8, 1, k === 0 ? F.blue : F.green, 5)
    cv.layer()
    box(cv, L, c.x + 1.8, y + 1.5, 2.6, 6, 1, F.linen, 5)
    cv.layer()
  }
  // the TV on its stand, and the couch facing it
  box(cv, L, c.x + 18, c.y, 10, 4, 4, F.wood)
  box(cv, L, c.x + 19, c.y + 1, 8, 1, 7, F.dark, 4)
  cv.layer()
  const tv = lit([at(L, c.x + 19.5, c.y + 2, 10.5), at(L, c.x + 26.5, c.y + 2, 10.5), at(L, c.x + 26.5, c.y + 2, 5.5), at(L, c.x + 19.5, c.y + 2, 5.5)], '#5ad0ff',
    `<animate attributeName="fill" values="#5ad0ff;#ff6ad5;#ffd34a;#7df08a" calcMode="discrete" dur="3.2s" ${loopBegin(3.2)} repeatCount="indefinite"/>`)
  cv.raw(tv)
  box(cv, L, c.x + 18, c.y + 13, 11, 4, 3, F.couch)
  cv.layer()
  box(cv, L, c.x + 18, c.y + 16, 11, 2, 6, F.couch)
  cv.layer()
  box(cv, L, c.x + 17, c.y + 13, 1.5, 5, 5, F.couch)
  box(cv, L, c.x + 28.5, c.y + 13, 1.5, 5, 5, F.couch)
  cv.layer()
  plant(cv, L, c.x + 35, c.y + 35, true)
  return ''
}

// A room's own furniture (not its desks), and any animated bits to lay over.
export function furniture(cv: Canvas, L: Layout, room: Room, c: Cell): string {
  switch (room) {
    case 'library': library(cv, L, c); return ''
    case 'study': study(cv, L, c); return ''
    case 'sunroom': return sunroom(cv, L, c)
    case 'kitchen': return kitchen(cv, L, c)
    case 'workshop': workshop(cv, L, c); return ''
    case 'lounge': return lounge(cv, L, c)
  }
}

// Each work room's machine, which flashes as a tool call comes back: where,
// on the picture, and how big.
export function machine(L: Layout, room: Room, c: Cell): { at: Pt; w: number; h: number } | undefined {
  switch (room) {
    case 'library': return { at: at(L, c.x + 2.5, c.y + 17, 9), w: 14, h: 20 }
    case 'study': return { at: at(L, c.x + 1.5, c.y + 26.5, 13), w: 8, h: 6 }
    case 'sunroom': return { at: at(L, c.x + 3.5, c.y + 22.5, 6), w: 8, h: 6 }
    case 'kitchen': return { at: at(L, c.x + 3, c.y + 21, 8), w: 10, h: 8 }
    case 'workshop': return { at: at(L, c.x + 3.5, c.y + 16.5, 7), w: 12, h: 8 }
    default: return undefined
  }
}

