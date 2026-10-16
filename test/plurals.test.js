"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("./load-core").loadCore();

test("annotatePlurals : regroupe les clés dont toutes les sous-clés sont des formes du pluriel", () => {
  const rows = C.annotatePlurals([
    { segs: ["contracts", "zero"] }, { segs: ["contracts", "one"] }, { segs: ["contracts", "other"] },
    { segs: ["single", "one"] },                         // une seule forme : pas un pluriel
    { segs: ["mixed", "one"] }, { segs: ["mixed", "label"] }, // sous-clé qui n'est pas une forme
    { segs: ["one"] },                                   // clé de premier niveau
  ]);
  const tags = rows.map(r => [r.segs.join("."), r.group || null, r.form || null]);
  assert.deepEqual(tags, [
    ["contracts.zero", "contracts", "zero"],
    ["contracts.one", "contracts", "one"],
    ["contracts.other", "contracts", "other"],
    ["single.one", null, null],
    ["mixed.one", null, null],
    ["mixed.label", null, null],
    ["one", null, null],
  ]);
});

test("parseJsonPlural : reconnaît un pluriel écrit en JSON dans une chaîne", () => {
  assert.deepEqual(C.parseJsonPlural('{"one":"1 jour","other":"{{n}} jours"}'), { one: "1 jour", other: "{{n}} jours" });
  assert.deepEqual(C.parseJsonPlural(' { "zero": "", "other": "x" }'), { zero: "", other: "x" });
});

test("parseJsonPlural : refuse ce qui n'est pas un pluriel", () => {
  for (const s of [
    "texte simple",
    '{"one":"une seule forme"}',
    '{"one":"a","label":"b"}',
    '{"one":1,"other":"b"}',
    '{"one":"a",',
    "{name}",
    null,
    42,
  ]) assert.equal(C.parseJsonPlural(s), null, String(s));
});

test("stringifyJsonPlural : garde le style d'échappement de l'original", () => {
  const forms = { one: "1 élément", other: "{{n}} éléments" };
  assert.equal(C.stringifyJsonPlural(forms, '{"one":"1 élément"}'), '{"one":"1 élément","other":"{{n}} éléments"}');
  assert.equal(C.stringifyJsonPlural(forms, '{"one":"1 \\u00e9l\\u00e9ment"}'),
    '{"one":"1 \\u00e9l\\u00e9ment","other":"{{n}} \\u00e9l\\u00e9ments"}');
  assert.equal(C.stringifyJsonPlural(forms, undefined), JSON.stringify(forms));
});

test("parseIcu : découpe texte et pluriel de premier niveau", () => {
  assert.deepEqual(C.parseIcu("Membres : {names}{more, plural, =0 {} one { et # autre} other { et # autres}}"), [
    { t: "text", v: "Membres : {names}" },
    { t: "arg", name: "more", type: "plural", offset: null, branches: [
      { sel: "=0", v: "" }, { sel: "one", v: " et # autre" }, { sel: "other", v: " et # autres" },
    ] },
  ]);
});

test("parseIcu : select, selectordinal et offset", () => {
  const parts = C.parseIcu("{g, select, male {il} other {elle}} est {n, selectordinal, one {#er} other {#e}}");
  assert.deepEqual(parts.map(p => p.t === "text" ? p.v : p.type), ["select", " est ", "selectordinal"]);
  assert.equal(C.parseIcu("{n, plural, offset:1 =0 {aucun} other {#}}")[0].offset, "offset:1");
});

test("parseIcu : le contenu d'une branche reste du texte (ICU imbriqué compris)", () => {
  const [arg] = C.parseIcu("{n, plural, one {{g, select, male {un ami} other {une amie}}} other {# amis}}");
  assert.equal(arg.branches[0].v, "{g, select, male {un ami} other {une amie}}");
});

test("parseIcu : null pour un texte sans pluriel ou un message mal formé", () => {
  for (const s of ["Pas d'accolade", "Bonjour {name}", "{n, number}", "{n, plural, one {x}", "{n, plural, }", "{n, plural, one x}", 42, null]) {
    assert.equal(C.parseIcu(s), null, String(s));
  }
});

test("serializeIcu : réécrit un message découpé à l'identique", () => {
  for (const s of [
    "Membres : {names}{more, plural, =0 {} one { et # autre} other { et # autres}}",
    "{n, plural, offset:1 =0 {aucun} other {#}}",
    "{g, select, male {il} other {elle}} est {n, selectordinal, one {#er} other {#e}}",
    "{count, plural, one {# contrat} other {# contrats}} actifs",
  ]) assert.equal(C.serializeIcu(C.parseIcu(s)), s);
});

test("serializeIcu : normalise les espaces autour des sélecteurs", () => {
  assert.equal(C.serializeIcu(C.parseIcu("{n,plural,one{# a}other{# b}}")), "{n, plural, one {# a} other {# b}}");
});

test("serializeIcu : applique une branche modifiée", () => {
  const parts = C.parseIcu("{count, plural, one {# jour} other {# jours}}");
  parts[0].branches[1].v = "# Tage";
  parts[0].branches[0].v = "# Tag";
  assert.equal(C.serializeIcu(parts), "{count, plural, one {# Tag} other {# Tage}}");
});
