import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function runTypeScriptCli(path: string, args: string[]) {
  return execFileSync(process.execPath, ['--experimental-strip-types', path, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
}

test('deployment CLI runs directly as TypeScript', () => {
  const output = runTypeScriptCli(resolve(repositoryRoot, 'deploy.ts'), ['--help'])
  assert.match(output, /Usage:/)
})

test('change-target-gate CLI runs directly as TypeScript', () => {
  const output = runTypeScriptCli(
    resolve(repositoryRoot, 'skills/change-target-gate/scripts/change-target-gate.ts'),
    ['--help'],
  )
  assert.match(output, /Usage:/)
})
