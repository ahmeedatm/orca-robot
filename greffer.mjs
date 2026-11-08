// Greffe sur place le JavaScript compilé du fork (out/) dans l'Orca officiel installé.
// Pourquoi une greffe et pas une app compilée maison : l'app officielle apporte tout le natif (Electron, helpers, orcad,
// computer use) signé par Apple, et garde ses mises à jour officielles. Le fork ne change que du JavaScript, rangé dans
// app.asar ; le robot (robot.sh) regreffe après chaque mise à jour.
// Pourquoi sur place : l'exécutable et Info.plist restent ceux d'Apple, donc macOS reconnaît toujours Orca (autorisations,
// trousseau « Orca Safe Storage »). Seul le sceau des ressources est rompu : une app déjà ouverte une fois démarre quand
// même, mais une copie neuve est refusée (« endommagé », vu le 2026-11-04). Possible parce que le fusible
// EnableEmbeddedAsarIntegrityValidation est éteint ; verifierFusible() s'arrête sinon.
// Pendant que l'app tourne : les anciens fichiers à nom haché sont gardés, une fenêtre ouverte peut encore les charger.
// Usage : node fork/greffer.mjs --app /Applications/Orca.app --version <x.y.z> --commit <sha>
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { parseArgs } from 'node:util'

const DEPOT = join(dirname(new URL(import.meta.url).pathname), '..')
const require = createRequire(join(DEPOT, 'package.json'))
const asar = require('@electron/asar')
const { FuseV1Options, getCurrentFuseWire } = require('@electron/fuses')
const minimatch = require(
  require.resolve('minimatch', { paths: [dirname(require.resolve('@electron/asar'))] })
)
const configBuild = require(join(DEPOT, 'config/electron-builder.config.cjs'))

const EXIGENCE_SIGNATURE = 'anchor apple generic and certificate leaf[subject.OU] = "6CX3WHS9HZ"' // Lovecast LLC
const REPERE_FORK = 'orca-fork.json' // lu par robot.sh pour savoir si la greffe est à jour
// Dossiers dont les noms de fichiers changent à chaque compilation (empreinte dans le nom).
const DOSSIERS_HACHES = ['out/renderer/assets/', 'out/main/chunks/']
// Version mobile : pas de changement du fork, et sa compilation demande la chaîne Expo ; on garde l'officielle.
const GARDE_OFFICIEL = 'out/mobile-web/'

const { values: args } = parseArgs({
  options: { app: { type: 'string' }, version: { type: 'string' }, commit: { type: 'string' } }
})
for (const cle of ['app', 'version', 'commit']) {
  if (!args[cle]) {
    arreter(`--${cle} manquant`)
  }
}
const RESSOURCES = join(args.app, 'Contents/Resources')
const ARCHIVE = join(RESSOURCES, 'app.asar')

class ArretGreffe extends Error {}

function arreter(message) {
  throw new ArretGreffe(message)
}

// Le code (exécutable, frameworks, helpers) doit être intact et signé par l'équipe d'Orca ; seules les ressources,
// que la greffe remplace, sont ignorées.
function verifierSignature() {
  try {
    execFileSync(
      'codesign',
      ['--verify', '--deep', '--ignore-resources', `-R=${EXIGENCE_SIGNATURE}`, args.app],
      {
        stdio: 'pipe'
      }
    )
  } catch {
    arreter(`${args.app} : code modifié ou pas signé par l'équipe d'Orca`)
  }
}

function lireVersion() {
  return execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleShortVersionString', join(args.app, 'Contents/Info.plist')],
    { encoding: 'utf8' }
  ).trim()
}

function verifierApp() {
  verifierSignature()
  const version = lireVersion()
  if (version !== args.version) {
    arreter(`Orca installé en ${version}, fork compilé pour ${args.version}`)
  }
}

async function verifierFusible() {
  const fusibles = await getCurrentFuseWire(args.app)
  const integrite = fusibles[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]
  // '0' : fusible éteint (caractère ASCII dans le binaire d'Electron).
  if (integrite !== undefined && String.fromCharCode(integrite) !== '0') {
    arreter(
      "le contrôle d'intégrité d'app.asar est allumé dans cette version d'Orca : greffe impossible"
    )
  }
}

function lister(dossier, base = dossier) {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(dossier, entree.name)
    if (entree.isSymbolicLink()) {
      arreter(`lien symbolique refusé dans la greffe : ${chemin}`)
    }
    return entree.isDirectory() ? lister(chemin, base) : [relative(base, chemin)]
  })
}

const exclusions = configBuild.files
  .filter((motif) => motif.startsWith('!'))
  .map((motif) => motif.slice(1))
const estExclu = (chemin) => exclusions.some((motif) => minimatch(chemin, motif, { dot: true }))
const estDepaquete = (chemin) =>
  configBuild.asarUnpack.some((motif) => minimatch(chemin, motif, { dot: true }))
const estHache = (chemin) => DOSSIERS_HACHES.some((dossier) => chemin.startsWith(dossier))

// Tout ce qui n'est pas out/ (ressources, configs) et la version mobile viennent de l'archive en place, donc d'Apple.
function composerFichiers(extrait) {
  const fichiers = new Map()
  for (const chemin of lister(extrait)) {
    if (!chemin.startsWith('out/') || chemin.startsWith(GARDE_OFFICIEL)) {
      fichiers.set(chemin, join(extrait, chemin))
    }
  }
  for (const chemin of lister(join(DEPOT, 'out')).map((c) => `out/${c}`)) {
    if (!chemin.startsWith(GARDE_OFFICIEL) && !estExclu(chemin)) {
      fichiers.set(chemin, join(DEPOT, chemin))
    }
  }
  return fichiers
}

// Garde-fou : un fichier en place absent de la greffe, hors noms hachés, veut dire que la compilation a raté une étape.
function verifierCouverture(extrait, fichiers) {
  const manquants = lister(extrait).filter((chemin) => !fichiers.has(chemin) && !estHache(chemin))
  if (manquants.length > 0) {
    arreter(`fichiers d'Orca absents de la greffe : ${manquants.slice(0, 10).join(', ')}`)
  }
}

function versionnerPackage(fichiers, travail) {
  const chemin = join(travail, 'package.json')
  const contenu = JSON.parse(readFileSync(fichiers.get('out/package.json'), 'utf8'))
  writeFileSync(chemin, `${JSON.stringify({ ...contenu, version: args.version }, null, 2)}\n`)
  return new Map(fichiers).set('out/package.json', chemin)
}

async function empaqueter(fichiers, destination) {
  const dossiers = new Set()
  for (const chemin of fichiers.keys()) {
    for (let parent = dirname(chemin); parent !== '.'; parent = dirname(parent)) {
      dossiers.add(parent)
    }
  }
  const flux = [
    ...[...dossiers].sort().map((chemin) => ({
      path: chemin,
      type: 'directory',
      unpacked: estDepaquete(`${chemin}/x`)
    })),
    ...[...fichiers.entries()].sort().map(([chemin, source]) => ({
      path: chemin,
      type: 'file',
      stat: lstatSync(source),
      unpacked: estDepaquete(chemin),
      streamGenerator: () => createReadStream(source)
    }))
  ]
  await asar.createPackageFromStreams(destination, flux)
}

// Seulement les fichiers hachés de la version en place (listés par son archive) : une fenêtre ouverte peut encore les
// charger. Ceux des greffes d'avant ne sont pas repris, le dossier ne grossit pas.
function garderAnciensHaches(extrait, nouveau) {
  for (const chemin of lister(extrait).filter(estHache)) {
    const ancien = join(`${ARCHIVE}.unpacked`, chemin)
    if (existsSync(ancien) && !existsSync(join(nouveau, chemin))) {
      cpSync(ancien, join(nouveau, chemin))
    }
  }
}

const SUFFIXES = ['.unpacked', ''] // le dossier d'abord : l'archive est ce qui rend l'app démarrable
const ancienne = (suffixe) => `${ARCHIVE}.ancienne${suffixe}`
const EN_COURS = join(RESSOURCES, 'orca-fork-greffe-en-cours') // présent = échange pas encore validé

// Échange coupé (arrêt, panne) : on remet l'ancienne archive. Échange validé mais pas rangé : on range.
function reparer() {
  const aDefaire = existsSync(EN_COURS)
  for (const suffixe of SUFFIXES) {
    if (!existsSync(ancienne(suffixe))) {
      continue
    }
    if (aDefaire) {
      rmSync(`${ARCHIVE}${suffixe}`, { recursive: true, force: true })
      renameSync(ancienne(suffixe), `${ARCHIVE}${suffixe}`)
    } else {
      rmSync(ancienne(suffixe), { recursive: true })
    }
  }
  rmSync(EN_COURS, { force: true })
  for (const reste of [NOUVELLE, `${NOUVELLE}.unpacked`]) {
    rmSync(reste, { recursive: true, force: true })
  }
}

function permuter(verifierAvant) {
  writeFileSync(EN_COURS, `${args.commit}\n`)
  try {
    verifierAvant()
    for (const suffixe of SUFFIXES) {
      renameSync(`${ARCHIVE}${suffixe}`, ancienne(suffixe))
      renameSync(`${NOUVELLE}${suffixe}`, `${ARCHIVE}${suffixe}`)
    }
    verifierSignature()
  } catch (erreur) {
    reparer()
    throw erreur
  }
  rmSync(EN_COURS) // point de validation : à partir d'ici la nouvelle archive est la bonne
  reparer()
}

const travail = mkdtempSync(join(tmpdir(), 'orca-greffe-'))
const NOUVELLE = `${ARCHIVE}.greffe`
try {
  reparer()
  verifierApp()
  await verifierFusible()
  const inodeArchive = statSync(ARCHIVE).ino
  const extrait = join(travail, 'en-place')
  asar.extractAll(ARCHIVE, extrait)
  const fichiers = versionnerPackage(composerFichiers(extrait), travail)
  verifierCouverture(extrait, fichiers)
  await empaqueter(fichiers, NOUVELLE)
  garderAnciensHaches(extrait, `${NOUVELLE}.unpacked`)
  // Une mise à jour officielle a pu remplacer l'app pendant l'empaquetage : on ne greffe pas sur la nouvelle.
  permuter(() => {
    if (lireVersion() !== args.version || statSync(ARCHIVE).ino !== inodeArchive) {
      arreter("Orca a changé pendant la greffe, rien n'est remplacé")
    }
  })
  writeFileSync(
    join(RESSOURCES, REPERE_FORK),
    `${JSON.stringify({ version: args.version, commit: args.commit, greffe: new Date().toISOString() }, null, 2)}\n`
  )
  console.log(
    `greffe posée : ${args.app} (${fichiers.size} fichiers, ${args.version}, ${args.commit.slice(0, 10)})`
  )
} catch (erreur) {
  if (!(erreur instanceof ArretGreffe)) {
    throw erreur
  }
  console.error(`greffer : ${erreur.message}`)
  process.exitCode = 1
} finally {
  rmSync(travail, { recursive: true })
  rmSync(NOUVELLE, { recursive: true, force: true })
  rmSync(`${NOUVELLE}.unpacked`, { recursive: true, force: true })
}
