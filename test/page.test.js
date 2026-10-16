"use strict";
// Vérifications de index.html lui-même : syntaxe des scripts et configuration des jeux de fichiers.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { inlineScripts, HTML_PATH } = require("./load-core");

const html = fs.readFileSync(HTML_PATH, "utf8");
const scripts = inlineScripts(html);
const ui = scripts.find(s => s.includes("const SETS = ["));

// Évalue une constante littérale du script de l'interface (ex. SETS, LANG_NAMES).
function constant(name) {
  const m = ui.match(new RegExp("const " + name + " = ([\\[{][\\s\\S]*?[\\]}]);\\n"));
  assert.ok(m, `constante ${name} introuvable`);
  return vm.runInNewContext("(" + m[1] + ")");
}

test("index.html : deux scripts, le moteur et l'interface", () => {
  assert.equal(scripts.length, 2);
  assert.ok(ui, "script de l'interface introuvable");
});

test("index.html : les scripts sont du JavaScript valide", () => {
  scripts.forEach((code, i) => assert.doesNotThrow(() => new vm.Script(code, { filename: `index.html#script${i + 1}` })));
});

test("index.html : dans le navigateur, le moteur s'expose sur window.I18nCore", () => {
  const core = scripts.find(s => s.includes("module.exports = api"));
  const sandbox = { window: {} };
  vm.runInNewContext(core, sandbox);
  assert.equal(typeof sandbox.window.I18nCore.computeRows, "function");
});

test("SETS : configuration cohérente", () => {
  const SETS = constant("SETS");
  const LANG_NAMES = constant("LANG_NAMES");
  assert.ok(SETS.length > 0);
  assert.equal(new Set(SETS.map(s => s.id)).size, SETS.length, "identifiants en double");
  const paths = new Set();
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
