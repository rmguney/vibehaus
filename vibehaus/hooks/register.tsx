import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderElement, SessionRateLimit } from 'claude-code'

import type { Resident, ResidentStatus, PlanUse, Room, Track } from '../types'
import { cardSvg } from './cards'
import { ALL_ROOMS } from './house'
import { cellAt, gardenRaster, packCells, planCells, planOf, planSize, RASTER_ROWS, reachOf } from './plan'
import type { Plan, Walker } from './plan'
import type { HouseGrid, Meter } from './scene'
import {
  clip, colorFor, displayName, errandEnds, gardenPicture, houseGrid, housePicture, houseTracks, meterColor, onePicture, own, paintSessions,
  reanchor, spotOf, svg, SVG_LIMIT, taskTypeOf,
} from './scene'
import { visit } from './visitors'
import type { Household } from './visitors'

const PANE = 'vibehaus'
const MAIN = 'main'
const KEEP_DONE = 4
const MAX_TEXT = 160
const MAX_CALLS = 8

const residents = atom({ plugin: 'vibehaus', key: 'residents' } as const, [])
const plan = atom({ plugin: 'vibehaus', key: 'plan' } as const, {})
const minute = atom({ plugin: 'vibehaus', key: 'minute' } as const, 0)
// The pending redraw, so pictures and hover zones catch up.
let nextDraw: { cancel: () => void } | undefined

function redrawSoon($: EngineInterface, ms: number): void {
  nextDraw?.cancel()
  nextDraw = undefined
  try {
    nextDraw = $.clock.after(ms, () => {
      try {
        $.ui.invalidate('ui.render')
      } catch {
        // the pane or this plugin load is gone
      }
    })
  } catch {
    // no timer: the next change redraws instead
  }
}

// The terminal house, played into a Raster frame by frame (see plan.ts); repeat frames are skipped.
const RASTER = 'vh-house'
const FRAME_MS = 200
const INLINE_ROWS = 22
let played: { plan: Plan; walkers: Walker[] } | undefined
let shownCells: Uint32Array | undefined
let frames: { cancel: () => void } | undefined
let isPainting = false

const sameCells = (a: Uint32Array, b: Uint32Array | undefined) => b !== undefined && a.length === b.length && a.every((v, i) => v === b[i])

function playHouse($: EngineInterface): void {
  if (frames) return
  try {
    frames = $.clock.every(FRAME_MS, () => void paintFrame($))
  } catch {
    // no timer: the house moves with each redraw instead
  }
}

async function paintFrame($: EngineInterface): Promise<void> {
  const house = played
  if (!house || isPainting) return
  isPainting = true
  try {
    const now = await $.clock.now()
    const cells = planCells(house.plan, house.walkers, now)
    if (played !== house || sameCells(cells, shownCells)) return
    const done = await $.ui.blit({ requestId: PANE, key: RASTER, cells: packCells(cells) })
    // a redraw replaced the plan meanwhile
    if (played !== house) return
    // not shown or resized: the next redraw restarts it
    if (done.deny) stopHouse()
    else shownCells = cells
  } catch {
    stopHouse()
  } finally {
    isPainting = false
  }
}

function stopHouse(): void {
  frames?.cancel()
  frames = undefined
  played = undefined
  shownCells = undefined
}

// A permission prompt's asker waits: the agent it names (any agent asking is named), else the lead.
async function askFor($: EngineInterface, agentId: string | undefined, message: string): Promise<void> {
  const tool = /permission to use ([^\s.,!]+)/i.exec(message)?.[1]
  await move($, agentId ?? MAIN, c => (c.status === 'working' ? { status: 'waiting', waitingTool: tool ?? c.tool } : {}))
}

const LEAD: Resident = {
  id: MAIN, name: 'Lead', kind: 'main', room: 'study',
  movedAt: 0, status: 'idle', activity: 'Waiting for you',
}

// BashOutput, KillShell, MultiEdit and NotebookRead are older builds' tools, kept for them.
function roomFor(tool: string): Room {
  if (/^(Read|Grep|Glob|LSP|NotebookRead|ListMcpResourcesTool|ReadMcpResourceTool)$/.test(tool)) return 'library'
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return 'workshop'
  if (/^(Bash|PowerShell|Monitor|BashOutput|KillShell|TaskStop)$/.test(tool)) return 'kitchen'
  if (/^(WebFetch|WebSearch)$/.test(tool) || tool.startsWith('mcp__')) return 'sunroom'
  return 'study'
}

function roomForKind(kind: string): Room {
  return kind === 'Explore' ? 'library' : 'study'
}

// One short line, so no heredoc reaches the state or alt text.
function oneLine(text: string): string {
  return clip(text.replace(/\s+/g, ' ').trim(), MAX_TEXT)
}

function detail(call: object): string {
  const args = call as Record<string, unknown>
  for (const key of ['command', 'file_path', 'pattern', 'url', 'query', 'description', 'skill']) {
    const v = args[key]
    if (typeof v === 'string' && v.length > 0) {
      return oneLine(key === 'file_path' ? v.split(/[\\/]/).pop() ?? v : v)
    }
  }
  return ''
}

function activityOf(tool: string, call: object): string {
  const what = detail(call)
  return what ? `${tool}: ${what}` : tool
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

// Fields naming a tool's background task; the todo tools' `taskId` is a todo.
const BACKGROUND_FIELD: Record<string, string> = {
  Bash: 'backgroundTaskId', PowerShell: 'backgroundTaskId', Monitor: 'taskId', Workflow: 'taskId',
}

function backgroundId(tool: string, result: unknown): string | undefined {
  const field = own(BACKGROUND_FIELD, tool)
  if (!field || typeof result !== 'object' || result === null) return undefined
  return str((result as Record<string, unknown>)[field])
}

function backgroundKind(tool: string): string {
  return tool === 'Bash' || tool === 'PowerShell' ? 'shell' : tool.toLowerCase()
}

const isLive = (c: Resident) => c.status === 'working' || c.status === 'waiting'

// Dropped finished members, so a brief late listing does not bring one back.
const forgotten = new Set<string>()

// Keeps a few finished members, none still carrying a box; the demo's few never push out real work.
function settle(list: Resident[]): Resident[] {
  const byAge = (a: Resident, b: Resident) => (a.doneAt ?? 0) - (b.doneAt ?? 0)
  const demoDone = list.filter(c => c.status === 'done' && c.isDemo && !c.carrying && !c.session).sort(byAge)
  if (demoDone.length > 2) {
    const drop = new Set(demoDone.slice(0, demoDone.length - 2).map(c => c.id))
    list = list.filter(c => !drop.has(c.id))
  }
  const done = list.filter(c => c.status === 'done' && !c.isDemo && !c.carrying && !c.session).sort(byAge)
  if (done.length <= KEEP_DONE) return list
  const drop = new Set(done.slice(0, done.length - KEEP_DONE).map(c => c.id))
  for (const id of drop) forgotten.add(id)
  for (const id of [...forgotten].slice(0, Math.max(0, forgotten.size - 500))) forgotten.delete(id)
  return list.filter(c => !drop.has(c.id))
}

function without<K extends keyof Resident>(c: Resident, key: K): Resident {
  const copy = { ...c }
  delete copy[key]
  return copy
}

// Desks stick, so nobody slides over when others leave.
function assignSeats(prev: Resident[], wanted: Resident[]): Resident[] {
  const was = new Map(prev.map(c => [c.id, c]))
  const taken = new Map<Room, Set<number>>()
  const takenIn = (room: Room) => taken.get(room) ?? taken.set(room, new Set()).get(room)!
  const kept = wanted.map(c => {
    if (!isLive(c)) return c.seat === undefined ? c : without(c, 'seat')
    const before = was.get(c.id)
    const stays = c.seat !== undefined && before !== undefined && isLive(before) && before.room === c.room && !takenIn(c.room).has(c.seat)
    if (stays && c.seat !== undefined) {
      takenIn(c.room).add(c.seat)
      return c
    }
    return without(c, 'seat')
  })
  return kept.map(c => {
    if (!isLive(c) || c.seat !== undefined) return c
    const used = takenIn(c.room)
    let seat = 0
    while (used.has(seat)) seat++
    used.add(seat)
    return { ...c, seat }
  })
}

// All household changes: changed plans start where shown now; unchanged writes are skipped.
async function change($: EngineInterface, fn: (list: Resident[]) => Resident[]): Promise<void> {
  void startSharing($).catch(() => undefined)
  const now = await $.clock.now()
  const apply = (list: Resident[]) => {
    const base = ordered(list.length === 0 ? [LEAD] : list)
    const seated = ordered(assignSeats(base, fn(base)))
    return reanchor(base, seated, now)
  }
  const before = await read($, residents)
  const after = apply(before)
  if (JSON.stringify(after) === JSON.stringify(before)) return
  // as worked out, unless another change landed first
  await update($, residents, list => (list === before ? after : apply(list)))
  void publish($).catch(() => undefined)
}

type Patch = Partial<Resident> | ((c: Resident) => Partial<Resident>)

async function move($: EngineInterface, id: string, patch: Patch, fallback?: Resident): Promise<void> {
  // not in the house: nothing to write (the lead always is)
  if (!fallback && id !== MAIN && !(await read($, residents)).some(c => c.id === id)) return
  const now = await $.clock.now()
  await change($, base => {
    const all = base.some(c => c.id === id) || !fallback ? base : [...base, fallback]
    return settle(all.map((c): Resident => {
      if (c.id !== id) return c
      const p = typeof patch === 'function' ? patch(c) : patch
      const room = p.room ?? c.room
      const moved = room !== c.room
      const status = p.status ?? c.status
      const wasIdle = c.status === 'idle' || c.status === 'done'
      const isIdle = status === 'idle' || status === 'done'
      return {
        ...c, ...p, room, movedAt: moved ? now : c.movedAt,
        idleSince: !wasIdle && isIdle ? now : c.idleSince,
        workSince: wasIdle && !isIdle ? now : c.workSince,
      }
    }))
  })
}

async function join($: EngineInterface, member: Resident): Promise<void> {
  forgotten.delete(member.id)
  await change($, base => settle([...base.filter(c => c.id !== member.id), member]))
}

// Read-then-write store jobs run one at a time, so none counts from a stale value.
let storeQueue: Promise<unknown> = Promise.resolve()

function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = storeQueue.then(job, job)
  storeQueue = run.catch(() => undefined)
  return run
}

// Today's shipping, a key per session; boxes stack by time so each keeps its place and tape.
type Shipment = { at: number; session: string }
let shippedToday: { day: string; boxes: Shipment[] } = { day: '', boxes: [] }

function dayOf(now: number): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// This session's id, before sharing starts too.
const ownId = async ($: EngineInterface) => self?.id ?? await $.session.id().catch(() => 'local')

async function readShipped($: EngineInterface, now: number): Promise<void> {
  const day = dayOf(now)
  const prefix = `shipped:${day}:`
  const own = await ownId($)
  const all: { at: number; id: string }[] = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith(prefix)) continue
    const id = key.slice(prefix.length)
    for (const at of numbers(await $.store.get(key))) all.push({ at, id })
  }
  // one order in every house; this session's own named ''
  all.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  shippedToday = { day, boxes: all.map(b => ({ at: b.at, session: b.id === own ? '' : b.id })) }
}

async function shippedOn($: EngineInterface, now: number): Promise<Shipment[]> {
  if (shippedToday.day !== dayOf(now)) await readShipped($, now).catch(() => undefined)
  return shippedToday.day === dayOf(now) ? shippedToday.boxes : []
}

// One more box on this session's key; an unreadable key is not started over.
async function countShipped($: EngineInterface, now: number): Promise<void> {
  const key = `shipped:${dayOf(now)}:${await ownId($)}`
  const sofar = await $.store.get(key)
  await $.store.set(key, [...numbers(sofar), now])
  await readShipped($, now)
}

// Today's boxes from every session and the demo, in order, each as its shipper.
async function yardBoxes($: EngineInterface, now: number): Promise<string[]> {
  const boxes = [...await shippedOn($, now), ...demoBoxes.map(at => ({ at, session: '' }))]
  return boxes.sort((a, b) => a.at - b.at).map(b => b.session)
}

// A finished member carries a box to the pallets (see `deliver`), one at a time so none share a place.
let finishing: Promise<unknown> = Promise.resolve()

function finish($: EngineInterface, id: string, activity: string): Promise<void> {
  const run = finishing.then(() => finishOne($, id, activity), () => finishOne($, id, activity))
  finishing = run.catch(() => undefined)
  return run
}

async function finishOne($: EngineInterface, id: string, activity: string): Promise<void> {
  const member = (await read($, residents)).find(c => c.id === id)
  if (!member || member.status === 'done' || member.session) return
  const now = await $.clock.now()
  // the next free pallet place, counting every session's latest
  await readShipped($, now).catch(() => undefined)
  const box = (await yardBoxes($, now)).length
  let isShipped = false
  let isDemo = false
  await change($, list => {
    // the update may run again on a clash: decide afresh each time
    isShipped = false
    return settle(list.map((c): Resident => {
      if (c.id !== id || c.status === 'done' || c.session) return c
      isShipped = true
      isDemo = c.isDemo === true
      // a shell or monitor keeps its command; the end goes to its status
      const keepsCommand = c.id !== MAIN && taskTypeOf(c) !== 'subagent'
      return { ...c, status: 'done', ...(keepsCommand ? {} : { activity }), taskStatus: activity.toLowerCase(), doneAt: now, idleSince: now, carrying: true, box }
    }))
  })
  if (!isShipped) return
  if (isDemo) demoBoxes.push(now)
  else await serial(() => countShipped($, now)).catch(() => undefined)
  await sendOut($, id)
}

// Corrects a task taken as completed once the engine's notice says how it ended.
async function restate($: EngineInterface, id: string, word: string): Promise<void> {
  await change($, list => list.map(c => {
    if (c.id !== id || c.status !== 'done' || c.session || c.taskStatus === word.toLowerCase()) return c
    const keepsCommand = c.id !== MAIN && taskTypeOf(c) !== 'subagent'
    return { ...c, ...(keepsCommand ? {} : { activity: word }), taskStatus: word.toLowerCase() }
  }))
}

// One timer per courier on its way.
const errands = new Map<string, { cancel: () => void }>()

// Brings a courier back when its errand ends; after a reload, one overdue lands at once.
async function sendOut($: EngineInterface, id: string): Promise<void> {
  const now = await $.clock.now()
  const end = errandEnds(ordered(await read($, residents)), now).get(id)
  errands.get(id)?.cancel()
  errands.delete(id)
  if (end === undefined) return
  errands.set(id, $.clock.after(Math.max(0, end - now), () => {
    errands.delete(id)
    void deliver($, id).catch(() => undefined)
  }))
}

// Back from the pallets, box stacked.
async function deliver($: EngineInterface, id: string): Promise<void> {
  const now = await $.clock.now()
  await change($, list => settle(list.map(c => (c.id === id && c.carrying ? { ...without(without(c, 'carrying'), 'box'), idleSince: now } : c))))
}

function ordered(list: Resident[]): Resident[] {
  const rank = (c: Resident) => (c.id === MAIN ? 0 : isLive(c) ? 1 : c.status === 'idle' ? 2 : 3)
  return list.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map(x => x.c)
}

// Where a member stands, for its hover card.
type State = 'running' | 'waiting' | 'pending' | 'idle' | 'done' | 'failed' | 'stopped'

function endState(c: Resident): State {
  const w = (c.taskStatus ?? c.activity).toLowerCase()
  if (/kill|stop|cancel|abort/.test(w)) return 'stopped'
  if (/fail|error/.test(w)) return 'failed'
  return 'done'
}

const STATE_WORD: Record<State, string> = {
  running: 'running', waiting: 'awaiting approval', pending: 'pending', idle: 'waiting for you',
  done: 'completed', failed: 'failed', stopped: 'stopped',
}

// ---------- token usage, kept as time and token pairs ----------

const HOUR = 60 * 60 * 1000
const WEEK = 7 * 24 * HOUR

function tokensSince(usage: number[] | undefined, since: number): number {
  let sum = 0
  for (let i = 0; i + 1 < (usage?.length ?? 0); i += 2) if ((usage?.[i] ?? 0) >= since) sum += usage?.[i + 1] ?? 0
  return sum
}

// One pair per hour, at its latest time, so a week is at most 168; pairs before `since` drop.
function byHour(flat: number[], since = 0): number[] {
  const hours = new Map<number, [number, number]>()
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const [t, n] = [flat[i] ?? 0, flat[i + 1] ?? 0]
    if (t < since) continue
    const was = hours.get(Math.floor(t / HOUR))
    hours.set(Math.floor(t / HOUR), [Math.max(t, was?.[0] ?? 0), n + (was?.[1] ?? 0)])
  }
  return [...hours.values()].sort((a, b) => a[0] - b[0]).flat()
}

function addUsage(usage: number[] | undefined, now: number, tokens: number): number[] {
  return byHour([...(usage ?? []), now, tokens], now - WEEK)
}

function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1e6) return `${Math.round(n / 1000)}k`
  return `${(n / 1e6).toFixed(1)}M`
}

// The week's tokens: the lead's span sessions, anyone else's is its one run.
function usageText(c: Resident, now: number): string | undefined {
  const week = tokensSince(c.usage, now - WEEK)
  return week === 0 ? undefined : compact(week)
}

// A request's cost; cache reads are left out, being nearly free.
function tokensOf(u: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number } | null | undefined): number {
  return u ? u.input_tokens + u.cache_creation_input_tokens + u.output_tokens : 0
}

// The lead's usage spans sessions, a key each, summed so none overwrite another.
const LEAD_USAGE = 'usage:lead'
let ownKey: string | undefined

async function leadKey($: EngineInterface): Promise<string> {
  if (ownKey) return ownKey
  const started = await $.session.usage({}).then(u => u.startedAt).catch(() => 0)
  ownKey = `${LEAD_USAGE}:${started || await $.clock.now()}`
  return ownKey
}

const numbers = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [])

// The lead's usage over all sessions, others' read at most once a minute; undefined if the store fails.
let othersUsage: { at: number; flat: number[] } | undefined

async function leadUsage($: EngineInterface, mine?: number[]): Promise<number[] | undefined> {
  try {
    const now = await $.clock.now()
    const own = await leadKey($)
    if (!othersUsage || now - othersUsage.at > MINUTE) {
      const flat: number[] = []
      for (const key of (await $.store.keys()).filter(k => k.startsWith(LEAD_USAGE) && k !== own)) flat.push(...numbers(await $.store.get(key)))
      othersUsage = { at: now, flat: byHour(flat) }
    }
    return byHour([...othersUsage.flat, ...(mine ?? numbers(await $.store.get(own)))])
  } catch {
    return undefined
  }
}

// Drops old days' counts, week-old usage and dead sessions (a crashed one never deletes its own).
async function pruneStore($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const today = dayOf(now)
  for (const key of await $.store.keys()) {
    if (key.startsWith('shipped:') && !key.startsWith(`shipped:${today}`)) await $.store.delete(key)
    if (key.startsWith(PEER)) {
      const v = await $.store.get(key) as Partial<Snapshot> | undefined
      if (now - (typeof v?.at === 'number' ? v.at : 0) > FORGET_AFTER) await $.store.delete(key)
    }
    if (key.startsWith(LEAD_USAGE)) {
      const v = numbers(await $.store.get(key))
      const newest = v.filter((_t, i) => i % 2 === 0).reduce((a, b) => Math.max(a, b), 0)
      if (newest < now - WEEK) await $.store.delete(key)
    }
  }
}

// No plan changes here, so this skips `change` and its reanchoring.
async function recordUsage($: EngineInterface, id: string, tokens: number): Promise<void> {
  if (tokens <= 0) return
  const now = await $.clock.now()
  if (id === MAIN) {
    await serial(async () => {
      const key = await leadKey($)
      const kept = (await read($, residents)).find(c => c.id === MAIN)?.usage
      const stored = await $.store.get(key).then(numbers, () => undefined)
      let usage = addUsage(kept, now, tokens)
      if (stored !== undefined) {
        const mine = addUsage(stored, now, tokens)
        if (await $.store.set(key, mine).then(() => true, () => false)) usage = await leadUsage($, mine) ?? mine
      }
      await update($, residents, list => (list.length === 0 ? [LEAD] : list).map(c => (c.id === MAIN ? { ...c, usage } : c)))
    })
    return
  }
  // nobody to add to: an engine fork's step, say
  if (!(await read($, residents)).some(c => c.id === id)) return
  await update($, residents, list => list.map(c => (c.id === id ? { ...c, usage: addUsage(c.usage, now, tokens) } : c)))
}

// ---------- the plan's windows, for the vibe fatigue band ----------

// Read off Claude Code's response headers, so nothing leaves the machine; the account's newest is shared.
const PLAN_KEY = 'plan'
const MINUTE = 60 * 1000

// A reading taken `at`; none off a subscription or before the first response.
function readingOf(limits: readonly SessionRateLimit[], at: number): PlanUse | undefined {
  const five = limits.find(r => r.kind === 'five_hour')
  const week = limits.find(r => r.kind === 'seven_day')
  if (!five && !week) return undefined
  const resets = (r: SessionRateLimit) => (r.resetsAt ? Date.parse(r.resetsAt) : NaN)
  const out: PlanUse = { at }
  if (five) {
    out.fiveHour = five.percentUsed
    if (Number.isFinite(resets(five))) out.fiveHourResets = resets(five)
  }
  if (week) {
    out.week = week.percentUsed
    if (Number.isFinite(resets(week))) out.weekResets = resets(week)
  }
  return out
}

// A stored reading, checked field by field, percentages floored at zero.
function planFrom(raw: unknown): PlanUse | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const v = raw as Record<string, unknown>
  const out: PlanUse = {}
  for (const k of ['at', 'fiveHour', 'fiveHourResets', 'week', 'weekResets'] as const) {
    const n = v[k]
    if (typeof n === 'number' && Number.isFinite(n)) out[k] = k === 'fiveHour' || k === 'week' ? Math.max(0, n) : n
  }
  return out.at !== undefined ? out : undefined
}

// A newer reading over an older, window by window.
function newer(was: PlanUse, r: PlanUse): PlanUse {
  const five = r.fiveHour !== undefined ? r : was
  const week = r.week !== undefined ? r : was
  return {
    ...(r.at !== undefined ? { at: r.at } : {}),
    ...(five.fiveHour !== undefined ? { fiveHour: five.fiveHour } : {}),
    ...(five.fiveHourResets !== undefined ? { fiveHourResets: five.fiveHourResets } : {}),
    ...(week.week !== undefined ? { week: week.week } : {}),
    ...(week.weekResets !== undefined ? { weekResets: week.weekResets } : {}),
  }
}

// The windows at `now`: one past its reset is blank until a response brings the next.
function current(p: PlanUse, now: number): PlanUse {
  const fiveOver = p.fiveHourResets !== undefined && p.fiveHourResets <= now
  const weekOver = p.weekResets !== undefined && p.weekResets <= now
  if (!fiveOver && !weekOver) return p
  return {
    ...(p.at !== undefined ? { at: p.at } : {}),
    ...(!fiveOver && p.fiveHour !== undefined ? { fiveHour: p.fiveHour } : {}),
    ...(!fiveOver && p.fiveHourResets !== undefined ? { fiveHourResets: p.fiveHourResets } : {}),
    ...(!weekOver && p.week !== undefined ? { week: p.week } : {}),
    ...(!weekOver && p.weekResets !== undefined ? { weekResets: p.weekResets } : {}),
  }
}

const sameWindows = (a: PlanUse, b: PlanUse) =>
  a.fiveHour === b.fiveHour && a.fiveHourResets === b.fiveHourResets && a.week === b.week && a.weekResets === b.weekResets

// Shows a newer, different local reading, and stores it unless the store's is newer.
async function takeReading($: EngineInterface, reading: PlanUse | undefined, now: number): Promise<void> {
  const at = reading?.at
  if (!reading || at === undefined) return
  // the reading applied to `was`, if it says anything new
  const over = (was: PlanUse) => {
    if (at <= (was.at ?? 0)) return undefined
    const merged = current(newer(was, reading), now)
    return sameWindows(merged, was) ? undefined : merged
  }
  if (!over(await read($, plan))) return
  let wrote: PlanUse | undefined
  await update($, plan, was => (wrote = over(was)) ?? was)
  if (!wrote) return
  const stored = planFrom(await $.store.get(PLAN_KEY).catch(() => undefined))
  if ((stored?.at ?? 0) < at) await $.store.set(PLAN_KEY, wrote).catch(() => undefined)
}

// Adopts the store's newer reading, else restores this one's (two writes may race); false if none stored.
async function adoptPlan($: EngineInterface, now: number): Promise<boolean> {
  const stored = planFrom(await $.store.get(PLAN_KEY))
  if (!stored) return false
  const at = stored.at ?? 0
  const was = await read($, plan)
  if (at > (was.at ?? 0)) await update($, plan, p => (at > (p.at ?? 0) ? current(newer(p, stored), now) : p))
  else if ((was.at ?? 0) > at) await $.store.set(PLAN_KEY, was).catch(() => undefined)
  return true
}

// At start: the store's newest reading, else Claude Code's own.
async function startPlan($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, minute, () => now)
  if (await adoptPlan($, now)) return
  const { rateLimits } = await $.session.usage({})
  await takeReading($, readingOf(rateLimits, now), now)
}

// Session setup, each step on its own so one failing leaves the rest.
async function begin($: EngineInterface): Promise<void> {
  // a session resumed here after ending shares again
  endedHere.clear()
  await $.command.register({
    name: 'haus',
    description: 'Show Vibehaus · "demo" fills it with a demo household · "snapshot" saves it as an SVG',
    argumentHint: '[demo | snapshot]',
    immediate: true,
  }).catch(() => undefined)
  try {
    const usage = await leadUsage($)
    await change($, list => list.filter(c => !c.isDemo).map(c => (c.id === MAIN && usage ? { ...c, usage } : c)))
    for (const c of await read($, residents)) if (c.carrying && !c.session) await sendOut($, c.id)
  } catch {
    // the household as it is
  }
  void endQuietly($).catch(() => undefined)
  $.clock.after(ENDING_GRACE, () => void endQuietly($).catch(() => undefined))
  void startSharing($).catch(() => undefined)
  void startPlan($).catch(() => undefined)
  void pruneStore($).catch(() => undefined)
}

// Each minute: resets count down and a window past its reset loses its reading.
async function tickPlan($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  await update($, minute, () => now)
  const was = await read($, plan)
  if (current(was, now) !== was) await update($, plan, p => current(p, now))
}
let ticker: { cancel: () => void } | undefined

// Cells per plan bar when the band's width is unknown.
const BAR = 8

function metersOf(p: PlanUse): Meter[] {
  return [
    { label: '5H', color: '#52d2f5', ...(p.fiveHour !== undefined ? { percent: p.fiveHour } : {}), ...(p.fiveHourResets !== undefined ? { resets: p.fiveHourResets } : {}) },
    { label: 'Week', color: '#4cf08c', ...(p.week !== undefined ? { percent: p.week } : {}), ...(p.weekResets !== undefined ? { resets: p.weekResets } : {}) },
  ]
}

// A reset time as the band words it: minutes or hours today, else the weekday.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function resetText(at: number, now: number): string {
  const m = Math.max(1, Math.ceil((at - now) / MINUTE))
  if (m < 60) return `${m}m`
  if (m < 24 * 60) return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`
  return DAYS[new Date(at).getDay()] ?? ''
}

// Bar width and reset wording: full resets while bars keep BAR_ROOMY cells, then short, then none.
const TOGGLE = '◧ Vibehaus'
const BAR_MIN = 3
const BAR_ROOMY = 4
const BAR_MAX = 40
const percentText = (m: Meter) => (m.percent === undefined ? '--' : `${Math.round(m.percent)}%`)

function bandOf(meters: Meter[], columns: number | undefined, now: number): { bar: number; words: string[] } {
  const wordings = [(t: string) => `Resets ${t}`, (t: string) => t, () => '']
  let last = { bar: BAR_MIN, words: meters.map(() => '') }
  for (const [i, say] of wordings.entries()) {
    const words = meters.map(m => (m.percent !== undefined && m.resets !== undefined ? say(resetText(m.resets, now)) : ''))
    if (columns === undefined) return { bar: BAR, words }
    // the toggle, gaps, a spare cell, and each meter's words: "5H ", " 42%", " · 2h 10m"
    const fixed = TOGGLE.length + 2 * meters.length + 1
      + meters.reduce((n, m, k) => n + m.label.length + 2 + percentText(m).length + (words[k] ? 3 + [...(words[k] as string)].length : 0), 0)
    const bar = Math.floor((columns - fixed) / meters.length)
    if (bar >= (i < wordings.length - 1 ? BAR_ROOMY : BAR_MIN)) return { bar: Math.min(BAR_MAX, bar), words }
    last = { bar: BAR_MIN, words }
  }
  return last
}

function stateOf(c: Resident): State {
  if (c.kind === 'main') return c.status === 'waiting' ? 'waiting' : c.status === 'working' ? 'running' : 'idle'
  if (c.status === 'waiting') return 'waiting'
  if (c.isTeammate && c.status === 'idle') return 'idle'
  if (isLive(c)) return c.taskStatus === 'pending' ? 'pending' : 'running'
  return endState(c)
}

function ended(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

// One of the Stop hooks' `background_tasks`; long texts end in "... [+N chars]".
type TaskSummary = {
  id: string
  type: string
  status: string
  description: string
  command?: string
  agent_type?: string
  name?: string
  server?: string
}
const CLIPPED = /\.\.\. \[\+\d+ chars\]$/

function fromSummary(t: TaskSummary): Resident {
  const description = oneLine(t.description.replace(CLIPPED, '…'))
  const isAgent = t.type === 'subagent'
  const kind = isAgent ? t.agent_type ?? 'agent' : t.type
  return {
    id: t.id,
    name: isAgent ? description || kind : `Background ${t.type}`,
    kind,
    room: isAgent ? roomForKind(kind) : t.type === 'shell' || t.type === 'monitor' ? 'kitchen' : t.server ? 'sunroom' : 'study',
    // start unknown: none rather than a wrong one
    movedAt: 0,
    status: 'working',
    activity: oneLine(t.command?.replace(CLIPPED, '…') || description || t.name || t.type),
    isBackground: true,
    taskType: t.type,
    taskStatus: t.status,
  }
}

// Syncs to the engine's background list as of `asOf`: missing tasks join, vanished ones end, newer stay.
// Agents go by the agent list instead (foreground ones are not background); workflow agents are in neither.
async function reconcile($: EngineInterface, tasks: readonly TaskSummary[] | undefined, asOf: number): Promise<void> {
  if (!tasks) return
  const live = new Map(tasks.map(t => [t.id, t]))
  let agents: Map<string, string> | undefined
  try {
    agents = new Map((await $.agent.list()).map(a => [a.id, a.status as string]))
  } catch {
    agents = undefined
  }
  let over: { id: string; word: string }[] = []
  let isEnding = false
  const hasEnded = (s: string | undefined) => s === undefined || s === 'completed' || s === 'failed' || s === 'killed'
  await change($, list => {
    over = []
    isEnding = false
    const synced = list.map((c): Resident => {
      if (c.session) return c
      const t = live.get(c.id)
      if (t) return c.status === 'done' ? c : { ...without(c, 'endingSince'), taskType: t.type, taskStatus: t.status }
      const seen = c.spawnedAt ?? c.workSince
      const isOld = seen === undefined || seen < asOf
      // a teammate, working or idle, ends once the engine stops listing it
      if (c.isTeammate && agents && c.status !== 'done') {
        const s = agents.get(c.id)
        if (isOld && hasEnded(s)) over.push({ id: c.id, word: s ?? 'completed' })
        return c
      }
      if (c.id === MAIN || c.isDemo || !isLive(c) || !isOld) return c
      if (taskTypeOf(c) === 'subagent') {
        if (!agents || c.isWorkflow) return c
        const s = agents.get(c.id)
        if (hasEnded(s)) over.push({ id: c.id, word: s ?? 'completed' })
        return c
      }
      // gone from the list: its end notice may be coming, so it ends as completed after a moment
      isEnding = true
      return c.endingSince !== undefined ? c : { ...c, endingSince: asOf }
    })
    for (const t of tasks) {
      if (list.some(c => c.id === t.id) || forgotten.has(t.id)) continue
      if (t.status !== 'running' && t.status !== 'pending') continue
      synced.push(fromSummary(t))
    }
    return settle(synced)
  })
  for (const o of over) await finish($, o.id, ended(o.word))
  if (isEnding) $.clock.after(ENDING_GRACE, () => void endQuietly($).catch(() => undefined))
}

// How long work gone from the engine's list waits for its notice.
const ENDING_GRACE = 5000

async function endQuietly($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const due = (await read($, residents)).filter(c => !c.session && c.status !== 'done' && c.endingSince !== undefined && now - c.endingSince >= ENDING_GRACE)
  for (const c of due) await finish($, c.id, 'Completed')
}

async function contextNow($: EngineInterface): Promise<number | undefined> {
  try {
    const usage = await $.session.usage({})
    return usage.context.percent
  } catch {
    return undefined
  }
}

// ---------- other sessions in the same house ----------

// Each session shares its household under its own key; the others' agents walk in from the street.
// One that stops writing, or idles unmessaged for five hours, moves out until busy again.
const PEER = 'session:'
const SYNC_EVERY = 3000
const BEAT_EVERY = 10000
const GONE_AFTER = 35000
const FORGET_AFTER = HOUR
const ACTIVE_FOR = 5 * HOUR

// What a session writes, with when it last woke from a long sleep.
type Snapshot = { at: number; since: number; activeAt: number; name: string; residents: Resident[]; wokeAt?: number }

// When a session was last busy, by its members' latest times.
const activeAtOf = (mine: Resident[]) => Math.max(0, ...mine.flatMap(c => [c.workSince, c.spawnedAt, c.resultAt, c.doneAt, c.idleSince, ...(c.calls ?? [])].filter((t): t is number => typeof t === 'number')))
type Peer = { id: string; name: string; since: number }

// This session as the others know it, and the others as last read.
let self: { id: string; name: string; since: number } | undefined
let peers: Peer[] = []
// sessions gone, whose households are still walking out
let going: Peer[] = []
let lastSync = 0
let shared = { at: 0, text: '' }
// sessions seen ending here, so late changes do not share them again; then the sleep state
const endedHere = new Map<string, number>()
const END_QUIET = 10000
let wasAsleep = false
let wokeAt = 0
let publishing: { cancel: () => void } | undefined
let sharing: Promise<void> | undefined
// counts starts, so one stopped mid-start gives up
let runs = 0
let beats: { cancel: () => void }[] = []

const peerName = (id: string) => [...peers, ...going].find(p => p.id === id)?.name ?? 'another session'

async function whoAmI($: EngineInterface): Promise<NonNullable<typeof self>> {
  const now = await $.clock.now()
  const id = await $.session.id().catch(() => 'local')
  const root = await $.session.root().catch(() => '')
  const since = await $.session.usage({}).then(u => u.startedAt).catch(() => 0)
  // its name before a reload: its title, once it had one
  const was = await $.store.get(PEER + id).catch(() => undefined) as Partial<Snapshot> | undefined
  const name = typeof was?.name === 'string' && was.name ? was.name : root.split(/[\\/]/).filter(Boolean).pop() ?? 'session'
  return { id, name, since: since || now }
}

// A session goes by its title once the engine sends one, else its folder.
async function retitle($: EngineInterface, title: string | undefined): Promise<void> {
  const name = title ? oneLine(title).slice(0, 40) : ''
  if (!name) return
  await startSharing($)
  const me = self
  if (!me || me.name === name) return
  me.name = name
  await publish($)
}

// What others see: nothing house-local, of its work only the tool and file name, never a command or query.
const FILE_TOOLS = /^(Read|Edit|Write|MultiEdit|NotebookEdit|NotebookRead)$/
function outward(c: Resident): Resident {
  const kept = without(without(without(without(c, 'anchor'), 'seat'), 'usage'), 'endingSince')
  const isTask = c.id !== MAIN && taskTypeOf(c) !== 'subagent'
  const activity = isTask
    ? c.status === 'done' ? ended(c.taskStatus ?? 'done') : 'Running'
    : c.tool && c.activity.startsWith(`${c.tool}: `) && !FILE_TOOLS.test(c.tool) ? c.tool : c.activity
  return { ...kept, activity }
}

// Shares this session's members at most every two seconds, and each beat as a sign of life.
async function publish($: EngineInterface, beat = false): Promise<void> {
  const me = self
  if (!me) return
  const now = await $.clock.now()
  if (!beat && now - shared.at < 2000) {
    publishing ??= $.clock.after(2000 - (now - shared.at), () => {
      publishing = undefined
      void publish($).catch(() => undefined)
    })
    return
  }
  const mine = (await read($, residents)).filter(c => !c.session && !c.isDemo).map(outward)
  // a session just started is not asleep, whatever its members did
  const activeAt = Math.max(me.since, activeAtOf(mine))
  // marks waking from a long sleep, so every house sees it arrive at once
  const asleep = !mine.some(isLive) && now - activeAt > ACTIVE_FOR
  if (wasAsleep && !asleep) wokeAt = now
  wasAsleep = asleep
  const body = { since: me.since, activeAt, name: me.name, residents: mine, ...(wokeAt ? { wokeAt } : {}) }
  const text = JSON.stringify(body)
  if ((!beat && text === shared.text) || self !== me) return
  shared = { at: now, text }
  await $.store.set(PEER + me.id, { ...body, at: now } satisfies Snapshot)
}

const ROOMS = new Set<string>(ALL_ROOMS)
const STATUSES = new Set<string>(['working', 'waiting', 'idle', 'done'])

// Another session's member, checked field by field; one lacking essentials is dropped.
function memberOf(raw: unknown): Resident | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const m = raw as Record<string, unknown>
  const text = (k: string) => (typeof m[k] === 'string' ? oneLine(m[k] as string) : undefined)
  const num = (k: string) => (typeof m[k] === 'number' && Number.isFinite(m[k]) ? m[k] as number : undefined)
  const { id, kind, name, room, status } = { id: text('id'), kind: text('kind'), name: text('name'), room: text('room'), status: text('status') }
  if (!id || !kind || name === undefined || !room || !ROOMS.has(room) || !status || !STATUSES.has(status)) return undefined
  const out: Resident = { id, kind, name, room: room as Room, status: status as ResidentStatus, movedAt: num('movedAt') ?? 0, activity: text('activity') ?? '' }
  for (const k of ['tool', 'taskType', 'taskStatus', 'waitingTool'] as const) {
    const v = text(k)
    if (v !== undefined) out[k] = v
  }
  for (const k of ['resultAt', 'spawnedAt', 'doneAt', 'idleSince', 'workSince', 'context', 'box'] as const) {
    const v = num(k)
    if (v !== undefined) out[k] = v
  }
  for (const k of ['isBackground', 'isOk', 'isWorkflow', 'isTeammate', 'carrying'] as const) {
    if (typeof m[k] === 'boolean') out[k] = m[k] as boolean
  }
  const from = text('spawnRoom')
  if (from && ROOMS.has(from)) out.spawnRoom = from as Room
  if (Array.isArray(m.calls)) out.calls = m.calls.filter((t): t is number => typeof t === 'number').slice(-MAX_CALLS)
  return out
}

// Session names as every house shows them, repeats numbered.
function nameAll(list: { id: string; name: string; since: number }[]): Map<string, string> {
  const seen = new Map<string, number>()
  const out = new Map<string, string>()
  for (const s of [...list].sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1))) {
    const n = (seen.get(s.name) ?? 0) + 1
    seen.set(s.name, n)
    out.set(s.id, n > 1 ? `${s.name} ${n}` : s.name)
  }
  return out
}

type Visible = Peer & Household

// Other sessions to show: neither stopped writing nor asleep. Long-stale keys are cleared.
async function readPeers($: EngineInterface, own: string, now: number): Promise<Visible[]> {
  const found: Visible[] = []
  const time = (t: unknown) => (typeof t === 'number' && Number.isFinite(t) ? t : undefined)
  for (const key of await $.store.keys()) {
    if (!key.startsWith(PEER) || key === PEER + own) continue
    const v = await $.store.get(key) as Partial<Snapshot> | undefined
    const at = time(v?.at) ?? 0
    if (now - at > FORGET_AFTER) {
      await $.store.delete(key).catch(() => undefined)
      continue
    }
    if (!v || now - at > GONE_AFTER || !Array.isArray(v.residents)) continue
    const members = v.residents.flatMap(m => memberOf(m) ?? [])
    if (!members.some(isLive) && now - (time(v.activeAt) ?? 0) > ACTIVE_FOR) continue
    const woke = time(v.wokeAt)
    found.push({
      id: key.slice(PEER.length), name: oneLine(String(v.name || 'session')).slice(0, 40),
      since: time(v.since) ?? 0, residents: members, ...(woke !== undefined ? { wokeAt: woke } : {}),
    })
  }
  return found.sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1))
}

// Moves other sessions in and quiet ones out; all go if the store stays out of reach as long.
let syncing = false

async function syncPeers($: EngineInterface): Promise<void> {
  if (syncing) return
  syncing = true
  try {
    await syncOnce($)
  } finally {
    syncing = false
  }
}

async function syncOnce($: EngineInterface): Promise<void> {
  const me = self
  if (!me) return
  const now = await $.clock.now()
  let found: Visible[]
  try {
    found = await readPeers($, me.id, now)
  } catch {
    if (now - lastSync > GONE_AFTER) {
      going = [...peers, ...going]
      peers = []
      paintHomes()
      await change($, list => visit(list, [], now))
    }
    return
  }
  lastSync = now
  await readShipped($, now).catch(() => undefined)
  await adoptPlan($, now).catch(() => false)
  const names = nameAll([me, ...found])
  const was = [...peers, ...going]
  peers = found.map(f => ({ id: f.id, name: names.get(f.id) ?? f.name, since: f.since }))
  // a session gone keeps its colour and name while its household walks out
  const here = await read($, residents)
  going = was.filter(p => !found.some(f => f.id === p.id) && here.some(c => c.session === p.id))
  paintHomes()
  // alone, with no visitors left to see out: nothing to change
  if (found.length === 0 && !here.some(c => c.session)) return
  await change($, list => visit(list, found, now))
}

// Starts sharing once: at session start, or the first change if the world could not answer yet.
function startSharing($: EngineInterface): Promise<void> {
  if (sharing) return sharing
  const run = ++runs
  sharing = (async () => {
    const me = await whoAmI($)
    // stopped while it asked
    if (run !== runs) return
    // ended just now: after /clear the next change uses the new id; a resumed one shares again
    const endedAt = endedHere.get(me.id)
    if (endedAt !== undefined && await $.clock.now() - endedAt < END_QUIET) {
      sharing = undefined
      return
    }
    self = me
    for (const beat of beats) beat.cancel()
    beats = [
      $.clock.every(SYNC_EVERY, () => void syncPeers($).catch(() => undefined)),
      $.clock.every(BEAT_EVERY, () => void publish($, true).catch(() => undefined)),
    ]
    await publish($, true).catch(() => undefined)
    await syncPeers($).catch(() => undefined)
  })()
  // failed: the next change tries again
  sharing.catch(() => {
    if (run === runs) sharing = undefined
  })
  return sharing
}

async function stopSharing($: EngineInterface): Promise<void> {
  for (const beat of beats) beat.cancel()
  beats = []
  publishing?.cancel()
  publishing = undefined
  sharing = undefined
  runs++
  const me = self
  self = undefined
  if (me) endedHere.set(me.id, await $.clock.now().catch(() => 0))
  peers = []
  going = []
  paintHomes()
  shared = { at: 0, text: '' }
  wasAsleep = false
  wokeAt = 0
  if (me) await $.store.delete(PEER + me.id).catch(() => undefined)
}

// Colours each session by when it moved in; none while this one is alone.
function paintHomes(): void {
  const others = [...peers, ...going]
  if (!self || others.length === 0) {
    paintSessions([], '')
    return
  }
  const me = self
  const all = [{ id: '', since: me.since, key: me.id }, ...others.map(p => ({ id: p.id, since: p.since, key: p.id }))]
    .sort((a, b) => a.since - b.since || (a.key < b.key ? -1 : 1))
  paintSessions(all.map(s => s.id), me.id)
}

// ---------- hover cards ----------

// Whole percentages (all a Box takes), rounded at running edges so the pieces add up.
function percents(edges: number[], whole: number): string[] {
  const at = edges.map(edge => Math.round((Math.min(Math.max(edge, 0), whole) / Math.max(1, whole)) * 100))
  return at.slice(1).map((p, i) => `${Math.max(0, p - (at[i] ?? 0))}%`)
}

function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

// An agent's hover card: who, the task, what it does, how long, at what cost.
function agentCard(c: Resident, now: number): string[] {
  const type = taskTypeOf(c)
  const state = stateOf(c)
  const live = state === 'running' || state === 'waiting' || state === 'pending'
  const started = c.spawnedAt ?? c.workSince
  const took = started && started > 0 ? live ? ago(now - started) : c.doneAt !== undefined ? ago(c.doneAt - started) : '' : ''
  const doing = state === 'waiting' ? `awaiting approval${c.waitingTool ? ` for ${c.waitingTool}` : ''}` : live || (state === 'idle' && c.isTeammate) ? c.activity : STATE_WORD[state]
  const used = usageText(c, now)
  const from = c.session ? `from "${peerName(c.session)}"` : ''
  if (c.kind === 'main') {
    return ['Host', from, doing, [c.context !== undefined ? `context ${Math.round(c.context)}%` : '', live ? took : '', used ? `${used} tokens this week` : ''].filter(Boolean).join(' · ')].filter(Boolean)
  }
  if (type === 'subagent') return [`${displayName(c)} · ${c.kind}`, c.name, from, doing, [took, used ? `${used} tokens` : ''].filter(Boolean).join(' · ')].filter(Boolean)
  return [`⧗ ${displayName(c)}`, c.activity || c.name, from, [STATE_WORD[state], took].filter(Boolean).join(' · ')].filter(Boolean)
}

// The desktop picture is centred, garden clipped evenly. A row's height against a column is unknown;
// code fonts run about 2.3 to 2.8, and the low end is taken so the house is never cut.
const ROW_RATIO = 2.3
// the high end, for the most garden a pane could show
const TALLEST_ROW = 2.8

// A picture is an image with its own clock, which stops while the window is hidden and restarts on reload.
// So each redraw draws every picture afresh, at least this often; no oftener, as each resends them all.
const REFRESH_MS = 2000
// the redraw's pace while nobody in the house walks
const QUIET_MS = 4000

// A sprite's reach round its spot: body, hat and name tag.
const REACH = { left: 8, right: 8, up: 15, down: 6 }
// In ms: a redraw's lag to the screen, which a zone outlasts, and how finely a walk is followed.
const LAG_MS = 400
const STEP_MS = 50

// Hover zones cover where each agent goes until the next redraw shows. Overlapping zones share a band,
// split halfway, so each is one keyed Box holding the card.
type Zone = { c: Resident; x0: number; x1: number; y0: number; y1: number }
type Band = { y0: number; y1: number; cells: { c: Resident; x0: number; x1: number }[] }

// zones over the desktop picture, in its units: a sprite's reach round each spot it takes
function houseBands(list: Resident[], tracks: Track[], now: number, grid: HouseGrid): Band[] {
  const zones: Zone[] = []
  const byId = new Map(list.map(c => [c.id, c]))
  for (const t of tracks) {
    const c = byId.get(t.id)
    if (!c) continue
    let span: Omit<Zone, 'c'> | undefined
    for (let ms = now; ms <= now + REFRESH_MS + LAG_MS; ms += STEP_MS) {
      const p = spotOf(t, ms)
      if (!p) continue
      span = span
        ? { x0: Math.min(span.x0, p.x), x1: Math.max(span.x1, p.x), y0: Math.min(span.y0, p.y), y1: Math.max(span.y1, p.y) }
        : { x0: p.x, x1: p.x, y0: p.y, y1: p.y }
    }
    if (!span) continue
    zones.push({
      c,
      x0: Math.max(0, span.x0 - REACH.left), x1: Math.min(grid.w, span.x1 + REACH.right),
      y0: Math.max(0, span.y0 - REACH.up), y1: Math.min(grid.h, span.y1 + REACH.down),
    })
  }
  return bandsOf(zones)
}

// zones over the terminal plan, in cells: each agent's Clawd and name at each cell it takes
function planBands(plan: Plan, walkers: Walker[], now: number): Band[] {
  const zones = walkers.flatMap(w => {
    let zone: Zone | undefined
    for (let ms = now; ms <= now + REFRESH_MS + LAG_MS; ms += STEP_MS) {
      const cell = cellAt(plan, w, ms)
      if (!cell) continue
      const [x0, y0, x1, y1] = reachOf(plan, w, cell)
      zone = zone
        ? { c: w.c, x0: Math.min(zone.x0, x0), y0: Math.min(zone.y0, y0), x1: Math.max(zone.x1, x1), y1: Math.max(zone.y1, y1) }
        : { c: w.c, x0, y0, x1, y1 }
    }
    return zone ? [zone] : []
  })
  return bandsOf(zones)
}

function bandsOf(zones: Zone[]): Band[] {
  const bands: { y0: number; y1: number; zones: Zone[] }[] = []
  for (const z of [...zones].sort((a, b) => a.y0 - b.y0)) {
    const last = bands[bands.length - 1]
    if (last && z.y0 < last.y1) {
      last.y1 = Math.max(last.y1, z.y1)
      last.zones.push(z)
    } else bands.push({ y0: z.y0, y1: z.y1, zones: [z] })
  }
  return bands.map(band => {
    const cells = [...band.zones].sort((p, q) => p.x0 + p.x1 - (q.x0 + q.x1)).map(z => ({ c: z.c, x0: z.x0, x1: z.x1 }))
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1] as { x0: number; x1: number }
      const c = cells[i] as { x0: number; x1: number }
      if (c.x0 < a.x1) {
        const mid = (Math.max(a.x0, c.x0) + Math.min(a.x1, c.x1)) / 2
        a.x1 = mid
        c.x0 = mid
      }
    }
    return { y0: band.y0, y1: band.y1, cells }
  })
}

// A card beside a zone on the roomier side, narrower when neither fits it.
function beside(left: number, span: number, columns: number): { isRight: boolean; width: number } {
  const toRight = columns - left - span - 1
  const toLeft = left - 1
  const isRight = toRight >= 30 || toRight >= toLeft
  return { isRight, width: Math.max(16, Math.min(30, isRight ? toRight : toLeft)) }
}

// Desktop zones in fractions of the picture, so they sit on the sprites at any row height.
function houseHoverLayer(ui: Pick<Elements['desktop'], 'Box' | 'Svg'>, bands: Band[], now: number, grid: HouseGrid, columns: number) {
  const { Box, Svg } = ui
  if (bands.length === 0) return null
  const heights = percents([0, ...bands.flatMap(b => [b.y0, b.y1])], grid.h)
  const rows = bands.flatMap((band, b) => {
    const widths = percents([0, ...band.cells.flatMap(c => [c.x0, c.x1])], grid.w)
    const isUpper = (band.y0 + band.y1) / 2 < grid.h / 2
    return [
      <Box height={heights[b * 2] ?? '0%'} />,
      <Box flexDirection="row" width="100%" height={heights[b * 2 + 1] ?? '0%'}>
        {band.cells.flatMap((cell, i) => {
          const lines = agentCard(cell.c, now)
          const left = Math.round((cell.x0 / grid.w) * columns)
          const span = Math.max(1, Math.round(((cell.x1 - cell.x0) / grid.w) * columns))
          const { isRight, width } = beside(left, span, columns)
          const units = Math.round((width * grid.w) / Math.max(1, columns))
          return [
            <Box width={widths[i * 2] ?? '0%'} height="100%" />,
            <Box key={`a-${cell.c.id}`} width={widths[i * 2 + 1] ?? '0%'} height="100%">
              <Box position="absolute" left={isRight ? span + 1 : -(width + 1)} {...(isUpper ? { top: 0 } : { bottom: 0 })} width={width} display="none" hover={{ display: 'flex' }}>
                <Svg source={cardSvg(lines, colorFor(cell.c), units)} alt={lines.join(' · ')} />
              </Box>
            </Box>,
          ]
        })}
      </Box>,
    ]
  })
  return <Box position="absolute" top={0} left={0} width="100%" height="100%" flexDirection="column">{rows}</Box>
}

// Terminal zones over the plan's cells, `inset` columns in.
function planHoverCells(ui: Pick<Elements['terminal'], 'Box' | 'Text'>, bands: Band[], now: number, inset: number, columns: number, rows: number) {
  const { Box } = ui
  let floor = 0
  return bands.flatMap(band => {
    // a band starts below the last, on whole cells
    const top = Math.max(floor, Math.floor(band.y0))
    const height = Math.max(1, Math.ceil(band.y1) - top)
    floor = top + height
    const isUpper = (band.y0 + band.y1) / 2 < rows / 2
    let edge = 0
    return band.cells.map(cell => {
      const left = Math.max(edge, inset + Math.floor(cell.x0))
      const span = Math.max(1, inset + Math.ceil(cell.x1) - left)
      edge = left + span
      const { isRight, width } = beside(left, span, columns)
      return (
        <Box key={`a-${cell.c.id}`} position="absolute" top={top} left={left} width={span} height={height}>
          <Box position="absolute" left={isRight ? span + 1 : -(width + 1)} {...(isUpper ? { top: 0 } : { bottom: 0 })} width={width} display="none" hover={{ display: 'flex' }}>
            {cardOf(ui, agentCard(cell.c, now), colorFor(cell.c), width)}
          </Box>
        </Box>
      )
    })
  })
}

// A terminal hover card: title in `color`, task bright, the rest dim, dark in either theme.
const CARD_PAPER = '#16181d'
const CARD_INK = '#e8e8f0'
const CARD_DIM = '#8c96a0'

function cardOf(ui: Pick<Elements['terminal'], 'Box' | 'Text'>, lines: string[], color: string, width: number): RenderElement {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={color} backgroundColor={CARD_PAPER} paddingX={1}>
      {lines.map((line, i) => <Text color={i === 0 ? color : i === 1 ? CARD_INK : CARD_DIM} bold={i === 0} backgroundColor={CARD_PAPER} wrap="wrap">{line}</Text>)}
    </Box>
  )
}

// With `afresh` (the person's own asks) an open pane is reopened, as on the desktop one reopened while
// open, or kept across a plugin reload, can stay blank.
async function openPane($: EngineInterface, afresh = false): Promise<void> {
  const panes = await $.ui.panes().catch(() => [])
  if (panes.some(pane => pane.id === PANE && pane.isPlaced)) {
    if (!afresh) return
    await $.ui.close({ id: PANE }).catch(() => undefined)
  }
  await $.ui.open({ id: PANE, title: 'Vibehaus' })
}

// ---------- /haus demo: a made-up household going about made-up work ----------

const DEMO_JOBS = [
  { name: 'Map the auth flow', kind: 'Explore' },
  { name: 'Fix the login redirect', kind: 'general-purpose' },
  { name: 'Plan the cache rework', kind: 'Plan' },
  { name: 'Write the missing tests', kind: 'general-purpose' },
  { name: 'Survey the API docs', kind: 'Explore' },
  { name: 'Tidy the build scripts', kind: 'general-purpose' },
]
const DEMO_STEPS = [
  { tool: 'Grep', what: 'refreshToken' },
  { tool: 'Read', what: 'auth.service.ts' },
  { tool: 'Edit', what: 'login.tsx' },
  { tool: 'Bash', what: 'npm test' },
  { tool: 'WebSearch', what: 'oauth pkce flow' },
  { tool: 'Write', what: 'cache.test.ts' },
  { tool: 'Glob', what: 'src/**/*.ts' },
  { tool: 'WebFetch', what: 'docs.example.com/api' },
]
const DEMO_LIFETIME = 5 * 60 * 1000

let demoTimer: { cancel: () => void } | undefined
let demoEnd: ReturnType<EngineInterface['clock']['after']> | undefined
let demoTick = 0
// the demo's shipping times, apart from real work's and gone with the demo
let demoBoxes: number[] = []

function demoMember(i: number, now: number, room: Room): Resident {
  const job = DEMO_JOBS[i % DEMO_JOBS.length] as (typeof DEMO_JOBS)[number]
  const step = DEMO_STEPS[(i * 3) % DEMO_STEPS.length] as (typeof DEMO_STEPS)[number]
  return {
    id: `demo-${i}`, name: job.name, kind: job.kind, room: roomFor(step.tool), movedAt: now,
    status: 'working', activity: `${step.tool}: ${step.what}`, tool: step.tool, spawnedAt: now, spawnRoom: room,
    taskType: 'subagent', taskStatus: 'running', isDemo: true, calls: [now],
  }
}

// Each tick a demo agent steps on; at times one finishes and a new one joins.
async function demoStep($: EngineInterface): Promise<void> {
  demoTick++
  const now = await $.clock.now()
  const list = await read($, residents)
  const working = list.filter(c => c.isDemo && isLive(c))
  if (demoTick % 5 === 0 && working.length > 0) {
    const leaving = working[demoTick % working.length] as Resident
    await finish($, leaving.id, demoTick % 15 === 0 ? 'Failed' : 'Done')
    if (!demoTimer) return
    const lead = list.find(c => c.id === MAIN)
    await join($, demoMember(100 + demoTick, now, lead?.room ?? 'study'))
    return
  }
  const who = working[demoTick % Math.max(1, working.length)]
  if (!who) return
  const step = DEMO_STEPS[(demoTick * 7) % DEMO_STEPS.length] as (typeof DEMO_STEPS)[number]
  await move($, who.id, c => ({
    status: 'working', room: roomFor(step.tool), tool: step.tool, activity: `${step.tool}: ${step.what}`,
    resultAt: now, isOk: demoTick % 9 !== 0, calls: [...(c.calls ?? []), now].slice(-MAX_CALLS),
  }))
}

async function startDemo($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const lead = (await read($, residents)).find(c => c.id === MAIN)
  const members = [0, 1, 2, 3].map(i => demoMember(i, now - i * 700, lead?.room ?? 'study'))
  const shell: Resident = {
    id: 'demo-shell', name: 'Background shell', kind: 'shell', room: 'kitchen', movedAt: now,
    status: 'working', activity: 'npm run dev', tool: 'Bash', isBackground: true, spawnedAt: now - 2000,
    spawnRoom: lead?.room ?? 'study', taskType: 'shell', taskStatus: 'running', isDemo: true,
  }
  const resting: Resident[] = [4, 5].map(i => ({
    ...demoMember(i, now - 60000, 'study'), status: 'done', activity: 'Done', taskStatus: 'done', doneAt: now - 30000 + i,
    idleSince: now - 30000 + i * 1000,
  }))
  await change($, base => settle([...base.filter(c => !c.isDemo), ...members, shell, ...resting]))
  demoTick = 0
  demoTimer?.cancel()
  demoTimer = $.clock.every(3500, () => void demoStep($).catch(() => undefined))
  cancelEnd()
  demoEnd = $.clock.after(DEMO_LIFETIME, () => void stopDemo($).catch(() => undefined))
}

function cancelEnd() {
  demoEnd?.cancel()
  demoEnd = undefined
}

async function stopDemo($: EngineInterface): Promise<void> {
  demoTimer?.cancel()
  demoTimer = undefined
  cancelEnd()
  demoBoxes = []
  await change($, base => base.filter(c => !c.isDemo))
}

// ---------- /haus snapshot: the house as an animated SVG file ----------

// This session's household only, as the file may be shared; in the pane's colours, so with other sessions
// open its members keep their rings. A fixed path the directory can read, in the folder Claude Code runs in.
async function snapshot($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const list = ordered(await read($, residents)).filter(c => !c.session)
  const source = svg(list, await yardBoxes($, now), now, metersOf(await read($, plan)))
  await $.fs.write('vibehaus-snapshot.svg', source)
}

// The band's ◧ Vibehaus button.
async function togglePane($: EngineInterface): Promise<void> {
  try {
    const isShowing = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced && pane.isShown)
    if (isShowing) await $.ui.close({ id: PANE })
    else await openPane($, true)
  } catch {
    // a surface that cannot list panes still gets the house opened
    await openPane($, true).catch(() => undefined)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await begin($)
    void openPane($).catch(() => undefined)
    ticker?.cancel()
    ticker = $.clock.every(MINUTE, () => void tickPlan($).catch(() => undefined))

    return next(e)
  }).catch((_, e, next) => next(e))

  // a session ending moves its household out of every house and takes the demo along
  on('session.end', async ($, e, next) => {
    await stopSharing($)
    await update($, residents, list => list.filter(c => !c.isDemo)).catch(() => undefined)
    demoTimer?.cancel()
    demoTimer = undefined
    cancelEnd()
    demoBoxes = []

    return next(e)
  }).catch((_, e, next) => next(e))

  on('command.run', { command: 'haus' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'demo') {
      if (demoTimer) {
        await stopDemo($)
        return { text: 'The demo household moved out.' }
      }
      await startDemo($)
      await openPane($, true)
      return { text: 'A demo household moved in for five minutes. Run /haus demo again to send them home.' }
    }
    if (arg === 'snapshot') {
      await snapshot($)
      return { text: 'Saved the house to vibehaus-snapshot.svg in the folder Claude Code runs in. It is an animated SVG, so open it in a browser.' }
    }
    if (arg) return { text: 'Usage: /haus, /haus demo or /haus snapshot.' }
    await openPane($, true)

    return { text: 'Vibehaus opened.' }
  })

  // The band above the prompt: plan use ("vibe fatigue") and the house toggle, giving way to a survey.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    // drawn again each minute, so the reset times count down
    await read($, minute)
    const now = await $.clock.now()
    const meters = metersOf(current(await read($, plan), now))
    const { bar, words } = bandOf(meters, e.props.bodyColumns, now)

    // monospaced, as the meters' cells were counted in it
    return (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2}>
        <Box flexDirection="row" alignItems="center" columnGap={2} flexShrink={1}>
          {meters.map((m, i) => {
            const filled = m.percent === undefined ? 0 : Math.round((Math.max(0, Math.min(100, m.percent)) / 100) * bar)
            const color = m.percent === undefined ? undefined : meterColor(m)
            return (
              <Text mono>
                <Text dimColor>{`${m.label} `}</Text>
                <Text color={color}>{'━'.repeat(filled)}</Text>
                <Text color="#3a3f47">{'━'.repeat(bar - filled)}</Text>
                <Text dimColor> {percentText(m)}{words[i] ? ` · ${words[i]}` : ''}</Text>
              </Text>
            )
          })}
        </Box>
        <Button key="vibehaus-toggle" label={TOGGLE} plain dimColor onPress={() => void togglePane($)} />
      </Box>
    )
  }).catch((_, e, next) => next(e))

  // After a turn, or a plan window moving a point: new readings go to the band and the store.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      const now = await $.clock.now()
      void takeReading($, readingOf(e.rateLimits, now), now).catch(() => undefined)
    }

    return next(e)
  }).catch((_, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    void recordUsage($, e.agentId ?? MAIN, tokensOf(response.usage)).catch(() => undefined)

    return response
  }).catch(async function* (_, e, next) { return yield* next(e) })

  on('turn.start', async ($, e, next) => {
    // a subagent or teammate is at work already, unless a teammate woken by a message
    if (e.agentId) {
      await move($, e.agentId, c => (c.isTeammate && c.status === 'idle' ? { status: 'working', activity: 'Thinking' } : {})).catch(() => undefined)
      return next(e)
    }
    await move($, MAIN, { status: 'working', room: 'study', activity: 'Thinking', tool: undefined, waitingTool: undefined })

    return next(e)
  }).catch((_, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    // only the model's own calls are household work, not a plugin's
    if (next.origin.plugin !== 'engine' && !e.agentId) return next(e)
    const id = e.agentId ?? MAIN
    const tool = String(e.tool)
    const activity = activityOf(tool, e)
    let stranger: Resident | undefined
    if (e.agentId && !(await read($, residents)).some(c => c.id === e.agentId)) {
      // an agent never seen starting joins only if listed, so engine forks (compaction, memory) stay out
      const info = (await $.agent.list().catch(() => [])).find(a => a.id === e.agentId)
      if (!info) return next(e)
      const now = await $.clock.now()
      stranger = {
        id, name: oneLine(info.description || info.type), kind: info.type, room: roomForKind(info.type),
        movedAt: now, status: 'working', activity: '', taskType: 'subagent', workSince: now,
        ...(info.teammateId ? { isTeammate: true } : {}),
      }
    }
    // awaited before the call goes on: a permission prompt's amber tag needs the member at work
    const startedAt = await $.clock.now()
    await move($, id, c => ({
      status: 'working', room: roomFor(tool), activity, tool,
      calls: [...(c.calls ?? []), startedAt].slice(-MAX_CALLS),
    }), stranger)

    // After the call, or a prompt it never got past: nobody stays waiting, and the room's machine flashes.
    const settleCall = async (isOk: boolean) => {
      const now = await $.clock.now()
      const context = id === MAIN ? await contextNow($) : undefined
      await move($, id, c => ({
        status: c.status === 'waiting' ? 'working' : c.status,
        resultAt: now, isOk, waitingTool: undefined,
        ...(context !== undefined ? { context } : {}),
      }))
    }
    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } catch (err) {
      await settleCall(false).catch(() => undefined)
      throw err
    }
    const outcome = ran as { isError?: boolean; deny?: string }
    const isOk = !outcome.isError && !outcome.deny
    await settleCall(isOk)

    if (isOk && (tool === 'TaskStop' || tool === 'KillShell')) {
      const args = e as Record<string, unknown>
      const res = (typeof ran.result === 'object' && ran.result !== null ? ran.result : {}) as Record<string, unknown>
      const stopped = str(res.task_id) ?? str(args.task_id) ?? str(args.shell_id)
      if (stopped) await finish($, stopped, 'Stopped')
    } else if (isOk) {
      const taskId = backgroundId(tool, ran.result)
      if (taskId) {
        const now = await $.clock.now()
        const lead = (await read($, residents)).find(c => c.id === id)
        await join($, {
          id: taskId,
          name: `Background ${backgroundKind(tool)}`,
          kind: backgroundKind(tool),
          room: roomFor(tool),
          movedAt: now,
          status: 'working',
          activity: detail(e) || tool,
          tool,
          isBackground: true,
          spawnedAt: now,
          spawnRoom: lead?.room ?? 'study',
          taskType: backgroundKind(tool),
          taskStatus: 'running',
        })
      }
    }

    return ran
  }).catch((_, e, next) => next(e))

  // The sidebar title names the session's household.
  on('classic.SessionStart', async ($, e, next) => {
    void retitle($, e.session_title).catch(() => undefined)
    // a /clear or a resume goes on in this process, with no session.start
    if (e.source === 'clear' || e.source === 'resume') void begin($).catch(() => undefined)
    return next(e)
  }).catch((_, e, next) => next(e))

  on('classic.UserPromptSubmit', async ($, e, next) => {
    void retitle($, e.session_title).catch(() => undefined)
    return next(e)
  }).catch((_, e, next) => next(e))

  // Each turn ends with the engine's background list; syncing to it leaves nothing missed or stuck.
  on('classic.Stop', async ($, e, next) => {
    const asOf = await $.clock.now()
    const answer = await next(e)
    await reconcile($, e.background_tasks, asOf).catch(() => undefined)

    return answer
  }).catch((_, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    const asOf = await $.clock.now()
    const answer = await next(e)
    await reconcile($, e.background_tasks, asOf).catch(() => undefined)

    return answer
  }).catch((_, e, next) => next(e))

  // A permission prompt: the asker turns to you under an amber tag until the call goes on or is refused.
  on('classic.Notification', async ($, e, next) => {
    if (e.notification_type === 'permission_prompt') await askFor($, e.agent_id, e.message).catch(() => undefined)

    return next(e)
  }).catch((_, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.agentId) {
      const now = await $.clock.now()
      const list = await read($, residents)
      const lead = list.find(c => c.id === (e.parentAgentId ?? MAIN))
      // its first tool call may have come first and put it at work already
      const had = list.find(c => c.id === spawned.agentId)
      const who = {
        name: oneLine(e.description || e.subagentType),
        kind: e.subagentType,
        spawnedAt: now,
        spawnRoom: lead?.room ?? 'study',
        taskType: 'subagent',
        taskStatus: 'running',
        ...(e.background ? { isBackground: true } : {}),
        ...(e.workflow ? { isWorkflow: true } : {}),
        ...(e.isTeammate || spawned.teammateId ? { isTeammate: true } : {}),
      }
      await join($, had ? { ...had, ...who } : {
        id: spawned.agentId, room: roomForKind(e.subagentType), movedAt: now, status: 'working', activity: 'Starting up', ...who,
      }).catch(() => undefined)
    }

    return spawned
  }).catch((_, e, next) => next(e))

  // A background task's end arrives as a <task-notification> in a user row.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    const message = e.message as { role?: string; content?: unknown }
    if (message.role !== 'user') return stored
    const blocks = Array.isArray(message.content) ? message.content : [message.content]
    const text = blocks
      .map(b => (typeof b === 'string' ? b : typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text' ? String((b as { text?: unknown }).text ?? '') : ''))
      .join('\n')
    const isNotice = e.origin.kind === 'task-notification' || text.trimStart().startsWith('<task-notification>')
    if (isNotice) {
      for (const m of text.matchAll(/<task-id>([^<]+)<\/task-id>[\s\S]*?<status>([^<]+)<\/status>/g)) {
        const [, taskId, status] = m
        if (!taskId || !status) continue
        await finish($, taskId.trim(), ended(status.trim()))
        // taken as completed already: the notice says how it ended
        await restate($, taskId.trim(), ended(status.trim()))
      }
    }

    return stored
  }).catch((_, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const reason = e.reason
    if (e.agentId) {
      const member = (await read($, residents)).find(c => c.id === e.agentId)
      if (member?.isTeammate) {
        // a teammate goes idle between messages; it has not finished
        await move($, e.agentId, { status: 'idle', activity: 'Waiting for a message' })
      } else {
        const word = e.isAborted ? 'Stopped' : reason === 'answer' ? 'Done' : 'Failed'
        await finish($, e.agentId, word)
      }
    } else {
      const context = await contextNow($)
      await move($, MAIN, {
        status: 'idle', activity: 'Waiting for you', tool: undefined, waitingTool: undefined,
        ...(context !== undefined ? { context } : {}),
      })
    }

    return done
  }).catch((_, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const everyone = ordered(await read($, residents))
    const now = await $.clock.now()
    const boxes = await yardBoxes($, now)
    // redraw sooner while anyone walks so hover zones keep up, less often when all stand still
    const redrawFor = (tracks: Track[]) => {
      const isStill = tracks.every(t => {
        const [a, b] = [spotOf(t, now), spotOf(t, now + QUIET_MS)]
        const moved = (p?: { x: number; y: number }, q?: { x: number; y: number }) => (p && q ? Math.hypot(p.x - q.x, p.y - q.y) > 0.5 : p !== q)
        return !moved(a, b) && Array.from({ length: 8 }, (_k, i) => spotOf(t, now + ((i + 1) * QUIET_MS) / 9)).every(p => !moved(a, p))
      })
      redrawSoon($, isStill ? QUIET_MS : REFRESH_MS)
    }

    if (e.surface === 'terminal') {
      const { Box, Text, Raster } = $.ui.resolve(e)
      const sized = (n: number, or: number) => (Number.isFinite(n) ? Math.max(16, n) : or)
      const cols = sized(e.props.bodyColumns, 80)
      // the most rows the pane may take: docked, all of it; inline above the prompt, a modest plan
      const bodyRows = Math.min(sized(e.props.scroll.bodyRows, 40), e.props.placement === 'inline' ? INLINE_ROWS : Infinity)
      const tracks = houseTracks(everyone, now)
      redrawFor(tracks)
      const size = planSize(cols, bodyRows)
      const plan = planOf(size, boxes.length, everyone)
      // narrower than the narrowest plan: say so, rather than spill over
      if (plan.columns > cols) return <Text dimColor wrap="wrap">Vibehaus needs a pane {plan.columns} columns wide.</Text>
      const byId = new Map(everyone.map(c => [c.id, c]))
      const walkers = tracks.flatMap(t => {
        const c = byId.get(t.id)
        return c ? [{ c, t }] : []
      })
      played = { plan, walkers }
      const cells = planCells(plan, walkers, now)
      shownCells = cells
      playHouse($)
      const inset = Math.max(0, Math.floor((cols - plan.columns) / 2))
      // the plan centred, garden in the rows it leaves above and below
      const spare = Math.max(0, bodyRows - plan.rows)
      const above = Math.min(RASTER_ROWS, Math.floor(spare / 2))
      const below = Math.min(RASTER_ROWS, spare - Math.floor(spare / 2))
      const band = (key: string, rows: number, side: 'above' | 'below') => (
        <Box marginLeft={inset}>
          <Raster key={key} columns={plan.columns} rows={rows} cells={gardenRaster(plan.columns, rows, side)} />
        </Box>
      )
      return (
        <Box flexDirection="column" width={cols} height={plan.rows + above + below}>
          {above > 0 && band('vh-garden-above', above, 'above')}
          <Box flexDirection="row" height={plan.rows}>
            <Box marginLeft={inset}>
              <Raster key={RASTER} columns={plan.columns} rows={plan.rows} cells={packCells(cells)} />
            </Box>
            {planHoverCells({ Box, Text }, planBands(plan, walkers, now), now, inset, cols, plan.rows)}
          </Box>
          {below > 0 && band('vh-garden-below', below, 'below')}
        </Box>
      )
    }

    // alt text: who, the task, what each does or how it ended; a visitor walking off is not counted
    const list = everyone.filter(c => c.leaving === undefined)
    const meters = metersOf(await read($, plan))
    const working = list.filter(c => c.status === 'working').length
    const used = meters.map(m => `${m.label.toLowerCase()} ${m.percent === undefined ? 'unknown' : `${Math.round(m.percent)}%`}`).join(', ')
    const doing = (c: Resident) => {
      const isAgent = c.kind !== 'main' && taskTypeOf(c) === 'subagent'
      const ended = c.status === 'done' && !isAgent && c.kind !== 'main' ? ` (${c.taskStatus ?? 'done'})` : ''
      return `${displayName(c)}: ${isAgent ? `${c.name} · ` : ''}${c.activity}${ended}`
    }
    const alt = clip(`Vibehaus: ${working} of ${list.length} working. Plan use: ${used}. ${list.map(doing).join('; ')}`, 2000)

    if (e.surface === 'desktop') {
      const { Box, Svg } = $.ui.resolve(e)
      const { layers, tracks } = housePicture(everyone, boxes, now)
      redrawFor(tracks)
      const grid = houseGrid(true)
      // a pane just opened may not be measured yet
      const sized = (n: number, or: number) => (Number.isFinite(n) && n >= 1 ? n : or)
      const cols = sized(e.props.bodyColumns, 80)
      const bodyRows = sized(e.props.scroll.bodyRows, 40)
      // Centred, narrowed to a whole percentage (all a Box takes) when the pane is too short for the house.
      // The body's height must come from the tree: no percentage or overlaid picture gives it one.
      const room = (grid.w * (bodyRows - 0.1) * ROW_RATIO) / cols
      const width = Math.max(1, Math.min(100, Math.floor((room / houseGrid().h) * 100)))
      return (
        <Box flexDirection="column" height={bodyRows - 0.1} overflow="hidden" justifyContent="center" alignItems="center">
          <Box position="relative" flexDirection="column" flexShrink={0} width={`${width}%`}>
            <Svg source={gardenPicture(now, (grid.w * bodyRows * TALLEST_ROW) / cols)} alt="The garden round the house" />
            {layers.map((layer, i) => (
              <Box key={`layer-${i}`} position="absolute" top={0} left={0} width="100%" height="100%">
                <Svg source={layer} alt={i === 0 ? alt : 'The agents in the house'} />
              </Box>
            ))}
            {houseHoverLayer({ Box, Svg }, houseBands(everyone, tracks, now, grid), now, grid, Math.max(1, (cols * width) / 100))}
          </Box>
        </Box>
      )
    }

    // elsewhere, one picture with as many agents as fit and the plan bars, there being no band
    const { Svg } = $.ui.resolve(e)
    const one = onePicture(everyone, boxes, now, meters, SVG_LIMIT)
    redrawFor(one.tracks)
    return <Svg source={one.source} alt={alt} />
  })
}
