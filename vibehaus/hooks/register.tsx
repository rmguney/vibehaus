import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderElement } from 'claude-code'

import type { Resident, ResidentStatus, Household, PlanUse, Room, TaskRow, TaskStats, Track } from '../types'
import { hostCells, hostSvg, linesOf, pagesOf, SPIN_MS, spinCells, spinSvg } from './lines'
import type { Acts, Live, Marks } from './lines'
import { cardSvg, listItems, tasksPanel } from './panel'
import { cellAt, packCells, planCells, planOf, planSize, reachOf } from './plan'
import type { Plan, Walker } from './plan'
import type { HouseGrid, Meter } from './scene'
import { arrive, clip, colorFor, displayName, errandEnds, houseGrid, housePicture, paintSessions, reanchor, spotOf, svg, taskTypeOf } from './scene'

const PANE = 'vibehaus'
const MAIN = 'main'
const KEEP_DONE = 4
const MAX_TEXT = 160
const MAX_CALLS = 8

const residents = atom({ plugin: 'vibehaus', key: 'residents' } as const, [])
const plan = atom({ plugin: 'vibehaus', key: 'plan' } as const, {})
// how far down the terminal's tasks list is scrolled, in rows
const listScroll = atom({ plugin: 'vibehaus', key: 'scroll' } as const, 0)
// which page of the desktop's tasks list shows
const listPage = atom({ plugin: 'vibehaus', key: 'page' } as const, 0)
// the sessions whose sections of the list a click turned from how they
// start: this one folded, another opened
const toggledSessions = atom({ plugin: 'vibehaus', key: 'toggled' } as const, [])

// The terminal's list as last drawn, for its scrollbar and the wheel: how
// far it scrolls, how many of its rows show, how many it has.
let listView: { maxTop: number; shown: number; total: number } | undefined

// In the terminal the list scrolls in the rows under the house, by the
// wheel, NOTCH rows a tick, or the scroll keys, a scrollbar beside it
// showing where it stands.
const SCROLLBAR = 'vh-scrollbar'
const NOTCH = 3

// On the desktop the pane is the surface's own scroll box, and everything in
// it scrolls together, the house too. So the pane's tree is never taller than
// the pane: the house and its bars stay put, and the list under them shows a
// page at a time, turned by buttons. How many of its lines fit under the house
// turns on how tall a pane row is against a column, which says how many rows
// the house picture takes, and which the pane does not say: code fonts run
// from about 2.3 (a tall face, tight lines) to 2.8 (a narrow one, loose lines)
// times. A page fills to the high end, the pane's edge cutting what does not
// fit, and the next page starts where the low end would have cut it. The
// buttons take a row or two.
const ROW_RATIOS = { low: 2.3, high: 2.8 }
const CONTROL_ROWS = { low: 2, high: 1 }

// The next redraw, `ms` on: the pictures catch up, and the hover zones move
// on with the sprites.
let nextDraw: { cancel: () => void } | undefined

function redrawSoon($: EngineInterface, ms: number): void {
  nextDraw?.cancel()
  nextDraw = undefined
  try {
    nextDraw = $.clock.after(ms, () => {
      try {
        $.ui.invalidate('ui.render')
      } catch {
        // the pane, or this load of the plugin, is gone
      }
    })
  } catch {
    // no timer: the next change redraws instead
  }
}

// The house in the terminal, its floor plan played by the plugin a frame at
// a time into a Raster (see plan.ts): the plan and its walkers as last
// drawn, and the timer painting its frames while it is shown.
const RASTER = 'vh-house'
const FRAME_MS = 200
let played: { plan: Plan; walkers: Walker[] } | undefined
let frames: { cancel: () => void } | undefined
let isPainting = false

function playHouse($: EngineInterface): void {
  if (frames) return
  try {
    frames = $.clock.every(FRAME_MS, () => void paintFrame($))
  } catch {
    // no timer: the house moves on with each redraw instead
  }
}

async function paintFrame($: EngineInterface): Promise<void> {
  const house = played
  if (!house || isPainting) return
  isPainting = true
  try {
    const now = await $.clock.now()
    const done = await $.ui.blit({ requestId: PANE, key: RASTER, cells: packCells(planCells(house.plan, house.walkers, now)) })
    // not shown, or resized: the next redraw starts it again
    if (done.deny) stopHouse()
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
}

// The list's moving parts in the terminal (the Host's line, a running
// task's spinner), each a Raster repainted at the spinner's pace while shown.
let liveParts: Live[] = []
let liveFrames: { cancel: () => void } | undefined
let isLivePainting = false

function playLive($: EngineInterface, parts: Live[]): void {
  liveParts = parts
  if (parts.length === 0) return stopLive()
  if (liveFrames) return
  try {
    liveFrames = $.clock.every(SPIN_MS, () => void paintLive($))
  } catch {
    // no timer: they move on with each redraw instead
  }
}

async function paintLive($: EngineInterface): Promise<void> {
  if (isLivePainting) return
  isLivePainting = true
  try {
    const now = await $.clock.now()
    let shown = 0
    for (const part of liveParts) {
      const done = await $.ui.blit({ requestId: PANE, key: part.key, cells: packCells(part.paint(now)) }).catch(() => ({ deny: 'gone' }))
      if (!done.deny) shown++
    }
    // not shown, or drawn without them: the next redraw starts it again
    if (shown === 0) stopLive()
  } finally {
    isLivePainting = false
  }
}

function stopLive(): void {
  liveFrames?.cancel()
  liveFrames = undefined
  liveParts = []
}

// A running task's stop button: Claude Code's own TaskStop, called as the
// model would call it and through the same permission check; once it went,
// the task ends here as stopped. A demo task only ends.
async function stopTask($: EngineInterface, id: string): Promise<void> {
  const c = (await read($, residents)).find(m => m.id === id)
  if (!c || c.session || !isLive(c)) return
  if (!c.isDemo) {
    const done = await $.tool.call({ tool: 'TaskStop', task_id: id })
    if (done.deny !== undefined || done.isError) {
      $.ui.toast(`Could not stop ${displayName(c)}: ${done.deny ?? done.text ?? 'TaskStop failed'}`)
      return
    }
  }
  await finish($, id, 'Stopped')
}

// Who a permission prompt is for: the agent it names, else the one at work
// with the tool it names ("Claude needs your permission to use Bash") that
// reached for it last, else the lead.
async function askFor($: EngineInterface, agentId: string | undefined, message: string): Promise<void> {
  const tool = /permission to use ([^\s.,!]+)/i.exec(message)?.[1]
  const lastCall = (c: Resident) => c.calls?.[c.calls.length - 1] ?? 0
  const asking = agentId ?? (await read($, residents))
    .filter(c => !c.session && c.status === 'working' && (tool === undefined || c.tool === tool))
    .sort((a, b) => lastCall(b) - lastCall(a))[0]?.id ?? MAIN
  await move($, asking, c => (c.status === 'working' ? { status: 'waiting', waitingTool: tool ?? c.tool } : {}))
}

async function foldSession($: EngineInterface, id: string): Promise<void> {
  await update($, toggledSessions, ids => (ids.includes(id) ? ids.filter(k => k !== id) : [...ids, id]))
}

const LEAD: Resident = {
  id: MAIN, name: 'Lead', kind: 'main', room: 'study',
  movedAt: 0, status: 'idle', activity: 'Waiting for you',
}

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

// One line, short enough for a label: a heredoc must not end up in the
// state, a picture's alt text or the task list.
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

// Which field of a tool's result names the task it left in the background.
// Only these tools start background work; the todo tools' `taskId` is a todo.
const BACKGROUND_FIELD: Record<string, string> = {
  Bash: 'backgroundTaskId', PowerShell: 'backgroundTaskId', Monitor: 'taskId', Workflow: 'taskId',
}

function backgroundId(tool: string, result: unknown): string | undefined {
  const field = BACKGROUND_FIELD[tool]
  if (!field || typeof result !== 'object' || result === null) return undefined
  return str((result as Record<string, unknown>)[field])
}

function backgroundKind(tool: string): string {
  return tool === 'Bash' || tool === 'PowerShell' ? 'shell' : tool.toLowerCase()
}

const isLive = (c: Resident) => c.status === 'working' || c.status === 'waiting'

// Finished members dropped from the list: the engine's background list may
// still name one briefly, and it must not come back as a phantom.
const forgotten = new Set<string>()

// Keeps the last few finished members, dropping the oldest first; nobody is
// dropped while still carrying its box out. The demo household keeps its own few,
// so it never pushes real work off the list.
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

// Desks stick: a member keeps its desk while it works in that room, and a
// newcomer takes the lowest free one, so nobody slides over when others leave.
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

// Every change to the household goes through here, so anyone whose plan changes is
// first pinned to where the house shows it now, and walks on from there.
// A write that changes nothing is skipped, so it redraws nothing either.
async function change($: EngineInterface, fn: (list: Resident[]) => Resident[]): Promise<void> {
  void startSharing($).catch(() => undefined)
  const now = await $.clock.now()
  const apply = (list: Resident[]) => {
    const base = ordered(list.length === 0 ? [LEAD] : list)
    const seated = ordered(assignSeats(base, fn(base)))
    return reanchor(base, seated, now)
  }
  const before = await read($, residents)
  if (JSON.stringify(apply(before)) === JSON.stringify(before)) return
  await update($, residents, apply)
  void publish($).catch(() => undefined)
}

type Patch = Partial<Resident> | ((c: Resident) => Partial<Resident>)

async function move($: EngineInterface, id: string, patch: Patch, fallback?: Resident): Promise<void> {
  // nothing to write for someone who is not in the house (the lead always is)
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

// How a task ended, from the engine's word for it.
function endOf(word: string): 'done' | 'failed' | 'stopped' {
  const w = word.toLowerCase()
  if (/kill|stop|cancel|abort/.test(w)) return 'stopped'
  if (/fail|error/.test(w)) return 'failed'
  return 'done'
}

// Store writes that read first go one at a time, so two hooks of this
// session never both count from the same old value.
let storeQueue: Promise<unknown> = Promise.resolve()

function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = storeQueue.then(job, job)
  storeQueue = run.catch(() => undefined)
  return run
}

// The day's shipping. Each session keeps when it shipped each box under a
// key of its own, so sessions side by side never write over one another; the
// yard stacks everyone's boxes in the order they went, so each box keeps its
// place and its tape whoever ships next.
type Shipment = { at: number; session: string }
let shippedToday: { day: string; boxes: Shipment[] } = { day: '', boxes: [] }

function dayOf(now: number): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// A session's day as written: when each of its boxes went, or, written
// before the times were kept, how many.

async function readShipped($: EngineInterface, now: number): Promise<void> {
  const day = dayOf(now)
  const prefix = `shipped:${day}:`
  const own = self?.id ?? 'local'
  const all: { at: number; id: string }[] = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith(prefix)) continue
    const id = key.slice(prefix.length)
    for (const at of numbers(await $.store.get(key))) all.push({ at, id })
  }
  // in the same order in every house; this session's own named ''
  all.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  shippedToday = { day, boxes: all.map(b => ({ at: b.at, session: b.id === own ? '' : b.id })) }
}

async function shippedOn($: EngineInterface, now: number): Promise<Shipment[]> {
  if (shippedToday.day !== dayOf(now)) await readShipped($, now).catch(() => undefined)
  return shippedToday.day === dayOf(now) ? shippedToday.boxes : []
}

// One more box on this session's own key; a key that cannot be read is left
// as it is rather than started over.
async function countShipped($: EngineInterface, now: number): Promise<void> {
  const key = `shipped:${dayOf(now)}:${self?.id ?? 'local'}`
  const sofar = await $.store.get(key)
  await $.store.set(key, [...numbers(sofar), now])
  await readShipped($, now)
}

// The yard's boxes in the order they went, each by who shipped it: the
// day's from every session, the demo's among them.
async function yardBoxes($: EngineInterface, now: number): Promise<string[]> {
  const boxes = [...await shippedOn($, now), ...demoBoxes.map(at => ({ at, session: '' }))]
  return boxes.sort((a, b) => a.at - b.at).map(b => b.session)
}

// A finished agent or task carries a box out to the pallets by the mailbox
// (see `deliver`), and real work counts towards the day's total.
async function finish($: EngineInterface, id: string, activity: string): Promise<void> {
  const now = await $.clock.now()
  // the next free place on the pallets, with every session's latest counted
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
      // a shell or monitor keeps what it ran as its name; the end goes to its status
      const keepsCommand = c.id !== MAIN && taskTypeOf(c) !== 'subagent'
      return { ...c, status: 'done', ...(keepsCommand ? {} : { activity }), taskStatus: activity.toLowerCase(), doneAt: now, idleSince: now, carrying: true, box }
    }))
  })
  if (!isShipped) return
  if (isDemo) demoBoxes.push(now)
  else await serial(() => countShipped($, now)).catch(() => undefined)
  await sendOut($, id)
}

// Timers for boxes on their way, one per courier.
const errands = new Map<string, { cancel: () => void }>()

// Sees a courier back in from the pallets when its errand ends: sets out
// again after a reload, and lands at once one that ended meanwhile.
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

// Back from the pallets, the box stacked: it goes about its day from here.
async function deliver($: EngineInterface, id: string): Promise<void> {
  const now = await $.clock.now()
  await change($, list => settle(list.map(c => (c.id === id && c.carrying ? { ...without(without(c, 'carrying'), 'box'), idleSince: now } : c))))
}

// The lead first, then whoever is working, then the idle, then the finished.
function ordered(list: Resident[]): Resident[] {
  const rank = (c: Resident) => (c.id === MAIN ? 0 : isLive(c) ? 1 : c.status === 'idle' ? 2 : 3)
  return list.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map(x => x.c)
}

const GROUP: Record<string, TaskRow['group']> = { subagent: 'Agents', shell: 'Shells', monitor: 'Monitors', workflow: 'Workflows' }

// How a task ended, from the engine's word when it gave one.
function endState(c: Resident): TaskRow['state'] {
  return endOf(c.taskStatus ?? c.activity)
}

const STATE_WORD: Record<TaskRow['state'], string> = {
  running: 'running', waiting: 'awaiting approval', pending: 'pending', idle: 'waiting for you',
  done: 'completed', failed: 'failed', stopped: 'stopped',
}

// "claude-haiku-4-5-20251001" reads as "Haiku 4.5", as the app names it
function shortModel(model: string): string {
  const name = model.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-(\d+)$/, ' $1')
  return name.charAt(0).toUpperCase() + name.slice(1)
}

// ---------- token usage, kept as time and token pairs ----------

const HOUR = 60 * 60 * 1000
const WEEK = 7 * 24 * HOUR
const MAX_USAGE = 400

function tokensSince(usage: number[] | undefined, since: number): number {
  let sum = 0
  for (let i = 0; i + 1 < (usage?.length ?? 0); i += 2) if ((usage?.[i] ?? 0) >= since) sum += usage?.[i + 1] ?? 0
  return sum
}

// Adds a turn's tokens, forgets anything older than a week, and folds the
// oldest entries together once there are many.
function addUsage(usage: number[] | undefined, now: number, tokens: number): number[] {
  const kept: number[] = []
  for (let i = 0; i + 1 < (usage?.length ?? 0); i += 2) {
    if ((usage?.[i] ?? 0) >= now - WEEK) kept.push(usage?.[i] ?? 0, usage?.[i + 1] ?? 0)
  }
  kept.push(now, tokens)
  // past the cap, the two oldest entries merge under the older time, so old
  // tokens age out of the hour and the week when they should
  while (kept.length > MAX_USAGE) {
    kept[1] = (kept[1] ?? 0) + (kept[3] ?? 0)
    kept.splice(2, 2)
  }
  return kept
}

function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1e6) return `${Math.round(n / 1000)}k`
  return `${(n / 1e6).toFixed(1)}M`
}

// Tokens over the week, the one figure the list shows: the lead's spans
// sessions, anyone else's is its one run.
function usageText(c: Resident, now: number): string | undefined {
  const week = tokensSince(c.usage, now - WEEK)
  return week === 0 ? undefined : compact(week)
}

// What a request cost: fresh input, input written to the cache, and output.
// Input read back from the cache is left out, being nearly free.
function tokensOf(u: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number } | null | undefined): number {
  return u ? u.input_tokens + u.cache_creation_input_tokens + u.output_tokens : 0
}

// The lead's usage is kept across sessions, so its week is a real week: each
// session writes its own key and the figure is their sum, so sessions side by
// side never write over one another.
const LEAD_USAGE = 'usage:lead'
let ownKey: string | undefined

async function leadKey($: EngineInterface): Promise<string> {
  if (ownKey) return ownKey
  const started = await $.session.usage({}).then(u => u.startedAt).catch(() => 0)
  ownKey = `${LEAD_USAGE}:${started || await $.clock.now()}`
  return ownKey
}

const numbers = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [])

// Undefined when the store cannot be read, so the session's own figures stand.
async function leadUsage($: EngineInterface): Promise<number[] | undefined> {
  try {
    const keys = (await $.store.keys()).filter(k => k.startsWith(LEAD_USAGE))
    const all: number[] = []
    for (const key of keys) all.push(...numbers(await $.store.get(key)))
    return all
  } catch {
    return undefined
  }
}

// Old days' counts and week-old usage keys go, so the store never grows.
async function pruneStore($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const today = dayOf(now)
  for (const key of await $.store.keys()) {
    if (key.startsWith('shipped:') && !key.startsWith(`shipped:${today}`)) await $.store.delete(key)
    if (key.startsWith(LEAD_USAGE)) {
      const v = numbers(await $.store.get(key))
      const newest = v.filter((_, i) => i % 2 === 0).reduce((a, b) => Math.max(a, b), 0)
      if (newest < now - WEEK) await $.store.delete(key)
    }
  }
}

// Adds one request's tokens to whoever made it. Only the usage changes, so
// nobody's plan does and the household skips the reanchoring `change` does.
async function recordUsage($: EngineInterface, id: string, tokens: number): Promise<void> {
  if (tokens <= 0) return
  const now = await $.clock.now()
  if (id === MAIN) {
    const usage = await serial(async () => {
      const key = await leadKey($)
      const kept = (await read($, residents)).find(c => c.id === MAIN)?.usage
      const stored = await $.store.get(key).then(numbers, () => undefined)
      if (stored === undefined) return addUsage(kept, now, tokens)
      const mine = addUsage(stored, now, tokens)
      const saved = await $.store.set(key, mine).then(() => true, () => false)
      return saved ? await leadUsage($) ?? mine : addUsage(kept, now, tokens)
    })
    await update($, residents, list => (list.length === 0 ? [LEAD] : list).map(c => (c.id === MAIN ? { ...c, usage } : c)))
    return
  }
  // nobody to add to: an engine fork's step, say
  if (!(await read($, residents)).some(c => c.id === id)) return
  await update($, residents, list => list.map(c => (c.id === id ? { ...c, usage: addUsage(c.usage, now, tokens) } : c)))
}

// ---------- the plan's windows, for the exp bars in the house's corner ----------

// The five-hour and weekly windows as Claude Code itself last read them,
// off its latest response: nothing leaves the machine for them. A window it
// has not read keeps its last reading, and an unchanged one redraws nothing.
async function refreshPlan($: EngineInterface): Promise<void> {
  const { rateLimits } = await $.session.usage({})
  const five = rateLimits.find(r => r.kind === 'five_hour')?.percentUsed
  const week = rateLimits.find(r => r.kind === 'seven_day')?.percentUsed
  const was = await read($, plan)
  const now = { ...was, ...(five !== undefined ? { fiveHour: five } : {}), ...(week !== undefined ? { week } : {}) }
  if (now.fiveHour !== was.fiveHour || now.week !== was.week) await update($, plan, () => now)
}

function metersOf(p: PlanUse): Meter[] {
  return [
    { label: '5H', color: '#52d2f5', ...(p.fiveHour !== undefined ? { percent: p.fiveHour } : {}) },
    { label: 'WEEK', color: '#4cf08c', ...(p.week !== undefined ? { percent: p.week } : {}) },
  ]
}

// Where a member stands, as the tasks list words it.
function stateOf(c: Resident): TaskRow['state'] {
  if (c.kind === 'main') return c.status === 'waiting' ? 'waiting' : c.status === 'working' ? 'running' : 'idle'
  if (c.status === 'waiting') return 'waiting'
  if (isLive(c)) return c.taskStatus === 'pending' ? 'pending' : 'running'
  return endState(c)
}

// The tasks list: the lead first, then every subagent, shell, monitor
// and workflow, grouped by kind, running ones first.
function taskRows(list: Resident[], now: number): TaskRow[] {
  const rows: TaskRow[] = []
  for (const c of list) {
    if (c.kind === 'main') {
      const state = stateOf(c)
      // what it is doing, as the chat's working line says it
      const lead: TaskRow = {
        id: c.id, group: 'Lead', state,
        title: state === 'running' ? c.activity || 'Working' : state === 'waiting' ? `Awaiting approval${c.waitingTool ? ` for ${c.waitingTool}` : ''}` : 'Waiting for you',
        detail: [displayName(c), c.context !== undefined ? `context ${Math.round(c.context)}%` : ''].filter(Boolean).join(' · '),
      }
      if (state !== 'idle' && c.workSince) lead.startedAt = c.workSince
      const used = usageText(c, now)
      if (used) lead.usage = used
      if (c.session) lead.session = c.session
      rows.push(lead)
      continue
    }
    const type = taskTypeOf(c)
    const running = isLive(c)
    const state = stateOf(c)
    const isAgent = type === 'subagent'
    const doing = running && c.activity && c.activity !== c.name && c.activity !== 'Starting up' ? c.activity : ''
    const tools = c.tools ? `${c.tools} tool${c.tools === 1 ? '' : 's'}${c.errors ? `, ${c.errors} failed` : ''}` : ''
    const parts = isAgent
      ? [displayName(c), c.model ? shortModel(c.model) : '', c.status === 'waiting' && c.waitingTool ? `wants ${c.waitingTool}` : STATE_WORD[state], tools, doing]
      : [displayName(c), STATE_WORD[state]]
    // plain data only: no field left undefined
    const row: TaskRow = {
      id: c.id,
      group: GROUP[type] ?? 'Other',
      title: isAgent ? c.name : c.activity || c.name,
      detail: parts.filter(Boolean).join(' · '),
      state,
    }
    const startedAt = c.spawnedAt ?? c.workSince
    if (startedAt !== undefined && startedAt > 0) row.startedAt = startedAt
    if (!running && c.doneAt !== undefined) row.endedAt = c.doneAt
    const used = usageText(c, now)
    if (used) row.usage = used
    if (c.session) row.session = c.session
    rows.push(row)
  }
  const rank = (r: TaskRow) => (r.state === 'done' || r.state === 'failed' || r.state === 'stopped' ? 1 : 0)
  return rows.sort((a, b) => rank(a) - rank(b))
}

function ended(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

// One entry of the engine's in-flight background work (the Stop hooks'
// `background_tasks`); long texts end in a "... [+N chars]" marker.
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
   
    // when it started is unknown: no start time rather than a wrong one
    movedAt: 0,
    status: 'working',
    activity: oneLine(t.command?.replace(CLIPPED, '…') || description || t.name || t.type),
    isBackground: true,
    taskType: t.type,
    taskStatus: t.status,
  }
}

// Brings the household in line with the engine's list of background work, taken
// at `asOf`: tasks it runs that the household lacks join, and running tasks it no
// longer has end. Anything that started after the list was taken is left be.
// Subagents are checked against the engine's agent list instead, since a
// foreground one is not background work; workflow agents and teammates are
// listed by neither, so they are left be too.
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
      if (t) return c.status === 'done' ? c : { ...c, taskType: t.type, taskStatus: t.status }
      const seen = c.spawnedAt ?? c.workSince
      const isOld = seen === undefined || seen < asOf
      // a teammate, working or idle, ends when the engine no longer lists it
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
      // background work gone from the list: its own notice of how it ended
      // may still be on its way, so it ends as completed only after a moment
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

// How long background work gone from the engine's list waits for its notice.
const ENDING_GRACE = 5000

async function endQuietly($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const due = (await read($, residents)).filter(c => !c.session && c.status !== 'done' && c.endingSince !== undefined && now - c.endingSince >= ENDING_GRACE)
  for (const c of due) await finish($, c.id, 'Completed')
}

// The lead's context window use, in percent, when the engine knows it.
async function contextNow($: EngineInterface): Promise<number | undefined> {
  try {
    const usage = await $.session.usage({})
    return usage.context.percent
  } catch {
    return undefined
  }
}

// ---------- other sessions in the same house ----------

// Every session running Vibehaus writes its own household to the shared store
// under a key of its own, and reads the others': their agents come in from
// the street and live here like this session's own. A session that stops
// writing moves out, back down the road, and so does one with nobody at
// work in it that nobody has messaged and nothing has worked in for five
// hours, until it is busy again.
const PEER = 'session:'
const SYNC_EVERY = 3000
const BEAT_EVERY = 10000
const GONE_AFTER = 35000
const FORGET_AFTER = 60 * 60 * 1000
const ACTIVE_FOR = 5 * 60 * 60 * 1000
// seconds between visitors setting off up the road together
const ARRIVE_GAP = 1.5

type Snapshot = { at: number; since: number; activeAt: number; name: string; residents: Resident[] }

// When a session was last busy: its last message, tool call, agent or task
// starting or ending, as its own members remember it.
const activeAtOf = (mine: Resident[]) => Math.max(0, ...mine.flatMap(c => [c.workSince, c.spawnedAt, c.resultAt, c.doneAt, c.idleSince, ...(c.calls ?? [])].filter((t): t is number => typeof t === 'number')))
type Peer = { id: string; name: string; since: number }

// This session as the others know it, its name as every house shows it, and
// the others as last read.
let self: { id: string; name: string; since: number } | undefined
let selfName = ''
let peers: Peer[] = []
let lastSync = 0
let shared = { at: 0, text: '' }
let publishing: { cancel: () => void } | undefined
let sharing: Promise<void> | undefined
let beats: { cancel: () => void }[] = []

const peerName = (id: string) => peers.find(p => p.id === id)?.name ?? 'another session'

async function whoAmI($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const id = await $.session.id().catch(() => 'local')
  const root = await $.session.root().catch(() => '')
  const since = await $.session.usage({}).then(u => u.startedAt).catch(() => 0)
  // the name it went by before a reload: its title, once it had one
  const was = await $.store.get(PEER + id).catch(() => undefined) as Partial<Snapshot> | undefined
  const name = typeof was?.name === 'string' && was.name ? was.name : root.split(/[\\/]/).filter(Boolean).pop() ?? 'session'
  self = { id, name, since: since || now }
  selfName = self.name
}

// A session goes by its title as the app shows it, once the engine names it
// (at the session's start and with each prompt); by its folder till then.
async function retitle($: EngineInterface, title: string | undefined): Promise<void> {
  const name = title ? oneLine(title).slice(0, 40) : ''
  if (!name) return
  await startSharing($)
  const me = self
  if (!me || me.name === name) return
  me.name = name
  selfName = name
  await publish($)
}

// What the others see of a member: nothing that is only this house's.
const outward = (c: Resident) => without(without(without(without(c, 'anchor'), 'seat'), 'usage'), 'endingSince')

// Writes this session's own members for the others, at most every two
// seconds, and again every few seconds as a sign of life.
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
  const body = { since: me.since, activeAt: activeAtOf(mine), name: me.name, residents: mine }
  const text = JSON.stringify(body)
  if ((!beat && text === shared.text) || self !== me) return
  shared = { at: now, text }
  await $.store.set(PEER + me.id, { ...body, at: now } satisfies Snapshot)
}

const ROOMS = new Set<string>(['study', 'library', 'workshop', 'kitchen', 'sunroom', 'lounge'])
const STATUSES = new Set<string>(['working', 'waiting', 'idle', 'done'])

// Another session's member as it wrote it, checked field by field: a field
// of the wrong shape is left out, and a member without its essentials too.
function memberOf(raw: unknown): Resident | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const m = raw as Record<string, unknown>
  const text = (k: string) => (typeof m[k] === 'string' ? oneLine(m[k] as string) : undefined)
  const num = (k: string) => (typeof m[k] === 'number' && Number.isFinite(m[k]) ? m[k] as number : undefined)
  const { id, kind, name, room, status } = { id: text('id'), kind: text('kind'), name: text('name'), room: text('room'), status: text('status') }
  if (!id || !kind || name === undefined || !room || !ROOMS.has(room) || !status || !STATUSES.has(status)) return undefined
  const out: Resident = { id, kind, name, room: room as Room, status: status as ResidentStatus, movedAt: num('movedAt') ?? 0, activity: text('activity') ?? '' }
  for (const k of ['tool', 'taskType', 'taskStatus', 'waitingTool', 'model'] as const) {
    const v = text(k)
    if (v !== undefined) out[k] = v
  }
  for (const k of ['resultAt', 'spawnedAt', 'doneAt', 'idleSince', 'workSince', 'tools', 'errors', 'context', 'box'] as const) {
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

// Names as every house shows them: each session's own, and for two of one
// name, the later ones numbered.
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

async function readPeers($: EngineInterface, own: string, now: number): Promise<(Peer & { residents: Resident[] })[]> {
  const found: (Peer & { residents: Resident[] })[] = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith(PEER) || key === PEER + own) continue
    const v = await $.store.get(key) as Partial<Snapshot> | undefined
    const at = typeof v?.at === 'number' ? v.at : 0
    if (now - at > FORGET_AFTER) {
      await $.store.delete(key).catch(() => undefined)
      continue
    }
    if (!v || now - at > GONE_AFTER || !Array.isArray(v.residents)) continue
    const members = v.residents.flatMap(m => memberOf(m) ?? [])
    const isBusy = members.some(m => m.status === 'working' || m.status === 'waiting')
    if (!isBusy && now - (typeof v.activeAt === 'number' ? v.activeAt : 0) > ACTIVE_FOR) continue
    found.push({
      id: key.slice(PEER.length), name: oneLine(String(v.name || 'session')).slice(0, 40),
      since: Number(v.since) || 0, residents: members,
    })
  }
  return found.sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1))
}

// Reads the other sessions and moves their members in; a session gone quiet
// moves out, and so does everyone else once the store has been out of reach
// that long.
async function syncPeers($: EngineInterface): Promise<void> {
  const me = self
  if (!me) return
  const now = await $.clock.now()
  let found: (Peer & { residents: Resident[] })[]
  try {
    found = await readPeers($, me.id, now)
  } catch {
    if (now - lastSync > GONE_AFTER) {
      peers = []
      await change($, list => visit(list, [], now))
    }
    return
  }
  lastSync = now
  await readShipped($, now).catch(() => undefined)
  const names = nameAll([me, ...found])
  selfName = names.get(me.id) ?? me.name
  peers = found.map(f => ({ id: f.id, name: names.get(f.id) ?? f.name, since: f.since }))
  await change($, list => visit(list, found, now))
}

// The others' members as they are now, each keeping the spot and desk it has
// here. A newcomer walks in from the street, the next a moment behind; one on
// its way in keeps coming until it is in; one its session let go walks back
// out to the street and is gone at the end of the road.
function visit(list: Resident[], found: { id: string; residents: Resident[] }[], now: number): Resident[] {
  const here = new Map(list.filter(c => c.session).map(c => [c.id, c]))
  const ends = errandEnds(list, now)
  const isThere = (c: Resident) => (ends.get(c.id) ?? 0) <= now
  const seen = new Set<string>()
  let queue = 0
  const theirs = found.flatMap(f => f.residents.map((m): Resident => {
    const id = `${f.id}/${m.id}`
    seen.add(id)
    const had = here.get(id)
    const member: Resident = { ...m, id, session: f.id }
    if (!had) return arrive(member, now, ARRIVE_GAP * queue++)
    return {
      ...member,
      ...(had.anchor ? { anchor: had.anchor } : {}),
      ...(had.seat !== undefined ? { seat: had.seat } : {}),
      ...(had.arriving !== undefined && !isThere(had) ? { arriving: had.arriving } : {}),
    }
  }))
  const gone = [...here.values()]
    .filter(c => !seen.has(c.id) && !(c.leaving !== undefined && isThere(c)))
    .map(c => (c.leaving !== undefined ? c : { ...c, leaving: now }))
  return [...list.filter(c => !c.session), ...theirs, ...gone]
}

// Starts sharing once: at the session's start, or at the first change to the
// household when the start came before the world could answer.
function startSharing($: EngineInterface): Promise<void> {
  sharing ??= (async () => {
    await whoAmI($)
    beats = [
      $.clock.every(SYNC_EVERY, () => void syncPeers($).catch(() => undefined)),
      $.clock.every(BEAT_EVERY, () => void publish($, true).catch(() => undefined)),
    ]
    await publish($, true).catch(() => undefined)
    await syncPeers($).catch(() => undefined)
  })()
  return sharing
}

// A session ending stops sharing and takes its key with it; after /clear the
// next change starts again under the new session's id.
async function stopSharing($: EngineInterface): Promise<void> {
  for (const beat of beats) beat.cancel()
  beats = []
  publishing?.cancel()
  publishing = undefined
  sharing = undefined
  const me = self
  self = undefined
  shared = { at: 0, text: '' }
  if (me) await $.store.delete(PEER + me.id).catch(() => undefined)
}

// The sessions in the house, this one first, each with its colour; empty
// while it is alone.
function households(): Household[] {
  if (!self || peers.length === 0) return []
  const me = self
  const all = [{ id: '', since: me.since, key: me.id }, ...peers.map(p => ({ id: p.id, since: p.since, key: p.id }))]
    .sort((a, b) => a.since - b.since || (a.key < b.key ? -1 : 1))
  const colors = paintSessions(all.map(s => s.id), me.id)
  return [{ id: '', name: selfName || me.name, color: colors.get('') ?? '#ffd166' }, ...peers.map(p => ({ id: p.id, name: p.name, color: colors.get(p.id) ?? '#ffd166' }))]
}

// ---------- hover cards ----------

// Sizes as whole percentages (all a Box takes), rounded at the running
// edges rather than piece by piece, so the pieces add up and stay in line.
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

// The card for an agent in the house: who, the task, what it is doing now,
// and for how long at what cost.
function agentCard(c: Resident, now: number): string[] {
  const type = taskTypeOf(c)
  const state = stateOf(c)
  const live = state === 'running' || state === 'waiting' || state === 'pending'
  const started = c.spawnedAt ?? c.workSince
  const took = started && started > 0 ? live ? ago(now - started) : c.doneAt !== undefined ? ago(c.doneAt - started) : '' : ''
  const doing = state === 'waiting' ? `awaiting approval${c.waitingTool ? ` for ${c.waitingTool}` : ''}` : live ? c.activity : STATE_WORD[state]
  const used = usageText(c, now)
  const from = c.session ? `from "${peerName(c.session)}"` : ''
  if (c.kind === 'main') {
    return ['Host', from, state === 'idle' ? 'waiting for you' : doing, [c.context !== undefined ? `context ${Math.round(c.context)}%` : '', live ? took : ''].filter(Boolean).join(' · ')].filter(Boolean)
  }
  if (type === 'subagent') return [`${displayName(c)} · ${c.kind}`, c.name, from, doing, [took, used ? `${used} tokens` : ''].filter(Boolean).join(' · ')].filter(Boolean)
  return [`⧗ ${displayName(c)}`, c.activity || c.name, from, [STATE_WORD[state], took].filter(Boolean).join(' · ')].filter(Boolean)
}

// The surface shows each picture as an image, and an image's clock can fall
// behind the house's: it stops while the window is hidden, and starts over
// whenever the surface loads the picture again. So every redraw draws both
// pictures afresh, on time, and the pane is redrawn at least this often, so
// a picture left behind catches up within a second.
const REFRESH_MS = 1000
// the redraw's pace while nobody in the house walks
const QUIET_MS = 4000

// The desktop's last drawing, what it was drawn from and when.
let lastDesk: { sig: string; at: number; tree: RenderElement } | undefined

// A sprite's reach around the spot it stands on: its body, hat and name tag.
const REACH = { left: 8, right: 8, up: 15, down: 6 }
// How long a redraw takes to reach the screen, so a zone holds past it; and
// how finely a walk is followed. In ms.
const LAG_MS = 400
const STEP_MS = 50

// Where each agent in sight can be hovered: over wherever it goes until the
// next redraw is on screen, the spot it stands on or the stretch it walks.
// Zones that overlap top to bottom share a band; within a band each gets one
// cell, split halfway where two overlap side by side. So no two overlap, and
// each is one keyed Box with the agent's card inside it, shown while the
// pointer is over it.
type Zone = { c: Resident; x0: number; x1: number; y0: number; y1: number }
type Band = { y0: number; y1: number; cells: { c: Resident; x0: number; x1: number }[] }

// the zones over the desktop's picture, in its units, a sprite's reach round
// each spot it takes
function houseBands(list: Resident[], tracks: Track[], now: number, grid: HouseGrid): Band[] {
  const zones: Zone[] = []
  for (const t of tracks) {
    const c = list.find(m => m.id === t.id)
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

// the zones over the terminal's plan, in its cells: each agent's Clawd and
// name at each cell it takes
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

// A card beside a zone `left` columns in and `span` wide, on whichever side
// has more room, narrower when neither has room for the whole card.
function beside(left: number, span: number, columns: number): { isRight: boolean; width: number } {
  const toRight = columns - left - span - 1
  const toLeft = left - 1
  const isRight = toRight >= 30 || toRight >= toLeft
  return { isRight, width: Math.max(16, Math.min(30, isRight ? toRight : toLeft)) }
}

// The zones on the desktop, laid out in fractions of the picture, so they
// sit on the sprites however tall the pane's rows come out.
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
                <Svg source={cardSvg(lines, colorFor(cell.c), units, 2)} alt={lines.join(' · ')} />
              </Box>
            </Box>,
          ]
        })}
      </Box>,
    ]
  })
  return <Box position="absolute" top={0} left={0} width="100%" height="100%" flexDirection="column">{rows}</Box>
}

// The zones in the terminal, over the plan's cells, the plan `inset`
// columns in a pane `columns` wide and `rows` of it tall.
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

// A hover card over the terminal's house: the title in `color`, the task,
// the rest dim, in colours of its own, dark in either theme.
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

// The terminal list's scrollbar, `rows` tall: a track down its right edge
// and a thumb for the part of the list showing, in the theme's own greys.
function scrollbar(ui: Pick<Elements['terminal'], 'Box' | 'Text'>, view: NonNullable<typeof listView>, top: number, rows: number): RenderElement {
  const { Box, Text } = ui
  const scrolls = rows > 1 && view.total > view.shown
  const len = scrolls ? Math.max(1, Math.min(rows - 1, Math.round((rows * view.shown) / view.total))) : 0
  const at = scrolls ? Math.round(((rows - len) * top) / Math.max(1, view.maxTop)) : 0
  return (
    <Box key={SCROLLBAR} flexDirection="column" width={1} height={rows}>
      {Array.from({ length: rows }, (_, y) => {
        const isThumb = scrolls && y >= at && y < at + len
        return <Text color={isThumb ? 'inactive' : 'subtle'}>{scrolls ? (isThumb ? '┃' : '│') : ' '}</Text>
      })}
    </Box>
  )
}

async function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: 'Vibehaus' })
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
// when the demo shipped each of its boxes, kept apart from real work's and
// gone with it
let demoBoxes: number[] = []

function demoMember(i: number, now: number, room: Room): Resident {
  const job = DEMO_JOBS[i % DEMO_JOBS.length] as (typeof DEMO_JOBS)[number]
  const step = DEMO_STEPS[(i * 3) % DEMO_STEPS.length] as (typeof DEMO_STEPS)[number]
  return {
    id: `demo-${i}`, name: job.name, kind: job.kind, room: roomFor(step.tool), movedAt: now,
    status: 'working', activity: `${step.tool}: ${step.what}`, tool: step.tool, spawnedAt: now, spawnRoom: room,
    taskType: 'subagent', taskStatus: 'running', isDemo: true, tools: 1, model: 'claude-haiku-4-5', calls: [now],
  }
}

// Every few seconds one demo agent moves on to its next step; now and then
// one finishes and ships its box, and a new one is handed a job.
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
    resultAt: now, isOk: demoTick % 9 !== 0, tools: (c.tools ?? 0) + 1, calls: [...(c.calls ?? []), now].slice(-MAX_CALLS),
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

// Into the session's folder, over the last one.
async function snapshot($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const list = ordered(await read($, residents))
  const source = svg(list, await yardBoxes($, now), now, metersOf(await read($, plan)))
  await $.fs.write('vibehaus-snapshot.svg', source)
}

// The footer button: opens the house, or closes it when it is showing.
async function togglePane($: EngineInterface): Promise<void> {
  try {
    const isShowing = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced && pane.isShown)
    if (isShowing) await $.ui.close({ id: PANE })
    else await openPane($)
  } catch {
    // a surface that cannot list panes still gets the house opened
    await openPane($).catch(() => undefined)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'haus',
      description: 'Show Vibehaus · "demo" fills it with a demo household · "snapshot" saves it as an SVG',
      argumentHint: '[demo | snapshot]',
      immediate: true,
    })
    const usage = await leadUsage($)
    await change($, list => list.filter(c => !c.isDemo).map(c => (c.id === MAIN && usage ? { ...c, usage } : c)))
    for (const c of await read($, residents)) if (c.carrying && !c.session) await sendOut($, c.id)
    void endQuietly($).catch(() => undefined)
    $.clock.after(ENDING_GRACE, () => void endQuietly($).catch(() => undefined))
    void startSharing($).catch(() => undefined)
    void openPane($).catch(() => undefined)
    void refreshPlan($).catch(() => undefined)
    void pruneStore($).catch(() => undefined)

    return next(e)
  })

  // a session ending moves its household out of every other house
  on('session.end', async ($, e, next) => {
    await stopSharing($)

    return next(e)
  })

  on('command.run', { command: 'haus' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'demo') {
      if (demoTimer) {
        await stopDemo($)
        return { text: 'The demo household moved out.' }
      }
      await startDemo($)
      await openPane($)
      return { text: 'A demo household moved in for five minutes. Run /haus demo again to send them home.' }
    }
    if (arg === 'snapshot') {
      await snapshot($)
      return { text: 'Saved the house to vibehaus-snapshot.svg in this session\'s folder. It is an animated SVG, so open it in a browser.' }
    }
    if (arg) return { text: 'Usage: /haus, /haus demo or /haus snapshot.' }
    await openPane($)

    return { text: 'Vibehaus opened.' }
  })

  // The ◧ Vibehaus button at the right of the prompt footer, beside the mode
  // labels.
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')}</Text>}
        <Button key="vibehaus-toggle" label="◧ Vibehaus" plain dimColor onPress={() => void togglePane($)} />
      </Box>
    )
  })

  // In the terminal the pane is never taller than its room, so the wheel and
  // the scroll keys move the list under the house, which stays put: a wheel
  // tick NOTCH rows, an arrow a row, a page key the list's window, Home and
  // End to its ends.
  on('ui.scroll', async ($, e, next) => {
    const view = listView
    if (e.component !== 'Pane' || e.requestId !== PANE || !view) return next(e)
    const by = e.pointer ? e.by * NOTCH
      : Math.abs(e.by) >= e.contentRows ? Math.sign(e.by) * Infinity
        : Math.abs(e.by) >= e.bodyRows ? Math.sign(e.by) * Math.max(1, view.shown - 1)
          : e.by
    const top = Math.max(0, Math.min(view.maxTop, (await read($, listScroll)) + by))
    await update($, listScroll, () => top)
    return {}
  })

  // Every model request, the lead's and each subagent's, adds its tokens to
  // that member's hourly and weekly usage.
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    void recordUsage($, e.agentId ?? MAIN, tokensOf(response.usage)).catch(() => undefined)

    return response
  })

  on('turn.start', async ($, e, next) => {
    await move($, MAIN, { status: 'working', room: 'study', activity: 'Thinking', tool: undefined, waitingTool: undefined })

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // only the model's own calls are household work, not a plugin's
    if (next.origin.plugin !== 'engine' && !e.agentId) return next(e)
    const id = e.agentId ?? MAIN
    const tool = String(e.tool)
    const activity = activityOf(tool, e)
    let stranger: Resident | undefined
    if (e.agentId && !(await read($, residents)).some(c => c.id === e.agentId)) {
      // an agent we never saw start: household only if the engine lists it, so its
      // own forks (compaction, memory) never show up as phantom agents
      const info = (await $.agent.list().catch(() => [])).find(a => a.id === e.agentId)
      if (!info) return next(e)
      const now = await $.clock.now()
      stranger = {
        id, name: oneLine(info.description || info.type), kind: info.type, room: roomForKind(info.type),
        movedAt: now, status: 'working', activity: '', taskType: 'subagent', workSince: now,
        ...(info.teammateId ? { isTeammate: true } : {}),
      }
    }
    const startedAt = await $.clock.now()
    await move($, id, c => ({
      status: 'working', room: roomFor(tool), activity, tool,
      tools: (c.tools ?? 0) + 1,
      calls: [...(c.calls ?? []), startedAt].slice(-MAX_CALLS),
    }), stranger)

    // Back from the call, or from a prompt it never got past: nobody is left
    // waiting, a member finished meanwhile stays finished, and the room's
    // machine flashes with the result.
    const settleCall = async (isOk: boolean) => {
      const now = await $.clock.now()
      const context = id === MAIN ? await contextNow($) : undefined
      await move($, id, c => ({
        status: c.status === 'waiting' ? 'working' : c.status,
        resultAt: now, isOk, waitingTool: undefined,
        errors: (c.errors ?? 0) + (isOk ? 0 : 1),
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
  })

  // The session's title, as the sidebar shows it, names its household.
  on('classic.SessionStart', async ($, e, next) => {
    void retitle($, e.session_title).catch(() => undefined)
    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    void retitle($, e.session_title).catch(() => undefined)
    return next(e)
  })

  // At the end of every turn the engine hands over its own list of background
  // work in flight: the list is synced to it, so nothing is missed or stuck.
  on('classic.Stop', async ($, e, next) => {
    const asOf = await $.clock.now()
    const answer = await next(e)
    await reconcile($, e.background_tasks, asOf).catch(() => undefined)

    return answer
  })

  on('classic.SubagentStop', async ($, e, next) => {
    const asOf = await $.clock.now()
    const answer = await next(e)
    await reconcile($, e.background_tasks, asOf).catch(() => undefined)

    return answer
  })

  // A permission prompt, as Claude Code announces it: the agent asking turns
  // to you under an amber tag until the call goes on or is refused.
  on('classic.Notification', async ($, e, next) => {
    if (e.notification_type === 'permission_prompt') await askFor($, e.agent_id, e.message).catch(() => undefined)

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.agentId) {
      const now = await $.clock.now()
      const lead = (await read($, residents)).find(c => c.id === (e.parentAgentId ?? MAIN))
      await join($, {
        id: spawned.agentId,
        name: oneLine(e.description || e.subagentType),
        kind: e.subagentType,
        room: roomForKind(e.subagentType),
       
        movedAt: now,
        status: 'working',
        activity: 'Starting up',
        spawnedAt: now,
        spawnRoom: lead?.room ?? 'study',
        taskType: 'subagent',
        taskStatus: 'running',
        tools: 0,
        ...(spawned.model ? { model: spawned.model } : {}),
        ...(e.background ? { isBackground: true } : {}),
        ...(e.workflow ? { isWorkflow: true } : {}),
        ...(e.isTeammate || spawned.teammateId ? { isTeammate: true } : {}),
      }).catch(() => undefined)
    }

    return spawned
  })

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
        if (taskId && status) await finish($, taskId.trim(), ended(status.trim()))
      }
    }

    return stored
  })

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
      void refreshPlan($).catch(() => undefined)
    }

    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const everyone = ordered(await read($, residents))
    // a visitor on its way out is drawn walking off, but no longer listed
    const list = everyone.filter(c => c.leaving === undefined)
    const now = await $.clock.now()
    // The desktop puts each drawing up whole, in place of the last: a press
    // whose button is drawn anew between going down and coming up is lost.
    // The first click on the pane gives it the focus, and so a redraw: one
    // asked for nothing but that gets the last drawing back, unchanged.
    const desk = e.surface === 'desktop'
      ? JSON.stringify([e.props.bodyColumns, e.props.scroll, e.props.placement, everyone, await read($, toggledSessions), await read($, listPage), await read($, plan)])
      : ''
    if (lastDesk && lastDesk.sig === desk && now - lastDesk.at < REFRESH_MS) return lastDesk.tree
    const homes = households()
    if (homes.length === 0) paintSessions([], '')
    const working = list.filter(c => c.status === 'working').length
    const meters = metersOf(await read($, plan))
    const boxes = await yardBoxes($, now)
    const { layers, tracks: drawnTracks } = housePicture(everyone, boxes, now, meters)
    const [source = '', ...overlays] = layers
    const used = meters.map(m => `${m.label.toLowerCase()} ${m.percent === undefined ? 'unknown' : `${Math.round(m.percent)}%`}`).join(', ')
    const alt = clip(`Vibehaus: ${working} of ${list.length} working. Plan use: ${used}. ${list.map(c => `${displayName(c)}: ${c.activity}`).join('; ')}`, 2000)
    const rows = taskRows(list, now)
    const stats: TaskStats = {
      shippedToday: (await shippedOn($, now)).length,
      toolsPerMinute: list.reduce((n, c) => n + (c.calls ?? []).filter(t => now - t < 60000).length, 0),
    }
    const toggled = await read($, toggledSessions)
    const items = listItems(rows, stats, homes, toggled, selfName)
    const acts: Acts = { fold: id => void foldSession($, id), stop: r => void stopTask($, r.id).catch(() => undefined) }
    const grid = houseGrid()
    // a second on while anyone walks, so the hover zones keep up; more
    // seldom while all stand still, so fewer presses meet a redraw
    const isStill = drawnTracks.every(t => {
      const [a, b] = [spotOf(t, now), spotOf(t, now + QUIET_MS)]
      const moved = (p?: { x: number; y: number }, q?: { x: number; y: number }) => (p && q ? Math.hypot(p.x - q.x, p.y - q.y) > 0.5 : p !== q)
      return !moved(a, b) && Array.from({ length: 8 }, (_, i) => spotOf(t, now + ((i + 1) * QUIET_MS) / 9)).every(p => !moved(a, p))
    })
    redrawSoon($, isStill ? QUIET_MS : REFRESH_MS)

    if (e.surface === 'terminal') {
      const { Box, Text, Button, Raster } = $.ui.resolve(e)
      const ui = { Box, Text, Button }
      const cols = Math.max(16, e.props.bodyColumns)
      const bodyRows = Math.max(16, e.props.scroll.bodyRows)
      // The house's floor plan as wide as the pane, its agents walking it a
      // frame at a time; the list in the rest, scrolled by the wheel, the
      // scroll keys or its scrollbar.
      const size = planSize(cols, bodyRows)
      const plan = planOf(size.columns, size.across, size.down, meters, boxes.length, everyone)
      const walkers = drawnTracks.flatMap(t => {
        const c = everyone.find(m => m.id === t.id)
        return c ? [{ c, t }] : []
      })
      played = { plan, walkers }
      playHouse($)
      const inset = Math.max(0, Math.floor((cols - plan.columns) / 2))
      const listRows = Math.max(0, bodyRows - plan.rows)
      // what moves on the list, repainted by the plugin a frame at a time;
      // the list one column short of the pane, for its scrollbar
      const width = cols - 1
      const marks: Marks = {
        host: (r, at) => {
          const key = `vh-host-${r.id}`
          return { el: <Raster key={key} columns={width} rows={1} cells={packCells(hostCells(r, at, width))} />, live: { key, paint: t => hostCells(r, t, width) } }
        },
        spin: (r, at) => {
          const key = `vh-spin-${r.id}`
          return { el: <Raster key={key} columns={1} rows={1} cells={packCells(spinCells(at))} />, live: { key, paint: spinCells } }
        },
      }
      const lines = linesOf(ui, items, now, marks, acts)
      const maxTop = Math.max(0, lines.length - listRows)
      const top = Math.min(maxTop, Math.max(0, Math.round(await read($, listScroll))))
      listView = { maxTop, shown: listRows, total: lines.length }
      const shown = lines.slice(top, top + listRows)
      playLive($, shown.flatMap(l => (l.live ? [l.live] : [])))
      return (
        <Box flexDirection="column" width={cols} height={plan.rows + listRows}>
          <Box flexDirection="row" flexShrink={0} height={plan.rows}>
            <Box marginLeft={inset}>
              <Raster key={RASTER} columns={plan.columns} rows={plan.rows} cells={packCells(planCells(plan, walkers, now))} />
            </Box>
            {planHoverCells(ui, planBands(plan, walkers, now), now, inset, cols, plan.rows)}
          </Box>
          <Box flexDirection="row" flexShrink={0} height={listRows}>
            <Box flexDirection="column" flexGrow={1}>{shown.map(l => l.el)}</Box>
            {scrollbar(ui, listView, top, listRows)}
          </Box>
        </Box>
      )
    }

    if (e.surface === 'desktop') {
      const { Box, Svg, Text, Button } = $.ui.resolve(e)
      const ui = { Box, Svg, Text, Button }
      const cols = Math.max(1, e.props.bodyColumns)
      const bodyRows = e.props.scroll.bodyRows
      // The house and its bars at the top, the list under them a page at a
      // time, and the buttons turning the pages at the bottom: the whole a
      // hair short of the pane, so the pane itself never scrolls.
      const room = (end: 'low' | 'high') => Math.max(4, Math.floor(bodyRows - 0.1 - CONTROL_ROWS[end] - (cols * grid.h) / (grid.w * ROW_RATIOS[end])))
      // what moves on the list: pictures that play by themselves
      const marks: Marks = {
        host: (r, at) => ({ el: <Svg source={hostSvg(r, at, cols)} alt={`${r.title} · running`} /> }),
        spin: (_, at) => ({ el: <Svg source={spinSvg(at)} alt="running" /> }),
      }
      const lines = linesOf(ui, items, now, marks, acts)
      const pages = pagesOf(lines, room('high'), room('low'))
      const index = Math.max(0, Math.min(pages.length - 1, await read($, listPage)))
      const turn = (by: number) => () => void update($, listPage, p => Math.max(0, Math.min(pages.length - 1, Math.min(p, pages.length - 1) + by)))
      // the buttons turning the page, when there is more than one
      const controls = pages.length > 1 && (
        <Box flexDirection="row" justifyContent="center" columnGap={2} alignItems="center" flexShrink={0}>
          <Button key="vh-page-back" plain label="◂" onPress={turn(-1)} />
          <Text dimColor>{index + 1}/{pages.length}</Text>
          <Button key="vh-page-on" plain label="▸" onPress={turn(1)} />
        </Box>
      )
      const tree = (
        <Box flexDirection="column" height={bodyRows - 0.1} overflow="hidden">
          <Box position="relative" flexDirection="column" flexShrink={0}>
            <Svg source={source} alt={alt} />
            {overlays.map((layer, i) => (
              <Box key={`agents-${i}`} position="absolute" top={0} left={0} width="100%" height="100%">
                <Svg source={layer} alt="The agents in the house" />
              </Box>
            ))}
            {houseHoverLayer(ui, houseBands(everyone, drawnTracks, now, grid), now, grid, cols)}
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">{(pages[index] ?? []).map(l => l.el)}</Box>
          {controls}
        </Box>
      )
      lastDesk = { sig: desk, at: now, tree }
      return tree
    }

    // elsewhere, the pictures as one, the agents left off one too big
    const { Box, Svg } = $.ui.resolve(e)
    const panel = tasksPanel(rows, stats, now, grid.w, homes, toggled, selfName)
    const whole = svg(everyone, boxes, now, meters)
    return (
      <Box flexDirection="column">
        <Svg source={whole.length <= 131072 ? whole : source} alt={alt} />
        <Svg source={panel.source} alt={panel.alt} />
      </Box>
    )
  })
}
