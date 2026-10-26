#!/usr/bin/env node

import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { deployAgentSkills } from './lib/agent-skills.mjs'

const usage = `Usage:
  node deploy.mjs --all [--force]
  node deploy.mjs --claude [--check] [--force]
  node deploy.mjs --codex [--force]
  node deploy.mjs --copilot [--force]

Options:
  --all       Deploy to Claude Code, Codex, and Copilot
  --claude    Deploy to Claude Code
  --codex     Deploy to Codex
  --copilot   Deploy to Copilot
  --check     Check Claude Code drift without changing files
  --force     Replace managed skill content despite detected drift
  --help      Show this help
`

function parseCliArgs(argv) {
  return parseArgs({
    args: argv,
    options: {
      all: { type: 'boolean', default: false },
      claude: { type: 'boolean', default: false },
      codex: { type: 'boolean', default: false },
      copilot: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
    strict: true,
  })
}

async function main() {
  let parsed
  try {
    parsed = parseCliArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    console.error(usage)
    process.exitCode = 2
    return
  }

  const { values } = parsed
  if (values.help) {
    process.stdout.write(usage)
    return
  }

  if (values.check && !values.claude) {
    console.error('--check is only supported with --claude')
    console.error(usage)
    process.exitCode = 2
    return
  }

  const runtimes = values.all
    ? ['copilot', 'claude', 'codex']
    : [
        values.copilot && 'copilot',
        values.claude && 'claude',
        values.codex && 'codex',
      ].filter(Boolean)

  if (runtimes.length === 0) {
    console.error('Select --all or at least one runtime')
    console.error(usage)
    process.exitCode = 2
    return
  }

  const root = dirname(fileURLToPath(import.meta.url))
  const ok = await deployAgentSkills({
    sourceDir: join(root, 'skills'),
    homeDir: homedir(),
    runtimes,
    force: values.force,
    check: values.check,
  })
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
