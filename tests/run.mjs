// Runs the tests the way `claude plugin test` reads them, from inside the
// plugin, in a copy of it: the tests stay out of the plugin itself, so they
// are not shipped with it.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const work = mkdtempSync(join(tmpdir(), 'vibehaus-test-'))
const plugin = join(work, 'vibehaus')
cpSync(join(here, '..', 'vibehaus'), plugin, { recursive: true })
mkdirSync(join(plugin, 'tests'))
for (const name of readdirSync(here).filter(n => /\.test\.tsx?$/.test(n))) {
  writeFileSync(join(plugin, 'tests', name), readFileSync(join(here, name), 'utf8').replaceAll("'../vibehaus/", "'../"))
}
const run = spawnSync(`claude plugin test "${plugin}"`, { shell: true, stdio: 'inherit' })
rmSync(work, { recursive: true, force: true })
process.exit(run.status ?? 1)
