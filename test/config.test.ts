import { test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LANG_NAMES, REVIEW_FILE, SETS, isReviewedPath } from "../src/lib/config";

test("SETS : configuration cohérente", () => {
  assert.ok(SETS.length > 0);
  assert.equal(new Set(SETS.map(s => s.id)).size, SETS.length, "identifiants en double");
  const paths = new Set<string>();
  for (const s of SETS) {
    assert.match(s.id, /^[a-z0-9-]+$/, `${s.id} : identifiant`);
    assert.match(s.repo, /^[\w.-]+\/[\w.-]+$/, `${s.id} : dépôt « propriétaire/nom »`);
    assert.ok(s.label, `${s.id} : libellé`);
    assert.ok(s.path.includes("{lang}"), `${s.id} : le chemin doit contenir {lang}`);
    assert.ok(!s.path.startsWith("/"), `${s.id} : chemin relatif à la racine du dépôt`);
    assert.ok(s.langs.length > 0 && new Set(s.langs).size === s.langs.length, `${s.id} : langues`);
    assert.ok(s.langs.includes(s.source), `${s.id} : la langue source doit faire partie des langues`);
    for (const l of s.langs) assert.ok(LANG_NAMES[l], `${s.id} : nom manquant dans LANG_NAMES pour « ${l} »`);
    const key = s.repo + ":" + s.path;
    assert.ok(!paths.has(key), `${s.id} : mêmes fichiers qu'un autre jeu`);
    paths.add(key);
  }
});

// Le CLI shadcn (npx shadcn add) réécrit parfois l'import de cn() vers un paquet npm sans rapport, nommé « cn ».
test("composants : cn() vient de @/lib/utils, jamais du paquet npm « cn »", () => {
  const root = path.join(import.meta.dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.ok(!pkg.dependencies?.cn && !pkg.devDependencies?.cn, "retirer le paquet « cn » : npm uninstall cn");
  const files = fs.readdirSync(path.join(root, "src"), { recursive: true, encoding: "utf8" }).filter(f => /\.tsx?$/.test(f));
  for (const f of files) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, "src", f), "utf8"), /from ["']cn["']/, `src/${f} : importer cn depuis "@/lib/utils"`);
  }
});

test("isReviewedPath : les traductions des jeux du dépôt, le fichier d'état et les suggestions", () => {
  const app = (p: string) => isReviewedPath("basquiat-co/basquiat-app", p);
  assert.ok(app(REVIEW_FILE));
  assert.ok(app("app/i18n/fr/app.json") && app("app/i18n/de/expo.json"));
  assert.ok(app("i18n-suggestions/fix-team-label.json"));
  assert.ok(!app("i18n-suggestions/README.md"), "seuls les fichiers de suggestions");
  assert.ok(!app("i18n-suggestions/sub/x.json"), "pas de sous-dossier");
  assert.ok(!app("service_bff/src/locales/fr.json"), "un autre dépôt");
  assert.ok(!app("app/i18n/en/app.json"), "une langue non configurée");
});
