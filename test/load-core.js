// Charge le moteur pur (window.I18nCore) directement depuis index.html, sans navigateur :
// l'application reste un fichier unique servi tel quel par GitHub Pages.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const HTML_PATH = path.join(__dirname, "..", "index.html");

function inlineScripts(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
}

function loadCore() {
  const scripts = inlineScripts(fs.readFileSync(HTML_PATH, "utf8"));
  const code = scripts.find(s => s.includes("module.exports = api"));
  if (!code) throw new Error("Script du moteur introuvable dans index.html");
  // Exécuté dans le contexte courant (et non un bac à sable vm) pour que les tableaux et objets
  // renvoyés aient les prototypes de Node : assert.deepStrictEqual les compare alors normalement.
  const module = { exports: {} };
  new vm.Script("(function (module) {" + code + "\n})", { filename: "index.html#I18nCore" }).runInThisContext()(module);
  return module.exports;
}

module.exports = { loadCore, inlineScripts, HTML_PATH };
