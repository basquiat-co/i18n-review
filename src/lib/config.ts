import type { Status } from "./core";

/* ================= Configuration des fichiers ================= */
export interface FileSet {
  id: string;
  repo: string;     // « propriétaire/dépôt »
  label: string;
  path: string;     // chemin dans le dépôt, {lang} remplacé par la langue
  langs: string[];
  source: string;   // langue de référence
}

export const SETS: FileSet[] = [
  { id: "app", repo: "basquiat-co/basquiat-app", label: "Application mobile (app.json)", path: "app/i18n/{lang}/app.json", langs: ["fr", "de"], source: "fr" },
  { id: "app-expo", repo: "basquiat-co/basquiat-app", label: "Application mobile (expo.json)", path: "app/i18n/{lang}/expo.json", langs: ["fr", "de"], source: "fr" },
  { id: "service", repo: "basquiat-co/basquiat-service", label: "Service (messages)", path: "basquiat_service/i18n/lang/{lang}.json", langs: ["fr", "de"], source: "fr" },
  { id: "salary-simulator", repo: "basquiat-co/basquiat-service", label: "Simulateur de salaire", path: "basquiat_service/salary/static/salary_simulator/i18n/{lang}.json", langs: ["fr", "en", "de", "it", "pt", "ar", "cn"], source: "fr" },
  { id: "bff", repo: "basquiat-co/lift-agentic-service", label: "Lift (BFF)", path: "service_bff/src/locales/{lang}.json", langs: ["fr", "en", "de"], source: "fr" },
];

export const REVIEW_FILE = ".i18n-review.json";
export const SUGGESTIONS_DIR = "i18n-suggestions"; // suggestions des développeurs, un fichier .json par branche
export const BRANCH_PREFIX = "i18n-review/";
export const API = (globalThis as { I18N_API_BASE?: string }).I18N_API_BASE || "https://api.github.com";
export const PAGE = 50;
export const MAX_LANGS = 3; // langues éditées côte à côte

export const LANG_NAMES: Record<string, string> = {
  fr: "français", de: "allemand", en: "anglais", it: "italien", pt: "portugais", ar: "arabe", cn: "chinois",
};
export const langName = (l: string) => LANG_NAMES[l] || l;

export const filePath = (set: FileSet, lang: string) => set.path.replace("{lang}", lang);

// Fichiers que l'outil écrit dans un dépôt : les traductions de ses jeux, le fichier d'état et les suggestions
// (qu'il retire une fois réglées).
export function isReviewedPath(repo: string, path: string): boolean {
  if (path === REVIEW_FILE) return true;
  if (path.startsWith(SUGGESTIONS_DIR + "/") && path.endsWith(".json") && !path.slice(SUGGESTIONS_DIR.length + 1).includes("/")) return true;
  // Les captures d'écran d'une suggestion, que l'outil supprime avec elle.
  if (/^i18n-suggestions\/[^/]+\/.+\.[a-z]{2}\.(current|proposed)\.webp$/.test(path)) return true;
  return SETS.some(s => s.repo === repo && s.langs.some(l => filePath(s, l) === path));
}

// findSet est strict (undefined si le jeu n'existe plus) ; setById retombe sur le premier jeu, pour l'affichage seulement.
export function findSet(id: string | null | undefined): FileSet | undefined { return SETS.find(s => s.id === id); }
export const setById = (id: string | null | undefined): FileSet => findSet(id) || SETS[0];
// Pour écrire sur GitHub : jamais de repli, une modification ne doit pas partir dans un autre dépôt que le sien.
export function knownSet(id: string): FileSet {
  const set = findSet(id);
  if (!set) throw new Error(`Le jeu de fichiers « ${id} » n'existe plus dans la configuration de l'outil.`);
  return set;
}

/* ================= Statuts ================= */
export type FilterKey = "todo" | Status | "all";

export const STATUS_INFO: { key: FilterKey; label: string; status?: Status }[] = [
  { key: "todo", label: "À relire" },
  { key: "missing", label: "Manquantes", status: "missing" },
  { key: "new", label: "Nouvelles", status: "new" },
  { key: "source", label: "Source modifiée", status: "source" },
  { key: "modified", label: "Modifiées hors relecture", status: "modified" },
  { key: "pending", label: "En attente de fusion", status: "pending" },
  { key: "ok", label: "Relues", status: "ok" },
  { key: "all", label: "Toutes" },
];

export const PILL: Record<Status, string> = {
  missing: "Manquante", new: "Nouvelle", source: "Source modifiée", modified: "Modifiée hors relecture", pending: "En attente", ok: "Relue",
};

export const TODO: Status[] = ["missing", "new", "source", "modified"];
// Statut affiché pour un pluriel : le plus urgent de ses formes.
export const STATUS_ORDER: Status[] = ["missing", "source", "modified", "new", "pending", "ok"];

export const FORM_LABEL: Record<string, string> = { zero: "zéro", one: "un", two: "deux", few: "quelques", many: "beaucoup", other: "plusieurs" };
