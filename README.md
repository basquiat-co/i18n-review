# i18n-review
outil de traduction Lift

L'application tient dans un seul fichier, `index.html`, publié tel quel par GitHub Pages : pas de build, pas de dépendance.

## Tests

Le moteur de l'outil (le premier `<script>` de `index.html`, exposé sous `window.I18nCore`) est fait de fonctions pures. Les tests le chargent directement depuis `index.html` et vérifient aussi que les scripts de la page sont valides et que la configuration `SETS` est cohérente.

```sh
npm test
```

Node 22 ou plus, aucune installation nécessaire. Les tests tournent aussi sur GitHub Actions à chaque pull request et à chaque push sur `main`.

| Fichier | Contenu |
|---|---|
| `test/files.test.js` | lecture et réécriture des fichiers JSON, aplatissement des clés, insertion d'une clé à sa place |
| `test/placeholders.test.js` | détection des variables (`{{nom}}`, `%{nom}`, `{nom}`, ICU) et des variables manquantes |
| `test/plurals.test.js` | pluriels en sous-clés, en JSON dans une chaîne et en ICU |
| `test/review.test.js` | fichier `.i18n-review.json`, statuts des clés, application d'une relecture |
| `test/drafts.test.js` | tri des modifications enregistrées dont le jeu de fichiers ou la langue n'existe plus |
| `test/page.test.js` | syntaxe des scripts de `index.html` et configuration des jeux de fichiers |
