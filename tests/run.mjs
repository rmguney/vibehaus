// Runs the tests inside a copy of the plugin, where `claude plugin test` looks, so they never ship with it.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const work = mkdtempSync(join(tmpdir(), 'vibehaus-test-'))
const plugin = join(work, 'vibehaus')
let status = 1
try {
  cpSync(join(here, '..', 'vibehaus'), plugin, { recursive: true })
  mkdirSync(join(plugin, 'tests'))
  for (const name of readdirSync(here).filter(n => /\.test\.tsx?$/.test(n))) {
    writeFileSync(join(plugin, 'tests', name), readFileSync(join(here, name), 'utf8').replaceAll("'../vibehaus/", "'../"))
  }
  // no shell, so the copy's path reaches Claude Code unchanged
  let run = spawnSync('claude', ['plugin', 'test', plugin], { stdio: 'inherit' })
  // a Windows npm install is claude.cmd, which only cmd runs: path quoted, refused if cmd would misread it
  if (run.error?.code === 'ENOENT' && process.platform === 'win32' && !/["%^&|<>]/.test(plugin)) {
    run = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"claude.cmd plugin test "${plugin}""`], { stdio: 'inherit', windowsVerbatimArguments: true })
  }
  if (run.error) console.error(`could not run claude: ${run.error.message}`)
  status = run.status ?? 1
} finally {
  rmSync(work, { recursive: true, force: true })
}
process.exit(status)
