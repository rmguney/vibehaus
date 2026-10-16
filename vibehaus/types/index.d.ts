// What an agent is doing, which picks the room it works in.
export type Room = 'study' | 'library' | 'workshop' | 'kitchen' | 'sunroom' | 'lounge'
// Where someone can stand: a room or the front yard.
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
  // the tool in hand; picks its desk screen
  tool?: string
  // when its last tool call returned, and if it went well
  resultAt?: number
  isOk?: boolean
  spawnedAt?: number
  // the lead's room when this agent got its task
  spawnRoom?: Room
  doneAt?: number
  // when it last went idle (starting its idle routine) and last started work
  idleSince?: number
  workSince?: number
  // where it stood at its last plan change, so the next starts there; `key`: the house build it is from
  anchor?: { t: number; x: number; y: number; room: Place; key: string }
  // its desk while working, kept until it leaves the room
  seat?: number
  // engine task kind (`subagent`, `shell`, `monitor`, `workflow`...) and status (`running`, `completed`...)
  taskType?: string
  taskStatus?: string
  // a workflow's agent or a teammate: the engine lists neither as a subagent
  isWorkflow?: boolean
  isTeammate?: boolean
  // the tool a permission prompt asks about
  waitingTool?: string
  // its last few tool calls, for how hot its desk runs
  calls?: number[]
  // the lead's context window use, in percent
  context?: number
  // finished, carrying its box to the pallets; `box`: the yard's count then, which picks its pallet
  carrying?: boolean
  box?: number
  // part of `/haus demo`'s made-up household, never real work
  isDemo?: boolean
  // another session's member: that session's id (also its own id's prefix)
  session?: string
  // when such a visitor steps onto the road coming in, or was let go; never shared
  arriving?: number
  leaving?: number
  // tokens used, as flat time, tokens pairs; the last week only, the lead's across sessions
  usage?: number[]
  // when a background task left the engine's list, so a late end notice still applies
  endingSince?: number
}

// The plan's five-hour and weekly use (%) and resets (clock ms), for the vibe fatigue band or corner
// bars: the newest reading any session took, `at` when; windows without one are left out.
export type PlanUse = { at?: number; fiveHour?: number; fiveHourResets?: number; week?: number; weekResets?: number }

// One agent's walk, replayed to place its hover zone: start (clock ms), length (s), whether it loops,
// keys as flat [t, x, y...] in picture units. `shown`: a visitor's time in sight (s), road to road's end.
export type Track = { id: string; t0: number; total: number; isLoop: boolean; keys: number[]; shown?: [number, number] }


declare module 'claude-code' {
  interface PluginState {
    // `minute`: the clock at the last minute tick, counting the band's resets down
    'vibehaus': { residents: Resident[]; plan: PlanUse; minute: number }
  }
}
