import { test } from "vitest";
import assert from "node:assert/strict";
import * as C from "../src/lib/core";

// Fichiers i18n-suggestions/<branche>.json écrits par les développeurs, réglés par la traductrice.
const CAT = "service_bff/src/locales/{lang}.json";
const file = (...items: unknown[]) => JSON.stringify({ author: "Jimmy, with Claude", items }, null, 2) + "\n";
const a = { catalog: CAT, key: "a", context: "Bouton", proposed: { fr: "Ah" } };
const b = { catalog: CAT, key: "b", context: "Titre" };

test("parseSuggestions : lit les éléments valides et ignore les autres", () => {
  const f = C.parseSuggestions(file(a, b, { catalog: CAT }, "x", { ...b, key: "c", proposed: { fr: "", de: "Neu" } }));
  assert.equal(f?.author, "Jimmy, with Claude");
  assert.deepEqual(f?.items.map(i => [i.key, i.proposed]), [["a", { fr: "Ah" }], ["b", {}], ["c", { de: "Neu" }]]);
});

test("parseSuggestions : un fichier illisible ne donne rien", () => {
  assert.equal(C.parseSuggestions("{"), null);
  assert.equal(C.parseSuggestions(null), null);
  assert.equal(C.parseSuggestions('{"items": 3}'), null);
});

test("removeSuggestions : retire les éléments réglés et garde le reste du fichier", () => {
  const out = C.removeSuggestions(file(a, b), new Set([C.suggestionId(a)]));
  assert.deepEqual(JSON.parse(out!), { author: "Jimmy, with Claude", items: [b] });
});

test("removeSuggestions : vide, le fichier est supprimé ; rien à retirer, il est inchangé", () => {
  assert.equal(C.removeSuggestions(file(a), new Set([C.suggestionId(a)])), null);
  const raw = file(a);
  assert.equal(C.removeSuggestions(raw, new Set(["autre|x"])), raw);
});

test("removeSuggestions : une même clé dans un autre catalogue du dépôt n'est pas retirée", () => {
  const other = { ...a, catalog: "app/i18n/{lang}/expo.json" };
  const out = C.removeSuggestions(file(a, other), new Set([C.suggestionId(a)]));
  assert.deepEqual(JSON.parse(out!).items, [other]);
});

test("settledBetween : ce qu'une PR a retiré, à rejouer sur main", () => {
  assert.deepEqual([...C.settledBetween(file(a, b), file(b))], [C.suggestionId(a)]);
  assert.deepEqual([...C.settledBetween(file(a), null)], [C.suggestionId(a)]);
  assert.deepEqual([...C.settledBetween(null, file(a))], []);
});

test("parseAsset : une capture nommée par convention, et rien d'autre", () => {
  assert.deepEqual(C.parseAsset("i18n-suggestions/feat-x/bff.a.b.de.proposed.webp"),
    { file: "i18n-suggestions/feat-x.json", key: "bff.a.b", lang: "de", kind: "proposed" });
  assert.equal(C.parseAsset("i18n-suggestions/feat-x/notes.txt"), null);
  assert.equal(C.parseAsset("i18n-suggestions/feat-x.json"), null);
  assert.equal(C.parseAsset("app/x.de.current.webp"), null);
});
