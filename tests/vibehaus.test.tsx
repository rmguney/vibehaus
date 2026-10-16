import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// the runner's timer, to let fire-and-forget work land
declare const setTimeout: (done: () => void, ms: number) => unknown

// Waits for the plugin's after-the-event work until `check` holds; fails after about 2 s.
async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (await check()) return
    await new Promise<void>(done => setTimeout(() => done(), 5))
  }
  throw new Error('timed out waiting for the plugin')
}

const PANE_PROPS = {
  title: 'Vibehaus',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

type Mounter = { ui: { mount: (target: {
  plugin: string; surface: 'terminal' | 'desktop' | 'mobile'; component: 'Pane'; requestId: string; props: typeof PANE_PROPS
}) => Promise<{
  find: (q: { type: string; text?: RegExp; in?: string; key?: string }) => Promise<unknown>; findAll: (q: { type: string }) => Promise<unknown[]>; unmount: () => Promise<void>
  drawn: () => Promise<unknown>
  press: (target: { key: string }) => Promise<unknown>
}> } }

// a tall terminal pane, garden above and below the plan
const mount = ($: Mounter, surface: 'terminal' | 'desktop' | 'mobile') =>
  $.ui.mount({ plugin: 'vibehaus', surface, component: 'Pane', requestId: 'vibehaus', props: surface === 'terminal' ? { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 90 } } : PANE_PROPS })

// Every desktop picture's alt text.
async function altsOn($: Mounter): Promise<string[]> {
  const desk = await mount($, 'desktop')
  const pics = await desk.findAll({ type: 'Svg' }) as { props: { alt: string } }[]
  await desk.unmount()
  return pics.map(p => p.props.alt)
}

// The house picture's alt: everyone, their tasks, and what each is doing or how it ended.
async function houseOn($: Mounter): Promise<string> {
  return (await altsOn($)).find(alt => alt.startsWith('Vibehaus')) ?? ''
}

// Each hover card over the desktop house (hidden till hovered), as its picture's alt.
type Drawn = { type: string; props: { display?: string; alt?: string }; children?: (Drawn | string)[] }
const altsIn = (e: Drawn | string): string[] => (typeof e === 'string' ? [] : [...(e.type === 'Svg' && e.props.alt ? [e.props.alt] : []), ...(e.children ?? []).flatMap(altsIn)])
const cardsIn = (boxes: Drawn[]) => boxes.filter(b => b.props.display === 'none').flatMap(altsIn)
async function cardsOn($: Mounter): Promise<string[]> {
  const desk = await mount($, 'desktop')
  const boxes = await desk.findAll({ type: 'Box' }) as Drawn[]
  await desk.unmount()
  return cardsIn(boxes)
}

// The terminal's floor plan as text, a row to a line.
async function planOn($: Mounter): Promise<string> {
  const term = await mount($, 'terminal')
  const raster = await term.find({ type: 'Raster', key: 'vh-house' }) as { props: { columns: number; cells: string } } | undefined
  await term.unmount()
  return spelled(raster)
}

// Backs the plugin store with `store`, for the test to inspect.
function storeIn(on: Parameters<TestBody>[1], store: Map<string, unknown>): void {
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
}

test('the room is named for what Claude is doing', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: 'ok' }))
  // @ts-ignore: Claude Code's tool table for this machine can be too deep to check
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)

  // over the room in the terminal plan
  expect(await planOn($)).toMatch(/kitchen +Bash: npm/)

  expect(await houseOn($)).toMatch(/Host: Bash: npm test/)
})

test('a background shell joins as its own agent and reads as stopped when stopped', async ($, on) => {
  mock.clock(on)
  on('tool.call', (_, e) => ({ result: e.tool === 'Bash' ? { backgroundTaskId: 'bg1' } : 'ok' }))
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })
  expect(await houseOn($)).toMatch(/Cook: npm run dev(;|$)/)
  // the terminal plan names it under its Clawd
  expect(await planOn($)).toMatch(/Cook/)

  await $.tool.call({ tool: 'TaskStop', task_id: 'bg1' })
  expect(await houseOn($)).toMatch(/Cook: npm run dev \(stopped\)/)
})
test('the band above the prompt shows the vibe fatigue and opens Vibehaus, and gives way to a survey', async ($, on) => {
  mock.clock(on)
  const opened: string[] = []
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  // the survey the engine draws in the band's place
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>a survey</Text>
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'vibehaus', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10 } as never })
    expect(await band.find({ type: 'Text', text: /^5H / })).toBeDefined()
    await band.press({ key: 'vibehaus-toggle' })
    await band.unmount()
    const survey = await $.ui.mount({ plugin: 'vibehaus', surface, component: 'AbovePrompt', props: { hasSurvey: true, isWorking: false, maxRows: 10 } as never })
    expect(await survey.find({ type: 'Button' })).toBeUndefined()
    expect(await survey.find({ type: 'Text', text: /a survey/ })).toBeDefined()
    await survey.unmount()
  }
  expect(opened).toEqual(['vibehaus', 'vibehaus'])
})

test('the house follows the engine\'s own background tasks', async ($, on) => {
  const clock = mock.clock(on)
  on('agent.list', () => ({ value: [] }))
  on('classic.Stop', () => ({}))
  const shell = { id: 'bgX', type: 'shell', status: 'running', description: 'dev server', command: 'npm run dev' }
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [shell] })
  expect(await houseOn($)).toMatch(/Cook: npm run dev(;|$)/)

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  // off the engine's list, it waits a moment for its end notice
  expect(await houseOn($)).toMatch(/Cook: npm run dev(;|$)/)
  await clock.advance(6000)
  expect(await houseOn($)).toMatch(/Cook: npm run dev \(completed\)/)
})
test('a tool call from an agent the engine does not list adds no phantom', async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: [] }))
  on('tool.call', () => ({ result: 'ok' }))
  await $.tool.call({ tool: 'ScheduleWakeup', agentId: 'fork-1' } as never)
  // nobody but the Host, if anyone
  expect(await houseOn($)).toMatch(/^Vibehaus: \d+ of [01] working\./)
})
test('a todo update is not mistaken for background work', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: { taskId: '3', success: true } }))
  await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'completed' } as never)
  expect(await houseOn($)).toMatch(/^Vibehaus: \d+ of 1 working\./)
})
test('the newest finished agents stay in the house, an error reads as failed', async ($, on) => {
  const clock = mock.clock(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: `ag${++n}` }))
  on('turn.complete', () => ({ text: '' }))
  for (let i = 1; i <= 6; i++) {
    await $.agent.spawn({ prompt: 'go', description: `job ${i}`, subagentType: 'Explore' } as never)
    await clock.advance(1000)
    await $.turn.complete({
      answer: '', durationMs: 1000, isAborted: false, turnId: `t${i}`, agentId: `ag${i}`, reason: i === 6 ? 'error' : 'answer',
    } as never)
  }
  // each carries its box out before the oldest leave
  await clock.advance(60000)

  const house = await houseOn($)
  expect(house).toMatch(/Snoop: job 6 · Failed/)
  expect(house).toMatch(/Snoop: job 3 · Done/)
  expect(house).not.toMatch(/job 1 · /)
})

test('a permission prompt Claude Code announces raises the amber tag until the call goes on', async ($, on) => {
  mock.clock(on)
  on('classic.Notification', () => ({}) as never)
  let seen = ''
  on('tool.call', async () => {
    await $.classic.Notification({ notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' } as never)
    // while the call still waits
    seen = await planOn($ as never)
    return { result: 'ok' }
  })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(seen).toMatch(/wants Bash/)
  // back from the call, nobody is left waiting
  expect(await planOn($ as never)).not.toMatch(/wants Bash/)
})

test('/haus demo moves a demo household in, and again sends it home', async ($, on) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  await $.command.run({ command: 'haus', args: 'demo' } as never)

  const house = await houseOn($)
  expect(house).toMatch(/: Map the auth flow · /)
  expect(house).toMatch(/Cook: npm run dev(;|$)/)

  await $.command.run({ command: 'haus', args: 'demo' } as never)
  expect(await houseOn($)).toMatch(/^Vibehaus: \d+ of 1 working\./)
})

test('/haus snapshot saves the house as an SVG in the session folder', async ($, on) => {
  mock.clock(on)
  const written: { path: string; text: string }[] = []
  on('fs.write', (_, e) => {
    written.push(e as unknown as { path: string; text: string })
    return { value: undefined }
  })
  await $.command.run({ command: 'haus', args: 'snapshot' } as never)

  expect(written.length).toBe(1)
  // in the folder Claude Code runs in, however the engine spells it
  expect(written[0]?.path).toMatch(/(^|[\\/])vibehaus-snapshot\.svg$/)
  expect(written[0]?.text).toMatch(/^<svg /)
})

// A model response costing `tokens` fresh tokens plus a large, uncounted cache read.
function answered(tokens: number) {
  return async function* () {
    return {
      turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn',
      usage: { input_tokens: tokens / 2, output_tokens: tokens / 4, cache_creation_input_tokens: tokens / 4, cache_read_input_tokens: 90000, model: 'claude-opus-5-5' },
    } as never
  }
}

async function step($: { turn: { step: (e: never) => AsyncGenerator<unknown, unknown> & { result: Promise<unknown> } } }, agentId?: string) {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) } as never)
  for await (const _ of stream) { /* drained */ }
  await stream.result
}

test('the Host and each agent count their tokens, on their hover cards', async ($, on) => {
  const clock = mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'ag1' }))
  let tokens = 2000
  on('turn.step', async function* () { return yield* answered(tokens)() })
  await step($ as never)
  await clock.advance(2 * 60 * 60 * 1000)
  tokens = 1500
  await step($ as never)
  await $.agent.spawn({ prompt: 'go', description: 'Map the auth flow', subagentType: 'Explore' } as never)
  tokens = 800
  await step($ as never, 'ag1')

  // the Host's week spans sessions, an agent's count its one run; each booked after its step
  await until(async () => {
    const cards = await cardsOn($)
    return cards.some(card => /^Host · .*3\.5k tokens this week$/.test(card)) && cards.some(card => /^Snoop · Explore · Map the auth flow · .*800 tokens$/.test(card))
  })

  // the terminal's cards say the same
  const term = await mount($, 'terminal')
  expect(await term.find({ type: 'Text', text: /800 tokens/ })).toBeDefined()
  await term.unmount()
})

// The text a Raster's cells spell, row by row.
function spelled(raster: { props: { columns: number; cells: string } } | undefined): string {
  const bytes = atob(raster?.props.cells ?? '')
  const words = new DataView(Uint8Array.from(bytes, ch => ch.charCodeAt(0)).buffer)
  let text = ''
  for (let i = 0; i + 12 <= bytes.length; i += 12) {
    text += String.fromCodePoint(words.getUint32(i, true))
    if ((i / 12 + 1) % (raster?.props.columns ?? 1) === 0) text += String.fromCharCode(10)
  }
  return text
}

test('the terminal draws the house as a floor plan in its own cells and plays it a frame at a time', async ($, on) => {
  const clock = mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'ag1' }))
  on('agent.list', () => ({ value: [{ id: 'ag1', type: 'Explore', description: 'Map the auth flow', status: 'running' }] }) as never)
  on('tool.call', () => ({ result: 'ok' }))
  const frames: string[] = []
  on('ui.blit', (_, e) => {
    frames.push((e as { cells?: string }).cells ?? '')
    return { value: {} }
  })
  await $.agent.spawn({ prompt: 'go', description: 'Map the auth flow', subagentType: 'Explore' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'refreshToken', agentId: 'ag1' } as never)
  await clock.advance(30000)
  const term = await mount($, 'terminal')
  const raster = await term.find({ type: 'Raster', key: 'vh-house' }) as { props: { columns: number; rows: number; cells: string } } | undefined
  // rooms by name, agents by role and activity, crisp at the pane's width
  expect(raster?.props.columns).toBeLessThanOrEqual(60)
  expect(raster?.props.columns).toBeGreaterThan(50)
  const plan = spelled(raster)
  for (const room of ['library', 'study', 'sunroom', 'kitchen', 'workshop', 'lounge']) expect(plan).toContain(room)
  expect(plan).toMatch(/Snoop/)
  expect(plan).toMatch(/Grep: ref/)
  // the house plays on between redraws
  await clock.advance(2000)
  expect(frames.length).toBeGreaterThan(4)
  await term.unmount()
})

test('the lead keeps its week across sessions in the store', async ($, on) => {
  const clock = mock.clock(on)
  // an earlier session's 5k tokens, under its own key
  const kept = new Map<string, unknown>([['usage:lead:1', [0, 5000]]])
  on('store.get', (_, e) => ({ value: kept.get(e.key) }))
  on('store.set', (_, e) => {
    kept.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...kept.keys()] }))
  on('turn.step', async function* () { return yield* answered(1000)() })
  await clock.advance(3 * 60 * 60 * 1000)
  await step($ as never)

  // this session writes its own key, leaving the other's alone
  await until(async () => kept.size === 2 && (await cardsOn($)).some(card => /^Host · .*6\.0k tokens this week$/.test(card)))
  expect(kept.get('usage:lead:1')).toEqual([0, 5000])
})

// The phone picture's alt for its corner plan bars (no band there), drawn in the pixel font.
async function houseBars($: Parameters<typeof mount>[0]): Promise<string> {
  const desk = await mount($, 'mobile')
  const pic = await desk.find({ type: 'Svg' }) as { props: { alt: string; source: string } } | undefined
  await desk.unmount()
  expect(pic?.props.source).not.toMatch(/<text/)
  return pic?.props.alt ?? ''
}

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// The band `columns` wide on `surface`: each meter's words, and its row's width in cells.
async function bandOn($: Parameters<TestBody>[0], surface: 'terminal' | 'desktop', columns: number): Promise<{ meters: string[]; width: number }> {
  const band = await $.ui.mount({ plugin: 'vibehaus', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: columns } as never })
  const texts = await band.findAll({ type: 'Text' }) as Drawn[]
  await band.unmount()
  const words = (e: Drawn | string): string => (typeof e === 'string' ? e : (e.children ?? []).map(words).join(''))
  const meters = texts.filter(t => (t.props as { mono?: boolean }).mono).map(words)
  // the meters and the toggle, two cells apart
  return { meters, width: [...meters, '◧ Vibehaus'].reduce((n, t) => n + [...t].length, 0) + 2 * meters.length }
}

test('the plan bars show the five hour and weekly windows as Claude Code measured them, and when each resets', async ($, on) => {
  const now = 1_800_000_000_000
  const clock = mock.clock(on, { now })
  const store = new Map<string, unknown>()
  storeIn(on, store)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  const resets = (ms: number) => new Date(now + ms).toISOString()
  await $.session.measure({
    context: { window: 200000 }, changed: ['rateLimits'],
    rateLimits: [{ kind: 'five_hour', percentUsed: 12, resetsAt: resets(2 * HOUR + 10 * MIN) }, { kind: 'seven_day', percentUsed: 93, resetsAt: resets(3 * DAY) }],
  } as never)
  // read after the measurement is handed on, not holding it up
  await until(async () => /Plan use: 5h 12%, week 93%\./.test(await houseBars($ as never)))
  // and kept for the other sessions
  expect(store.get('plan')).toMatchObject({ at: now, fiveHour: 12, week: 93 })

  // the band adds when each resets, its bars filling the row
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(now + 3 * DAY).getDay()] as string
  for (const surface of ['terminal', 'desktop'] as const) {
    const wide = await bandOn($, surface, 120)
    expect(wide.meters[0]).toMatch(/^5H ━+ 12% · Resets 2h 10m$/)
    expect(wide.meters[1]).toMatch(new RegExp(`^Week ━+ 93% · Resets ${weekday}$`))
    expect(wide.width).toBeLessThanOrEqual(120)
    expect(wide.width).toBeGreaterThanOrEqual(117)
  }
  // narrower, reset times shorten then go, the bars still filling the row
  const narrow = await bandOn($, 'terminal', 56)
  expect(narrow.meters[0]).toMatch(/^5H ━+ 12% · 2h 10m$/)
  expect(narrow.width).toBeGreaterThanOrEqual(53)
  const narrower = await bandOn($, 'terminal', 50)
  expect(narrower.meters[0]).toMatch(/^5H ━{3,} 12%$/)

  // reset times count down; a window past its reset has no reading
  await clock.advance(2 * HOUR)
  expect((await bandOn($, 'terminal', 120)).meters[0]).toMatch(/ 12% · Resets 10m$/)
  await clock.advance(11 * MIN)
  const after = await bandOn($, 'terminal', 120)
  expect(after.meters[0]).toMatch(/^5H ━+ --$/)
  expect(after.meters[1]).toMatch(/ 93% · Resets /)
})

test('every session shows the newest plan reading any of them took', async ($, on) => {
  const now = 1_800_000_000_000
  mock.clock(on, { now })
  const store = new Map<string, unknown>([['plan', { at: now - MIN, fiveHour: 40, fiveHourResets: now + HOUR, week: 55, weekResets: now + 2 * DAY }]])
  storeIn(on, store)
  on('session.id', () => ({ value: 'mine' }))
  on('tool.call', () => ({ result: 'ok' }))
  // the first change starts sharing, which reads the others
  await $.tool.call({ tool: 'Grep', pattern: 'route' })
  await until(async () => /Plan use: 5h 40%, week 55%\./.test(await houseBars($ as never)))
  expect((await bandOn($, 'terminal', 120)).meters[0]).toMatch(/ 40% · Resets 1h$/)
})

test('an agent standing in the house has a hover zone that shows its card', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'ag1' }))
  on('agent.list', () => ({ value: [{ id: 'ag1', type: 'Explore', description: 'Map the auth flow', status: 'running' }] }) as never)
  on('tool.call', () => ({ result: 'ok' }))
  await $.agent.spawn({ prompt: 'go', description: 'Map the auth flow', subagentType: 'Explore' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'refreshToken', agentId: 'ag1' } as never)

  type Placed = Drawn & { props: { display?: string; position?: string; left?: number; width?: number } }
  const desk = await mount($, 'desktop')
  const boxes = await desk.findAll({ type: 'Box' }) as Placed[]
  await desk.unmount()

  // the house's card is the compact one: who, the task, what it is doing
  expect(cardsIn(boxes).filter(card => /^Snoop · Explore · Map the auth flow · Grep: refreshToken/.test(card)).length).toBe(1)
  // drawn hidden beside its sprite, shown by the zone's hover (plain data omits hover props)
  const cards = boxes.filter(b => b.props.display === 'none' && b.props.position === 'absolute' && (b.props.width ?? 99) <= 30)
  expect(cards.length).toBe(2)
  // beside its zone, never over it: past its right edge or wholly to its left
  expect(cards.every(b => (b.props.left ?? 0) > 0 || (b.props.left ?? 0) + (b.props.width ?? 0) < 0)).toBe(true)
})

test('an agent on its way to another room keeps its hover card as it walks', async ($, on) => {
  const clock = mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'ag1' }))
  on('agent.list', () => ({ value: [{ id: 'ag1', type: 'Explore', description: 'Map the auth flow', status: 'running' }] }) as never)
  on('tool.call', () => ({ result: 'ok' }))
  await $.agent.spawn({ prompt: 'go', description: 'Map the auth flow', subagentType: 'Explore' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'refreshToken', agentId: 'ag1' } as never)
  await clock.advance(30000)
  // from the library to the workshop, and partway there
  await $.tool.call({ tool: 'Edit', file_path: 'src/auth.ts', old_string: 'a', new_string: 'b', agentId: 'ag1' } as never)
  await clock.advance(300)

  expect((await cardsOn($)).filter(card => /^Snoop · Explore · Map the auth flow · Edit/.test(card)).length).toBe(1)
})

test('the pane holds the house in its middle, garden above and below, on the desktop and in the terminal', async ($, on) => {
  mock.clock(on)
  on('tool.call', (_, e) => ({ result: e.tool === 'Bash' ? { backgroundTaskId: 'bg1' } : 'ok' }))
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })

  const desk = await mount($, 'desktop')
  const buttons = await desk.findAll({ type: 'Button' })
  const texts = await desk.findAll({ type: 'Text' })
  const boxes = await desk.findAll({ type: 'Box' }) as Drawn[]
  const alts = (await desk.findAll({ type: 'Svg' }) as { props: { alt: string } }[]).map(p => p.props.alt)
  await desk.unmount()
  expect(buttons.length).toBe(0)
  expect(texts.length).toBe(0)
  expect(cardsIn(boxes).length).toBeGreaterThan(0)
  expect(alts[0]).toBe('The garden round the house')
  // a pane too short for the house narrows it, on a whole percentage
  const short = await $.ui.mount({ plugin: 'vibehaus', surface: 'desktop', component: 'Pane', requestId: 'vibehaus', props: { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 13 } } })
  const widths = (await short.findAll({ type: 'Box' }) as { props: { width?: number | string } }[]).map(b => b.props.width).filter(w => typeof w === 'string')
  await short.unmount()
  expect(widths.length).toBeGreaterThan(0)
  expect(widths.every(w => /^\d{1,3}%$/.test(w as string))).toBe(true)
  expect(widths).toContainEqual(expect.stringMatching(/^[1-9]\d?%$/))

  // the terminal's plan in the middle, garden above and below, together as tall as the pane
  const term = await mount($, 'terminal')
  const pane = await term.drawn() as { props: { height?: number } }
  const rasters = await term.findAll({ type: 'Raster' }) as { props: { key?: string; rows: number } }[]
  const termButtons = await term.findAll({ type: 'Button' })
  await term.unmount()
  expect(rasters.map(x => x.props.key)).toEqual(['vh-garden-above', 'vh-house', 'vh-garden-below'])
  expect(Math.abs((rasters[0]?.props.rows ?? 0) - (rasters[2]?.props.rows ?? 0))).toBeLessThanOrEqual(1)
  expect(pane.props.height).toBe(90)
  expect(rasters.reduce((n, x) => n + x.props.rows, 0)).toBe(90)
  expect(termButtons.length).toBe(0)
})
test('another session moves its household in, its agents\' cards saying whose they are', async ($, on) => {
  const now = 1_800_000_000_000
  const clock = mock.clock(on, { now })
  const store = new Map<string, unknown>([['session:other', {
    at: now, since: 1, activeAt: now - 60000, name: 'rmguney.github.io', residents: [
      { id: 'main', name: 'Lead', kind: 'main', room: 'study', movedAt: 0, status: 'working', activity: 'Edit: a.ts', workSince: now - 9000 },
      { id: 'ag9', name: 'Map the API', kind: 'Explore', room: 'library', movedAt: 0, status: 'working', activity: 'Grep: route', taskType: 'subagent', spawnedAt: now - 5000 },
    ],
  }], ['session:asleep', {
    // open, but unmessaged for six hours
    at: now, since: 2, activeAt: now - 6 * 60 * 60 * 1000, name: 'old-project',
    residents: [{ id: 'main', name: 'Lead', kind: 'main', room: 'study', movedAt: 0, status: 'idle', activity: 'Waiting for you' }],
  }], ['session:night', {
    // unmessaged for six hours too, but its shell still runs
    at: now, since: 3, activeAt: now - 6 * 60 * 60 * 1000, name: 'night-shift',
    residents: [{ id: 'bg1', name: 'Background shell', kind: 'shell', room: 'kitchen', movedAt: 0, status: 'working', activity: 'npm run soak', taskType: 'shell', isBackground: true }],
  }]])
  storeIn(on, store)
  on('session.id', () => ({ value: 'mine' }))
  on('session.root', () => ({ value: '/work/vibehaus' }))
  on('tool.call', () => ({ result: 'ok' }))
  on('classic.UserPromptSubmit', () => ({}))
  await $.tool.call({ tool: 'Grep', pattern: 'route' })
  await until(() => store.has('session:mine'))
  await clock.advance(3500)

  // its agents work here; a session asleep for hours is left out unless something still runs
  const house = await houseOn($)
  expect(house).toMatch(/Snoop: Map the API · Grep: route/)
  expect(house).toMatch(/Cook: npm run soak/)
  expect(house).toMatch(/^Vibehaus: 4 of 4 working\./)
  expect(await cardsOn($)).toContainEqual(expect.stringMatching(/Map the API · from "rmguney\.github\.io"/))
  // and this session's household went to the store for the others
  expect((store.get('session:mine') as { name?: string } | undefined)?.name).toBe('vibehaus')

  // once the engine names the session, it goes by its title
  await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Clawd plugin' } as never)
  await until(async () => {
    await clock.advance(500)
    return (store.get('session:mine') as { name?: string } | undefined)?.name === 'Clawd plugin'
  })
})

test('a visitor walks in, ships in its own colour, and leaves by the road', async ($, on) => {
  const now = 1_800_000_000_000
  const clock = mock.clock(on, { now })
  const d = new Date(now)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const store = new Map<string, unknown>([['session:other', {
    at: now, since: 1, activeAt: now - 60000, name: 'rmguney.github.io',
    residents: [{ id: 'bg1', name: 'Background shell', kind: 'shell', room: 'kitchen', movedAt: 0, status: 'working', activity: 'npm run soak', taskType: 'shell', isBackground: true }],
  }], [`shipped:${day}:other`, [now - 8000]]])
  storeIn(on, store)
  on('session.id', () => ({ value: 'mine' }))
  on('session.root', () => ({ value: '/work/vibehaus' }))
  on('tool.call', () => ({ result: 'ok' }))
  await $.tool.call({ tool: 'Grep', pattern: 'route' })
  await until(() => store.has('session:mine'))
  await clock.advance(3500)

  // the house, and the agents drawn over it
  const look = async () => {
    const desk = await mount($, 'desktop')
    const pics = await desk.findAll({ type: 'Svg' }) as { props: { alt: string; source: string } }[]
    await desk.unmount()
    return {
      said: pics.find(p => p.props.alt.startsWith('Vibehaus'))?.props.alt ?? '',
      house: pics.find(p => p.props.alt.startsWith('Vibehaus'))?.props.source ?? '',
      agents: pics.filter(p => p.props.alt === 'The agents in the house').map(p => p.props.source).join(''),
    }
  }
  let seen = await look()
  expect(seen.said).toMatch(/Cook: npm run soak/)
  // the cook in its toque, and its session's box taped in its colour
  expect(seen.agents).toMatch(/id="hat-Cook"/)
  expect(seen.house).toMatch(/\.yt[0-9a-f]{6}\{fill/)

  // its session goes: uncounted at once, it walks out to the street
  store.delete('session:other')
  await clock.advance(3500)
  seen = await look()
  expect(seen.said).not.toMatch(/npm run soak/)
  expect(seen.agents).toMatch(/id="hat-Cook"/)
  // gone at the road's end
  await clock.advance(30000)
  seen = await look()
  expect(seen.agents).not.toMatch(/id="hat-Cook"/)
})

test('a subagent\'s turn leaves the lead as it was', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'ag1' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.agent.spawn({ prompt: 'go', description: 'Map the auth flow', subagentType: 'Explore' } as never)
  await $.turn.start({ text: 'go', turnId: 't2', agentId: 'ag1' } as never)
  expect(await houseOn($)).toMatch(/Host: Waiting for you/)
})

test('a permission prompt that names no agent is the lead\'s', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'ag1' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('classic.Notification', () => ({}) as never)
  let cards: string[] = []
  on('tool.call', async () => {
    // the lead's prompt comes while an agent's Bash call still runs
    await $.classic.Notification({ notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' } as never)
    cards = await cardsOn($)
    return { result: 'ok' }
  })
  await $.turn.start({ text: 'hi', turnId: 't1' } as never)
  await $.agent.spawn({ prompt: 'go', description: 'Run the tests', subagentType: 'general-purpose' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'ag1' } as never)
  expect(cards).toContainEqual(expect.stringMatching(/^Host · .*awaiting approval for Bash/))
  expect(cards.filter(card => /awaiting approval/.test(card)).length).toBe(1)
})

test('a session\'s end takes the demo with it', async ($, on) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('session.end', () => ({ sessionId: 's1' }) as never)
  await $.command.run({ command: 'haus', args: 'demo' } as never)
  await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
  expect(await houseOn($)).not.toMatch(/Map the auth flow/)
  const again = await $.command.run({ command: 'haus', args: 'demo' } as never) as { text?: string }
  expect(again.text).toMatch(/moved in/)
})

test('an agent type named like an object\'s own property is a name like any other', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'ag1' }))
  await $.agent.spawn({ prompt: 'go', description: 'Odd one', subagentType: 'constructor' } as never)
  expect(await houseOn($)).toMatch(/Handyman: Odd one/)
  const term = await mount($, 'terminal')
  expect(await term.find({ type: 'Text', text: /Handyman · constructor/ })).toBeDefined()
  await term.unmount()
})

test('other sessions see the tool this one uses, never its command', async ($, on) => {
  const clock = mock.clock(on)
  const store = new Map<string, unknown>()
  storeIn(on, store)
  on('session.id', () => ({ value: 'mine' }))
  on('tool.call', () => ({ result: 'ok' }))
  await $.tool.call({ tool: 'Bash', command: 'curl -H "Authorization: secret" example.com' })
  type Shared = { residents?: { id: string; activity: string }[] } | undefined
  await until(async () => {
    await clock.advance(1000)
    return (store.get('session:mine') as Shared)?.residents?.find(c => c.id === 'main')?.activity === 'Bash'
  })
  expect(JSON.stringify(store.get('session:mine'))).not.toMatch(/secret|curl/)
})

test('other sessions see a background task as running, never its command', async ($, on) => {
  const clock = mock.clock(on)
  const store = new Map<string, unknown>()
  storeIn(on, store)
  on('session.id', () => ({ value: 'mine' }))
  on('tool.call', () => ({ result: { backgroundTaskId: 'bg1' } }))
  await $.tool.call({ tool: 'Bash', command: 'deploy --token secret', run_in_background: true } as never)
  type Shared = { residents?: { id: string; activity: string }[] } | undefined
  await until(async () => {
    await clock.advance(1000)
    return (store.get('session:mine') as Shared)?.residents?.find(c => c.id === 'bg1')?.activity === 'Running'
  })
  expect(JSON.stringify(store.get('session:mine'))).not.toMatch(/secret|deploy/)
})

test('a session\'s start sets the house up, and so does a /clear, which has none', async ($, on) => {
  mock.clock(on)
  const registered: string[] = []
  on('command.register', (_, e) => {
    const name = (e as { name: string }).name
    registered.push(name)
    return { value: { command: name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('session.start', () => ({ cwd: '/work' }) as never)
  on('classic.SessionStart', () => ({}) as never)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true } as never)
  expect(registered).toEqual(['haus'])
  await $.classic.SessionStart({ source: 'clear', session_id: 'next', transcript_path: '', cwd: '/work', hook_event_name: 'SessionStart' } as never)
  await until(() => registered.length === 2)
})

test('a background task\'s end notice says how it ended, even after the house took it for completed', async ($, on) => {
  const clock = mock.clock(on)
  storeIn(on, new Map())
  on('agent.list', () => ({ value: [] }))
  on('classic.Stop', () => ({}))
  on('session.append', (_, e, next) => next(e))
  const shell = (id: string, command: string) => ({ id, type: 'shell', status: 'running', description: command, command })
  const notice = (id: string, status: string) => $.session.append({
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n<summary>Background command ended</summary>\n</task-notification>` }] },
    door: 'notice', origin: { kind: 'task-notification' }, uuid: `u-${id}`,
  } as never)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [shell('bg1', 'npm test'), shell('bg2', 'npm run build')] })

  // one's notice comes while it still runs
  await notice('bg1', 'failed')
  expect(await houseOn($)).toMatch(/Cook: npm test \(failed\)/)

  // the other leaves the list unexplained, is taken for completed after a grace; its late notice corrects it
  await clock.advance(1000)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  await clock.advance(6000)
  expect(await houseOn($)).toMatch(/Cook: npm run build \(completed\)/)
  await notice('bg2', 'killed')
  const house = await houseOn($)
  expect(house).toMatch(/Cook: npm run build \(killed\)/)
  expect(house).toMatch(/Cook: npm test \(failed\)/)
})

test('a teammate idles between messages, wakes to the next, and ends when the engine lets it go', async ($, on) => {
  const clock = mock.clock(on)
  storeIn(on, new Map())
  let listed = 'running'
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'tm1', teammateId: 'tm1' }) as never)
  on('agent.list', () => ({ value: [{ id: 'tm1', type: 'general-purpose', description: 'Review the PR', status: listed }] }) as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  await $.agent.spawn({ prompt: 'go', description: 'Review the PR', subagentType: 'general-purpose', isTeammate: true } as never)

  // its turn done, it waits for a message, neither done nor working
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'tm1' } as never)
  const cards = await cardsOn($)
  expect(cards).toContainEqual(expect.stringMatching(/^Handyman · general-purpose · Review the PR · Waiting for a message/))
  expect(cards.join('\n')).not.toMatch(/completed/)
  expect(await houseOn($)).toMatch(/^Vibehaus: 0 of 2 working\./)

  // a message wakes it
  await $.turn.start({ text: 'next', turnId: 't2', agentId: 'tm1' } as never)
  expect(await houseOn($)).toMatch(/Handyman: Review the PR · Thinking/)

  // a Stop while the engine still lists it changes nothing; once let go, it ends as the engine says
  await clock.advance(1000)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  expect(await houseOn($)).toMatch(/Handyman: Review the PR · Thinking/)
  listed = 'completed'
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  expect(await houseOn($)).toMatch(/Handyman: Review the PR · Completed/)
})
