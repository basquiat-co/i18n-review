"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("./load-core").loadCore();

const vars = s => [...C.placeholderVars(s)];

test("placeholderVars : syntaxes {{nom}}, %{nom} et {nom}", () => {
  assert.deepEqual(vars("Bonjour {{ name }} et {{user.first}}"), ["name", "user.first"]);
  assert.deepEqual(vars("%{count} éléments"), ["count"]);
  assert.deepEqual(vars("Bonjour {name}, tu as {n} messages"), ["name", "n"]);
  assert.deepEqual(vars("Aucune variable"), []);
});

test("placeholderVars : arguments ICU formatés", () => {
  assert.deepEqual(vars("{n, number} le {d, date, short}"), ["n", "d"]);
});

test("placeholderVars : le texte des branches d'un pluriel n'est pas une variable", () => {
  assert.deepEqual(vars("{count, plural, one {# chat} other {# chats}}"), ["count"]);
  assert.deepEqual(vars("{g, select, male {il} female {elle} other {iel}} a {count, plural, one {# chat} other {# chats}}"), ["g", "count"]);
});

test("placeholderVars : variables à l'intérieur des branches", () => {
  assert.deepEqual(vars("{count, plural, one {{name} a # chat} other {{name} a # chats}}"), ["count", "name"]);
});

test("placeholderVars : apostrophes d'échappement ICU et balises {% %}", () => {
  assert.deepEqual(vars("Écrire '{pas_une_variable}' ici, mais {vraie}"), ["vraie"]);
  assert.deepEqual(vars("{% if x %}{{y}}{% endif %}"), ["y"]);
});

test("placeholderVars : un message mal formé ne lève pas d'erreur", () => {
  assert.doesNotThrow(() => vars("{broken, plural, one {x"));
  assert.doesNotThrow(() => vars("}}}{{{"));
});

test("missingPlaceholders : variables de la source absentes de la traduction", () => {
  assert.deepEqual(C.missingPlaceholders("Bonjour {name}", "Hallo"), ["name"]);
  assert.deepEqual(C.missingPlaceholders("Bonjour {name}", "Hallo {name}"), []);
  assert.deepEqual(C.missingPlaceholders("{n} sur {total}", "{total}"), ["n"]);
  assert.deepEqual(C.missingPlaceholders("Bonjour {name}", ""), []); // traduction vide : rien à signaler
});

test("missingPlaceholders : une variable en trop dans la traduction n'est pas signalée", () => {
  assert.deepEqual(C.missingPlaceholders("Bonjour", "Hallo {name}"), []);
});

test("missingPlaceholders : pluriels ICU", () => {
  const src = "{count, plural, one {# jour} other {# jours}}";
  assert.deepEqual(C.missingPlaceholders(src, "{count, plural, one {ein Tag} other {# Tage}}"), []);
  assert.deepEqual(C.missingPlaceholders("{count, plural, one {{name}} other {{name}}}", "{count, plural, one {x} other {y}}"), ["name"]);
});

test("missingPlaceholders : pluriels JSON comparés forme par forme", () => {
  const src = JSON.stringify({ one: "{{n}} jour", other: "{{n}} jours" });
  assert.deepEqual(C.missingPlaceholders(src, JSON.stringify({ one: "{{n}} Tag", other: "{{n}} Tage" })), []);
  assert.deepEqual(C.missingPlaceholders(src, JSON.stringify({ one: "ein Tag", other: "{{n}} Tage" })), ["n"]);
  assert.deepEqual(C.missingPlaceholders(src, JSON.stringify({ one: "{{n}} Tag" })), []); // forme absente : pas de faux positif
});
