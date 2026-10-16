import { test } from "vitest";
import assert from "node:assert/strict";
import * as C from "../src/lib/core";
import type { FileSet } from "../src/lib/config";
import type { SetData } from "../src/lib/github";
import * as R from "../src/lib/rows";

const SET: FileSet = { id: "app", repo: "o/app", label: "App", path: "{lang}.json", langs: ["fr", "de", "en", "it"], source: "fr" };
const { hash } = C;

function data(fr: C.JsonObject, de: C.JsonObject, entries: C.ReviewEntries = {}): SetData {
  return {
    sha: "s", branch: "main",
    flat: { fr: C.flatten(fr), de: C.flatten(de), en: [], it: [] },
    review: { version: 1, sets: { app: { de: entries } } },
    pending: { fr: new Map(), de: new Map(), en: new Map(), it: new Map() },
  };
}
const FR = { a: "A", b: "B", n: { one: "1 x", other: "{{count}} x" } };
const DE = { a: "Ah", b: "Bh", n: { one: "1 y", other: "{{count}} y" } };
const reviewed = { a: hash("A") + " " + hash("Ah") }; // a relue, le reste nouveau

test("activeLangs : toutes sauf la source par défaut, au plus trois, préférences filtrées", () => {
  assert.deepEqual(R.activeLangs(SET, {}), ["de", "en", "it"]);
  assert.deepEqual(R.activeLangs(SET, { app: ["it", "xx", "fr"] }), ["it", "fr"]);
  assert.deepEqual(R.activeLangs({ ...SET, langs: ["fr"] }, {}), ["fr"]);
  assert.deepEqual(R.activeLangs(SET, { app: ["de", "en", "it", "fr"] }), ["de", "en", "it"]);
});

test("currentKeys : une cellule par langue, pluriels annotés, modifications rattachées", () => {
  const drafts = { "app|de|b": { set: "app", lang: "de", id: "b", segs: ["b"], value: "Bx", original: "Bh", exists: true, source: "B", edited: true } };
  const keys = R.currentKeys(SET, data(FR, DE, reviewed), ["de", "fr"], drafts);
  assert.deepEqual(keys.map(k => k.id), ["a", "b", "n.one", "n.other"]);
  assert.deepEqual(keys[0].cells.map(c => [c.lang, c.status]), [["de", "ok"], ["fr", "new"]]);
  assert.equal(keys[1].cells[0].draft!.value, "Bx");
  assert.equal(keys[2].group, "n");
  assert.equal(keys[2].form, "one");
});

test("filtres : « à relire » inclut les clés modifiées, « relues » exige toutes les langues", () => {
  const keys = R.currentKeys(SET, data(FR, DE, reviewed), ["de"], {});
  assert.deepEqual(R.filterCounts(keys, ["todo", "ok", "new", "all"]), { todo: 3, ok: 1, new: 3, all: 4 });
  const withDraft = R.currentKeys(SET, data(FR, DE, reviewed), ["de"],
    { "app|de|a": { set: "app", lang: "de", id: "a", segs: ["a"], value: "Ahh", original: "Ah", exists: true, source: "A", edited: true } });
  assert.equal(R.keyMatchesStatus(withDraft[0], "todo"), true);
  assert.equal(R.currentKeys(SET, data(FR, DE, reviewed), ["de", "fr"], {}).filter(k => R.keyMatchesStatus(k, "ok")).length, 0);
});

test("buildUnits : un pluriel est une seule unité, entière dès qu'une forme correspond", () => {
  const keys = R.currentKeys(SET, data(FR, DE, reviewed), ["de"], {});
  const units = R.buildUnits(keys, "all", "");
  assert.deepEqual(units.map(R.unitId), ["a", "b", "n"]);
  assert.equal(R.unitCells(units[2]).length, 2);
  assert.deepEqual(R.buildUnits(keys, "all", "{{count}} y").map(R.unitId), ["n"]);
  assert.deepEqual(R.buildUnits(keys, "todo", "").map(R.unitId), ["b", "n"]);
  assert.deepEqual(R.buildUnits(keys, "all", "BH").map(R.unitId), ["b"]); // insensible à la casse
});

test("recherche : clé, source, traduction ou texte modifié", () => {
  const drafts = { "app|de|a": { set: "app", lang: "de", id: "a", segs: ["a"], value: "Neuer Text", original: "Ah", exists: true, source: "A", edited: true } };
  const keys = R.currentKeys(SET, data(FR, DE), ["de"], drafts);
  for (const q of ["n.one", "1 x", "1 y", "neuer"]) assert.ok(keys.some(k => R.matchesSearch(k, q)), q);
  assert.ok(!keys.some(k => R.matchesSearch(k, "introuvable")));
});

test("applyEdit : correction, validation, retour au texte d'origine, texte vide", () => {
  const [a, b] = R.currentKeys(SET, data(FR, DE, reviewed), ["de"], {}).map(k => k.cells[0]); // a relue, b nouvelle
  const corrected = R.applyEdit({}, "app", b, "Bneu", false)!;
  assert.deepEqual(corrected["app|de|b"], { set: "app", lang: "de", id: "b", segs: ["b"], value: "Bneu", original: "Bh", exists: true, source: "B", edited: true });

  assert.deepEqual(R.applyEdit({}, "app", b, "Bh", true)!["app|de|b"].edited, false); // valider sans changement
  assert.equal(R.applyEdit({}, "app", b, "Bh", false), null);                         // sortir du champ sans rien changer
  assert.equal(R.applyEdit({}, "app", a, "Ah", true), null);                          // déjà relue : rien à valider

  const back = { ...corrected, "app|de|b": { ...corrected["app|de|b"], value: "Bneu" } };
  assert.deepEqual(R.applyEdit(back, "app", { ...b, draft: back["app|de|b"] }, "Bh", false), {}); // retour au texte d'origine
  assert.deepEqual(R.applyEdit(corrected, "app", b, "", false), {});                 // texte vide : modification retirée
});

test("applyEdit : une clé absente de la langue cible est toujours à écrire", () => {
  const cell = R.currentKeys(SET, data({ x: "X" }, {}), ["de"], {})[0].cells[0];
  assert.equal(cell.status, "missing");
  assert.equal(R.applyEdit({}, "app", cell, "Ix", false)!["app|de|x"].edited, true);
});

test("validateCells : ignore les formes relues, déjà modifiées ou vides", () => {
  const cells = R.currentKeys(SET, data({ ...FR, e: "E", z: "" }, { ...DE, e: "", z: "" }, reviewed), ["de"], {}).map(k => k.cells[0]);
  const out = R.validateCells({}, "app", cells);
  assert.deepEqual(Object.keys(out).sort(), ["app|de|b", "app|de|n.one", "app|de|n.other", "app|de|z"]);
  assert.equal(out["app|de|b"].edited, false);
});

test("removeDrafts : retire les modifications des cellules données", () => {
  const drafts = R.validateCells({}, "app", R.currentKeys(SET, data(FR, DE), ["de"], {}).map(k => k.cells[0]));
  assert.deepEqual(Object.keys(R.removeDrafts(drafts, "app", [{ lang: "de", id: "a" }, { lang: "de", id: "b" }])), ["app|de|n.one", "app|de|n.other"]);
});

test("worstStatus et formVars", () => {
  assert.equal(R.worstStatus([{ status: "ok" }, { status: "new" }, { status: "source" }]), "source");
  assert.equal(R.worstStatus([]), "ok");
  assert.deepEqual(R.formVars("one", "{{count}} jour", "Ein Tag"), []);
  assert.deepEqual(R.formVars("other", "{{count}} jours", "Tage"), ["count"]);
  assert.deepEqual(R.formVars("one", "{{name}} : {{count}} jour", "Ein Tag"), ["name"]);
});
