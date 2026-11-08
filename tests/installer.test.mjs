import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { SOURCES, URL_FORK, creerBac, lancer } from './helpers.mjs'

const CALE_ORCA = `#!/bin/bash
echo "$*" >>"$HOME/orca.log"
fichier="$HOME/automations.json"
case "$1 $2" in
  "automations list") if [[ -f "$fichier" ]]; then cat "$fichier"; else echo '{"result":{"automations":[]}}'; fi ;;
  "automations create") echo '{"result":{"automations":[{"id":"id-1","name":"Fork Orca : greffe après mise à jour"}]}}' >"$fichier" ;;
esac
`

describe('installer-robot.sh', () => {
  let bac
  const installer = (...args) => lancer(bac, join(SOURCES, 'installer-robot.sh'), ...args)
  const journalOrca = () => readFileSync(join(bac.home, 'orca.log'), 'utf8')
  beforeEach(() => {
    bac = creerBac()
    const cale = join(bac.racine, 'cales/orca')
    writeFileSync(cale, CALE_ORCA)
    chmodSync(cale, 0o755)
    bac.env.ORCA_CLI_COMMAND = cale
  })
  afterEach(() => bac.nettoyer())

  it('écrit la cible, clone le robot et crée l’automatisation', () => {
    const r = installer(URL_FORK, 'perso')
    assert.equal(r.status, 0, r.stderr)
    assert.equal(readFileSync(join(bac.config, 'cible'), 'utf8'), `${URL_FORK} perso\n`)
    assert.ok(existsSync(join(bac.reserve, 'robot.sh')))
    const log = journalOrca()
    assert.match(log, /automations create/)
    assert.match(log, /\.local\/share\/orca-robot\/robot\.sh/)
    assert.match(log, /--trigger \*\/15 \* \* \* \*/)
    assert.match(log, new RegExp(`${URL_FORK}, branche perso`))
    assert.doesNotMatch(log, /fork\/robot\.sh/)
  })

  it('une deuxième installation modifie la même automatisation', () => {
    assert.equal(installer(URL_FORK, 'perso').status, 0)
    const r = installer(URL_FORK, 'perso')
    assert.equal(r.status, 0, r.stderr)
    const log = journalOrca()
    assert.equal(log.match(/automations create/g).length, 1)
    assert.match(log, /automations edit id-1 /)
    assert.match(log, /--precheck-timeout 120/)
  })

  it('refuse une cible invalide sans rien écrire', () => {
    assert.notEqual(installer('http://github.com/a/b.git', 'perso').status, 0)
    assert.equal(existsSync(join(bac.config, 'cible')), false)
    assert.equal(existsSync(bac.reserve), false)
  })

  it('épingle : écrit le fichier et place le clone sur ce commit', () => {
    const sha = bac.git('-C', bac.nu('robot'), 'rev-parse', 'refs/heads/main')
    bac.avancerRobot()
    const r = installer(URL_FORK, 'pro', '--epingle', sha)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(readFileSync(join(bac.config, 'epingle'), 'utf8'), `${sha}\n`)
    assert.equal(bac.teteReserve(), sha)
  })

  it('refuse une épingle au mauvais format', () => {
    assert.notEqual(installer(URL_FORK, 'pro', '--epingle', 'main').status, 0)
    assert.equal(existsSync(join(bac.config, 'epingle')), false)
  })

  it('espace de travail de réparation réglable', () => {
    const r = installer(URL_FORK, 'pro', '--espace', '/chemin/du/clone')
    assert.equal(r.status, 0, r.stderr)
    assert.match(journalOrca(), /--workspace path:\/chemin\/du\/clone/)
  })

  it('n’installe rien pendant un travail', () => {
    mkdirSync(join(bac.etat, 'travail.verrou'), { recursive: true })
    writeFileSync(join(bac.etat, 'travail.verrou/pid'), `${process.pid}`)
    assert.notEqual(installer(URL_FORK, 'perso').status, 0)
    assert.equal(existsSync(join(bac.config, 'cible')), false)
  })
})
