import { expect, mock, test } from 'claude-code/testing'

import type { Resident, Track } from '../vibehaus/types'
import { doorX, doorY, frontDoor, house, T } from '../vibehaus/hooks/house'
import { arrive, errandEnds, housePicture, reanchor } from '../vibehaus/hooks/scene'
import { yardOf } from '../vibehaus/hooks/yard'

const PANE_PROPS = {
  title: 'Vibehaus',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

// Where a track has its agent at `now`, on the picture.
function trackAt(t: Track, now: number): { x: number; y: number } {
  const n = t.keys.length / 3
  const raw = (now - t.t0) / 1000
  const s = t.isLoop ? ((raw % t.total) + t.total) % t.total : Math.max(0, Math.min(raw, t.total))
  let i = 0
  while (i + 1 < n && (t.keys[(i + 1) * 3] ?? 0) <= s) i++
  const [t1, x1, y1] = [t.keys[i * 3] ?? 0, t.keys[i * 3 + 1] ?? 0, t.keys[i * 3 + 2] ?? 0]
  if (i + 1 >= n) return { x: x1, y: y1 }
  const [t2, x2, y2] = [t.keys[i * 3 + 3] ?? 0, t.keys[i * 3 + 4] ?? 0, t.keys[i * 3 + 5] ?? 0]
  const u = t2 > t1 ? (s - t1) / (t2 - t1) : 1
  return { x: x1 + (x2 - x1) * u, y: y1 + (y2 - y1) * u }
}

// Whether a track has its agent in sight at `now`: a visitor only on its way
// in from the road or out to it.
function inSight(t: Track, now: number): boolean {
  const s = Math.max(0, Math.min((now - t.t0) / 1000, t.total))
  return !t.shown || (s >= t.shown[0] && s < t.shown[1])
}

test('nobody walks through a wall or jumps, whatever the household gets up to', async () => {
  const L = house()
  // back from the picture to the floor plan
  const plan = (X: number, Y: number) => ({ x: (X - L.ox) / 2 + (Y - L.oy), y: Y - L.oy - (X - L.ox) / 2 })
  const cells = Object.values(L.rooms)
  const door = frontDoor(L)
  const road = yardOf(L).road
  // where a step from p to q goes through a wall, other than by its doorway
  // or the front door, or off the floor and the road out front
  const through = (p: { x: number; y: number }, q: { x: number; y: number }): string | undefined => {
    const fy = L.ph - T / 2
    if ((p.y - fy) * (q.y - fy) < 0) {
      const x = p.x + ((fy - p.y) / (q.y - p.y)) * (q.x - p.x)
      if (x < door.x0 || x > door.x1) return `the front wall at x ${x.toFixed(1)}`
    }
    for (const c of cells) {
      const wx = c.x - T / 2
      if (c.col > 0 && (p.x - wx) * (q.x - wx) < 0) {
        const y = p.y + ((wx - p.x) / (q.x - p.x)) * (q.y - p.y)
        if (y >= c.y - T && y <= c.y + c.h && Math.abs(y - doorY(c)) > 5) return `x ${wx} at y ${y.toFixed(1)}`
      }
      const wy = c.y - T / 2
      if (c.row > 0 && (p.y - wy) * (q.y - wy) < 0) {
        const x = p.x + ((wy - p.y) / (q.y - p.y)) * (q.x - p.x)
        if (x >= c.x - T && x <= c.x + c.w && Math.abs(x - doorX(c)) > 5) return `y ${wy} at x ${x.toFixed(1)}`
      }
    }
    const onRoad = q.y > L.ph - T && q.y <= road.y1 + 0.5 && q.x >= road.x0 - 0.5 && q.x <= road.x1 + 0.5
    if (!onRoad && (q.x < T - 0.5 || q.x > L.pw - T + 0.5 || q.y < T - 0.5 || q.y > L.ph - T + 0.5)) return `off the floor at ${q.x.toFixed(1)}, ${q.y.toFixed(1)}`
    return undefined
  }

  const problems: string[] = []
  const rooms = ['study', 'library', 'workshop', 'kitchen', 'sunroom'] as const
  for (let session = 1; session <= 4; session++) {
    let seed = session * 7919
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296)
    let now = 1_800_000_000_000
    const member = (id: string, extra: Partial<Resident>): Resident =>
      ({ id, name: id, kind: id === 'main' ? 'main' : 'Explore', room: 'study', movedAt: now, status: 'idle', activity: 'x', ...extra })
    let list: Resident[] = [member('main', { idleSince: now - 5000 })]
    const boxes: string[] = []
    let tracks = housePicture(list, boxes, now).tracks
    let n = 0
    for (let step = 0; step < 120; step++) {
      now += Math.floor(300 + rnd() * (rnd() < 0.2 ? 20000 : 4000))
      // walks that ended, as the hooks see to: couriers back from the pallets
      // and visitors in from the street go about their day, and visitors
      // gone down the road leave
      const ends = errandEnds(list, now)
      const over = (c: Resident) => (ends.get(c.id) ?? Infinity) <= now
      if (list.some(over)) {
        const shown = new Map(tracks.map(t => [t.id, trackAt(t, now)]))
        const next = list.filter(c => !(c.leaving !== undefined && over(c))).map(c => {
          if (!over(c)) return c
          const rest = { ...c }
          delete rest.arriving
          return c.carrying ? { ...rest, carrying: false, idleSince: now } : rest
        })
        list = reanchor(list, next, now)
        tracks = housePicture(list, boxes, now).tracks
        for (const t of tracks) {
          const was = shown.get(t.id)
          const is = trackAt(t, now)
          if (was && Math.hypot(was.x - is.x, was.y - is.y) > 0.5) problems.push(`${t.id} jumped coming back at step ${step}`)
        }
      }
      const main = list.find(c => c.id === 'main') as Resident
      const live = list.filter(c => c.id !== 'main' && c.status === 'working' && c.leaving === undefined)
      const guests = list.filter(c => c.session && c.leaving === undefined)
      const roll = rnd()
      const set = (id: string, patch: Partial<Resident>) => list.map(c => {
        if (c.id !== id) return c
        const next = { ...c, ...patch }
        if (patch.status === 'idle' || patch.status === 'done') next.idleSince = now
        if (next.status !== 'working') delete next.seat
        return next
      })
      let next: Resident[]
      if (roll < 0.13) next = set('main', main.status === 'idle' ? { status: 'working', room: 'study' } : { status: 'idle' })
      else if (roll < 0.3 && main.status !== 'idle') next = set('main', { room: rooms[Math.floor(rnd() * rooms.length)] })
      else if (roll < 0.42 && list.length < 10) next = [...list, member(`a${n++}`, { status: 'working', room: rnd() < 0.5 ? 'library' : 'study', spawnedAt: now, spawnRoom: main.room })]
      else if (roll < 0.52 && guests.length < 4) {
        // another session's members move in, together a moment apart
        const room = rooms[Math.floor(rnd() * rooms.length)] ?? 'study'
        const guest = (k: number) => arrive(member(`other/g${n++}`, rnd() < 0.5
          ? { status: 'working', room, session: 'other' }
          : { status: 'idle', room, idleSince: now - 9000, session: 'other' }), now, k * 1.5)
        next = [...list, guest(0), ...(rnd() < 0.4 ? [guest(1)] : [])]
      } else if (roll < 0.6 && guests.length) {
        const who = guests[Math.floor(rnd() * guests.length)]
        next = list.map(c => (c === who ? { ...c, leaving: now } : c))
      } else if (roll < 0.8 && live.length) next = set((live[Math.floor(rnd() * live.length)] as Resident).id, { room: rooms[Math.floor(rnd() * rooms.length)] })
      else if (live.length) {
        const who = live[Math.floor(rnd() * live.length)] as Resident
        next = set(who.id, { status: 'done', doneAt: now, carrying: true, box: boxes.length })
        boxes.push(who.session ?? '')
      } else continue
      // the finished leave once there are more than four, once their box is out
      const done = next.filter(c => c.status === 'done' && !c.carrying && !c.session).sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0))
      if (done.length > 4) next = next.filter(c => c !== done[0])

      const shown = new Map(tracks.map(t => [t.id, trackAt(t, now)]))
      list = reanchor(list, next, now)
      tracks = housePicture(list, boxes, now).tracks
      for (const t of tracks) {
        // where it stands now is where it stood a moment ago
        const was = shown.get(t.id)
        const is = trackAt(t, now)
        if (was && Math.hypot(was.x - is.x, was.y - is.y) > 0.5) problems.push(`${t.id} jumped at step ${step}`)
        // and every step of its plan goes by the doorways
        for (let k = 3; k < t.keys.length; k += 3) {
          const p = plan(t.keys[k - 2] ?? 0, t.keys[k - 1] ?? 0)
          const q = plan(t.keys[k + 1] ?? 0, t.keys[k + 2] ?? 0)
          const wall = through(p, q)
          if (wall) problems.push(`${t.id} walks through a wall (${wall}) at step ${step}`)
        }
      }
    }
  }
  expect(problems.slice(0, 5)).toEqual([])
})

test('a visitor comes in from the street by the front door and leaves the same way', () => {
  const L = house()
  const plan = (X: number, Y: number) => ({ x: (X - L.ox) / 2 + (Y - L.oy), y: Y - L.oy - (X - L.ox) / 2 })
  const road = yardOf(L).road
  const room = L.rooms.library
  const now = 1_800_000_000_000
  const lead: Resident = { id: 'main', name: 'Lead', kind: 'main', room: 'study', movedAt: 0, status: 'idle', activity: 'x', idleSince: now - 60000 }
  const guest = arrive({ id: 'other/ag1', name: 'Map it', kind: 'Explore', room: 'library', movedAt: 0, status: 'working', activity: 'Grep', session: 'other' }, now, 1.5)
  let list = [lead, guest]
  // where the house shows it at `t`, on the plan; nowhere while out of sight
  const where = (t: number) => {
    const track = housePicture(list, [], t).tracks.find(k => k.id === guest.id)
    if (!track || !inSight(track, t)) return undefined
    const p = trackAt(track, t)
    return plan(p.x, p.y)
  }
  expect(where(now + 1000)).toBeUndefined()
  const onRoad = where(now + 2500)
  expect(onRoad !== undefined && onRoad.y > L.ph && onRoad.x >= road.x0 && onRoad.x <= road.x1).toBe(true)
  const inAt = errandEnds(list, now).get(guest.id) ?? Infinity
  const atDesk = where(inAt + 100)
  expect(atDesk !== undefined && atDesk.x > room.x && atDesk.x < room.x + room.w && atDesk.y > room.y && atDesk.y < room.y + room.h).toBe(true)
  // let go by its session: back down the road, then out of sight
  const t = inAt + 5000
  list = reanchor(list, list.map(c => (c.id === guest.id ? { ...c, leaving: t } : c)), t)
  const outAt = errandEnds(list, t).get(guest.id) ?? Infinity
  const last = where(outAt - 300)
  expect(last !== undefined && last.y > road.y1 - 12 && last.x >= road.x0 && last.x <= road.x1).toBe(true)
  expect(where(outAt + 100)).toBeUndefined()
})

test('a redraw seconds later is drawn on the clock, not reused', async ($, on) => {
  const clock = mock.clock(on)
  const picture = async () => {
    const desk = await $.ui.mount({ plugin: 'vibehaus', surface: 'desktop', component: 'Pane', requestId: 'vibehaus', props: PANE_PROPS })
    const pics = await desk.findAll({ type: 'Svg' }) as unknown as { props: { alt: string; source: string } }[]
    await desk.unmount()
    return pics.find(p => p.props.alt.startsWith('Vibehaus'))?.props.source ?? ''
  }
  // a crown's sway: its beat, and how far into it the picture starts
  const sway = (source: string) => {
    const m = /type="skewX" values="[^"]*" dur="([\d.]+)s" begin="-([\d.]+)s"/.exec(source)
    return { beat: Number(m?.[1]), at: Number(m?.[2]) }
  }
  const first = await picture()
  await clock.advance(3700)
  const later = await picture()

  expect(later).not.toBe(first)
  // the later picture picks the sway up 3.7 seconds on, as the first one,
  // left showing, would have it
  const a = sway(first)
  const b = sway(later)
  expect(a.beat).toBe(b.beat)
  expect(Math.abs(((b.at - a.at + a.beat) % a.beat) - (3.7 % a.beat))).toBeLessThan(0.02)
})
