import { test } from "vitest";
import assert from "node:assert/strict";
import { compositeOf, isSplittable } from "../src/lib/composite";

const labels = (fs: { label: string }[]) => fs.map(f => f.label);
const values = (fs: { value: string }[]) => fs.map(f => f.value);

test("texte simple : pas de découpage", () => {
  assert.equal(compositeOf({ source: "Bonjour {name}", value: "Hallo {name}" }, "Hallo {name}"), null);
  assert.equal(isSplittable("Bonjour {name}"), false);
  assert.equal(isSplittable("{n, plural, one {#} other {#}}"), true);
  assert.equal(isSplittable('{"one":"a","other":"b"}'), true);
});

test("pluriel ICU : une forme par champ, reconstruit à l'identique", () => {
  const src = "{count, plural, one {# membre} other {# membres}}";
  const cur = "{count, plural, one {# Mitglied} other {# Mitglieder}}";
  const c = compositeOf({ source: src, value: cur }, cur)!;
  assert.equal(c.kind, "Pluriel");
  assert.deepEqual(labels(c.fields), ["un", "plusieurs"]);
  assert.deepEqual(values(c.fields), ["# Mitglied", "# Mitglieder"]);
  assert.deepEqual(values(c.src), ["# membre", "# membres"]);
  assert.equal(c.build(["# Mitglied", "# Leute"]), "{count, plural, one {# Mitglied} other {# Leute}}");
});

test("pluriel ICU : texte autour, =0 et plusieurs arguments", () => {
  const src = "Membres : {names}{more, plural, =0 {} one { et # autre} other { et # autres}}";
  const c = compositeOf({ source: src, value: src }, src)!;
  assert.deepEqual(labels(c.fields), ["texte", "exactement 0", "un", "plusieurs"]);
  assert.equal(c.build(values(c.fields)), src);

  const two = "{g, select, male {Il} other {Elle}} a {n, plural, one {# chat} other {# chats}}";
  const c2 = compositeOf({ source: two, value: two }, two)!;
  assert.equal(c2.kind, "Variantes");
  assert.deepEqual(labels(c2.fields), ["g · male", "g · autre cas", "texte", "n · un", "n · plusieurs"]);
});

test("pluriel ICU : une traduction encore vide part de la structure de la source", () => {
  const src = "{count, plural, one {# jour} other {# jours}}";
  const c = compositeOf({ source: src, value: "" }, "")!;
  assert.deepEqual(values(c.fields), ["", ""]);
  assert.equal(c.build(["# Tag", "# Tage"]), "{count, plural, one {# Tag} other {# Tage}}");
});

test("pluriel ICU : une traduction illisible n'est pas découpée", () => {
  assert.equal(compositeOf({ source: "{n, plural, one {#} other {#}}", value: "kaputt {" }, "kaputt {"), null);
});

test("pluriel JSON : formes de la source puis formes en plus de la traduction", () => {
  const src = JSON.stringify({ one: "1 jour", other: "{{n}} jours" });
  const cur = JSON.stringify({ one: "1 Tag", other: "{{n}} Tage", few: "{{n}} Tagy" });
  const c = compositeOf({ source: src, value: cur }, cur)!;
  assert.deepEqual(labels(c.fields), ["un", "plusieurs", "quelques"]);
  assert.deepEqual(labels(c.src), ["un", "plusieurs"]);
  assert.equal(c.build(["1 Tag", "{{n}} Tage", "x"]), JSON.stringify({ one: "1 Tag", other: "{{n}} Tage", few: "x" }));
});

test("pluriel JSON : garde l'échappement \\uXXXX de l'original", () => {
  const src = '{"one":"1 \\u00e9l\\u00e9ment","other":"{{n}} \\u00e9l\\u00e9ments"}';
  const c = compositeOf({ source: src, value: src }, src)!;
  assert.deepEqual(values(c.fields), ["1 élément", "{{n}} éléments"]);
  assert.equal(c.build(["1 élément", "{{n}} élémentz"]), '{"one":"1 \\u00e9l\\u00e9ment","other":"{{n}} \\u00e9l\\u00e9mentz"}');
});
