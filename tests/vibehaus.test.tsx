import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

// the test runner's own timer, for letting fire-and-forget work land
declare const setTimeout: (done: () => void, ms: number) => unknown

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

// the terminal's pane tall, so the garden shows above and below its plan
const mount = ($: Mounter, surface: 'terminal' | 'desktop' | 'mobile') =>
  $.ui.mount({ plugin: 'vibehaus', surface, component: 'Pane', requestId: 'vibehaus', props: surface === 'terminal' ? { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 90 } } : PANE_PROPS })

// Every picture on the desktop, by what it says of itself.
async function altsOn($: Mounter): Promise<string[]> {
  const desk = await mount($, 'desktop')
  const pics = await desk.findAll({ type: 'Svg' }) as { props: { alt: string } }[]
  await desk.unmount()
  return pics.map(p => p.props.alt)
}

// What the house picture says of everyone in it, its alt text: who, the
// task, and what each is doing or how it ended.
async function houseOn($: Mounter): Promise<string> {
  return (await altsOn($)).find(alt => alt.startsWith('Vibehaus')) ?? ''
}

// Every hover card over the desktop's house, drawn hidden till hovered: its
// picture's alt, its lines joined.
type Drawn = { type: string; props: { display?: string; alt?: string }; children?: (Drawn | string)[] }
const altsIn = (e: Drawn | string): string[] => (typeof e === 'string' ? [] : [...(e.type === 'Svg' && e.props.alt ? [e.props.alt] : []), ...(e.children ?? []).flatMap(altsIn)])
const cardsIn = (boxes: Drawn[]) => boxes.filter(b => b.props.display === 'none').flatMap(altsIn)
async function cardsOn($: Mounter): Promise<string[]> {
  const desk = await mount($, 'desktop')
  const boxes = await desk.findAll({ type: 'Box' }) as Drawn[]
  await desk.unmount()
  return cardsIn(boxes)
}

// The terminal's floor plan, spelled out a row to a line.
async function planOn($: Mounter): Promise<string> {
  const term = await mount($, 'terminal')
  const raster = await term.find({ type: 'Raster', key: 'vh-house' }) as { props: { columns: number; cells: string } } | undefined
  await term.unmount()
  return spelled(raster)
}

// The plugin store, kept in `store` for the test to look into.
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
  // @ts-ignore: the tool table Claude Code lays for this machine can be too deep to check here
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)

  // over the room in the terminal's floor plan
  expect(await planOn($)).toMatch(/kitchen +Bash: npm/)

  expect(await houseOn($)).toMatch(/Host: Bash: npm test/)
})

test('a background shell joins as its own agent and reads as stopped when stopped', async ($, on) => {
  mock.clock(on)
  on('tool.call', (_, e) => ({ result: e.tool === 'Bash' ? { backgroundTaskId: 'bg1' } : 'ok' }))
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })
  expect(await houseOn($)).toMatch(/Cook: npm run dev(;|$)/)
  // the terminal's floor plan names it under its Clawd
  expect(await planOn($)).toMatch(/Cook/)

  await $.tool.call({ tool: 'TaskStop', task_id: 'bg1' })
  expect(await houseOn($)).toMatch(/Cook: npm run dev \(stopped\)/)
})
test('the band above the prompt shows the vibe fatigue and opens Vibehaus, and gives way to a survey', async ($, on) => {
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
    expect(await band.find({ type: 'Text', text: /Vibe fatigue/ })).toBeDefined()
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
  // gone from the engine's list: it waits a moment for its own notice of how it ended
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
  // each carries its box out to the pallets before the oldest leave the list
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
  expect(written[0]?.path).toMatch(/(^|[\\/])vibehaus-snapshot\.svg$/)
  expect(written[0]?.text).toMatch(/^<svg /)
})

// A model request's response, as the engine would hand it back, costing
// `tokens` fresh tokens plus a large cache read that is not counted.
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
  // the plugin books the tokens after handing the step on, without holding it up
  await new Promise<void>(done => setTimeout(() => done(), 30))
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

  // the Host's week spans its sessions, an agent's figure is its one run
  const cards = await cardsOn($)
  expect(cards).toContainEqual(expect.stringMatching(/^Host · .*3\.5k tokens this week$/))
  expect(cards).toContainEqual(expect.stringMatching(/^Snoop · Explore · Map the auth flow · .*800 tokens$/))

  // the terminal's cards say the same, in its own text
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
  // the rooms by name, each agent by its role and what it is doing, crisp
  // at the pane's width
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
  // an earlier session's 5k tokens, already in the store under its own key
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

  // this session wrote a key of its own, and left the other's alone
  expect(kept.size).toBe(2)
  expect(kept.get('usage:lead:1')).toEqual([0, 5000])
  expect(await cardsOn($)).toContainEqual(expect.stringMatching(/^Host · .*6\.0k tokens this week$/))
})

// What a phone's picture says of the plan bars in its corner, there being no
// band there: its alt text names each bar's figure, drawn in the house's own
// pixel font.
async function houseBars($: Parameters<typeof mount>[0]): Promise<string> {
  const desk = await mount($, 'mobile')
  const pic = await desk.find({ type: 'Svg' }) as { props: { alt: string; source: string } } | undefined
  await desk.unmount()
  expect(pic?.props.source).not.toMatch(/<text/)
  return pic?.props.alt ?? ''
}

test('the plan bars show the five hour and weekly windows as Claude Code read them', async ($, on) => {
  mock.clock(on)
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 0, window: 200000, percent: 0 }, rateLimits: [{ kind: 'five_hour', percentUsed: 12 }, { kind: 'seven_day', percentUsed: 93 }] },
  }) as never)
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  // the plugin reads it after handing the turn on, without holding it up
  await new Promise<void>(done => setTimeout(() => done(), 30))

  expect(await houseBars($ as never)).toMatch(/Plan use: 5h 12%, week 93%\./)
  // and the band above the prompt says the same, on both surfaces
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'vibehaus', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10 } as never })
    expect(await band.find({ type: 'Text', text: /12%/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /93%/ })).toBeDefined()
    await band.unmount()
  }
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

  // the house's own card is the compact one: who, the task, what it is doing
  expect(cardsIn(boxes).filter(card => /^Snoop · Explore · Map the auth flow · Grep: refreshToken/.test(card)).length).toBe(1)
  // drawn hidden beside its sprite, the hover group of the zone over the
  // sprite showing it (the kit's plain data leaves the hover props out)
  const cards = boxes.filter(b => b.props.display === 'none' && b.props.position === 'absolute' && (b.props.width ?? 99) <= 30)
  expect(cards.length).toBe(2)
  // beside the zone it belongs to, never over it: past its right edge or
  // wholly to its left
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

  // the terminal's floor plan in the middle, the garden in the rows it leaves
  // above and below, as tall as the pane together
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
    // open, but nobody has messaged it for six hours
    at: now, since: 2, activeAt: now - 6 * 60 * 60 * 1000, name: 'old-project',
    residents: [{ id: 'main', name: 'Lead', kind: 'main', room: 'study', movedAt: 0, status: 'idle', activity: 'Waiting for you' }],
  }], ['session:night', {
    // nobody has messaged it for six hours either, but its shell still runs
    at: now, since: 3, activeAt: now - 6 * 60 * 60 * 1000, name: 'night-shift',
    residents: [{ id: 'bg1', name: 'Background shell', kind: 'shell', room: 'kitchen', movedAt: 0, status: 'working', activity: 'npm run soak', taskType: 'shell', isBackground: true }],
  }]])
  storeIn(on, store)
  on('session.id', () => ({ value: 'mine' }))
  on('session.root', () => ({ value: '/work/vibehaus' }))
  on('tool.call', () => ({ result: 'ok' }))
  on('classic.UserPromptSubmit', () => ({}))
  await $.tool.call({ tool: 'Grep', pattern: 'route' })
  await new Promise<void>(done => setTimeout(() => done(), 30))
  await clock.advance(3500)

  // its agents at work here, and a session asleep for hours left out unless it
  // still runs something
  const house = await houseOn($)
  expect(house).toMatch(/Snoop: Map the API · Grep: route/)
  expect(house).toMatch(/Cook: npm run soak/)
  expect(house).toMatch(/^Vibehaus: 4 of 4 working\./)
  expect(await cardsOn($)).toContainEqual(expect.stringMatching(/Map the API · from "rmguney\.github\.io"/))
  // and this session's own household went to the store for the others
  expect((store.get('session:mine') as { name?: string } | undefined)?.name).toBe('vibehaus')

  // once the engine names the session, it goes by its title
  await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Clawd plugin' } as never)
  await new Promise<void>(done => setTimeout(() => done(), 30))
  await clock.advance(2500)
  expect((store.get('session:mine') as { name?: string } | undefined)?.name).toBe('Clawd plugin')
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
  await new Promise<void>(done => setTimeout(() => done(), 30))
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

  // its session goes: no longer counted at once, and walking out to the street
  store.delete('session:other')
  await clock.advance(3500)
  seen = await look()
  expect(seen.said).not.toMatch(/npm run soak/)
  expect(seen.agents).toMatch(/id="hat-Cook"/)
  // gone once it reaches the end of the road
  await clock.advance(30000)
  seen = await look()
  expect(seen.agents).not.toMatch(/id="hat-Cook"/)
})
