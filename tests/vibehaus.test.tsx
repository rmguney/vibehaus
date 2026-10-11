import { expect, mock, test } from 'claude-code/testing'

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

// the terminal's pane tall, so its list shows whole under the house
const mount = ($: Mounter, surface: 'terminal' | 'desktop' | 'mobile') =>
  $.ui.mount({ plugin: 'vibehaus', surface, component: 'Pane', requestId: 'vibehaus', props: surface === 'terminal' ? { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 90 } } : PANE_PROPS })

// The tasks list as drawn where it is a picture (the mobile app's pane),
// read back from its alt text: a line for the header, the tallies, each
// group and each task. The desktop and the terminal draw the same items in
// text.
async function tasksOf(drawing: { findAll: (q: { type: string }) => Promise<unknown[]> }): Promise<string> {
  const pics = await drawing.findAll({ type: 'Svg' }) as { props: { alt: string } }[]
  return pics.map(p => p.props.alt).find(alt => /^Tasks( from "[^"]*")? · /.test(alt)) ?? ''
}

async function tasksOn($: Mounter): Promise<string> {
  const drawing = await mount($, 'mobile')
  const text = await tasksOf(drawing)
  await drawing.unmount()
  return text
}

// Whether a drawing has the button `key`: a session's heading, a stop.
async function hasButton(drawing: { findAll: (q: { type: string }) => Promise<unknown[]> }, key: string): Promise<boolean> {
  return (await drawing.findAll({ type: 'Button' }) as { props: { key?: string } }[]).some(b => b.props.key === key)
}

test('the room is named for what Claude is doing', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: 'ok' }))
  // @ts-ignore: the tool table Claude Code lays for this machine can be too deep to check here
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)

  // over the room in the terminal's floor plan
  const term = await mount($, 'terminal')
  const raster = await term.find({ type: 'Raster' }) as { props: { columns: number; cells: string } } | undefined
  await term.unmount()
  expect(spelled(raster)).toMatch(/kitchen +Bash: npm/)

  const desk = await mount($, 'desktop')
  const house = await desk.find({ type: 'Svg' }) as { props: { alt: string } } | undefined
  await desk.unmount()
  expect(house?.props.alt).toMatch(/Host: Bash: npm test/)
})

test('a background shell joins as its own agent and reads as stopped when stopped', async ($, on) => {
  mock.clock(on)
  on('tool.call', (_, e) => ({ result: e.tool === 'Bash' ? { backgroundTaskId: 'bg1' } : 'ok' }))
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })

  let term = await mount($, 'terminal')
  expect(await term.find({ type: 'Text', text: /npm run dev/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /Cook · running/ })).toBeDefined()
  await term.unmount()

  await $.tool.call({ tool: 'TaskStop', task_id: 'bg1' })
  term = await mount($, 'terminal')
  expect(await term.find({ type: 'Text', text: /Cook · stopped/ })).toBeDefined()
  await term.unmount()
})

test('the footer Vibehaus button opens Vibehaus', async ($, on) => {
  const opened: string[] = []
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  const ui = await $.ui.mount({ plugin: 'vibehaus', surface: 'desktop', component: 'SessionMode', props: { modes: ['focus'] } })
  expect(await ui.find({ type: 'Text', text: /focus/ })).toBeDefined()
  await ui.press({ key: 'vibehaus-toggle' })
  expect(opened).toContain('vibehaus')
  await ui.unmount()
})

test('the list follows the engine\'s own background tasks', async ($, on) => {
  const clock = mock.clock(on)
  on('agent.list', () => ({ value: [] }))
  on('classic.Stop', () => ({}))
  const shell ={ id: 'bgX', type: 'shell', status: 'running', description: 'dev server', command: 'npm run dev' }
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [shell] })

  let desk = await mount($, 'mobile')
  expect(await tasksOf(desk)).toMatch(/^npm run dev · Cook · running$/m)
  expect(await tasksOf(desk)).toMatch(/^Tasks · 1 running$/m)
  await desk.unmount()

  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  // gone from the list: it waits a moment for its own notice of how it ended
  desk = await mount($, 'mobile')
  expect(await tasksOf(desk)).toMatch(/^npm run dev · Cook · running$/m)
  await desk.unmount()
  await clock.advance(6000)
  desk = await mount($, 'mobile')
  expect(await tasksOf(desk)).toMatch(/^npm run dev · Cook · completed$/m)
  expect(await tasksOf(desk)).toMatch(/^Tasks · 0 running$/m)
  await desk.unmount()
})

test('a tool call from an agent the engine does not list adds no phantom', async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: [] }))
  on('tool.call', () => ({ result: 'ok' }))
  await $.tool.call({ tool: 'ScheduleWakeup', agentId: 'fork-1' } as never)

  const desk = await mount($, 'mobile')
  expect(await tasksOf(desk)).toMatch(/Nothing in the background/)
  await desk.unmount()
})

test('a todo update is not mistaken for background work', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: { taskId: '3', success: true } }))
  await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'completed' } as never)

  const desk = await mount($, 'mobile')
  expect(await tasksOf(desk)).toMatch(/Nothing in the background/)
  await desk.unmount()
})

test('the newest finished agents stay listed, an error reads as failed', async ($, on) => {
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

  const desk = await mount($, 'mobile')
  expect(await tasksOf(desk)).toMatch(/^job 6 · /m)
  expect(await tasksOf(desk)).toMatch(/^job 3 · /m)
  expect(await tasksOf(desk)).not.toMatch(/^job 1 · /m)
  expect(await tasksOf(desk)).toMatch(/Snoop · Haiku 4\.5 · failed/)
  await desk.unmount()
})

test('a permission prompt Claude Code announces raises the amber tag until the call goes on', async ($, on) => {
  mock.clock(on)
  on('classic.Notification', () => ({}) as never)
  let seen = ''
  on('tool.call', async () => {
    await $.classic.Notification({ notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' } as never)
    // while the call still waits
    const term = await mount($ as never, 'terminal')
    const raster = await term.find({ type: 'Raster' }) as { props: { columns: number; cells: string } } | undefined
    await term.unmount()
    seen = spelled(raster)
    return { result: 'ok' }
  })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(seen).toMatch(/wants Bash/)
  // back from the call, nobody is left waiting
  const term = await mount($ as never, 'terminal')
  const raster = await term.find({ type: 'Raster' }) as { props: { columns: number; cells: string } } | undefined
  await term.unmount()
  expect(spelled(raster)).not.toMatch(/wants Bash/)
})

test('the list shows running tasks under the house', async ($, on) => {
  mock.clock(on)
  on('tool.call', (_, e) => ({ result: e.tool === 'Bash' ? { backgroundTaskId: 'bg2' } : 'ok' }))
  await $.tool.call({ tool: 'Bash', command: 'npm run watch', run_in_background: true })

  const desk = await mount($, 'mobile')
  expect(await tasksOf(desk)).toMatch(/^Shells$/m)
  expect(await tasksOf(desk)).toMatch(/^npm run watch · Cook · running$/m)
  expect(await tasksOf(desk)).toMatch(/^1 shell( · |$)/m)
  await desk.unmount()
})

test('/haus demo moves a demo household in, and again sends it home', async ($, on) => {
  mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  await $.command.run({ command: 'haus', args: 'demo' } as never)

  let desk = await mount($, 'mobile')
  expect(await tasksOf(desk)).toMatch(/^Map the auth flow · /m)
  expect(await tasksOf(desk)).toMatch(/^npm run dev · Cook · running$/m)
  await desk.unmount()

  await $.command.run({ command: 'haus', args: 'demo' } as never)
  desk = await mount($, 'mobile')
  expect(await tasksOf(desk)).toMatch(/Nothing in the background/)
  await desk.unmount()
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

test('the tasks list leads with the lead and counts tokens by hour and week', async ($, on) => {
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

  const desk = await mount($, 'mobile')
  expect(await tasksOf(desk)).toMatch(/^Tasks · /m)
  const list = await tasksOf(desk)
  expect(list.indexOf(' · Host')).toBeLessThan(list.indexOf('Map the auth flow'))
  expect(await tasksOf(desk)).toMatch(/ · Host · 3\.5k$/m)
  expect(await tasksOf(desk)).toMatch(/^Map the auth flow · .* · 800$/m)
  await desk.unmount()

  // the terminal lists the same, in its own text
  const term = await mount($, 'terminal')
  expect(await term.find({ type: 'Text', text: /Map the auth flow/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /^ ?800$/ })).toBeDefined()
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
  const raster = await term.find({ type: 'Raster' }) as { props: { columns: number; rows: number; cells: string } } | undefined
  // the rooms by name, each agent by its role and what it is doing, crisp
  // at the pane's width
  expect(raster?.props.columns).toBeLessThanOrEqual(60)
  expect(raster?.props.columns).toBeGreaterThan(50)
  const plan = spelled(raster)
  for (const room of ['library', 'study', 'sunroom', 'kitchen', 'workshop', 'lounge']) expect(plan).toContain(room)
  expect(plan).toMatch(/Snoop/)
  expect(plan).toMatch(/Grep: ref/)
  // the list under it, its scrollbar beside it
  expect(await hasButton(term, 'vh-fold-this')).toBe(true)
  expect(await term.find({ type: 'Box', key: 'vh-scrollbar' })).toBeDefined()
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
  const desk = await mount($, 'mobile')
  expect(await tasksOf(desk)).toMatch(/ · Host · 6\.0k$/m)
  await desk.unmount()
})

// What the house picture says of the exp bars (its alt text names each
// bar's figure), and that the tasks list no longer prints them.
async function houseBars($: Parameters<typeof mount>[0]): Promise<string> {
  const desk = await mount($, 'mobile')
  const pic = await desk.find({ type: 'Svg' }) as { props: { alt: string; source: string } } | undefined
  const texts = (await tasksOf(desk)).match(/Plan use|5h \d/)
  await desk.unmount()
  expect(texts).toBeNull()
  expect(pic?.props.source).not.toMatch(/<text/)
  return pic?.props.alt ?? ''
}

test('the exp bars in the corner show the five hour and weekly windows as Claude Code read them', async ($, on) => {
  mock.clock(on)
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 0, window: 200000, percent: 0 }, rateLimits: [{ kind: 'five_hour', percentUsed: 12 }, { kind: 'seven_day', percentUsed: 93 }] },
  }) as never)
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  // the plugin reads it after handing the turn on, without holding it up
  await new Promise<void>(done => setTimeout(() => done(), 30))

  expect(await houseBars($ as never)).toMatch(/Plan use: 5h 12%, week 93%\./)
})

test('an agent standing in the house has a hover zone that shows its card', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'ag1' }))
  on('agent.list', () => ({ value: [{ id: 'ag1', type: 'Explore', description: 'Map the auth flow', status: 'running' }] }) as never)
  on('tool.call', () => ({ result: 'ok' }))
  await $.agent.spawn({ prompt: 'go', description: 'Map the auth flow', subagentType: 'Explore' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'refreshToken', agentId: 'ag1' } as never)

  type Placed = { props: { display?: string; position?: string; left?: number; width?: number } }
  const desk = await mount($, 'desktop')
  const boxes = await desk.findAll({ type: 'Box' }) as Placed[]
  const alts = (await desk.findAll({ type: 'Svg' }) as { props: { alt: string } }[]).map(p => p.props.alt)
  await desk.unmount()

  // the house's own card is the compact one: who, the task, what it is doing
  expect(alts.filter(alt => /^Snoop · Explore · Map the auth flow · Grep: refreshToken/.test(alt)).length).toBe(1)
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

  const desk = await mount($, 'desktop')
  const alts = (await desk.findAll({ type: 'Svg' }) as { props: { alt: string } }[]).map(p => p.props.alt)
  await desk.unmount()
  expect(alts.filter(alt => /^Snoop · Explore · Map the auth flow · Edit/.test(alt)).length).toBe(1)
})

test('a running task stops at its button, through Claude Code\'s own TaskStop', async ($, on) => {
  mock.clock(on)
  const stopped: string[] = []
  on('tool.call', (_, e) => {
    if (e.tool === 'TaskStop') {
      stopped.push(String((e as { task_id?: unknown }).task_id))
      return { result: { message: 'Stopped' } }
    }
    return { result: e.tool === 'Bash' ? { backgroundTaskId: 'bg1' } : 'ok' }
  })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })
  // each surface has the button, the Host none
  const term = await mount($, 'terminal')
  expect(await hasButton(term, 'vh-stop-bg1')).toBe(true)
  expect(await hasButton(term, 'vh-stop-main')).toBe(false)
  await term.unmount()
  const desk = await mount($, 'desktop')
  await desk.press({ key: 'vh-stop-bg1' })
  expect(await hasButton(desk, 'vh-stop-bg1')).toBe(false)
  await desk.unmount()
  expect(stopped).toEqual(['bg1'])
  expect(await tasksOn($)).toMatch(/^npm run dev · Cook · stopped$/m)
})

test('the Host\'s line is drawn as the chat draws its own while it works', async ($, on) => {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  on('tool.call', () => ({ result: 'ok' }))
  const frames: string[] = []
  on('ui.blit', (_, e) => {
    if ((e as { key?: string }).key === 'vh-host-main') frames.push((e as { cells?: string }).cells ?? '')
    return { value: {} }
  })
  await $.tool.call({ tool: 'Grep', pattern: 'refreshToken' } as never)
  await clock.advance(65000)

  // on the desktop, a picture that plays by itself
  const desk = await mount($, 'desktop')
  const host = (await desk.findAll({ type: 'Svg' }) as { props: { alt: string; source: string } }[]).find(p => p.props.alt === 'Grep: refreshToken · running')
  await desk.unmount()
  expect(host?.props.source).toContain('Grep: refreshToken')
  expect(host?.props.source).toContain('1m 5s')
  // in the terminal, cells repainted a frame at a time
  const term = await mount($, 'terminal')
  const line = (await term.findAll({ type: 'Raster' }) as { props: { key?: string; columns: number; cells: string } }[]).find(r => r.props.key === 'vh-host-main')
  expect(spelled(line)).toMatch(/^. Grep: refreshToken 1m 5s/)
  await clock.advance(1000)
  expect(frames.length).toBeGreaterThan(4)
  await term.unmount()
})

test('on the desktop the house and its bars stay put, the list under them a page at a time', async ($, on) => {
  mock.clock(on)
  let n = 0
  on('tool.call', () => ({ result: { backgroundTaskId: `bg${++n}` } }))
  for (let i = 0; i < 24; i++) await $.tool.call({ tool: 'Bash', command: `npm run job-${i}`, run_in_background: true })

  type Sized = { props: { height?: number | string; position?: string; overflow?: string; key?: string } }
  const desk = await mount($, 'desktop')
  const shows = async (text: RegExp) => (await desk.find({ type: 'Text', text })) !== undefined
  const heads = () => hasButton(desk, 'vh-fold-this')
  const boxes = await desk.findAll({ type: 'Box' }) as Sized[]
  const clients = await desk.findAll({ type: 'Client' })
  // a hair short of the pane's 40 rows, so the pane itself never scrolls:
  // the only rows anything is sized in, clipped at the pane's edge
  const counted = boxes.filter(b => b.props.position !== 'absolute' && typeof b.props.height === 'number')
  expect(counted.map(b => b.props.height)).toEqual([39.9])
  expect(boxes[0]?.props.overflow).toBe('hidden')
  expect(clients.length).toBe(0)
  // and no row of the list has a hover card
  expect(boxes.some(b => (b.props.key ?? '').startsWith('t-'))).toBe(false)
  // the first page from the top, in the pane's own text, the rest a button
  // away
  expect(await heads()).toBe(true)
  expect(await shows(/^npm run job-0$/)).toBe(true)
  expect(await shows(/^npm run job-23$/)).toBe(false)
  expect(await shows(/^1\/\d+$/)).toBe(true)
  await desk.press({ key: 'vh-page-on' })
  expect(await shows(/^npm run job-0$/)).toBe(false)
  expect(await shows(/^2\/\d+$/)).toBe(true)
  await desk.press({ key: 'vh-page-back' })
  expect(await shows(/^npm run job-0$/)).toBe(true)
  await desk.unmount()
})

test('on the desktop a redraw for nothing but the focus gives the same drawing back, so a click lands', async ($, on) => {
  const clock = mock.clock(on)
  type Drawing = { drawn: () => Promise<unknown>; redraw: (props: typeof PANE_PROPS) => Promise<void>; unmount: () => Promise<void> }
  const desk = await $.ui.mount({ plugin: 'vibehaus', surface: 'desktop', component: 'Pane', requestId: 'vibehaus', props: PANE_PROPS }) as unknown as Drawing
  const before = JSON.stringify(await desk.drawn())
  // the click's focus, a moment later: the house would be drawn anew for it
  await clock.advance(300)
  await desk.redraw({ ...PANE_PROPS, isFocused: true })
  expect(JSON.stringify(await desk.drawn())).toEqual(before)
  await desk.unmount()
})

test('in the terminal the list scrolls under the house, its scrollbar beside it', async ($, on) => {
  mock.clock(on)
  let n = 0
  on('tool.call', () => ({ result: { backgroundTaskId: `bg${++n}` } }))
  for (let i = 0; i < 24; i++) await $.tool.call({ tool: 'Bash', command: `npm run job-${i}`, run_in_background: true })
  const term = await $.ui.mount({ plugin: 'vibehaus', surface: 'terminal', component: 'Pane', requestId: 'vibehaus', props: PANE_PROPS })
  const heads = () => hasButton(term, 'vh-fold-this')
  // the scrollbar's rows, top to bottom: where its thumb stands
  type Drawn = { type?: string; props?: { key?: string }; children?: (Drawn | string)[] }
  const bar = async () => {
    const find = (d: Drawn | string): Drawn | undefined => (typeof d === 'string' ? undefined : d.props?.key === 'vh-scrollbar' ? d : (d.children ?? []).map(find).find(Boolean))
    const text = (d: Drawn | string): string => (typeof d === 'string' ? d : (d.children ?? []).map(text).join(''))
    return text(find(await term.drawn() as Drawn) ?? '')
  }
  // the top of the list under the house, the thumb at the top of the track
  expect(await heads()).toBe(true)
  expect(await bar()).toMatch(/^┃+│+$/)
  // the wheel, as the terminal raises it over the pane: a tick down, then
  // End and Home
  const scroll = (by: number, pointer?: object) => $.ui.scroll({ component: 'Pane', requestId: 'vibehaus', offset: 0, by, bodyRows: 40, contentRows: 40, ...(pointer ? { pointer } : {}) } as never)
  await scroll(1, { x: 0, y: 50 })
  expect(await heads()).toBe(false)
  expect(await bar()).toMatch(/^│*┃+│+$/)
  await scroll(1000)
  expect(await bar()).toMatch(/^│+┃+$/)
  await scroll(-1000)
  expect(await heads()).toBe(true)
  expect(await bar()).toMatch(/^┃+│+$/)
  await term.unmount()
})

test('another session moves its household in, its tasks in a section of their own', async ($, on) => {
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
  on('session.id', () => ({ value: 'mine' }))
  on('session.root', () => ({ value: '/work/vibehaus' }))
  on('tool.call', () => ({ result: 'ok' }))
  on('classic.UserPromptSubmit', () => ({}))
  await $.tool.call({ tool: 'Grep', pattern: 'route' })
  await new Promise<void>(done => setTimeout(() => done(), 30))
  await clock.advance(3500)

  const desk = await mount($, 'desktop')
  const house = (await desk.findAll({ type: 'Svg' }) as { props: { alt: string } }[]).map(p => p.props.alt).find(alt => alt.startsWith('Vibehaus')) ?? ''
  await desk.unmount()
  // this session's section open, the others' folded to their headings
  const tasks = await tasksOn($)
  expect(tasks).toMatch(/^Tasks from "vibehaus" · 1 running$/m)
  expect(tasks).toMatch(/^Tasks from "rmguney\.github\.io" · 2 running · folded$/m)
  expect(tasks).not.toMatch(/Map the API/)
  expect(tasks).not.toMatch(/old-project/)
  expect(tasks).toMatch(/^Tasks from "night-shift" · 1 running · folded$/m)
  expect(house).toMatch(/Snoop: Grep: route/)
  // and this session's own household went to the store for the others
  expect((store.get('session:mine') as { name?: string } | undefined)?.name).toBe('vibehaus')

  // once the engine names the session, it goes by its title, here and there
  await $.classic.UserPromptSubmit({ prompt: 'hi', session_title: 'Clawd plugin' } as never)
  await new Promise<void>(done => setTimeout(() => done(), 30))
  await clock.advance(2500)
  expect(await tasksOn($)).toMatch(/^Tasks from "Clawd plugin" · 1 running$/m)
  // a press on a session's heading on the desktop opens its section
  const again = await mount($, 'desktop')
  await again.press({ key: 'vh-fold-other' })
  await again.unmount()
  const opened = await tasksOn($)
  expect(opened).toMatch(/^Tasks from "rmguney\.github\.io" · 2 running$/m)
  expect(opened).toMatch(/^Map the API · Snoop · running · Grep: route$/m)
  expect((store.get('session:mine') as { name?: string } | undefined)?.name).toBe('Clawd plugin')

  // and in the terminal, its heading is a button that folds it again; a pane
  // tall enough to show the whole list
  const term = await $.ui.mount({ plugin: 'vibehaus', surface: 'terminal', component: 'Pane', requestId: 'vibehaus', props: { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 90 } } })
  expect(await term.find({ type: 'Text', text: /Snoop · running · Grep: route/ })).toBeDefined()
  await term.press({ key: 'vh-fold-other' })
  expect(await term.find({ type: 'Text', text: /Snoop · running · Grep: route/ })).toBeUndefined()
  await term.unmount()
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
    const tasks = await tasksOn($)
    return {
      tasks,
      house: pics.find(p => p.props.alt.startsWith('Vibehaus'))?.props.source ?? '',
      agents: pics.filter(p => p.props.alt === 'The agents in the house').map(p => p.props.source).join(''),
    }
  }
  let seen = await look()
  expect(seen.tasks).toMatch(/^Tasks from "rmguney\.github\.io" · 1 running · folded$/m)
  // the cook in its toque, and its session's box taped in its colour
  expect(seen.agents).toMatch(/id="hat-Cook"/)
  expect(seen.house).toMatch(/\.yt[0-9a-f]{6}\{fill/)

  // its session goes: off the list at once, and walking out to the street
  store.delete('session:other')
  await clock.advance(3500)
  seen = await look()
  expect(seen.tasks).not.toMatch(/rmguney\.github\.io/)
  expect(seen.agents).toMatch(/id="hat-Cook"/)
  // gone once it reaches the end of the road
  await clock.advance(30000)
  seen = await look()
  expect(seen.agents).not.toMatch(/id="hat-Cook"/)
})
