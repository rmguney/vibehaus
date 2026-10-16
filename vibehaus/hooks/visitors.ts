// Other sessions' visitors walking in from the street and out. Set-off times come from the store so all
// houses agree; one let go leaves from where it stands now, as an earlier start would jump it back.
import type { Resident } from '../types'
import { arrive, errandEnds } from './scene'

// Another session's household from the store; `wokeAt`: when it last woke from a long sleep.
export type Household = { id: string; since: number; residents: Resident[]; wokeAt?: number }

// seconds between one session's visitors setting off together
const ARRIVE_GAP = 1.5
// set off longer ago than this (ms): already in, no walk to show
const WALK_FOR = 60000

// Each member's set-off: when it joined (the lead: its session's start) or the session woke, if later;
// those that came together a moment apart.
function arrivals(f: Household): Map<string, number> {
  const joined = (m: Resident) => Math.max(m.spawnedAt ?? (m.id === 'main' ? f.since : m.workSince ?? 0), f.wokeAt ?? 0)
  const out = new Map<string, number>()
  let next = -Infinity
  for (const m of [...f.residents].sort((a, b) => joined(a) - joined(b))) {
    const t = Math.max(joined(m), next)
    out.set(m.id, t)
    next = t + ARRIVE_GAP * 1000
  }
  return out
}

// The others' members now, each keeping its spot and desk. Newcomers walk in from their set-off time;
// those let go walk out and are gone at the road's end.
export function visit(list: Resident[], found: Household[], now: number): Resident[] {
  const here = new Map(list.filter(c => c.session).map(c => [c.id, c]))
  const ends = here.size > 0 ? errandEnds(list, now) : new Map<string, number>()
  const isThere = (c: Resident) => (ends.get(c.id) ?? 0) <= now
  const seen = new Set<string>()
  const theirs = found.flatMap(f => {
    const starts = arrivals(f)
    return f.residents.map((m): Resident => {
      const id = `${f.id}/${m.id}`
      seen.add(id)
      const had = here.get(id)
      const member: Resident = { ...m, id, session: f.id }
      if (!had) {
        const start = starts.get(m.id) ?? now
        if (now - start > WALK_FOR) return member
        const from = Math.min(now, start)
        return arrive(member, from, (start - from) / 1000)
      }
      return {
        ...member,
        ...(had.anchor ? { anchor: had.anchor } : {}),
        ...(had.seat !== undefined ? { seat: had.seat } : {}),
        ...(had.arriving !== undefined && !isThere(had) ? { arriving: had.arriving } : {}),
      }
    })
  })
  const gone = [...here.values()]
    .filter(c => !seen.has(c.id) && !(c.leaving !== undefined && isThere(c)))
    .map(c => (c.leaving !== undefined ? c : { ...c, leaving: now }))
  return [...list.filter(c => !c.session), ...theirs, ...gone]
}
