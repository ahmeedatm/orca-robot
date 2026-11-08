// Banc d'essai : vrai git, HOME temporaire, et github.com redirigé vers des dépôts locaux (url.<local>.insteadOf).
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export const SOURCES = join(dirname(new URL(import.meta.url).pathname), '..')
export const URL_FORK = 'https://github.com/moi/fork.git'
export const FICHIERS_ROBOT = ['robot.sh', 'greffer.mjs', 'installer-robot.sh']
const URL_AMONT = 'https://github.com/stablyai/orca.git'
const URL_ROBOT = 'https://github.com/ahmeedatm/orca-robot.git'

export function creerBac() {
  const racine = realpathSync(mkdtempSync(join(tmpdir(), 'orca-robot-test-')))
  const home = join(racine, 'home')
  const cales = join(racine, 'cales')
  mkdirSync(home)
  mkdirSync(cales)
  writeFileSync(join(cales, 'osascript'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(cales, 'osascript'), 0o755)
  const app = join(racine, 'Orca.app')
  const env = {
    HOME: home,
    PATH: `${cales}:${process.env.PATH}`,
    GIT_CONFIG_NOSYSTEM: '1',
    ORCA_FORK_APP: app
  }
  const git = (...args) =>
    execFileSync('git', args, { env, encoding: 'utf8', stdio: 'pipe', cwd: racine }).trim()
  const nu = (nom) => join(racine, `${nom}.git`)

  const reglages = {
    'user.name': 'Banc',
    'user.email': 'banc@example.invalid',
    'init.defaultBranch': 'main',
    'protocol.file.allow': 'always',
    [`url.file://${nu('fork')}.insteadOf`]: URL_FORK,
    [`url.file://${nu('amont')}.insteadOf`]: URL_AMONT,
    [`url.file://${nu('robot')}.insteadOf`]: URL_ROBOT
  }
  for (const [cle, valeur] of Object.entries(reglages)) {
    git('config', '--file', join(home, '.gitconfig'), cle, valeur)
  }

  const validerFichier = (depot, nom, contenu, message) => {
    writeFileSync(join(depot, nom), contenu)
    git('-C', depot, 'add', '-A')
    git('-C', depot, 'commit', '-q', '-m', message)
    return git('-C', depot, 'rev-parse', 'HEAD')
  }
  const publier = (depot, nom) => {
    git('clone', '-q', '--bare', depot, nu(nom))
    git('-C', nu(nom), 'config', 'uploadpack.allowFilter', 'true')
    git('-C', nu(nom), 'config', 'uploadpack.allowAnySHA1InWant', 'true')
  }

  const amont = join(racine, 'amont')
  git('init', '-q', amont)
  validerFichier(amont, 'a.txt', 'a\n', 'release: v1.4.249')
  git('-C', amont, 'tag', 'v1.4.249')
  validerFichier(amont, 'b.txt', 'b\n', 'release: v1.4.250')
  git('-C', amont, 'tag', 'v1.4.250')
  publier(amont, 'amont')
  publier(amont, 'fork')

  const travailFork = join(racine, 'fork-travail')
  git('clone', '-q', nu('amont'), travailFork)
  git('-C', travailFork, 'switch', '-q', '-c', 'perso', 'v1.4.249')

  const travailRobot = join(racine, 'robot-travail')
  git('init', '-q', travailRobot)
  for (const fichier of FICHIERS_ROBOT) {
    cpSync(join(SOURCES, fichier), join(travailRobot, fichier))
  }
  git('-C', travailRobot, 'add', '-A')
  git('-C', travailRobot, 'commit', '-q', '-m', 'robot')
  publier(travailRobot, 'robot')

  const reserve = join(home, '.local/share/orca-robot')
  const etat = join(home, 'Library/Logs/orca-fork')
  const config = join(home, '.config/orca-robot')

  const bac = {
    racine,
    home,
    app,
    env,
    git,
    nu,
    reserve,
    etat,
    config,
    journal: () => {
      const chemin = join(etat, 'robot.log')
      return existsSync(chemin) ? readFileSync(chemin, 'utf8') : ''
    },
    echec: () => {
      const chemin = join(etat, 'echec')
      return existsSync(chemin) ? readFileSync(chemin, 'utf8') : null
    },
    // contenu du commit ajouté à la branche perso ; fichier en conflit possible avec l'amont
    publierFork(fichier = 'ajout.txt', contenu = 'ajout\n') {
      validerFichier(travailFork, fichier, contenu, 'feat: ajout')
      git('-C', travailFork, 'push', '-q', nu('fork'), 'perso')
      return git('-C', travailFork, 'rev-parse', 'HEAD')
    },
    cible(ligne = `${URL_FORK} perso`) {
      mkdirSync(config, { recursive: true })
      writeFileSync(join(config, 'cible'), `${ligne}\n`)
    },
    epingle(contenu) {
      mkdirSync(config, { recursive: true })
      writeFileSync(join(config, 'epingle'), `${contenu}\n`)
    },
    installerApp(version = '1.4.250', repere = {}) {
      const contenus = join(app, 'Contents')
      mkdirSync(join(contenus, 'Resources'), { recursive: true })
      const plist = join(contenus, 'Info.plist')
      rmSync(plist, { force: true })
      execFileSync('/usr/libexec/PlistBuddy', [
        '-c',
        `Add :CFBundleShortVersionString string ${version}`,
        plist
      ])
      writeFileSync(join(contenus, 'Resources/orca-fork.json'), JSON.stringify(repere))
    },
    clonerReserve() {
      git('clone', '-q', URL_ROBOT, reserve)
      return git('-C', reserve, 'rev-parse', 'HEAD')
    },
    // Par défaut le vrai robot plus une ligne : un clone mis à jour dessus continue de marcher.
    avancerRobot(contenu = `${readFileSync(join(SOURCES, 'robot.sh'), 'utf8')}\n# version suivante\n`) {
      const sha = validerFichier(travailRobot, 'robot.sh', contenu, 'maj')
      git('-C', travailRobot, 'push', '-q', nu('robot'), 'HEAD:refs/heads/main')
      return sha
    },
    teteReserve: () => git('-C', reserve, 'rev-parse', 'HEAD'),
    lireArgs: () => readFileSync(join(home, 'greffer-args'), 'utf8'),
    nettoyer: () => rmSync(racine, { recursive: true, force: true })
  }
  return bac
}

// Source robot.sh sans le lancer, puis exécute `corps` : permet de remplacer compiler(), node, git...
export function dansRobot(bac, corps, script = join(SOURCES, 'robot.sh')) {
  return spawnSync('/bin/bash', ['-c', `source "$1"\n${corps}`, 'banc', script], {
    env: bac.env,
    encoding: 'utf8'
  })
}

export function lancer(bac, chemin, ...args) {
  return spawnSync('/bin/bash', [chemin, ...args], { env: bac.env, encoding: 'utf8' })
}
