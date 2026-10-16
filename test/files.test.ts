import { test } from "vitest";
import assert from "node:assert/strict";
import * as C from "../src/lib/core";

test("hash : empreinte stable de 8 caractères hexadécimaux", () => {
  assert.equal(C.hash("Bonjour"), C.hash("Bonjour"));
  assert.notEqual(C.hash("Bonjour"), C.hash("bonjour"));
  for (const s of ["", "Bonjour", "Grüezi ✓", "x".repeat(10000)]) assert.match(C.hash(s), /^[0-9a-f]{8}$/);
});

test("hash : valeurs figées (le fichier .i18n-review.json en dépend)", () => {
  // Changer l'algorithme ferait repasser toutes les clés relues en « modifiée ».
  assert.equal(C.hash(""), "1aee8d83");
  assert.equal(C.hash("Bonjour"), "db0a9441");
});

test("detectFormat : indentation et retour à la ligne final", () => {
  assert.deepEqual(C.detectFormat('{\n  "a": 1\n}\n'), { indent: "  ", trailingNewline: true });
  assert.deepEqual(C.detectFormat('{\n    "a": 1\n}'), { indent: "    ", trailingNewline: false });
  assert.deepEqual(C.detectFormat('{\n\t"a": 1\n}\n'), { indent: "\t", trailingNewline: true });
  assert.deepEqual(C.detectFormat('{"a":1}'), { indent: "  ", trailingNewline: false });
});

test("parseFile / serializeFile : réécriture à l'identique", () => {
  for (const raw of [
    '{\n  "a": "1",\n  "b": {\n    "c": "2"\n  }\n}\n',
    '{\n    "a": "1"\n}',
    '{\n\t"a": {\n\t\t"b": "é"\n\t}\n}\n',
  ]) {
    const { obj, fmt } = C.parseFile(raw);
    assert.equal(C.serializeFile(obj, fmt), raw);
  }
});

test("flatten : chemins, identifiants et valeurs non textuelles", () => {
  assert.deepEqual(C.flatten({ a: { b: "c", n: 1, list: [1, 2], nul: null }, "d.e": "f" }), [
    { segs: ["a", "b"], id: "a.b", value: "c" },
    { segs: ["a", "n"], id: "a.n", value: "1" },
    { segs: ["a", "list"], id: "a.list", value: "[1,2]" },
    { segs: ["a", "nul"], id: "a.nul", value: "null" },
    { segs: ["d.e"], id: "d.e", value: "f" }, // une clé plate qui contient un point reste un seul segment
  ]);
  assert.deepEqual(C.flatten({}), []);
});

test("toMap : indexe les entrées par identifiant", () => {
  const m = C.toMap(C.flatten({ a: { b: "c" }, d: "e" }));
  assert.deepEqual([...m.keys()], ["a.b", "d"]);
  assert.equal(m.get("a.b")!.value, "c");
});

test("getAt : lit une valeur, undefined si le chemin manque", () => {
  const o = { a: { b: "c" }, s: "str" };
  assert.equal(C.getAt(o, ["a", "b"]), "c");
  assert.deepEqual(C.getAt(o, ["a"]), { b: "c" });
  assert.equal(C.getAt(o, ["a", "x"]), undefined);
  assert.equal(C.getAt(o, ["s", "length"]), undefined); // ne descend pas dans une chaîne
});

test("setAt : remplace une valeur existante sans toucher l'ordre", () => {
  const o = { b: "1", a: "2" };
  C.setAt(o, ["a"], "deux", { a: "", b: "" });
  assert.deepEqual(Object.keys(o), ["b", "a"]);
  assert.equal(o.a, "deux");
});

test("setAt : insère une clé manquante à sa place selon la source", () => {
  const source = { a: { x: "1", y: "2", z: "3" }, b: "B" };
  const target = { b: "bb", a: { z: "zz" } };
  C.setAt(target, ["a", "x"], "xx", source);
  assert.deepEqual(Object.keys(target.a), ["x", "z"]);
  assert.deepEqual(Object.keys(target), ["b", "a"]); // « a » existait : sa position ne change pas
});

test("setAt : crée les parents manquants dans l'ordre de la source", () => {
  const source = { a: { y: "2" }, b: "B", extra: "E" };
  const target = { custom: "c", b: "bb" };
  C.setAt(target, ["a", "y"], "yy", source);
  assert.deepEqual(target, { a: { y: "yy" }, b: "bb", custom: "c" }); // clés absentes de la source à la fin
  assert.deepEqual(Object.keys(target), ["a", "b", "custom"]);
});

test("setAt : remplace une valeur simple par un objet si le chemin l'exige", () => {
  const target = { a: "texte" };
  C.setAt(target, ["a", "b"], "v", { a: { b: "" } });
  assert.deepEqual(target, { a: { b: "v" } });
});
