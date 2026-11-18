import { create } from "zustand";
import { rebaseDraft, type Drafts } from "@/lib/core";
import { PAGE, SETS, knownSet, setById, type FilterKey } from "@/lib/config";
import { GhError, GitHub, StaleDraftsError, explain, type CreatedPr, type GhUser, type SetData } from "@/lib/github";
import { activeLangs, applyEdit, draftKey, driftedDrafts, removeDrafts, validateCells, type Cell } from "@/lib/rows";
import * as storage from "@/lib/storage";

export interface Notice { id: number; kind: "ok" | "warn" | "error"; text: string; link?: { href: string; text: string } }
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
  checkedAt: Record<string, number>; // dernière fois que main a été comparé à ce qui est affiché, par jeu
  drafts: Drafts;
  orphans: Drafts;
  rawRows: Record<string, true>; // cellules affichées en texte brut plutôt que forme par forme
  notices: Notice[];
  pr: { open: boolean; mode: PrMode; setId: string; submitting: boolean; checking: boolean; refused: boolean };
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
  checkedAt: {},
  drafts: storage.loadDrafts(),
  orphans: storage.loadOrphans(),
  rawRows: {},
  notices: [],
  pr: { open: false, mode: "drafts", setId: SETS[0].id, submitting: false, checking: false, refused: false },
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
  watchMain();
  await refresh();
}

export function logout(message?: string) {
  client = null;
  generation++;
  unwatch?.();
  storage.clearToken();
  set({ user: null, data: {}, loginError: message || "", notices: [], pr: { ...get().pr, open: false, submitting: false, checking: false } });
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
  const gen = ++generation; // un rechargement demandé passe devant une vérification en fond en cours
  set({ loading: true });
  try {
    const loaded = await client.loadSet(setById(setId));
    if (gen !== generation) return;
    set(s => ({ data: { ...s.data, [setId]: loaded }, checkedAt: { ...s.checkedAt, [setId]: Date.now() } }));
    reconcile(setId);
  } catch (e) {
    if ((e as GhError).status === 401) { logout("Le jeton GitHub est refusé (expiré ou révoqué). Colle un nouveau jeton."); return; }
    notify("error", "Impossible de charger les fichiers. " + explain(e, setById(setId).repo));
  } finally {
    if (seq === loadSeq) set({ loading: false }); // un chargement plus récent garde la main
  }
}

/* ================= Main toujours à jour ================= */
// Ce qui est affiché suit main sans qu'Alex ait à recharger : une vérification par minute tant que l'onglet est
// visible, et dès qu'il y revient. Une vérification lit le sha de main (1 requête) ; s'il a bougé, la comparaison
// dit si un fichier relu a changé (1 requête) ; seulement alors les fichiers sont relus.
let generation = 0; // change à chaque envoi, rechargement demandé ou déconnexion : un résultat plus ancien est jeté
let unwatch: (() => void) | null = null;
let ticking = false;
const CHECK_EVERY = 60_000;

function watchMain() {
  unwatch?.();
  const tick = () => { if (!document.hidden) void checkMain(); };
  const timer = window.setInterval(tick, CHECK_EVERY);
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("focus", tick);
  unwatch = () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", tick);
    window.removeEventListener("focus", tick);
    unwatch = null;
  };
}

// Vérification en fond du jeu affiché : jamais de message en cas d'échec (le réseau reviendra à la suivante).
export async function checkMain() {
  const { setId, pr, loading } = get();
  if (ticking || !client || loading || pr.submitting || pr.checking) return;
  ticking = true;
  try { await freshen(setId); }
  catch (e) { if ((e as GhError).status === 401) logout("Le jeton GitHub est refusé (expiré ou révoqué). Colle un nouveau jeton."); }
  finally { ticking = false; }
}

/** Remet un jeu à jour avec main s'il a bougé ; lève l'erreur de GitHub, à l'appelant de dire s'il l'affiche. */
async function freshen(setId: string) {
  const c = client;
  if (!c) return;
  const gen = generation;
  const fileSet = setById(setId);
  const old = get().data[setId];
  let next: SetData | null = null;
  if (!old) next = await c.loadSet(fileSet);
  else {
    const head = await c.repoHead(fileSet.repo);
    if (head.sha !== old.sha) next = await c.touchesReviewed(fileSet.repo, old.sha, head.sha) ? await c.loadSet(fileSet) : { ...old, sha: head.sha };
  }
  if (next) await untilFieldLeft();
  if (gen !== generation || c !== client) return;
  set(s => ({ ...(next ? { data: { ...s.data, [setId]: next } } : {}), checkedAt: { ...s.checkedAt, [setId]: Date.now() } }));
  reconcile(setId);
}

// Les champs ne sont pas contrôlés et sont recréés quand leur texte change : remplacer les données pendant
// qu'Alex tape dans un champ effacerait sa saisie. On attend qu'il le quitte (sa sortie de champ enregistre la
// modification, que la comparaison avec main signale ensuite si main a changé ce texte).
function untilFieldLeft(): Promise<void> {
  const a = document.activeElement;
  if (!(a instanceof HTMLTextAreaElement) || !a.closest("#rows") || a.value === a.defaultValue) return Promise.resolve();
  return new Promise(resolve => a.addEventListener("blur", () => setTimeout(resolve, 0), { once: true }));
}

// Modifications d'un jeu face à main : celle que main contient déjà devient une validation ; celle qui n'a plus
// d'objet (clé supprimée, validation d'un texte qui a changé) est retirée, avec un message ; un conflit reste,
// signalé sur la ligne et dans la fenêtre d'envoi.
function reconcile(setId: string) {
  const { drafts, data } = get();
  const drifted = driftedDrafts(drafts, data, setId);
  if (!drifted.some(x => x.drift !== "conflict")) return;
  const next = { ...drafts };
  const dropped: string[] = [];
  for (const x of drifted) {
    if (x.drift === "absorbed") next[x.key] = rebaseDraft(x.draft, x.now);
    else if (x.drift !== "conflict") { delete next[x.key]; dropped.push(`${x.draft.id} (${x.draft.lang})`); }
  }
  saveDrafts(next);
  if (dropped.length) {
    const n = dropped.length, list = dropped.slice(0, 5).join(", ") + (n > 5 ? `, et ${n - 5} autre${n > 6 ? "s" : ""}` : "");
    notify("warn", `${n} modification${n > 1 ? "s retirées" : " retirée"} : la branche principale a supprimé la clé, ou changé le texte que tu avais validé tel quel (${list}). Relis ${n > 1 ? "ces lignes" : "cette ligne"} si besoin.`);
  }
}

/** Conflit : garder ma correction, désormais comparée au texte actuel de main. */
export function keepMine(key: string) {
  const { drafts, data } = get();
  const x = driftedDrafts({ [key]: drafts[key] }, data)[0];
  if (x) saveDrafts({ ...drafts, [key]: rebaseDraft(x.draft, x.now) });
}
/** Conflit : abandonner ma correction et prendre le texte de main. */
export const takeMain = (key: string) => {
  const next = { ...get().drafts };
  delete next[key];
  saveDrafts(next);
};

/* ================= Navigation ================= */
export function selectSet(id: string) {
  storage.saveSetId(id);
  set({ setId: id, shown: PAGE, search: "" });
  if (get().data[id]) void checkMain(); else void refresh();
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
  set({ pr: { open: true, mode, setId, submitting: false, checking: mode === "drafts", refused: false } });
  if (mode === "drafts") void preflight();
}

// À l'ouverture de la fenêtre d'envoi : chaque jeu qui a des modifications est remis à jour avec main, pour que
// les conflits s'y affichent avant l'envoi (y compris pour une langue masquée ou un autre jeu).
async function preflight(fail = true) {
  const sets = [...new Set(Object.values(get().drafts).map(d => d.set))];
  try {
    await Promise.all(sets.map(freshen));
  } catch (e) {
    if ((e as GhError).status === 401) { logout("Le jeton GitHub est refusé (expiré ou révoqué). Colle un nouveau jeton."); return; }
    if (fail) notify("error", "Impossible de vérifier la branche principale avant l'envoi. " + explain(e) + " L'envoi la vérifiera de toute façon.");
  } finally {
    set(s => ({ pr: { ...s.pr, checking: false } }));
  }
}
export function closePr() {
  if (get().pr.submitting) return;
  set(s => ({ pr: { ...s.pr, open: false } }));
}

export async function submitPr(title: string, note: string) {
  const { pr, user } = get();
  if (pr.submitting || pr.checking || !client) return;
  generation++; // une vérification en fond ne doit pas remplacer les données pendant l'envoi
  set({ pr: { ...pr, submitting: true } });
  const who = user ? (user.name || user.login) : "relecture";
  const results: CreatedPr[] = [];
  const done = () => {
    for (const r of results) {
      const text = (r.updated ? `Pull request #${r.number} mise à jour dans ${r.repo}.` : `Pull request créée dans ${r.repo}.`) +
        (r.autoMerge ? " Elle sera fusionnée automatiquement dès que les vérifications passent." : "") +
        r.notes.map(n => " " + n).join("");
      notify("ok", text, { href: r.url, text: "Ouvrir la PR #" + r.number });
    }
  };
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
    if (e instanceof StaleDraftsError) {
      // Rien n'a été écrit pour ce dépôt : la fenêtre reste ouverte et montre les conflits une fois main relu
      // (un message hors de la fenêtre serait caché par elle).
      set(s => ({ pr: { ...s.pr, submitting: false, checking: true, refused: true } }));
      done();
      await preflight(false);
      if (results.length) void refresh(true); // un autre dépôt a bien reçu sa PR : ses lignes passent « en attente »
      return;
    }
    set(s => ({ pr: { ...s.pr, open: false, submitting: false } }));
    done();
    notify("error", "La pull request n'a pas pu être créée. " + explain(e) + " Tes modifications sont conservées.");
  }
}

