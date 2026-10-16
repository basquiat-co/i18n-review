/* Moteur de l'outil de relecture i18n : fonctions pures, sans accès réseau ni DOM. */

export type Json = string | number | boolean | null | Json[] | JsonObject;
export type JsonObject = { [key: string]: Json };

export interface FileFormat { indent: string; trailingNewline: boolean }
export interface FlatEntry { segs: string[]; id: string; value: string }

// Empreinte courte et stable d'une chaîne (cyrb53 tronqué à 8 caractères hexadécimaux).
export function hash(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, "0").slice(-8);
}

// Format d'un fichier JSON : indentation et retour à la ligne final, pour réécrire à l'identique.
export function detectFormat(raw: string): FileFormat {
  const m = raw.match(/\n([ \t]+)"/);
  return { indent: m ? m[1] : "  ", trailingNewline: raw.endsWith("\n") };
}

export function parseFile(raw: string): { obj: JsonObject; fmt: FileFormat } {
  return { obj: JSON.parse(raw), fmt: detectFormat(raw) };
}

export function serializeFile(obj: JsonObject, fmt: FileFormat): string {
  return JSON.stringify(obj, null, fmt.indent) + (fmt.trailingNewline ? "\n" : "");
}

// Une clé est un chemin de segments ; son identifiant texte joint les segments par un point.
// (Les clés plates qui contiennent déjà des points restent un seul segment.)
export function keyId(segs: string[]): string { return segs.join("."); }

export function isPlainObject(v: unknown): v is JsonObject {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function flatten(obj: JsonObject): FlatEntry[] {
  const out: FlatEntry[] = [];
  (function walk(o: JsonObject, segs: string[]) {
    for (const k of Object.keys(o)) {
      const v = o[k];
      const s = segs.concat(k);
      if (isPlainObject(v)) walk(v, s);
      else out.push({ segs: s, id: keyId(s), value: typeof v === "string" ? v : JSON.stringify(v) });
    }
  })(obj, []);
  return out;
}

export function toMap(flat: FlatEntry[]): Map<string, FlatEntry> {
  const m = new Map<string, FlatEntry>();
  for (const e of flat) m.set(e.id, e);
  return m;
}

export function getAt(obj: Json, segs: string[]): Json | undefined {
  let o: Json = obj;
  for (const s of segs) {
    if (!isPlainObject(o) || !(s in o)) return undefined;
    o = o[s];
  }
  return o;
}

// Réordonne les clés d'un objet pour suivre l'ordre de la source ; les clés absentes de la source restent à la fin.
function reorderLike(level: JsonObject, sourceLevel: Json | undefined) {
  if (!isPlainObject(sourceLevel)) return;
  const entries = Object.keys(level).map(k => [k, level[k]] as const);
  const have = new Map(entries);
  const ordered: [string, Json][] = [];
  for (const k of Object.keys(sourceLevel)) if (have.has(k)) { ordered.push([k, have.get(k)!]); have.delete(k); }
  for (const [k, v] of have) ordered.push([k, v]);
  for (const [k] of entries) delete level[k];
  for (const [k, v] of ordered) level[k] = v;
}

// Écrit une valeur ; si la clé (ou un parent) manque dans la langue cible, elle est insérée à sa place selon la source.
export function setAt(obj: JsonObject, segs: string[], value: Json, sourceObj: Json | undefined) {
  let level = obj;
  let srcLevel = sourceObj;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const last = i === segs.length - 1;
    const existed = s in level;
    if (last) level[s] = value;
    else if (!existed || !isPlainObject(level[s])) level[s] = {};
    if (!existed) reorderLike(level, srcLevel);
    level = level[s] as JsonObject;
    srcLevel = isPlainObject(srcLevel) ? srcLevel[s] : undefined;
  }
}

// ---------- Variables d'interpolation ----------
// Reconnaît {{nom}}, %{nom}, {nom} et les messages ICU {count, plural, one {…} other {…}} :
// le texte des branches d'un pluriel n'est pas une variable.
export function placeholderVars(str: string): Set<string> {
  const vars = new Set<string>();
  for (const m of str.matchAll(/\{\{\s*([A-Za-z_][\w.]*)\s*\}\}/g)) vars.add(m[1]);
  for (const m of str.matchAll(/%\{\s*([A-Za-z_]\w*)\s*\}/g)) vars.add(m[1]);
  const rest = str.replace(/\{\{\s*[A-Za-z_][\w.]*\s*\}\}/g, " ").replace(/\{%[\s\S]*?%\}/g, " ").replace(/%\{[^}]*\}/g, " ");
  try { icuMessage(rest, 0, vars); } catch { /* message mal formé : on ne signale rien */ }
  return vars;
}

// Lit un message jusqu'à l'accolade fermante de sa branche (ou la fin) ; renvoie la position de cette accolade.
function icuMessage(s: string, i: number, vars: Set<string>): number {
  while (i < s.length) {
    const c = s[i];
    if (c === "'" && (s[i + 1] === "{" || s[i + 1] === "}")) { const end = s.indexOf("'", i + 1); i = end < 0 ? s.length : end + 1; continue; }
    if (c === "{") { i = icuArgument(s, i, vars); continue; }
    if (c === "}") return i;
    i++;
  }
  return i;
}

function skipBalanced(s: string, i: number): number { // i sur « { » ; renvoie la position après l'accolade fermante correspondante
  let depth = 0;
  for (; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i + 1;
  }
  return s.length;
}

function icuArgument(s: string, start: number, vars: Set<string>): number {
  let i = start + 1;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  ws();
  const name = (s.slice(i).match(/^\w+/) || [""])[0];
  if (!name) return skipBalanced(s, start);
  i += name.length; ws();
  if (s[i] === "}") { vars.add(name); return i + 1; }
  if (s[i] !== ",") return skipBalanced(s, start);
  i++; ws();
  const type = (s.slice(i).match(/^\w+/) || [""])[0];
  i += type.length; ws();
  vars.add(name);
  if (s[i] === "}") return i + 1;
  if (s[i] !== "," || !/^(plural|select|selectordinal)$/.test(type)) return skipBalanced(s, start);
  i++;
  for (;;) {
    ws();
    if (i >= s.length) return i;
    if (s[i] === "}") return i + 1;
    const sel = (s.slice(i).match(/^[^\s{}]+/) || [""])[0];
    i += sel.length; ws();
    if (/^offset:/.test(sel)) continue;
    if (s[i] !== "{") return skipBalanced(s, start);
    i = icuMessage(s, i + 1, vars);
    if (s[i] === "}") i++;
  }
}

// ---------- Pluriels ----------
export const PLURAL_FORMS = ["zero", "one", "two", "few", "many", "other"];
const isPluralObject = (o: unknown): o is Record<string, string> => isPlainObject(o) && Object.keys(o).length > 1 &&
  Object.keys(o).every(k => PLURAL_FORMS.includes(k) && typeof o[k] === "string");

// Clés dont toutes les sous-clés sont des formes du pluriel ({ zero, one, other }) : regroupées pour l'édition.
export function annotatePlurals<T extends { segs: string[]; group?: string; form?: string }>(rows: T[]): T[] {
  const byParent = new Map<string, T[]>();
  for (const r of rows) {
    if (r.segs.length < 2) continue;
    const parent = keyId(r.segs.slice(0, -1));
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent)!.push(r);
  }
  for (const [parent, list] of byParent) {
    if (list.length < 2 || !list.every(r => PLURAL_FORMS.includes(r.segs[r.segs.length - 1]))) continue;
    for (const r of list) { r.group = parent; r.form = r.segs[r.segs.length - 1]; }
  }
  return rows;
}

// ---------- Messages ICU découpés pour l'édition ----------
// « Membres : {names}{more, plural, =0 {} one { et # autre} other { et # autres}} » devient
// [texte "Membres : {names}", arg more/plural avec ses branches]. Seuls les plural/select du premier niveau
// sont découpés ; le contenu d'une branche reste du texte (il peut contenir {names} ou un ICU imbriqué).
export type IcuText = { t: "text"; v: string };
export type IcuArg = { t: "arg"; name: string; type: string; offset: string | null; branches: { sel: string; v: string }[] };
export type IcuPart = IcuText | IcuArg;

export function parseIcu(s: unknown): IcuPart[] | null {
  if (typeof s !== "string" || s.indexOf("{") < 0) return null;
  const parts: IcuPart[] = [];
  let text = "", i = 0, found = false;
  const header = /^\{\s*(\w+)\s*,\s*(plural|select|selectordinal)\s*,/;
  while (i < s.length) {
    if (s[i] !== "{") { text += s[i++]; continue; }
    const m = s.slice(i).match(header);
    if (!m) { const end = skipBalanced(s, i); text += s.slice(i, end); i = end; continue; }
    let j = i + m[0].length;
    const arg: IcuArg = { t: "arg", name: m[1], type: m[2], offset: null, branches: [] };
    for (;;) {
      while (j < s.length && /\s/.test(s[j])) j++;
      if (j >= s.length) return null;
      if (s[j] === "}") { j++; break; }
      const sel = (s.slice(j).match(/^[^\s{}]+/) || [""])[0];
      if (!sel) return null;
      j += sel.length;
      if (/^offset:/.test(sel)) { arg.offset = sel; continue; }
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] !== "{") return null;
      const end = skipBalanced(s, j);
      if (s[end - 1] !== "}") return null;
      arg.branches.push({ sel, v: s.slice(j + 1, end - 1) });
      j = end;
    }
    if (!arg.branches.length) return null;
    if (text) { parts.push({ t: "text", v: text }); text = ""; }
    parts.push(arg); found = true; i = j;
  }
  if (text) parts.push({ t: "text", v: text });
  return found ? parts : null;
}

export function serializeIcu(parts: IcuPart[]): string {
  return parts.map(p => p.t === "text" ? p.v
    : "{" + p.name + ", " + p.type + ", " + (p.offset ? p.offset + " " : "") + p.branches.map(b => b.sel + " {" + b.v + "}").join(" ") + "}").join("");
}

// Pluriel écrit comme du JSON dans une chaîne : "{\"one\":\"…\",\"other\":\"…\"}".
export function parseJsonPlural(str: unknown): Record<string, string> | null {
  if (typeof str !== "string" || !/^\s*\{\s*"/.test(str)) return null;
  try { const o = JSON.parse(str); return isPluralObject(o) ? o : null; } catch { return null; }
}

// Réécrit ce pluriel dans le même style que l'original (caractères accentués échappés en \uXXXX ou non).
export function stringifyJsonPlural(obj: Record<string, string>, like?: string): string {
  const out = JSON.stringify(obj);
  if (!/\\u[0-9a-fA-F]{4}/.test(like || "")) return out;
  return out.replace(/[\u007f-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

export function missingPlaceholders(source: string, target: string): string[] {
  if (!target) return [];
  const js = parseJsonPlural(source), jt = parseJsonPlural(target);
  if (js && jt) {
    const miss = new Set<string>();
    for (const f of Object.keys(js)) for (const v of missingPlaceholders(js[f], jt[f] || "")) miss.add(v);
    return [...miss];
  }
  const t = placeholderVars(target);
  return [...placeholderVars(source)].filter(v => !t.has(v));
}

// ---------- Fichier d'état de relecture (.i18n-review.json) ----------
// { "version": 1, "sets": { "<jeu>": { "<langue>": { "<clé>": "<empreinte source> <empreinte traduction>" } } } }
// Pour la langue source, l'entrée ne contient que l'empreinte du texte.

export type ReviewEntries = Record<string, string>;
export interface Review { version: number; sets: Record<string, Record<string, ReviewEntries>> }

export function emptyReview(): Review { return { version: 1, sets: {} }; }

export function parseReview(raw: string | null | undefined): Review {
  if (!raw) return emptyReview();
  const r = JSON.parse(raw);
  if (!r || typeof r !== "object" || !r.sets) return emptyReview();
  return r;
}

function sortDeep<T>(v: T): T {
  if (!isPlainObject(v)) return v;
  const o: JsonObject = {};
  for (const k of Object.keys(v).sort()) o[k] = sortDeep(v[k]);
  return o as T;
}

export function serializeReview(review: Review): string {
  return JSON.stringify({ version: 1, sets: sortDeep(review.sets) }, null, 2) + "\n";
}

export function reviewEntries(review: Review, setId: string, lang: string): ReviewEntries {
  return (review.sets[setId] && review.sets[setId][lang]) || {};
}

function entryFor(isSource: boolean, sourceValue: string, targetValue: string): string {
  return isSource ? hash(targetValue) : hash(sourceValue) + " " + hash(targetValue);
}

// ---------- Statuts ----------
export const STATUS = {
  missing: "missing",   // pas de traduction (clé absente ou vide)
  fresh: "new",         // jamais relue
  source: "source",     // le texte source a changé depuis la relecture
  modified: "modified", // la traduction a été modifiée en dehors de la relecture
  pending: "pending",   // validée dans une PR ouverte, pas encore fusionnée
  ok: "ok",             // relue et inchangée
} as const;
export type Status = typeof STATUS[keyof typeof STATUS];

export interface PendingInfo { number: number; url: string }
export interface Row {
  id: string; segs: string[]; source: string;
  value: string; exists: boolean;
  status: Status; pending: PendingInfo | null;
  group?: string; form?: string;
}

/**
 * Construit les lignes à afficher pour une langue.
 * sourceFlat / targetFlat : sorties de flatten() ; entries : entrées de relecture de cette langue ;
 * pendingEntries : Map clé -> { number, url } venant des PR ouvertes.
 */
export function computeRows({ sourceFlat, targetFlat, isSource, entries, pendingEntries }: {
  sourceFlat: FlatEntry[]; targetFlat?: FlatEntry[] | null; isSource: boolean;
  entries: ReviewEntries; pendingEntries?: Map<string, PendingInfo>;
}): Row[] {
  const target = isSource ? null : toMap(targetFlat || []);
  const rows: Row[] = [];
  for (const src of sourceFlat) {
    const tgt = isSource ? src : target!.get(src.id);
    const value = tgt ? tgt.value : undefined;
    const entry = entries[src.id];
    let status: Status;
    if (value === undefined || (value === "" && src.value !== "")) status = STATUS.missing;
    else if (!entry) status = STATUS.fresh;
    else {
      const [a, b] = entry.split(" ");
      const trHash = isSource ? a : b;
      if (!isSource && a !== hash(src.value)) status = STATUS.source;
      else if (trHash !== hash(value)) status = STATUS.modified;
      else status = STATUS.ok;
    }
    let pending: PendingInfo | null = null;
    if (status !== STATUS.ok && pendingEntries && pendingEntries.has(src.id)) {
      pending = pendingEntries.get(src.id)!;
      status = STATUS.pending;
    }
    rows.push({
      id: src.id, segs: src.segs, source: src.value,
      value: value === undefined ? "" : value, exists: value !== undefined,
      status, pending,
    });
  }
  return rows;
}

export type StatusCounts = Record<Status, number> & { todo: number; total: number };

export function countStatuses(rows: { status: Status }[]): StatusCounts {
  const c = { missing: 0, new: 0, source: 0, modified: 0, pending: 0, ok: 0, todo: 0, total: 0 };
  for (const r of rows) c[r.status]++;
  c.todo = c.missing + c.new + c.source + c.modified;
  c.total = rows.length;
  return c;
}

// ---------- Application d'une relecture ----------

/**
 * Applique les modifications sur la version la plus récente des fichiers.
 * edits : [{ segs, value }] ; renvoie le nouveau contenu ou null si rien n'a changé.
 */
export function applyEdits(targetRaw: string, sourceObj: Json | undefined, edits: { segs: string[]; value: string }[]): string | null {
  if (!edits.length) return null;
  const { obj, fmt } = parseFile(targetRaw);
  let changed = false;
  for (const e of edits) {
    if (getAt(obj, e.segs) === e.value) continue;
    setAt(obj, e.segs, e.value, sourceObj);
    changed = true;
  }
  return changed ? serializeFile(obj, fmt) : null;
}

/**
 * Met à jour l'état de relecture d'une langue.
 * validations : [{ id, source, value }] (texte source vu par le traducteur, valeur finale) ;
 * liveIds : identifiants des clés encore présentes dans la source (les autres entrées sont supprimées).
 */
export function updateReview(review: Review, setId: string, lang: string, isSource: boolean,
  validations: { id: string; source: string; value: string }[], liveIds: Set<string> | null): Review {
  const next: Review = JSON.parse(JSON.stringify(review));
  next.sets[setId] = next.sets[setId] || {};
  const cur = next.sets[setId][lang] || {};
  const out: ReviewEntries = {};
  for (const k of Object.keys(cur)) if (!liveIds || liveIds.has(k)) out[k] = cur[k];
  for (const v of validations) out[v.id] = entryFor(isSource, v.source, v.value);
  next.sets[setId][lang] = out;
  return next;
}

// Considère tout l'existant d'un jeu comme relu (point de départ après Lokalise).
export function initReview(review: Review, setId: string, sourceLang: string, langsFlat: Record<string, FlatEntry[]>): Review {
  let next = review;
  const sourceFlat = langsFlat[sourceLang];
  const liveIds = new Set(sourceFlat.map(e => e.id));
  for (const lang of Object.keys(langsFlat)) {
    const isSource = lang === sourceLang;
    const tmap = toMap(langsFlat[lang]);
    const validations = [];
    for (const src of sourceFlat) {
      const t = isSource ? src : tmap.get(src.id);
      if (!t || (t.value === "" && src.value !== "")) continue;
      validations.push({ id: src.id, source: src.value, value: t.value });
    }
    next = updateReview(next, setId, lang, isSource, validations, liveIds);
  }
  return next;
}

// ---------- Modifications en attente ----------

export interface Draft {
  set: string; lang: string; id: string; segs: string[];
  value: string;      // texte final
  original: string;   // texte sur GitHub au moment de la modification
  exists: boolean;    // la clé existait déjà dans la langue cible
  source: string;     // texte source vu par le traducteur
  edited: boolean;    // à écrire dans le fichier (sinon simple validation)
}
export type Drafts = Record<string, Draft>;

/**
 * Sépare les modifications enregistrées sur l'ordinateur : celles dont le jeu de fichiers et la langue
 * existent encore dans la configuration (sets), et les autres, qui ne doivent être envoyées nulle part.
 * drafts : { "<jeu>|<langue>|<clé>": { set, lang, … } } ; les entrées qui ne sont pas des objets sont ignorées.
 */
export function splitDrafts(drafts: unknown, sets: { id: string; langs: string[] }[]): { kept: Drafts; orphans: Drafts } {
  const kept: Drafts = {}, orphans: Drafts = {};
  for (const [k, d] of Object.entries(isPlainObject(drafts) ? drafts : {})) {
    if (!isPlainObject(d)) continue;
    const set = sets.find(s => s.id === d.set);
    if (set && set.langs.includes(d.lang as string)) kept[k] = d as unknown as Draft; else orphans[k] = d as unknown as Draft;
  }
  return { kept, orphans };
}
