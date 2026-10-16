import { splitDrafts, type Drafts } from "./core";
import { SETS } from "./config";

/* Stockage local : confort uniquement, chaque accès peut échouer (navigation privée, stockage bloqué). */
type Kind = "local" | "session";
function store(kind: Kind): Storage | null {
  try { return kind === "local" ? window.localStorage : window.sessionStorage; } catch { return null; }
}
export function sget(k: string, kind: Kind = "local"): string | null {
  try { const s = store(kind); return s ? s.getItem(k) : null; } catch { return null; }
}
export function sset(k: string, v: string | null, kind: Kind = "local") {
  try { const s = store(kind); if (s) { if (v === null) s.removeItem(k); else s.setItem(k, v); } } catch { /* stockage indisponible */ }
}
function sjson<T>(k: string, fallback: T): T {
  try { return JSON.parse(sget(k) || "null") ?? fallback; } catch { return fallback; }
}

/* ---------- Modifications en attente ---------- */
// Les modifications d'un jeu de fichiers ou d'une langue retirés de SETS sont mises de côté (jamais envoyées)
// et signalées au démarrage ; elles reviennent d'elles-mêmes si le jeu ou la langue est remis dans SETS.
export function loadDrafts(): Drafts {
  let saved: unknown;
  try { saved = JSON.parse(sget("i18n-drafts") || "{}"); } catch { return {}; }
  const stored = loadOrphans();
  const { kept, orphans } = splitDrafts({ ...stored, ...(saved as object) }, SETS);
  if (Object.keys(orphans).length || Object.keys(stored).length) {
    sset("i18n-drafts", JSON.stringify(kept));
    sset("i18n-drafts-orphans", Object.keys(orphans).length ? JSON.stringify(orphans) : null);
  }
  return kept;
}
export const saveDrafts = (drafts: Drafts) => sset("i18n-drafts", JSON.stringify(drafts));
export const loadOrphans = (): Drafts => sjson<Drafts>("i18n-drafts-orphans", {});
export const clearOrphans = () => sset("i18n-drafts-orphans", null);

/* ---------- Préférences ---------- */
export const loadSetId = () => sget("i18n-set");
export const saveSetId = (id: string) => sset("i18n-set", id);
export const loadLangPrefs = () => sjson<Record<string, string[]>>("i18n-langs", {});
export const saveLangPrefs = (prefs: Record<string, string[]>) => sset("i18n-langs", JSON.stringify(prefs));

export type Theme = "light" | "dark" | "system";
export const loadTheme = (): Theme => (sget("i18n-theme") as Theme) || "system";
export const saveTheme = (t: Theme) => sset("i18n-theme", t === "system" ? null : t);

/* ---------- Jeton GitHub ---------- */
// Toujours en session ; aussi sur l'ordinateur si « Se souvenir du jeton » est coché.
export function loadToken(): { token: string; remembered: boolean } | null {
  const local = sget("i18n-token");
  const token = sget("i18n-token", "session") || local;
  return token ? { token, remembered: !!local } : null;
}
export function saveToken(token: string, remember: boolean) {
  sset("i18n-token", token, "session");
  sset("i18n-token", remember ? token : null);
}
export function clearToken() {
  sset("i18n-token", null, "session");
  sset("i18n-token", null);
}
