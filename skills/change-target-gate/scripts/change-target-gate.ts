#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

type Candidate = { path: string; score: number }
type Policy = {
  version: number
  repository: string
  defaultBranch: string
  allowedRepositories: string[]
}
type ManifestTarget = { repository: string; path: string; operation: string }
type Manifest = {
  version: number
  repository: string
  base?: string
  targets: ManifestTarget[]
  allowedChangedPaths?: string[]
}
type VerifyResult = {
  ok: boolean
  repository: string | null
  base: string
  changed: string[]
  errors: string[]
}

const usage = `Usage:
  change-target-gate discover --repo <path> --query <terms>
  change-target-gate verify --policy <path> --manifest <path> [--base <ref>]

Options:
  -h, --help  Show this help
`

const options = {
  repo: { type: 'string' },
  query: { type: 'string' },
  policy: { type: 'string' },
  manifest: { type: 'string' },
  base: { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown) => {
      return typeof item === 'string'
    })
  )
}

function isPolicy(value: unknown): value is Policy {
  return (
    isRecord(value) &&
    typeof value.version === 'number' &&
    typeof value.repository === 'string' &&
    typeof value.defaultBranch === 'string' &&
    isStringArray(value.allowedRepositories)
  )
}

function isManifestTarget(value: unknown): value is ManifestTarget {
  return (
    isRecord(value) &&
    typeof value.repository === 'string' &&
    typeof value.path === 'string' &&
    typeof value.operation === 'string'
  )
}

function isManifest(value: unknown): value is Manifest {
  if (!isRecord(value)) return false
  if (
    typeof value.version !== 'number' ||
    typeof value.repository !== 'string' ||
    (value.base !== undefined && typeof value.base !== 'string') ||
    !Array.isArray(value.targets) ||
    !value.targets.every(isManifestTarget)
  )
    return false
  return value.allowedChangedPaths === undefined || isStringArray(value.allowedChangedPaths)
}

function fail(code: number, errors: string[]) {
  process.stderr.write(JSON.stringify({ ok: false, errors }, null, 2) + '\n')
  process.exitCode = code
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function git(args: string[], cwd: string) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error: unknown) {
    let detail = errorMessage(error)
    if (error instanceof Error && 'stderr' in error) {
      const stderr = error.stderr
      if (typeof stderr === 'string') detail = stderr.trim() || detail
      else if (Buffer.isBuffer(stderr)) detail = stderr.toString().trim() || detail
    }
    throw new Error(`git ${args.join(' ')}: ${detail}`)
  }
}

function parseCliArgs(argv: string[]) {
  return parseArgs({
    args: argv,
    options,
    allowPositionals: true,
    strict: true,
  })
}

function readJson(path: string) {
  const parsed: unknown = JSON.parse(readFileSync(resolve(path), 'utf8'))
  if (!isRecord(parsed)) throw new Error(`JSON value must be an object: ${path}`)
  return parsed
}

function readPolicy(path: string) {
  const parsed = readJson(path)
  if (!isPolicy(parsed)) throw new Error(`invalid change-target policy: ${path}`)
  return parsed
}

function readManifest(path: string) {
  const parsed = readJson(path)
  if (!isManifest(parsed)) throw new Error(`invalid change-target manifest: ${path}`)
  return parsed
}

function canonicalRepository(url: string) {
  const value = url.trim().replace(/\.git$/, '')
  const scp = value.match(/^git@([^:]+):(.+)$/)
  if (scp) {
    const host = scp[1]
    const path = scp[2]
    if (host && path) return host === 'github.com' ? path : `${host}/${path}`
  }
  try {
    const parsed = new URL(value)
    const path = parsed.pathname.replace(/^\/+/, '')
    return parsed.hostname === 'github.com' ? path : `${parsed.hostname}/${path}`
  } catch {
    return value
  }
}

function repositoryForRepo(repo: string) {
  try {
    return canonicalRepository(git(['remote', 'get-url', 'origin'], repo))
  } catch {
    return null
  }
}

function existsAtRef(cwd: string, ref: string, path: string) {
  try {
    git(['cat-file', '-e', `${ref}:${path}`], cwd)
    return true
  } catch {
    return false
  }
}

function validateRelativePath(path: string) {
  const normalized = path.replaceAll('\\', '/')
  return (
    normalized !== '' &&
    !normalized.startsWith('/') &&
    normalized !== '..' &&
    !normalized.startsWith('../') &&
    !normalized.includes('/../')
  )
}

function discover(repo: string, query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const candidates: Candidate[] = []
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name === 'SKILL.md') {
        const rel = relative(repo, path).replaceAll('\\', '/')
        const content = readFileSync(path, 'utf8').toLowerCase()
        const score = terms.reduce((sum, term) => {
          return sum + (rel.toLowerCase().includes(term) ? 3 : 0) + (content.includes(term) ? 1 : 0)
        }, 0)
        if (score > 0) candidates.push({ path: rel, score })
      }
    }
  }
  walk(repo)
  return candidates.sort((a, b) => {
    return b.score - a.score || a.path.localeCompare(b.path)
  })
}

function verify(repo: string, policyPath: string, manifestPath: string, baseOverride?: string) {
  const policy = readPolicy(policyPath)
  const manifest = readManifest(manifestPath)
  const errors: string[] = []
  if (policy.version !== 1 || manifest.version !== 1)
    errors.push('unsupported manifest or policy version')

  const remote = repositoryForRepo(repo)
  if (!remote) errors.push('origin repository is unavailable')
  else {
    if (remote !== policy.repository)
      errors.push(`origin repository mismatch: expected ${policy.repository}, observed ${remote}`)
    if (!policy.allowedRepositories.includes(remote))
      errors.push(`repository is not allowlisted: ${remote}`)
    if (manifest.repository !== remote)
      errors.push(
        `manifest repository mismatch: expected ${remote}, observed ${manifest.repository}`,
      )
  }

  const base = baseOverride || manifest.base || `origin/${policy.defaultBranch}`
  try {
    git(['rev-parse', '--verify', base], repo)
  } catch {
    errors.push(`base ref is not resolvable: ${base}`)
  }

  const targets = manifest.targets
  if (targets.length === 0) errors.push('manifest has no targets')
  const allowed = new Set(
    manifest.allowedChangedPaths ??
      targets.map((target) => {
        return target.path
      }),
  )
  for (const target of targets) {
    if (!validateRelativePath(target.path)) errors.push(`invalid target path: ${target.path}`)
    if (target.repository !== remote)
      errors.push(`target repository mismatch for ${target.path}: ${target.repository}`)
    if (target.operation !== 'patch' && target.operation !== 'create') {
      errors.push(`invalid operation for ${target.path}: ${target.operation}`)
    }
    if (target.operation === 'patch' && existsAtRef(repo, base, target.path) === false) {
      errors.push(`patch target does not exist at ${base}: ${target.path}`)
    }
    if (target.operation === 'create' && existsAtRef(repo, base, target.path)) {
      errors.push(`create target already exists at ${base}: ${target.path}`)
    }
  }

  let changed: string[] = []
  try {
    const tracked = git(['diff', '--name-only', base], repo).split('\n').filter(Boolean)
    const untracked = git(['ls-files', '--others', '--exclude-standard'], repo)
      .split('\n')
      .filter(Boolean)
    changed = [...new Set([...tracked, ...untracked])].sort()
  } catch {
    errors.push(`unable to inspect working tree against ${base}`)
  }
  if (changed.length === 0) errors.push(`no changed files found against ${base}`)
  for (const path of changed) {
    if (!allowed.has(path)) errors.push(`changed path is outside manifest scope: ${path}`)
  }

  const result: VerifyResult = {
    ok: errors.length === 0,
    repository: remote,
    base,
    changed,
    errors,
  }
  return result
}

async function main() {
  const { values, positionals } = parseCliArgs(process.argv.slice(2))
  if (positionals.length > 1)
    return fail(2, [`unexpected positional arguments: ${positionals.slice(1).join(' ')}`])
  const command = positionals[0]
  if (!command || values.help) {
    process.stdout.write(usage)
    return
  }
  if (command === 'discover') {
    const repo = resolve(values.repo || '.')
    if (!existsSync(repo) || !statSync(repo).isDirectory())
      throw new Error(`repo does not exist: ${repo}`)
    const repository = repositoryForRepo(repo)
    process.stdout.write(
      JSON.stringify(
        { ok: true, repository, candidates: discover(repo, values.query || '') },
        null,
        2,
      ) + '\n',
    )
    return
  }
  if (command === 'verify') {
    const repo = resolve(values.repo || '.')
    if (!values.policy) return fail(2, ['--policy is required'])
    if (!values.manifest) return fail(2, ['--manifest is required'])
    const result = verify(repo, values.policy, values.manifest, values.base)
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    if (!result.ok) process.exitCode = 1
    return
  }
  return fail(2, [`unknown command: ${command}`])
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    return fail(2, [errorMessage(error)])
  })
}

export { canonicalRepository, discover, verify }
