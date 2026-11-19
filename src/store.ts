import { create } from "zustand";
import { rebaseDraft, type Drafts } from "@/lib/core";
import { PAGE, SETS, knownSet, setById, type FilterKey } from "@/lib/config";
import { GhError, GitHub, StaleDraftsError, clashKey, explain, type ClashChoice, type CreatedPr, type GhUser, type PrClash, type SetData } from "@/lib/github";
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
  drafts: Drafts;
  orphans: Drafts;
  rawRows: Record<string, true>; // cellules affichées en texte brut plutôt que forme par forme
  notices: Notice[];
  // checkError : la relecture de main avant l'envoi a échoué ; dropped : les validations qu'elle a retirées. Tous deux
  // affichés dans la fenêtre, qui cache les messages. clashes : textes de la PR ouverte que main a changés depuis ;
  // choices : ce qu'Alex a choisi pour chacun (gardé pendant l'envoi seulement).
  pr: { open: boolean; mode: PrMode; setId: string; submitting: boolean; checking: boolean; refused: boolean; checkError: string; dropped: string;
    clashes: PrClash[]; choices: Record<string, ClashChoice> };
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
  pr: { open: false, mode: "drafts", setId: SETS[0].id, submitting: false, checking: false, refused: false, checkError: "", dropped: "", clashes: [], choices: {} },
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
  generation++;
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
    set(s => ({ data: { ...s.data, [setId]: loaded } }));
    const dropped = reconcile(setId);
    if (dropped) notify("warn", dropped);
  } catch (e) {
    if ((e as GhError).status === 401) { logout("Le jeton GitHub est refusé (expiré ou révoqué). Colle un nouveau jeton."); return; }
    notify("error", "Impossible de charger les fichiers. " + explain(e, setById(setId).repo));
  } finally {
    if (seq === loadSeq) set({ loading: false }); // un chargement plus récent garde la main
  }
}

/* ================= Comparaison avec main, à l'envoi ================= */
// Main n'est relue qu'à l'ouverture de la fenêtre d'envoi et pendant l'envoi, jamais en fond : 1 requête pour son
// sha ; s'il a bougé, la comparaison dit si un fichier relu a changé (1 requête) ; seulement alors les fichiers sont
// relus. « Recharger depuis GitHub » relit tout à la demande.
let generation = 0; // change à chaque envoi, rechargement demandé ou déconnexion : un résultat plus ancien est jeté

/** Remet un jeu à jour avec main s'il a bougé et rend le message des validations retirées ; lève l'erreur de
 *  GitHub, à l'appelant de dire s'il l'affiche. */
async function freshen(setId: string): Promise<string> {
  const c = client;
  if (!c) return "";
  const gen = generation;
  const fileSet = setById(setId);
  const old = get().data[setId];
  let next: SetData | null = null;
  if (!old) next = await c.loadSet(fileSet);
  else {
    const head = await c.repoHead(fileSet.repo);
    if (head.sha !== old.sha) next = await c.touchesReviewed(fileSet.repo, old.sha, head.sha) ? await c.loadSet(fileSet) : { ...old, sha: head.sha };
  }
  if (gen !== generation || c !== client) return "";
  if (next) set(s => ({ data: { ...s.data, [setId]: next } }));
  return reconcile(setId);
}

// Modifications d'un jeu face à main : celle que main contient déjà devient une validation ; celle qui n'a plus
// d'objet (clé supprimée, validation d'un texte qui a changé) est retirée, et le message qui le dit est rendu ; un
// conflit reste, signalé sur la ligne et dans la fenêtre d'envoi.
function reconcile(setId: string): string {
  const loaded = get().data[setId];
  // Source absente ou vide sur main (fichier déplacé, en cours de réécriture) : toutes les clés sembleraient
  // supprimées. On ne touche à rien ; l'envoi le refusera en nommant le fichier.
  if (!loaded || !loaded.flat[setById(setId).source]?.length) return "";
  // Relu sur l'ordinateur plutôt qu'en mémoire : un autre onglet a pu enregistrer des modifications depuis, et
  // cette mise à jour ne doit pas les écraser.
  const drafts = { ...storage.loadDrafts() };
  const drifted = driftedDrafts(drafts, get().data, setId);
  if (!drifted.some(x => x.drift === "absorbed" || x.drift.startsWith("dropped"))) return "";
  const next = { ...drafts };
  const dropped: string[] = [];
  for (const x of drifted) {
    if (x.drift === "absorbed") next[x.key] = rebaseDraft(x.draft, x.now);
    else if (x.drift.startsWith("dropped")) { delete next[x.key]; dropped.push(`${x.draft.id} (${x.draft.lang})`); }
  }
  saveDrafts(next);
  if (!dropped.length) return "";
  const n = dropped.length, list = dropped.slice(0, 5).join(", ") + (n > 5 ? `, et ${n - 5} autre${n > 6 ? "s" : ""}` : "");
  return `${n} validation${n > 1 ? "s retirées" : " retirée"} : la branche principale a supprimé la clé, ou changé le texte que tu avais validé tel quel (${list}). Relis ${n > 1 ? "ces lignes" : "cette ligne"} si besoin.`;
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
  set({ pr: { open: true, mode, setId, submitting: false, checking: mode === "drafts", refused: false, checkError: "", dropped: "", clashes: [], choices: {} } });
  if (mode === "drafts") void preflight();
}

// À l'ouverture de la fenêtre d'envoi : chaque jeu qui a des modifications est remis à jour avec main, et la PR de
// relecture ouverte de chaque dépôt comparée à main, pour que les conflits s'y affichent avant l'envoi (y compris
// pour une langue masquée ou un autre jeu).
// Chaque jeu est attendu, même si un autre échoue ; seule la dernière vérification lancée rend la main.
let preflightSeq = 0;
async function preflight() {
  const seq = ++preflightSeq;
  const sets = [...new Set(Object.values(get().drafts).map(d => d.set))];
  const repos = [...new Set(sets.map(id => knownSet(id).repo))];
  const c = client;
  const [results, clashResults] = await Promise.all([
    Promise.allSettled(sets.map(freshen)),
    Promise.allSettled(repos.map(r => c ? c.prClashes(r) : Promise.resolve([]))),
  ]);
  if (seq !== preflightSeq) return;
  const clashes = clashResults.flatMap(r => (r.status === "fulfilled" ? r.value : []));
  const failed = [...results, ...clashResults].find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed && (failed.reason as GhError).status === 401) { logout("Le jeton GitHub est refusé (expiré ou révoqué). Colle un nouveau jeton."); return; }
  const checkError = failed ? "Impossible de relire la branche principale : " + explain(failed.reason) : "";
  const dropped = results.flatMap(r => (r.status === "fulfilled" && r.value ? [r.value] : [])).join(" ");
  // Un choix ne survit que si son conflit est encore là, sur le même texte de main ; sinon Alex choisit à nouveau.
  const live = new Map(clashes.map(c => [clashKey(c), c]));
  set(s => ({ pr: { ...s.pr, checking: false, checkError, clashes, dropped: [s.pr.dropped, dropped].filter(Boolean).join(" "),
    choices: Object.fromEntries(Object.entries(s.pr.choices).filter(([k, ch]) => live.has(k) && live.get(k)!.main === ch.main)) } }));
}

/** Conflit avec la PR ouverte : Alex garde son texte ou prend celui de main (lié au texte de main qu'il a vu). */
export function chooseClash(c: PrClash, keep: ClashChoice["keep"]) {
  set(s => ({ pr: { ...s.pr, choices: { ...s.pr.choices, [clashKey(c)]: { keep, main: c.main } } } }));
}
export function closePr() {
  if (get().pr.submitting) return;
  set(s => ({ pr: { ...s.pr, open: false } }));
}

export async function submitPr(title: string, note: string) {
  const { pr, user } = get();
  if (pr.submitting || pr.checking || !client) return;
  generation++; // une relecture de main encore en cours ne doit pas remplacer les données pendant l'envoi
  set({ pr: { ...pr, submitting: true } });
  const who = user ? (user.name || user.login) : "relecture";
  const results: CreatedPr[] = [];
  const done = () => {
    for (const r of results) {
      const text = (r.updated ? `Pull request #${r.number} mise à jour dans ${r.repo}.` : `Pull request créée dans ${r.repo}.`) +
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
        results.push(await client.createPr(repo, title, note, who, { drafts, choices: get().pr.choices }));
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
      await preflight();
      if (results.length) void refresh(true); // un autre dépôt a bien reçu sa PR : ses lignes passent « en attente »
      return;
    }
    set(s => ({ pr: { ...s.pr, open: false, submitting: false } }));
    done();
    notify("error", "La pull request n'a pas pu être créée. " + explain(e) + " Tes modifications sont conservées.");
  }
}

