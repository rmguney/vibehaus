// What an agent is doing, which picks the room it works in.
export type Room = 'study' | 'library' | 'workshop' | 'kitchen' | 'sunroom' | 'lounge'
// Where someone can stand: a room, or out in the front yard.
export type Place = Room | 'yard'

export type ResidentStatus = 'working' | 'waiting' | 'idle' | 'done'

export type Resident = {
  id: string
  name: string
  kind: string
  room: Room
  movedAt: number
  status: ResidentStatus
  activity: string
  isBackground?: boolean
  // the tool in hand, which picks what its desk screen shows
  tool?: string
  // when its last tool call came back, and whether it went well
  resultAt?: number
  isOk?: boolean
  spawnedAt?: number
  // the room the lead stood in when this agent was handed its task
  spawnRoom?: Room
  doneAt?: number
  // when it last went idle (its idle routine starts there) and last started work
  idleSince?: number
  workSince?: number
  // where it stood when its plan last changed: the next plan starts here, so
  // nobody jumps; `key` names the house it was taken in, so a spot from an
  // older build of the house is not used
  anchor?: { t: number; x: number; y: number; room: Place; key: string }
  // its desk in its room while it works, kept until it leaves the room
  seat?: number
  // as the engine's background tasks name it: `subagent`, `shell`, `monitor`,
  // `workflow` or another kind, and its status there (`running`, `completed`)
  taskType?: string
  taskStatus?: string
  // a workflow's agent or a teammate: the engine lists neither as a subagent
  isWorkflow?: boolean
  isTeammate?: boolean
  // the tool a permission prompt is asking about
  waitingTool?: string
  // its last few tool calls, for how hot its desk runs
  calls?: number[]
  // the lead's context window use, in percent
  context?: number
  // finished and carrying its box out to the pallets by the mailbox: `box`
  // is how many boxes the yard held when it set out, which picks its pallet
  carrying?: boolean
  box?: number
  // part of `/haus demo`'s made-up household, never real work
  isDemo?: boolean
  // another session's member, moved in from the shared store: that session's
  // id (the member's own id is prefixed with it)
  session?: string
  // such a visitor on its way in from the street (when it steps onto the
  // road) or back out to it (since when its session let it go); this
  // house's own, never shared
  arriving?: number
  leaving?: number
  // tokens its turns used, as flat pairs: time, tokens, time, tokens...
  // (the last week only; the lead's carry across sessions)
  usage?: number[]
  // a background task gone from the engine's list: when it went, so a late
  // notice of how it really ended can still name the end
  endingSince?: number
}

// The plan's five-hour and weekly windows in percent, for the vibe fatigue
// band (and the bars in the house's corner where there is no band); a window
// with no reading is left out.
export type PlanUse = { fiveHour?: number; week?: number }

// One agent's walk across the house as plain data, replayed to place its hover
// zone: when its timeline starts (clock ms), how long it runs (s), whether it
// loops, and its key points as flat [t, x, y, t, x, y...] in the picture's
// units. `shown`: a visitor's stretch in sight (s), from the road on its way
// in until the road's end on its way out.
export type Track = { id: string; t0: number; total: number; isLoop: boolean; keys: number[]; shown?: [number, number] }


declare module 'claude-code' {
  interface PluginState {
    'vibehaus': { residents: Resident[]; plan: PlanUse }
  }
}
