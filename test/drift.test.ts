import { test } from "vitest";
import assert from "node:assert/strict";
import * as C from "../src/lib/core";
import { driftedDrafts } from "../src/lib/rows";
import type { SetData } from "../src/lib/github";

// Une modification d'Alex face à main, qui a pu avancer depuis qu'il l'a faite.
const draft = (over: Partial<C.Draft> = {}): C.Draft => ({
  set: "app", lang: "de", id: "bye", segs: ["bye"],
  value: "Tschau", original: "Tschüss", exists: true, source: "Au revoir", edited: true, ...over,
});

test("draftDrift : main n'a touché ni à la source ni au texte", () => {
  assert.equal(C.draftDrift(draft(), { source: "Au revoir", value: "Tschüss" }), "same");
});

test("draftDrift : une clé absente de la langue au départ, toujours absente", () => {
  assert.equal(C.draftDrift(draft({ exists: false, original: "" }), { source: "Au revoir", value: undefined }), "same");
});

test("draftDrift : la clé a disparu de la source", () => {
  assert.equal(C.draftDrift(draft(), { source: undefined, value: "Tschüss" }), "dropped-gone");
});

test("draftDrift : une correction dont le texte cible a changé sur main est un conflit", () => {
  assert.equal(C.draftDrift(draft(), { source: "Au revoir", value: "Auf Wiedersehen" }), "conflict");
});

test("draftDrift : une correction dont la source a changé est un conflit, même si le texte cible est identique", () => {
  assert.equal(C.draftDrift(draft(), { source: "À bientôt", value: "Tschüss" }), "conflict");
});

test("draftDrift : une traduction ajoutée par un développeur sur une clé qu'Alex traduisait est un conflit", () => {
  assert.equal(C.draftDrift(draft({ exists: false, original: "" }), { source: "Au revoir", value: "Bis bald" }), "conflict");
});

test("draftDrift : main contient déjà exactement la correction", () => {
  assert.equal(C.draftDrift(draft(), { source: "Au revoir", value: "Tschau" }), "absorbed");
});

test("draftDrift : main a la correction, mais la source a changé : c'est un conflit, pas une validation", () => {
  assert.equal(C.draftDrift(draft(), { source: "À bientôt", value: "Tschau" }), "conflict");
});

test("draftDrift : une simple validation d'un texte qui a changé n'a plus d'objet", () => {
  const v = draft({ value: "Tschüss", edited: false });
  assert.equal(C.draftDrift(v, { source: "Au revoir", value: "Auf Wiedersehen" }), "dropped-validation");
  assert.equal(C.draftDrift(v, { source: "À bientôt", value: "Tschüss" }), "dropped-validation");
});

test("rebaseDraft : garde le texte d'Alex, comparé à ce que main contient aujourd'hui", () => {
  const r = C.rebaseDraft(draft(), { source: "À bientôt", value: "Auf Wiedersehen" });
  assert.deepEqual([r.value, r.original, r.source, r.exists, r.edited], ["Tschau", "Auf Wiedersehen", "À bientôt", true, true]);
  assert.equal(C.draftDrift(r, { source: "À bientôt", value: "Auf Wiedersehen" }), "same");
});

test("rebaseDraft : quand main a déjà le texte d'Alex, il reste une validation", () => {
  const r = C.rebaseDraft(draft(), { source: "Au revoir", value: "Tschau" });
  assert.deepEqual([r.original, r.edited], ["Tschau", false]);
});

test("rebaseDraft : une clé encore absente de la langue reste à écrire", () => {
  const r = C.rebaseDraft(draft({ exists: false, original: "", value: "Tschau" }), { source: "Salut", value: undefined });
  assert.deepEqual([r.exists, r.original, r.edited], [false, "", true]);
});

test("mainLookup : source et texte de la langue, par clé, y compris dans un objet imbriqué", () => {
  const now = C.mainLookup("fr", { fr: C.flatten({ menu: { open: "Ouvrir" } }), de: C.flatten({ menu: { open: "Öffnen" } }) });
  assert.deepEqual(now("de", "menu.open"), { source: "Ouvrir", value: "Öffnen" });
  assert.deepEqual(now("de", "menu.close"), { source: undefined, value: undefined });
  assert.deepEqual(now("fr", "menu.open"), { source: "Ouvrir", value: "Ouvrir" });
});

test("driftedDrafts : toutes les langues d'un jeu chargé, même masquées ; un jeu non chargé est ignoré", () => {
  const data = { app: { flat: { fr: C.flatten({ bye: "Au revoir" }), de: C.flatten({ bye: "Bis dann" }) } } as unknown as SetData };
  const drafts = {
    "app|de|bye": draft(),
    "app|fr|bye": draft({ lang: "fr", value: "Salut", original: "Au revoir" }),
    "app-expo|de|x": draft({ set: "app-expo", id: "x" }),
  };
  const out = driftedDrafts(drafts, data);
  assert.deepEqual(out.map(x => [x.key, x.drift]), [["app|de|bye", "conflict"]]);
  assert.deepEqual(driftedDrafts(drafts, data, "app-expo"), []);
});
