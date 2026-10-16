import { create } from "zustand";
import type { Drafts } from "@/lib/core";
import { PAGE, SETS, knownSet, setById, type FilterKey } from "@/lib/config";
import { GhError, GitHub, explain, type CreatedPr, type GhUser, type SetData } from "@/lib/github";
import { activeLangs, applyEdit, draftKey, removeDrafts, validateCells, type Cell } from "@/lib/rows";
import * as storage from "@/lib/storage";

export interface Notice { id: number; kind: "ok" | "error"; text: string; link?: { href: string; text: string } }
export type PrMode = "drafts" | "init";

interface AppState {
  booting: boolean;          // connexion automatique avec un jeton enregistré
  user: GhUser | null;
  loginError: string;
  setId: string;
  langPrefs: Record<string, string[]>;
  filter: FilterKey;
  search: string;
  shown: number;
  data: Record<string, SetData>;
  loading: boolean;
  drafts: Drafts;
  orphans: Drafts;
  rawRows: Record<string, true>; // cellules affichées en texte brut plutôt que forme par forme
  notices: Notice[];
  pr: { open: boolean; mode: PrMode; setId: string; submitting: boolean };
  theme: storage.Theme;
}

const savedToken = storage.loadToken();

export const useApp = create<AppState>(() => ({
  booting: !!savedToken,
  user: null,
  loginError: "",
  setId: setById(storage.loadSetId()).id, // un jeu retiré de SETS ne doit pas rester sélectionné
  langPrefs: storage.loadLangPrefs(),
  filter: "todo",
  search: "",
  shown: PAGE,
  data: {},
  loading: false,
  drafts: storage.loadDrafts(),
  orphans: storage.loadOrphans(),
  rawRows: {},
  notices: [],
  pr: { open: false, mode: "drafts", setId: SETS[0].id, submitting: false },
  theme: storage.loadTheme(),
}));

const get = useApp.getState;
const set = useApp.setState;
let client: GitHub | null = null;

/* ================= Messages ================= */
let noticeId = 0;
export function notify(kind: Notice["kind"], text: string, link?: Notice["link"]) {
  set(s => ({ notices: [...s.notices, { id: ++noticeId, kind, text, link }] }));
}
export const dismissNotice = (id: number) => set(s => ({ notices: s.notices.filter(n => n.id !== id) }));

/* ================= Connexion ================= */
export async function login(token: string, remember: boolean) {
  const gh = new GitHub(token);
  let user: GhUser;
  try {
    user = await gh.user();
  } catch (e) {
    set({ booting: false, loginError: (e as GhError).status === 401 ? "Ce jeton est refusé par GitHub. Vérifie qu'il est complet et qu'il n'a pas expiré." : "Connexion impossible : " + explain(e) });
    return;
  }
  client = gh;
  storage.saveToken(token, remember);
  set({ booting: false, user, loginError: "" });
  await refresh();
}

export function logout(message?: string) {
  client = null;
  storage.clearToken();
  set({ user: null, data: {}, loginError: message || "", notices: [], pr: { ...get().pr, open: false, submitting: false } });
}

let autoLoginDone = false;
export function autoLogin() {
  if (autoLoginDone) return; // une seule fois, même si React monte deux fois l'application en développement
  autoLoginDone = true;
  if (savedToken) void login(savedToken.token, savedToken.remembered);
}
export const rememberedToken = () => !!savedToken?.remembered;

/* ================= Chargement ================= */
let loadSeq = 0;
export async function refresh(force = false) {
  const { setId, data } = get();
  if (!client) return;
  if (data[setId] && !force) return;
  const seq = ++loadSeq;
  set({ loading: true });
  try {
    const loaded = await client.loadSet(setById(setId));
    set(s => ({ data: { ...s.data, [setId]: loaded } }));
  } catch (e) {
    if ((e as GhError).status === 401) { logout("Le jeton GitHub est refusé (expiré ou révoqué). Colle un nouveau jeton."); return; }
    notify("error", "Impossible de charger les fichiers. " + explain(e, setById(setId).repo));
  } finally {
    if (seq === loadSeq) set({ loading: false }); // un chargement plus récent garde la main
  }
}

/* ================= Navigation ================= */
export function selectSet(id: string) {
  storage.saveSetId(id);
  set({ setId: id, shown: PAGE, search: "" });
  void refresh();
}

export function toggleLang(lang: string) {
  const { setId, langPrefs } = get();
  const fileSet = setById(setId);
  const langs = activeLangs(fileSet, langPrefs);
  const on = langs.includes(lang);
  if (on && langs.length === 1) return; // il faut garder au moins une langue
  const next = on ? langs.filter(x => x !== lang) : [...langs, lang];
  const prefs = { ...langPrefs, [setId]: fileSet.langs.filter(x => next.includes(x)) }; // ordre stable : celui du jeu
  storage.saveLangPrefs(prefs);
  set({ langPrefs: prefs, shown: PAGE });
}

export function setTheme(theme: storage.Theme) {
  storage.saveTheme(theme);
  set({ theme });
}

export const setFilter = (filter: FilterKey) => set({ filter, shown: PAGE });
export const setSearch = (search: string) => set({ search, shown: PAGE });
export const showMore = () => set(s => ({ shown: s.shown + PAGE }));
export const toggleRaw = (key: string) => set(s => {
  const rawRows = { ...s.rawRows };
  if (rawRows[key]) delete rawRows[key]; else rawRows[key] = true;
  return { rawRows };
});

/* ================= Modifications ================= */
function saveDrafts(drafts: Drafts) {
  storage.saveDrafts(drafts);
  set({ drafts });
}
export function editCell(cell: Cell, value: string, explicit: boolean) {
  const next = applyEdit(get().drafts, get().setId, cell, value, explicit);
  if (next) saveDrafts(next);
}
export const validate = (cells: Cell[]) => saveDrafts(validateCells(get().drafts, get().setId, cells));
export const undo = (cells: Cell[]) => saveDrafts(removeDrafts(get().drafts, get().setId, cells));
export const discardAll = () => saveDrafts({});
export function deleteOrphans() {
  storage.clearOrphans();
  set({ orphans: {} });
}

/* ================= Pull request ================= */
// Pendant la création, le panneau ne peut être ni fermé ni rouvert : un second envoi créerait une PR en double.
export function openPr(mode: PrMode, setId = get().setId) {
  if (get().pr.submitting) return;
  set({ pr: { open: true, mode, setId, submitting: false } });
}
export function closePr() {
  if (get().pr.submitting) return;
  set(s => ({ pr: { ...s.pr, open: false } }));
}

export async function submitPr(title: string, note: string) {
  const { pr, user } = get();
  if (pr.submitting || !client) return;
  set({ pr: { ...pr, submitting: true } });
  const who = user ? (user.name || user.login) : "relecture";
  const results: CreatedPr[] = [];
  const done = () => { for (const r of results) notify("ok", `Pull request créée dans ${r.repo}.`, { href: r.url, text: "Ouvrir la PR #" + r.number }); };
  try {
    if (pr.mode === "init") {
      results.push(await client.createPr(knownSet(pr.setId).repo, title, note, who, { initSet: pr.setId }));
    } else {
      const repos = [...new Set(Object.values(get().drafts).map(d => knownSet(d.set).repo))];
      for (const repo of repos) {
        const drafts = Object.values(get().drafts).filter(d => knownSet(d.set).repo === repo);
        results.push(await client.createPr(repo, title, note, who, { drafts }));
        const left = { ...get().drafts };
        for (const d of drafts) delete left[draftKey(d.set, d.lang, d.id)];
        saveDrafts(left);
      }
    }
    set(s => ({ pr: { ...s.pr, open: false, submitting: false }, data: {} }));
    done();
    await refresh();
  } catch (e) {
    set(s => ({ pr: { ...s.pr, open: false, submitting: false } }));
    done();
    notify("error", "La pull request n'a pas pu être créée. " + explain(e) + " Tes modifications sont conservées.");
  }
}

