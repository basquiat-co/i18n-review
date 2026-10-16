import { test } from "vitest";
import assert from "node:assert/strict";
import * as C from "../src/lib/core";

const { hash } = C;
const S = C.STATUS;

// Lignes d'une langue cible à partir d'objets JSON, comme le fait l'application.
function rows(source: C.JsonObject, target: C.JsonObject, entries: C.ReviewEntries = {}, pending?: Map<string, C.PendingInfo>) {
  return C.computeRows({
    sourceFlat: C.flatten(source), targetFlat: C.flatten(target), isSource: false,
    entries, pendingEntries: pending,
  });
}
const statusOf = (list: C.Row[]) => Object.fromEntries(list.map(r => [r.id, r.status]));

/* ---------- Fichier d'état ---------- */

test("parseReview : contenu absent ou vide → état vide", () => {
  for (const raw of [null, undefined, "", "{}", "null", '{"version":1}']) {
    assert.deepEqual(C.parseReview(raw), { version: 1, sets: {} }, String(raw));
  }
});

test("parseReview : lit un état existant", () => {
  const r = { version: 1, sets: { app: { de: { a: "11111111 22222222" } } } };
  assert.deepEqual(C.parseReview(JSON.stringify(r)), r);
});

test("parseReview : un JSON invalide lève une erreur", () => {
  assert.throws(() => C.parseReview("{oops"), SyntaxError);
});

test("serializeReview : clés triées à tous les niveaux, retour à la ligne final", () => {
  const out = C.serializeReview({ version: 1, sets: { z: { de: { b: "1", a: "2" } }, a: { fr: {} } } });
  assert.equal(out, '{\n  "version": 1,\n  "sets": {\n    "a": {\n      "fr": {}\n    },\n    "z": {\n      "de": {\n        "a": "2",\n        "b": "1"\n      }\n    }\n  }\n}\n');
  assert.deepEqual(C.parseReview(out), { version: 1, sets: { a: { fr: {} }, z: { de: { a: "2", b: "1" } } } });
});

test("reviewEntries : entrées d'une langue, objet vide sinon", () => {
  const r = { version: 1, sets: { app: { de: { a: "x" } } } };
  assert.deepEqual(C.reviewEntries(r, "app", "de"), { a: "x" });
  assert.deepEqual(C.reviewEntries(r, "app", "en"), {});
  assert.deepEqual(C.reviewEntries(r, "autre", "de"), {});
});

/* ---------- Statuts ---------- */

test("computeRows : un statut par situation", () => {
  const source = { ok: "Oui", src: "Nouveau texte", mod: "Texte", fresh: "Neu", absent: "Absent", empty: "Vide" };
  const target = { ok: "Ja", src: "Text", mod: "Geänderter Text", fresh: "Neu", empty: "" };
  const entries = {
    ok: hash("Oui") + " " + hash("Ja"),
    src: hash("Ancien texte") + " " + hash("Text"),
    mod: hash("Texte") + " " + hash("Text"),
  };
  assert.deepEqual(statusOf(rows(source, target, entries)), {
    ok: S.ok, src: S.source, mod: S.modified, fresh: S.fresh, absent: S.missing, empty: S.missing,
  });
});

test("computeRows : la source prime sur la traduction quand les deux ont changé", () => {
  const list = rows({ a: "Nouveau" }, { a: "Neu" }, { a: hash("Ancien") + " " + hash("Alt") });
  assert.equal(list[0].status, S.source);
});

test("computeRows : source et traduction vides → à relire, pas manquante", () => {
  assert.equal(rows({ zero: "" }, { zero: "" })[0].status, S.fresh);
});

test("computeRows : suit l'ordre de la source et ignore les clés en trop", () => {
  const list = rows({ b: "B", a: { x: "X" } }, { extra: "E", a: { x: "XX" }, b: "BB" });
  assert.deepEqual(list.map(r => r.id), ["b", "a.x"]);
  assert.deepEqual(list.map(r => r.value), ["BB", "XX"]);
});

test("computeRows : une clé absente a une valeur vide et exists = false", () => {
  const [r] = rows({ a: "A" }, {});
  assert.equal(r.value, "");
  assert.equal(r.exists, false);
  assert.equal(r.source, "A");
  assert.deepEqual(r.segs, ["a"]);
});

test("computeRows : une clé validée dans une PR ouverte est « en attente », sauf si elle est déjà relue", () => {
  const pr = { number: 12, url: "https://github.com/o/r/pull/12" };
  const pending = new Map([["todo", pr], ["done", pr], ["absent", pr]]);
  const list = rows({ todo: "A", done: "B", absent: "C" }, { todo: "a", done: "b" }, { done: hash("B") + " " + hash("b") }, pending);
  assert.deepEqual(statusOf(list), { todo: S.pending, done: S.ok, absent: S.pending });
  assert.deepEqual(list[0].pending, pr);
  assert.equal(list[1].pending, null);
});

test("computeRows : langue source (une seule empreinte par entrée)", () => {
  const flat = C.flatten({ ok: "Oui", mod: "Changé", fresh: "Neuf", empty: "" });
  const list = C.computeRows({
    sourceFlat: flat, targetFlat: null, isSource: true,
    entries: { ok: hash("Oui"), mod: hash("Avant") },
  });
  assert.deepEqual(statusOf(list), { ok: S.ok, mod: S.modified, fresh: S.fresh, empty: S.fresh });
  assert.equal(list[0].value, "Oui");
});

test("countStatuses : compteurs, « à relire » et total", () => {
  const list = [S.ok, S.ok, S.missing, S.fresh, S.source, S.modified, S.pending].map(status => ({ status }));
  assert.deepEqual(C.countStatuses(list), { missing: 1, new: 1, source: 1, modified: 1, pending: 1, ok: 2, todo: 4, total: 7 });
  assert.deepEqual(C.countStatuses([]), { missing: 0, new: 0, source: 0, modified: 0, pending: 0, ok: 0, todo: 0, total: 0 });
});

/* ---------- Application d'une relecture ---------- */

test("applyEdits : null si rien à écrire", () => {
  assert.equal(C.applyEdits('{"a":"x"}', { a: "" }, []), null);
  assert.equal(C.applyEdits('{"a":"x"}', { a: "" }, [{ segs: ["a"], value: "x" }]), null);
});

test("applyEdits : garde l'indentation, le retour final et l'ordre des clés", () => {
  const before = '{\n    "b": "B",\n    "a": "A"\n}\n';
  assert.equal(C.applyEdits(before, { a: "", b: "" }, [{ segs: ["a"], value: "Ä" }]), '{\n    "b": "B",\n    "a": "Ä"\n}\n');
});

test("applyEdits : insère une clé manquante à sa place selon la source", () => {
  const source = { title: "", menu: { open: "", close: "" }, footer: "" };
  const before = '{\n  "title": "Titel",\n  "footer": "Fuß"\n}\n';
  const after = C.applyEdits(before, source, [{ segs: ["menu", "close"], value: "Schließen" }]);
  assert.equal(after, '{\n  "title": "Titel",\n  "menu": {\n    "close": "Schließen"\n  },\n  "footer": "Fuß"\n}\n');
});

test("applyEdits : fichier cible encore vide", () => {
  assert.equal(C.applyEdits("{}\n", { a: "" }, [{ segs: ["a"], value: "x" }]), '{\n  "a": "x"\n}\n');
});

test("applyEdits : un JSON invalide lève une erreur", () => {
  assert.throws(() => C.applyEdits("{", {}, [{ segs: ["a"], value: "x" }]), SyntaxError);
});

test("updateReview : enregistre les validations sans modifier l'état reçu", () => {
  const before = C.emptyReview();
  const after = C.updateReview(before, "app", "de", false, [{ id: "a", source: "A", value: "Ah" }], new Set(["a"]));
  assert.deepEqual(before, { version: 1, sets: {} });
  assert.deepEqual(after.sets, { app: { de: { a: hash("A") + " " + hash("Ah") } } });
});

test("updateReview : langue source → empreinte du texte seul", () => {
  const after = C.updateReview(C.emptyReview(), "app", "fr", true, [{ id: "a", source: "A", value: "A2" }], null);
  assert.deepEqual(after.sets.app.fr, { a: hash("A2") });
});

test("updateReview : supprime les entrées des clés disparues de la source", () => {
  const review = { version: 1, sets: { app: { de: { keep: "1 2", gone: "3 4" }, en: { gone: "5 6" } } } };
  assert.deepEqual(C.updateReview(review, "app", "de", false, [], new Set(["keep"])).sets.app,
    { de: { keep: "1 2" }, en: { gone: "5 6" } }); // les autres langues ne sont pas touchées
  assert.deepEqual(C.updateReview(review, "app", "de", false, [], null).sets.app.de, { keep: "1 2", gone: "3 4" });
});

test("updateReview puis computeRows : une clé validée devient relue, puis change de statut avec les textes", () => {
  const review = C.updateReview(C.emptyReview(), "app", "de", false, [{ id: "a", source: "Bonjour", value: "Hallo" }], new Set(["a"]));
  const entries = C.reviewEntries(review, "app", "de");
  assert.equal(rows({ a: "Bonjour" }, { a: "Hallo" }, entries)[0].status, S.ok);
  assert.equal(rows({ a: "Bonsoir" }, { a: "Hallo" }, entries)[0].status, S.source);
  assert.equal(rows({ a: "Bonjour" }, { a: "Guten Tag" }, entries)[0].status, S.modified);
});

test("initReview : marque comme relu tout ce qui est traduit", () => {
  const langsFlat = {
    fr: C.flatten({ a: "A", b: "B", vide: "" }),
    de: C.flatten({ a: "Ah", b: "", extra: "X" }),
  };
  const review = C.initReview(C.emptyReview(), "s", "fr", langsFlat);
  assert.deepEqual(review.sets.s, {
    fr: { a: hash("A"), b: hash("B"), vide: hash("") },
    de: { a: hash("A") + " " + hash("Ah") }, // b est vide, extra n'existe pas dans la source, vide manque
  });
  const de = rows({ a: "A", b: "B", vide: "" }, { a: "Ah", b: "", extra: "X" }, review.sets.s.de);
  assert.deepEqual(statusOf(de), { a: S.ok, b: S.missing, vide: S.missing });
});

test("initReview : conserve les autres jeux de fichiers", () => {
  const start = { version: 1, sets: { autre: { fr: { k: "12345678" } } } };
  const review = C.initReview(start, "s", "fr", { fr: C.flatten({ a: "A" }) });
  assert.deepEqual(review.sets.autre, { fr: { k: "12345678" } });
  assert.deepEqual(review.sets.s, { fr: { a: hash("A") } });
});
