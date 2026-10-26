#!/usr/bin/env node

import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { deployAgentSkills, type AgentRuntime } from './lib/agent-skills.ts'

const usage = `Usage:
  node --experimental-strip-types deploy.ts --all [--force]
  node --experimental-strip-types deploy.ts --claude [--check] [--force]
  node --experimental-strip-types deploy.ts --codex [--force]
  node --experimental-strip-types deploy.ts --copilot [--force]

Options:
  --all       Deploy to Claude Code, Codex, and Copilot
  --claude    Deploy to Claude Code
  --codex     Deploy to Codex
  --copilot   Deploy to Copilot
  --check     Check Claude Code drift without changing files
  --force     Replace managed skill content despite detected drift
  --help      Show this help
`

function parseCliArgs(argv: string[]) {
  const options = {
    all: { type: 'boolean', default: false },
    claude: { type: 'boolean', default: false },
    codex: { type: 'boolean', default: false },
    copilot: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  } as const

  return parseArgs({
    args: argv,
    options,
    allowPositionals: false,
    strict: true,
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function main() {
  let parsed
  try {
    parsed = parseCliArgs(process.argv.slice(2))
  } catch (error) {
    console.error(errorMessage(error))
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

  const runtimes: AgentRuntime[] = []
  if (values.all) {
    runtimes.push('copilot', 'claude', 'codex')
  } else {
    if (values.copilot) runtimes.push('copilot')
    if (values.claude) runtimes.push('claude')
    if (values.codex) runtimes.push('codex')
  }

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

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
