# orca-robot

Garde un fork d'[Orca](https://github.com/stablyai/orca) greffé dans l'app officielle, sur macOS. Orca garde ses mises
à jour officielles ; après chacune, le robot remet les ajouts du fork.

## Comment ça marche

1. `robot.sh` tourne toutes les 15 min (automatisation Orca « Fork Orca : greffe après mise à jour »). Il compare la
   version installée et la branche du fork avec le repère `Contents/Resources/orca-fork.json` de l'app.
2. S'il faut regreffer : il recolle la branche sur le tag de la nouvelle version (et la pousse), compile le JavaScript,
   vérifie les types et lance les tests du fork. Il travaille dans son propre clone du fork,
   `~/.local/share/orca-fork/depot`.
3. `greffer.mjs` remplace `app.asar` dans `/Applications/Orca.app`, sur place. Il garde l'exécutable et la signature
   d'Apple : macOS reconnaît toujours Orca (autorisations, trousseau). Une notification demande de redémarrer Orca.
4. En cas d'échec (conflit, compilation, tests), l'automatisation lance un agent Claude dans le clone de développement
   du fork pour réparer. Journal : `~/Library/Logs/orca-fork/robot.log`.

## Réglages locaux

Rien de propre à un Mac n'est dans ce dépôt. Tout est dans `~/.config/orca-robot/` :

- `cible` : une ligne, `<url-du-depot.git> <branche>`. Seules les adresses `https://github.com/…` sont acceptées.
- `epingle` (facultatif) : un commit complet de ce dépôt. Présent, le robot reste sur ce commit et ne suit plus `main`.
  Absent, il suit `main` tout seul.

## Installer

Depuis un terminal d'Orca (macOS ne laisse qu'Orca écrire dans Orca.app) :

```sh
git clone https://github.com/ahmeedatm/orca-robot.git /tmp/orca-robot
/tmp/orca-robot/installer-robot.sh https://github.com/<compte>/<fork>.git <branche> \
  [--epingle <commit>] [--espace <clone de développement>]
```

L'installation place le robot dans `~/.local/share/orca-robot`, un clone réservé qu'on n'édite jamais à la main. Elle
crée ou modifie l'automatisation, sans lancer de greffe : le passage suivant s'en charge.

## Mise à jour du robot

À chaque passage, hors greffe en cours, le clone réservé rejoint `main` (ou l'épingle). Une version dont un script ne
passe pas `bash -n` ou `node --check` est refusée. Réseau coupé : le robot continue avec la version en place.

Pour avancer un Mac épinglé : écrire le nouveau commit dans `epingle`.

## Le fork suivi

Une branche posée sur le tag `vX.Y.Z` d'Orca, plus ses ajouts. Elle garde son propre `FORK.md`. Le dépôt peut être un
fork GitHub, ou un dépôt neuf : les tags manquants viennent alors de `stablyai/orca`.

## Limites

- Seulement du JavaScript (barres gauche et droite, écrans, logique de `src/main`) : le natif reste celui d'Apple. La
  version mobile n'est pas recompilée (elle reste l'officielle).
- La greffe rompt le sceau des ressources : une copie neuve d'Orca greffée serait refusée par macOS (« endommagé »). Sur
  place, dans une app déjà ouverte une fois, Orca démarre.
- Si Orca allume un jour le fusible `EnableEmbeddedAsarIntegrityValidation`, `greffer.mjs` refuse de greffer.
- Pas encore vu en vrai : la mise à jour officielle d'une app greffée. Filet : si Orca reste 3 jours derrière la
  dernière version, le robot lance un agent.
- Entre une mise à jour officielle et la greffe suivante (15 min au plus, plus la compilation), Orca tourne sans les
  ajouts.

## Sécurité

Tout ce qui est poussé sur la branche suivie, ou sur `main` ici, s'exécute sur le Mac sous 15 min avec le droit d'écrire
dans Orca.app. Le compte GitHub propriétaire est la seule porte : à garder sous double authentification. `epingle`
retire la seconde de ces deux portes.

## Tests

```sh
node --test tests/*.test.mjs
```

Aucune dépendance. Les tests utilisent le vrai git et un `HOME` temporaire, avec github.com redirigé vers des dépôts
locaux. Ils ne touchent ni à Orca.app ni au réseau.
