import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { it } from 'node:test'
import { SOURCES } from './helpers.mjs'

it('greffer.mjs sans --depot : message lisible, sortie en erreur', () => {
  const r = spawnSync(
    process.execPath,
    [join(SOURCES, 'greffer.mjs'), '--app', '/x', '--version', '1.0.0', '--commit', 'abc'],
    { encoding: 'utf8' }
  )
  assert.equal(r.status, 1)
  assert.match(r.stderr, /--depot manquant/)
  assert.doesNotMatch(r.stderr, /ReferenceError|at file:/)
})
