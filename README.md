# Vibehaus

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/media/vibehaus-night.gif">
  <img src=".github/media/vibehaus-day.gif" width="100%" alt="Clawds working, napping and chatting in a cozy isometric pixel house in an autumn garden, with plan usage bars in the corner">
</picture>

A cozy pixel house for your Claude Code agents. Your lead agent, subagents and background tasks live in an isometric house in an autumn garden as Clawds: they work at desks in the room for each kind of job, carry a box out to the mailbox when they finish, and nap, read, watch TV or goof about when idle.

> Work in progress. Built on Claude Code's function hooks, which are early access and may change.

## What it shows

<img src=".github/media/vibehaus-tall.gif" alt="The house at night in a tall docked pane, with the tasks list under it" width="220" align="right">

- **A room for each kind of work**: library (reading, search), study (the lead), sunroom (web), kitchen (shell), workshop (edits) and a bedroom lounge. Desk screens follow the tool in use; a permission prompt raises an amber tag.
- **Roles, with hats**: the lead is the Host in a crown, Explore agents are Snoops in deerstalkers, Plan agents the Schemer in a wizard's hat, general-purpose agents Handymen in hard hats; shells are Cooks in toques, monitors the Neighbor in a sun hat, workflows the Butler in a top hat.
- **Shipping**: each finished task walks out the front door with a box and stacks it on the pallets by the mailbox, where the day's boxes from every session pile up.
- **Your other sessions** move in too: their agents walk in from the street and leave the same way. Each session has its own colour on rings at the feet, box tape and names, and its own section of the tasks list under the session's title.
- **Hover cards** for every agent in the house, and **plan bars** (five-hour and weekly) in the corner.
- **The tasks list** under the house, synced with Claude Code's background tasks: a section for each session, the others' folded to their name until a click opens them. First the Host's line, drawn as the chat draws its own while Claude works (the spinner, the step under a glimmer, how long it has run), then every subagent, shell, monitor and workflow with its state, running time and tokens, and a **■** that stops it.
- Light mode is a sunny day, dark mode a lamplit night.

<br clear="right">

## In a terminal

<img src=".github/media/vibehaus-terminal.gif" alt="The house in a terminal: a floor plan of six rooms with their furniture, Clawds working and walking, the yard by the front door, the tasks list under it" width="300" align="right">

A terminal can't show the picture, so there the house is drawn as a floor plan from above, in the terminal's own character cells, and stays crisp at any size.

- **Turned to fit a docked pane**: the plan is rotated a quarter turn, so the rooms run down the pane in two columns, with the yard and front door at the side.
- **The same rooms and furniture**: each room is a box with its name over it, holding what the picture has: desks and their screens, bookshelves, the fireplace, the fridge and stove, the workbench, beds, the TV and the couch. Desk screens change colour with the tool in use.
- **Every agent is a Clawd**, drawn the way Claude Code draws its own, with its role written under it. They walk from room to room as they do on the desktop, while fires, screens and lights flicker.
- **The yard** holds the day's boxes by the mailbox, and the **plan bars** run along the top.
- **The tasks list** sits under the house in plain text, row for row the same as the desktop's, its spinners and the Host's line repainted as Claude Code repaints its own. Hover a Clawd for its card; click a session's name to fold its section, or **■** to stop a task.

<br clear="right">

## Install

```
/plugin install vibehaus --marketplace rmguney/vibehaus
```

Needs Claude Code 2.1.295 or later, in the terminal or the desktop Code tab.

## Use

- It opens when a session starts (in a terminal 144 columns wide or more); `/haus` opens it anywhere.
- `/haus demo` moves a made-up household in for five minutes; run it again to send them home.
- `/haus snapshot` saves the house as `vibehaus-snapshot.svg`, an animated SVG, in the session's folder.
- **◧ Vibehaus** in the prompt footer opens or closes it.
- The house stays put over the tasks list. On the desktop the list shows a page at a time, turned by **◂** and **▸** at the bottom; in a terminal it scrolls by the mouse wheel or the scroll keys, a scrollbar beside it showing where it stands.
- A click on a session's name folds or opens its section; other sessions' start folded. **■** beside a running subagent or background task of this session stops it.

## Privacy and permissions

- **What it sends**: nothing. It contacts no host and never uses your sign-in: the plan bars show Claude Code's own last reading of your five-hour and weekly windows.
- **What it writes**: `vibehaus-snapshot.svg` in the session's folder, over the last one, only when you run `/haus snapshot`. Besides that only Claude Code's local plugin store, where your sessions share their households (names, roles, rooms and what each is doing), the Host's token counts and when each box shipped.
- **What it runs**: only what you press. **■** beside a running subagent or background task calls Claude Code's own `TaskStop` tool for that task, through Claude Code's usual permission check. `TaskStop` only ever gets the id of the task whose **■** you pressed. It calls no other tool, runs no commands or processes and starts no agents. It adds the `/haus` command and answers only that one.
- **What its hooks do**: they watch, and pass everything on unchanged.
  - Tool calls put each agent in the room for its tool and pick up the background tasks it starts. The call and its result go on as they were.
  - Agents starting, turns starting and ending, and model requests move agents in and out and count each one's tokens.
  - The session's rows give background tasks' end notices.
  - The classic `Stop` and `SubagentStop` events sync the list with Claude Code's own list of background work. `SessionStart` and `UserPromptSubmit` give the session's title.
  - Claude Code's notification of a permission prompt raises the amber tag over the agent that asks. The plugin hooks no permission check: the prompt and your decision are untouched.
  - It draws its own pane, and the prompt footer's mode labels with the ◧ Vibehaus button beside them. The wheel and scroll keys it answers are only its own pane's.
- It reads no credentials, environment variables or files, and depends on no other plugin. Like every mod it is not sandboxed; the source is plain TypeScript in `vibehaus/hooks/`.

## Develop

```
claude --plugin-dir vibehaus
node tests/run.mjs
claude plugin validate --strict .
claude plugin validate --strict vibehaus
```

The tests sit in `tests/`, outside the plugin, so they are not installed with it; `tests/run.mjs` runs them in a copy of the plugin.

## License

MIT, see [LICENSE](LICENSE). Clawd, the Claude Code mascot, and the Claude and Claude Code names are Anthropic's. Vibehaus is an unofficial fan project, not affiliated with or endorsed by Anthropic.
