import { test } from "vitest";
import assert from "node:assert/strict";
import * as C from "../src/lib/core";

// Reprise d'une PR ouverte sur la dernière version de main : base = point de départ de la PR, head = la PR, main = aujourd'hui.
const ids = (...k: string[]) => new Set(k);

test("replayValues : rejoue ce que la PR a écrit, y compris une traduction ajoutée", () => {
  const base = { a: "A", b: "B" };
  const head = { a: "A2", b: "B", c: "C" };
  const main = { a: "A", b: "B", d: "D" };
  const r = C.replayValues(base, head, main, ids("a", "b", "c", "d"));
  assert.deepEqual(r.edits.map(e => [e.id, e.value]), [["a", "A2"], ["c", "C"]]);
  assert.deepEqual(r.clashes, []);
});

test("replayValues : une clé supprimée sur main n'est pas recréée", () => {
  const r = C.replayValues({ gone: "x" }, { gone: "y" }, {}, ids());
  assert.deepEqual(r, { edits: [], clashes: [] });
});

test("replayValues : une valeur changée aussi sur main garde le texte de main et part dans clashes", () => {
  const r = C.replayValues({ a: "A" }, { a: "A (PR)" }, { a: "A (main)" }, ids("a"));
  assert.deepEqual(r, { edits: [], clashes: ["a"] });
});

test("replayValues : une valeur déjà identique sur main n'est ni rejouée ni en conflit", () => {
  const r = C.replayValues({ a: "A" }, { a: "A2" }, { a: "A2" }, ids("a"));
  assert.deepEqual(r, { edits: [], clashes: [] });
});

test("replayValues : clés imbriquées", () => {
  const r = C.replayValues({ menu: { open: "O" } }, { menu: { open: "O2", close: "F" } }, { menu: { open: "O" } }, ids("menu.open", "menu.close"));
  assert.deepEqual(r.edits.map(e => [e.segs, e.value]), [[["menu", "open"], "O2"], [["menu", "close"], "F"]]);
});

const rev = (de: C.ReviewEntries, other: Record<string, Record<string, C.ReviewEntries>> = {}): C.Review =>
  ({ version: 1, sets: { app: { de }, ...other } });

test("replayReview : reprend les entrées changées par la PR, garde celles de main", () => {
  const base = rev({ a: "1 1", b: "1 1" });
  const head = rev({ a: "1 2", b: "1 1", c: "3 3" });
  const main = rev({ a: "1 1", b: "1 1", m: "9 9" });
  const out = C.replayReview(main, base, head, () => ids("a", "b", "c", "m"), new Set());
  assert.deepEqual(out.sets.app.de, { a: "1 2", b: "1 1", m: "9 9", c: "3 3" });
  assert.deepEqual(main.sets.app.de, { a: "1 1", b: "1 1", m: "9 9" }, "main n'est pas modifié");
});

test("replayReview : ni clé supprimée, ni clé en conflit, ni jeu inconnu", () => {
  const base = rev({});
  const head = rev({ gone: "1 1", clash: "2 2", ok: "3 3" }, { old: { de: { x: "4 4" } } });
  const out = C.replayReview(rev({}), base, head, id => id === "app" ? ids("clash", "ok") : null, new Set(["app|de|clash"]));
  assert.deepEqual(out.sets, { app: { de: { ok: "3 3" } } });
});

test("replayReview : une langue absente de main est créée", () => {
  const out = C.replayReview({ version: 1, sets: {} }, rev({}), rev({ a: "1 1" }), () => ids("a"), new Set());
  assert.deepEqual(out.sets, { app: { de: { a: "1 1" } } });
});

test("replayReview : une entrée que main a changée depuis la base de la PR garde celle de main", () => {
  // La PR a validé k sur l'ancienne valeur ; une autre PR fusionnée l'a relue depuis.
  const out = C.replayReview(rev({ k: "1 9" }), rev({ k: "1 0" }), rev({ k: "1 5" }), () => ids("k"), new Set());
  assert.deepEqual(out.sets.app.de, { k: "1 9" });
});
