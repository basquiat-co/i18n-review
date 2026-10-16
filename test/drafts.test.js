"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("./load-core").loadCore();

const SETS = [
  { id: "app", repo: "o/app", langs: ["fr", "de"], source: "fr" },
  { id: "bff", repo: "o/bff", langs: ["fr", "en"], source: "fr" },
];
const draft = (set, lang, id) => ({ set, lang, id, segs: [id], value: "v", original: "", source: "s", edited: true });

test("splitDrafts : garde les modifications d'un jeu et d'une langue configurés", () => {
  const drafts = { "app|de|a": draft("app", "de", "a"), "bff|en|b": draft("bff", "en", "b"), "app|fr|c": draft("app", "fr", "c") };
  assert.deepEqual(C.splitDrafts(drafts, SETS), { kept: drafts, orphans: {} });
});

test("splitDrafts : met de côté un jeu retiré de la configuration (aucun repli sur un autre jeu)", () => {
  const ok = draft("app", "de", "a"), gone = draft("ancien", "de", "a");
  const { kept, orphans } = C.splitDrafts({ "app|de|a": ok, "ancien|de|a": gone }, SETS);
  assert.deepEqual(kept, { "app|de|a": ok });
  assert.deepEqual(orphans, { "ancien|de|a": gone });
});

test("splitDrafts : met de côté une langue retirée d'un jeu", () => {
  const { kept, orphans } = C.splitDrafts({ "app|en|a": draft("app", "en", "a") }, SETS); // en n'existe que pour bff
  assert.deepEqual(kept, {});
  assert.deepEqual(Object.keys(orphans), ["app|en|a"]);
});

test("splitDrafts : une modification revient quand son jeu est remis dans la configuration", () => {
  const d = draft("ancien", "de", "a");
  const { orphans } = C.splitDrafts({ k: d }, SETS);
  const back = C.splitDrafts(orphans, SETS.concat({ id: "ancien", repo: "o/x", langs: ["fr", "de"], source: "fr" }));
  assert.deepEqual(back, { kept: { k: d }, orphans: {} });
});

test("splitDrafts : ignore un contenu enregistré mal formé", () => {
  for (const bad of [null, undefined, "texte", 42, []]) assert.deepEqual(C.splitDrafts(bad, SETS), { kept: {}, orphans: {} });
  assert.deepEqual(C.splitDrafts({ a: null, b: "x", c: [1] }, SETS), { kept: {}, orphans: {} });
});
