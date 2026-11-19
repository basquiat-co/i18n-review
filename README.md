# i18n-review
outil de traduction Lift

Les traductrices et traducteurs relisent les fichiers de traduction directement depuis GitHub. Leurs corrections et validations partent sous forme de pull request dans le dépôt concerné. L'outil n'a pas de serveur : le navigateur parle directement à `api.github.com` avec un jeton personnel (fine-grained token).

Application React (Vite, TypeScript, Tailwind, [shadcn/ui](https://ui.shadcn.com)), compilée en **un seul fichier HTML** et publiée sur GitHub Pages.

**Site : <https://basquiat-co.github.io/i18n-review/>**

## Créer un jeton GitHub

L'outil demande un jeton personnel *fine-grained* à la connexion. Il faut un compte GitHub membre de l'organisation `basquiat-co`.

1. Ouvre [GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token](https://github.com/settings/personal-access-tokens/new).
2. **Token name** : par exemple `i18n-review`. **Expiration** : au choix (à l'expiration, il suffit d'en créer un nouveau).
3. **Resource owner** : `basquiat-co` (pas ton compte personnel).
4. **Repository access** : *Only select repositories*, puis les dépôts à relire : `basquiat-app`, `basquiat-service`, `lift-agentic-service`.
5. **Permissions → Repository permissions** :
   - **Contents** : *Read and write*
   - **Pull requests** : *Read and write*
   - *Metadata* (*Read-only*) s'ajoute tout seul.
6. **Generate token**, puis copie le jeton (`github_pat_…`) : GitHub ne l'affiche qu'une fois.
7. Colle-le sur la page de connexion du [site](https://basquiat-co.github.io/i18n-review/).

Si l'organisation exige une approbation des jetons, le jeton reste « pending » jusqu'à ce qu'un propriétaire de `basquiat-co` l'approuve (*Organization settings → Personal access tokens → Pending requests*) ; d'ici là l'outil répond que le jeton n'a pas accès au dépôt.

Un jeton se révoque à tout moment dans [Settings → Personal access tokens](https://github.com/settings/personal-access-tokens).

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

Les tests de parcours construisent l'application, puis la pilotent dans Chromium avec une **fausse API GitHub** (`e2e/fake-github.ts`) : aucun appel réseau réel. Ils couvrent la connexion, les statuts et les filtres, les corrections, les pluriels, la création de la pull request (contenu exact des fichiers envoyés), la reprise d’une PR ouverte, la comparaison avec la branche principale à l'envoi (conflits, envoi refusé sans écriture), le verrou contre les PR en double et les modifications mises de côté. Ils visent l'interface par ses libellés accessibles. `E2E_BASE_URL=http://… npm run test:e2e` les lance contre une autre version déjà servie, par exemple l'ancienne.

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
- **Une seule PR de relecture ouverte par dépôt.** Si une PR de l'outil est déjà ouverte et ne contient que des fichiers relus (traductions des jeux du dépôt et `.i18n-review.json`), l'envoi la reprend au lieu d'en ouvrir une autre : ce qu'elle avait écrit est rejoué sur la dernière version de la branche principale, la nouvelle relecture est ajoutée par-dessus, et sa branche avance d'un commit de fusion (jamais de réécriture d'historique). Elle reste donc à jour avec la branche principale. Une clé supprimée entre-temps n'est pas recréée. Si un développeur a changé un texte que la PR avait écrit, la fenêtre d'envoi montre les deux versions et bloque l'envoi jusqu'à ce qu'Alex choisisse, pour chacun, *Garder ma version* ou *Prendre celle de la branche principale* (le texte choisi est marqué relu) ; si la branche principale change encore ce texte avant l'envoi, rien n'est envoyé et il choisit à nouveau. Une correction tapée sur la clé tranche aussi. Une simple validation d'une clé que la PR avait déjà corrigée ne défait pas cette correction. Un commit de fusion (*Update branch*, un conflit réglé sur GitHub) n'empêche pas la reprise. Une PR qui contient un autre commit fait à la main (d'autres fichiers, des tests) ou un fichier illisible n'est pas reprise : une nouvelle PR est créée.
- **Comparaison avec la branche principale à l'envoi seulement.** L'outil ne relit pas la branche principale en fond : il la relit à l'ouverture de la fenêtre d'envoi, puis encore pendant l'envoi, avant toute écriture (1 requête pour son dernier commit, 1 de plus pour comparer s'il a bougé, et les fichiers ne sont relus que si un fichier relu a changé). *Recharger depuis GitHub* relit tout à la demande.
- **Modifications dépassées par la branche principale.** Chaque modification garde le texte source et le texte qu'elle a vus. À l'envoi, si la branche principale contient déjà exactement la correction, elle devient une simple validation. Une simple validation (rien de tapé) dont la clé a été supprimée ou dont le texte a changé depuis est retirée, avec un message : c'est la seule modification retirée sans qu'on le demande. Une correction tapée sur une clé supprimée est gardée et montrée dans la fenêtre d'envoi, avec son texte et un bouton *Retirer*. Si c'est une correction dont la source ou le texte a changé, la ligne le montre (avant → maintenant) et propose *Garder ma correction* ou *Prendre le texte actuel*. La fenêtre d'envoi refait cette comparaison pour toutes les langues et tous les jeux qui ont des modifications, et bloque l'envoi tant qu'un conflit n'est pas tranché. L'envoi lui-même la refait encore, avant toute écriture : si la branche principale a bougé entre-temps, rien n'est envoyé et les conflits s'affichent. Un fichier source ou de traduction absent ou vide sur la branche principale (déplacé, en cours de réécriture) ne retire aucune modification : l'envoi est refusé en nommant le fichier.
- **Pas de fusion automatique.** L'outil ne fusionne jamais une PR et ne demande pas à GitHub de le faire : un développeur la fusionne.

## Sécurité

Le jeton reste dans le navigateur : en session, ou sur l'ordinateur si « Se souvenir du jeton » est coché. Il n'est envoyé qu'à `api.github.com`. `npm audit` signale `braces`, une dépendance de `vite-plugin-singlefile` utilisée seulement au moment du build et pour laquelle il n'existe pas de version corrigée. Le fichier publié n'a aucune vulnérabilité connue (`npm audit --omit=dev`).
