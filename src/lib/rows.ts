import * as C from "./core";
import { MAX_LANGS, STATUS_ORDER, TODO, type FileSet, type FilterKey } from "./config";
import type { SetData } from "./github";

/* Modèle d'affichage : une clé = la source + une cellule par langue éditée. Fonctions pures. */

export interface Cell extends C.Row { lang: string; draft: C.Draft | null }
export interface Key { id: string; segs: string[]; source: string; group?: string; form?: string; cells: Cell[] }
// Une unité affichée est soit une clé simple, soit un pluriel (toutes ses formes ensemble).
export type Unit = { group: string; keys: Key[]; key?: undefined } | { key: Key; group?: undefined; keys?: undefined };

export const draftKey = (set: string, lang: string, id: string) => set + "|" + lang + "|" + id;

// Langues éditées côte à côte (3 au plus) ; par défaut toutes sauf la source.
export function activeLangs(set: FileSet, prefs: Record<string, string[]>): string[] {
  let langs = (prefs[set.id] || []).filter(l => set.langs.includes(l)).slice(0, MAX_LANGS);
  if (!langs.length) {
    const others = set.langs.filter(l => l !== set.source);
    langs = (others.length ? others : [set.source]).slice(0, MAX_LANGS);
  }
  return langs;
}

export function rowsFor(set: FileSet, data: SetData, lang: string, drafts: C.Drafts): Cell[] {
  const rows = C.computeRows({
    sourceFlat: data.flat[set.source], targetFlat: data.flat[lang], isSource: lang === set.source,
    entries: C.reviewEntries(data.review, set.id, lang), pendingEntries: data.pending[lang],
  });
  return C.annotatePlurals(rows.map(r => ({ ...r, lang, draft: drafts[draftKey(set.id, lang, r.id)] || null })));
}

// Toutes les listes suivent l'ordre de la source.
export function currentKeys(set: FileSet, data: SetData, langs: string[], drafts: C.Drafts): Key[] {
  const lists = langs.map(l => rowsFor(set, data, l, drafts));
  return lists[0].map((r0, i) => ({
    id: r0.id, segs: r0.segs, source: r0.source, group: r0.group, form: r0.form,
    cells: lists.map(list => list[i]),
  }));
}

export function keyMatchesStatus(k: Key, f: FilterKey): boolean {
  if (f === "all") return true;
  if (f === "todo") return k.cells.some(c => TODO.includes(c.status) || c.draft);
  if (f === "ok") return k.cells.every(c => c.status === "ok");
  return k.cells.some(c => c.status === f);
}

export function matchesSearch(k: Key, search: string): boolean {
  if (!search) return true;
  const q = search.toLowerCase();
  return k.id.toLowerCase().includes(q) || k.source.toLowerCase().includes(q) ||
    k.cells.some(c => (c.value || "").toLowerCase().includes(q) || (!!c.draft && c.draft.value.toLowerCase().includes(q)));
}

// Un pluriel s'affiche en entier dès qu'une de ses formes correspond au filtre et à la recherche.
export function buildUnits(keys: Key[], filter: FilterKey, search: string): Unit[] {
  const groups = new Map<string, Key[]>();
  for (const k of keys) if (k.group) { if (!groups.has(k.group)) groups.set(k.group, []); groups.get(k.group)!.push(k); }
  const units: Unit[] = [], seen = new Set<string>();
  for (const k of keys) {
    if (k.group) {
      if (seen.has(k.group)) continue;
      seen.add(k.group);
      const list = groups.get(k.group)!;
      if (list.some(x => keyMatchesStatus(x, filter)) && list.some(x => matchesSearch(x, search))) units.push({ group: k.group, keys: list });
    } else if (keyMatchesStatus(k, filter) && matchesSearch(k, search)) units.push({ key: k });
  }
  return units;
}
export const unitKeys = (u: Unit): Key[] => u.group ? u.keys : [u.key!];
export const unitCells = (u: Unit): Cell[] => unitKeys(u).flatMap(k => k.cells);
export const unitId = (u: Unit) => u.group ?? u.key!.id;

export function filterCounts(keys: Key[], filters: FilterKey[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of filters) out[f] = keys.reduce((n, k) => n + (keyMatchesStatus(k, f) ? 1 : 0), 0);
  return out;
}

// Une forme peut être validée telle quelle si elle a un texte, ou si la source est elle-même vide (ex. « zero »: "").
export const canValidateRow = (r: Cell) => !r.draft && r.status !== "ok" && (r.value !== "" || r.source === "");

// Statut résumé d'un ensemble de cellules (un pluriel, une langue) : le plus urgent.
export const worstStatus = (cells: { status: C.Status }[]): C.Status =>
  STATUS_ORDER.find(s => cells.some(c => c.status === s)) || "ok";

// Les formes « zéro » et « un » peuvent légitimement omettre le nombre (« Aucun contrat », « 1 contrat »).
export function formVars(form: string | undefined, source: string, value: string): string[] {
  const miss = C.missingPlaceholders(source, value);
  return form === "zero" || form === "one" ? miss.filter(v => v !== "count") : miss;
}

/* ---------- Modifications ---------- */

/**
 * Nouvelle valeur pour une cellule ; renvoie les modifications mises à jour, ou null si rien ne change.
 * explicit : validation demandée (bouton « Valider », Ctrl+Entrée) plutôt qu'une simple sortie de champ.
 */
export function applyEdit(drafts: C.Drafts, setId: string, r: Cell, value: string, explicit: boolean): C.Drafts | null {
  const k = draftKey(setId, r.lang, r.id);
  const existing = drafts[k];
  // « edited » = à écrire dans le fichier : texte changé, ou clé encore absente de la langue cible.
  const make = (edited: boolean): C.Draft => ({ set: setId, lang: r.lang, id: r.id, segs: r.segs, value, original: r.value, exists: r.exists, source: r.source, edited: edited || !r.exists });
  const next = { ...drafts };
  if (value === "" && r.source !== "") delete next[k];          // une traduction vide ne peut pas être validée
  else if (value !== r.value) next[k] = make(true);              // correction
  else if (explicit && r.status !== "ok") next[k] = make(false); // validation sans changement
  else if (existing && existing.edited) delete next[k];          // retour au texte d'origine
  else return null;
  return next;
}

export function validateCells(drafts: C.Drafts, setId: string, cells: Cell[]): C.Drafts {
  const next = { ...drafts };
  for (const r of cells) {
    if (!canValidateRow(r)) continue;
    next[draftKey(setId, r.lang, r.id)] = { set: setId, lang: r.lang, id: r.id, segs: r.segs, value: r.value, original: r.value, exists: r.exists, source: r.source, edited: !r.exists };
  }
  return next;
}

export function removeDrafts(drafts: C.Drafts, setId: string, cells: { lang: string; id: string }[]): C.Drafts {
  const next = { ...drafts };
  for (const r of cells) delete next[draftKey(setId, r.lang, r.id)];
  return next;
}
