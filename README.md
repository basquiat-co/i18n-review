# i18n-review
outil de traduction Lift

Les traductrices et traducteurs relisent les fichiers de traduction directement depuis GitHub. Leurs corrections et validations partent sous forme de pull request dans le dépôt concerné. L'outil n'a pas de serveur : le navigateur parle directement à `api.github.com` avec un jeton personnel (fine-grained token).

Application React (Vite, TypeScript, Tailwind, [shadcn/ui](https://ui.shadcn.com)), compilée en **un seul fichier HTML** et publiée sur GitHub Pages.

## Développement

Node 22 ou plus.

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/index.html, autonome (JS, CSS et polices inclus)
npm run preview    # sert dist/ en local
```

## Tests

```sh
npm run typecheck  # TypeScript
npm test           # tests unitaires (Vitest)
npm run test:e2e   # parcours complets dans Chromium (Playwright)
```

Les tests de parcours construisent l'application, puis la pilotent dans Chromium avec une **fausse API GitHub** (`e2e/fake-github.ts`) : aucun appel réseau réel. Ils couvrent la connexion, les statuts et les filtres, les corrections, les pluriels, la création de la pull request (contenu exact des fichiers envoyés), le verrou contre les PR en double et les modifications mises de côté. Ils visent l'interface par ses libellés accessibles. `E2E_BASE_URL=http://… npm run test:e2e` les lance contre une autre version déjà servie, par exemple l'ancienne.

En local, si Playwright ne trouve pas Chromium : `npx playwright install chromium`.

Sur GitHub Actions, `.github/workflows/tests.yml` lance les trois à chaque pull request et à chaque push sur `main`.

## Déploiement

`.github/workflows/deploy.yml` construit l'application et la publie sur GitHub Pages à chaque push sur `main`.

**Réglage à faire une fois dans le dépôt :** *Settings → Pages → Build and deployment → Source* : **GitHub Actions** (au lieu de *Deploy from a branch*). Sans ce réglage, Pages servirait le `index.html` source de Vite, qui ne fonctionne pas sans compilation.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `src/lib/config.ts` | **jeux de fichiers relus (`SETS`)**, langues, libellés des statuts |
| `src/lib/core.ts` | moteur pur : lecture et réécriture des JSON, variables, pluriels ICU/JSON, statuts, fichier `.i18n-review.json` |
| `src/lib/rows.ts` | modèle d'affichage : clés, filtres, recherche, règles de correction et de validation |
| `src/lib/composite.ts` | découpage d'un pluriel écrit dans une seule chaîne en un champ par forme |
| `src/lib/github.ts` | client GitHub : chargement d'un jeu, PR ouvertes, création de branche, commit et pull request |
| `src/lib/storage.ts` | stockage local : jeton, modifications en attente, préférences |
| `src/store.ts` | état de l'application (zustand) et actions |
| `src/components/` | interface ; `src/components/ui/` contient les composants shadcn |

**Ajouter des fichiers à relire** : une entrée dans `SETS` (`src/lib/config.ts`). `test/config.test.ts` vérifie la cohérence de la configuration.

**Composants shadcn** : `npx shadcn@latest add <composant>`. Le CLI réécrit parfois l'import de `cn` vers un paquet npm sans rapport, nommé `cn`. Il faut alors remettre `from "@/lib/utils"` et faire `npm uninstall cn`. Un test unitaire bloque ce cas.

## Fonctionnement

- **Statuts** : *manquante*, *nouvelle* (jamais relue), *source modifiée* (le texte de référence a changé depuis la relecture), *modifiée hors relecture*, *en attente* (validée dans une PR de l'outil pas encore fusionnée), *relue*.
- **`.i18n-review.json`**, à la racine de chaque dépôt, enregistre pour chaque clé relue l'empreinte du texte source et celle de la traduction. Une clé redevient « à relire » dès que l'un des deux textes change.
- Les **modifications en attente** sont gardées dans le navigateur jusqu'à la création de la PR. Celles d'un jeu ou d'une langue retirés de `SETS` sont mises de côté et ne sont jamais envoyées.
- Les fichiers sont réécrits avec leur indentation d'origine. Une clé manquante est insérée à sa place, dans l'ordre de la langue source.

## Sécurité

Le jeton reste dans le navigateur : en session, ou sur l'ordinateur si « Se souvenir du jeton » est coché. Il n'est envoyé qu'à `api.github.com`. `npm audit` signale `braces`, une dépendance de `vite-plugin-singlefile` utilisée seulement au moment du build et pour laquelle il n'existe pas de version corrigée. Le fichier publié n'a aucune vulnérabilité connue (`npm audit --omit=dev`).
