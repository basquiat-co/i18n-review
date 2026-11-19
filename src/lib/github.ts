import * as C from "./core";
import { API, BRANCH_PREFIX, REVIEW_FILE, SETS, filePath, knownSet, langName, reviewedPaths, type FileSet } from "./config";

export class GhError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export interface GhUser { login: string; name?: string | null; avatar_url?: string }

/** Contenu d'un jeu de fichiers sur la branche principale. */
export interface SetData {
  sha: string;
  branch: string;
  flat: Record<string, C.FlatEntry[]>;
  review: C.Review;
  pending: Record<string, Map<string, C.PendingInfo>>; // clés déjà validées dans des PR ouvertes par l'outil
}

export interface CreatedPr {
  repo: string; url: string; number: number;
  updated: boolean;   // une PR déjà ouverte a été reprise
  notes: string[];    // avertissements : la PR existe, mais quelque chose mérite d'être dit
}

/** Des modifications portent sur des textes que main a changés depuis : rien n'a été envoyé. */
export class StaleDraftsError extends Error {
  constructor(public keys: string[]) {
    super(`${keys.length} modification${keys.length > 1 ? "s portent" : " porte"} sur des textes changés sur la branche principale depuis.`);
  }
}

/**
 * Une valeur qu'une relecture précédente a écrite dans la PR ouverte, et que main a changée depuis : Alex choisit à
 * l'envoi entre la sienne (mine) et celle de main (main, undefined si main a retiré la traduction).
 */
export interface PrClash {
  pr: number; set: string; lang: string; id: string; segs: string[]; mine: string; main: string | undefined;
  source: string;   // texte source sur main aujourd'hui
  prSource: string; // texte source dans la PR, celui qu'Alex avait sous les yeux en écrivant « mine »
}
/** Choix d'Alex pour un conflit, lié au texte de main qu'il a vu : si main change encore, il choisit à nouveau. */
export interface ClashChoice { keep: "mine" | "main"; main: string | undefined }
export const clashKey = (c: { set: string; lang: string; id: string }) => `${c.set}|${c.lang}|${c.id}`;

/** PR de relecture ouverte d'un dépôt, vue à l'ouverture de la fenêtre d'envoi. */
export interface ReviewPrState {
  pr: { number: number; url: string } | null;
  upToDate: boolean; // la PR contient déjà la dernière version de main : rien à rejouer
  clashes: PrClash[];
}

// PR de l'outil reprise par une nouvelle relecture.
interface OpenPr { number: number; url: string; body: string; ref: string; sha: string; mergeBase: string; files: string[] }

// Signature des commits de l'outil : une PR dont un commit ne la porte pas a été modifiée à la main.
const TOOL_MARK = "Créé avec l'outil de relecture des traductions";

export function explain(e: unknown, repo?: string): string {
  const err = e as Partial<GhError>;
  if (err.status === 401) return "Le jeton GitHub est refusé (expiré ou révoqué). Reconnecte-toi avec un nouveau jeton.";
  if (err.status === 403 || err.status === 404) return `Le jeton n'a pas accès à ${repo || "ce dépôt"}. Vérifie qu'il inclut ce dépôt avec les droits Contents et Pull requests.`;
  if (err.status === 409 || err.status === 422) return "GitHub a refusé l'opération : " + err.message;
  return err.message || String(e);
}

const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

// Lit un fichier JSON ; l'erreur nomme le fichier plutôt qu'un « Unexpected token » sans contexte.
function parseJson<T>(raw: string, path: string): T {
  try { return JSON.parse(raw); } catch (e) { throw new Error(`Le fichier ${path} n'est pas un JSON valide (${(e as Error).message}).`); }
}

export class GitHub {
  private repoInfo: Record<string, { branch: string }> = {};
  constructor(private token: string) {}

  async request<T>(path: string, opts: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: "Bearer " + this.token,
      Accept: opts.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
    };
    if (opts.body) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(API + path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: "no-store" });
    } catch {
      const embedded = /claude\.ai$|claudeusercontent\.com$|claude\.site$/.test(location.hostname) || window.top !== window.self;
      throw new GhError(0, embedded
        ? "Cette page ne peut pas joindre GitHub depuis claude.ai, qui bloque ces appels. Télécharge le fichier relecture-traductions.html et ouvre-le directement dans ton navigateur."
        : "GitHub ne répond pas. Vérifie ta connexion internet, ou qu'aucun pare-feu ou extension ne bloque api.github.com.");
    }
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).message || ""; } catch { /* corps non JSON */ }
      throw new GhError(res.status, detail || res.statusText);
    }
    return (opts.raw ? res.text() : res.status === 204 ? null : res.json()) as Promise<T>;
  }

  user() { return this.request<GhUser>("/user"); }

  async getFile(repo: string, path: string, ref: string): Promise<string | null> {
    try { return await this.request<string>(`/repos/${repo}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`, { raw: true }); }
    catch (e) { if ((e as GhError).status === 404) return null; throw e; }
  }

  async repoHead(repo: string): Promise<{ branch: string; sha: string }> {
    if (!this.repoInfo[repo]) {
      const r = await this.request<{ default_branch: string }>(`/repos/${repo}`);
      this.repoInfo[repo] = { branch: r.default_branch };
    }
    const branch = this.repoInfo[repo].branch;
    const ref = await this.request<{ object: { sha: string } }>(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    return { branch, sha: ref.object.sha };
  }

  /**
   * main est passé de from à to : un des fichiers relus a-t-il changé ? Dans le doute (liste tronquée à 300
   * fichiers par GitHub, comparaison impossible), oui : relire coûte quelques requêtes, l'oublier coûte un écran faux.
   */
  async touchesReviewed(repo: string, from: string, to: string): Promise<boolean> {
    try {
      const c = await this.request<{ files?: { filename: string }[] }>(`/repos/${repo}/compare/${from}...${to}`);
      const files = c.files || [];
      if (files.length >= 300) return true;
      const paths = reviewedPaths(repo);
      return files.some(f => paths.has(f.filename));
    } catch (e) {
      if ((e as GhError).status === 401) throw e;
      return true;
    }
  }

  // Compare chaque modification à main tel qu'il est au moment de l'envoi (pas à la PR reprise, qui porte
  // les corrections déjà envoyées par Alex). « absorbed » passe : main contient déjà ce texte.
  private async refuseStale(drafts: C.Draft[], atMain: (path: string) => Promise<string | null>) {
    const stale: string[] = [];
    for (const setId of new Set(drafts.map(d => d.set))) {
      const set = knownSet(setId);
      const mine = drafts.filter(d => d.set === setId);
      const flat: Record<string, C.FlatEntry[]> = {};
      for (const l of new Set([set.source, ...mine.map(d => d.lang)])) {
        const raw = await atMain(filePath(set, l));
        flat[l] = C.flatten(parseJson(raw === null ? "{}" : raw, filePath(set, l)));
      }
      // Un fichier source absent ou vide (déplacé, en cours de réécriture) rendrait toutes les clés « supprimées ».
      if (!flat[set.source].length) throw new Error(`Fichier source introuvable ou vide sur la branche principale : ${filePath(set, set.source)}. Rien n'a été envoyé ; préviens un développeur.`);
      const empty = mine.find(d => d.exists && !flat[d.lang].length);
      if (empty) throw new Error(`Fichier de traduction introuvable ou vide sur la branche principale : ${filePath(set, empty.lang)}. Rien n'a été envoyé ; préviens un développeur.`);
      const now = C.mainLookup(set.source, flat);
      for (const d of mine) {
        const drift = C.draftDrift(d, now(d.lang, d.id));
        if (drift !== "same" && drift !== "absorbed") stale.push(`${d.set}|${d.lang}|${d.id}`);
      }
    }
    if (stale.length) throw new StaleDraftsError(stale);
  }

  /* ---------- Chargement d'un jeu de fichiers ---------- */
  async loadSet(set: FileSet): Promise<SetData> {
    const head = await this.repoHead(set.repo);
    const raws = await Promise.all(set.langs.map(l => this.getFile(set.repo, filePath(set, l), head.sha)));
    const flat: Record<string, C.FlatEntry[]> = {};
    set.langs.forEach((l, i) => { flat[l] = C.flatten(parseJson(raws[i] === null ? "{}" : raws[i]!, filePath(set, l))); });
    const reviewRaw = await this.getFile(set.repo, REVIEW_FILE, head.sha);
    let review: C.Review;
    try { review = C.parseReview(reviewRaw); }
    catch (e) { throw new Error(`Le fichier ${REVIEW_FILE} n'est pas un JSON valide (${(e as Error).message}).`); }
    const pending = await this.loadPending(set, head.sha, review);
    return { sha: head.sha, branch: head.branch, flat, review, pending };
  }

  // Clés validées dans des pull requests ouvertes par l'outil : chaque PR est comparée à sa propre base
  // (base.sha, fixée à sa création), pas à la branche principale actuelle qui a pu avancer depuis.
  private async loadPending(set: FileSet, mainSha: string, mainReview: C.Review) {
    const out: SetData["pending"] = {};
    set.langs.forEach(l => out[l] = new Map());
    type Pr = { number: number; html_url: string; base: { sha: string }; head?: { ref?: string; sha: string; repo?: { full_name: string } } };
    let prs: Pr[] = [];
    try { prs = await this.request<Pr[]>(`/repos/${set.repo}/pulls?state=open&per_page=50`); } catch { return out; }
    prs = prs.filter(p => p.head?.ref?.startsWith(BRANCH_PREFIX) && p.head.repo?.full_name === set.repo).slice(0, 10);
    // Le fichier pèse plusieurs centaines de Ko : une seule lecture par commit, aucune pour la branche principale déjà lue.
    const reviews = new Map<string, Promise<C.Review | null>>([[mainSha, Promise.resolve(mainReview)]]);
    const reviewAt = (sha: string) => {
      if (!reviews.has(sha)) reviews.set(sha, this.getFile(set.repo, REVIEW_FILE, sha).then(C.parseReview).catch(() => null));
      return reviews.get(sha)!;
    };
    await Promise.all(prs.map(async p => {
      const [head, base] = await Promise.all([reviewAt(p.head!.sha), reviewAt(p.base.sha)]);
      if (!head || !base) return;
      for (const l of set.langs) {
        const entries = (r: C.Review) => C.reviewEntries(r, set.id, l);
        for (const k of C.changedEntries(entries(base), entries(head), entries(mainReview))) {
          out[l].set(k, { number: p.number, url: p.html_url });
        }
      }
    }));
    return out;
  }

  /* ---------- Création de la pull request ---------- */
  // Une seule PR de l'outil ouverte par dépôt : si une PR ouverte ne contient que des fichiers relus, elle est
  // reconstruite sur la dernière version de la branche principale et la relecture y est ajoutée. Sinon (aucune PR,
  // ou des fichiers ajoutés à la main, des tests par exemple), une nouvelle branche et une nouvelle PR sont créées.
  // updateOnly : sans nouvelle relecture, rejoue seulement la PR ouverte sur main (« Mettre à jour ma PR »).
  async createPr(repo: string, title: string, note: string, who: string, { drafts, initSet, choices = {}, updateOnly = false }: { drafts?: C.Draft[]; initSet?: string; choices?: Record<string, ClashChoice>; updateOnly?: boolean }): Promise<CreatedPr> {
    const head = await this.repoHead(repo);

    // Fichiers lus sur la branche principale (une lecture par chemin) et contenus à écrire, par chemin.
    const mainRaws = new Map<string, Promise<string | null>>();
    const atMain = (path: string) => {
      if (!mainRaws.has(path)) mainRaws.set(path, this.getFile(repo, path, head.sha));
      return mainRaws.get(path)!;
    };
    // Avant toute écriture : une modification dont main a changé le texte depuis n'écrase rien sans qu'Alex l'ait vu.
    if (drafts) await this.refuseStale(drafts, atMain);

    const commit = await this.request<{ tree: { sha: string } }>(`/repos/${repo}/git/commits/${head.sha}`);
    let open = await this.reusablePr(repo, head.sha);
    if (updateOnly) {
      if (!open) throw new Error(`Aucune PR de relecture ouverte que l'outil peut reprendre dans ${repo} : rien à mettre à jour.`);
      if (open.mergeBase === head.sha) return { repo, url: open.url, number: open.number, updated: true, notes: ["Elle était déjà à jour avec la branche principale : rien n'a été écrit."] };
    }
    const out = new Map<string, string>();
    const current = async (path: string) => out.has(path) ? out.get(path)! : atMain(path);

    const mainReview = C.parseReview(await atMain(REVIEW_FILE));
    let review = mainReview;
    let clashes: PrClash[] = [];
    let replayed = new Set<string>();
    const notes: string[] = [];
    if (open) {
      try {
        ({ review, clashes, replayed } = await this.replayPr(repo, open, mainReview, atMain, out));
      } catch (e) {
        // Une PR dont un fichier est illisible sur sa branche ne doit pas bloquer les envois : nouvelle PR.
        if (updateOnly) throw new Error(`La PR #${open.number} n'a pas pu être relue (${explain(e, repo)}). Rien n'a été écrit.`);
        notes.push(`La PR #${open.number} n'a pas pu être reprise (${explain(e, repo)}) : une nouvelle PR est créée.`);
        open = null;
        out.clear();
        review = mainReview;
        clashes = [];
      }
    }
    // Avant toute écriture : chaque conflit avec la PR reprise a été tranché par Alex, sur le texte de main actuel.
    // Une correction tapée sur la clé le tranche aussi : la plus récente l'emporte.
    if (drafts) {
      const typed = new Set(drafts.filter(d => d.edited).map(clashKey));
      const undecided = clashes.filter(c => {
        const ch = choices[clashKey(c)];
        return !typed.has(clashKey(c)) && (!ch || ch.main !== c.main);
      });
      // Un choix sans conflit correspondant : main a bougé depuis (texte remis, « Update branch »). Ce qu'Alex a
      // choisi ne vaut plus ; rien n'est envoyé, et la fenêtre montre l'état actuel.
      const current = new Set(clashes.map(clashKey));
      const vanished = Object.keys(choices).filter(k => knownSet(k.split("|")[0]).repo === repo && !current.has(k));
      if (undecided.length || vanished.length) throw new StaleDraftsError([...undecided.map(clashKey), ...vanished]);
      // Chaque choix devient une modification : « la mienne » réécrit sa valeur, « celle de main » la valide.
      const chosen = new Map<string, C.Draft>();
      for (const c of clashes) {
        const ch = choices[clashKey(c)];
        if (typed.has(clashKey(c)) || !ch || (ch.keep === "main" && c.main === undefined)) continue;
        const mine = ch.keep === "mine";
        // « La mienne » est relue face à la source qu'Alex avait en l'écrivant : si main l'a changée, la clé repasse
        // « source modifiée ». « Celle de main » est validée face à la source actuelle, montrée dans la fenêtre.
        chosen.set(clashKey(c), { set: c.set, lang: c.lang, id: c.id, segs: c.segs, value: mine ? c.mine : c.main!, original: c.main ?? "", exists: c.main !== undefined, source: mine ? c.prSource : c.source, edited: mine });
      }
      drafts = [...drafts.filter(d => !chosen.has(clashKey(d))), ...chosen.values()];
      clashes = []; // tous tranchés : rien à signaler dans la description
    }
    const lines: string[] = [];

    const setIds = initSet ? [initSet] : [...new Set(drafts!.map(d => d.set))];
    for (const setId of setIds) {
      const set = knownSet(setId);
      const raws: Record<string, string | null> = {};
      for (const l of set.langs) raws[l] = await current(filePath(set, l));
      if (raws[set.source] === null) throw new GhError(404, `Fichier source introuvable : ${filePath(set, set.source)}`);

      if (initSet) {
        const flat: Record<string, C.FlatEntry[]> = {};
        for (const l of set.langs) flat[l] = C.flatten(parseJson(raws[l] || "{}", filePath(set, l)));
        review = C.initReview(review, set.id, set.source, flat);
        lines.push(`- **${set.label}** : état initial, toutes les clés existantes marquées comme relues.`);
        continue;
      }

      const setDrafts = drafts!.filter(d => d.set === setId);
      const stray = setDrafts.find(d => !set.langs.includes(d.lang));
      if (stray) throw new Error(`La langue « ${stray.lang} » n'est plus configurée pour ${set.label}.`);
      // la langue source d'abord : ses corrections font partie de la référence des autres langues
      const langs = [set.source, ...set.langs.filter(l => l !== set.source)].filter(l => setDrafts.some(d => d.lang === l));
      let sourceObj: C.JsonObject = parseJson(raws[set.source]!, filePath(set, set.source));
      for (const lang of langs) {
        // Une simple validation d'une clé que la PR reprise a déjà écrite porte sur la valeur de main, que la
        // traductrice voyait : elle est ignorée, la valeur et l'entrée de relecture de la PR sont gardées.
        const ld = setDrafts.filter(d => d.lang === lang && (d.edited || !replayed.has(`${set.id}|${lang}|${d.id}`)));
        const path = filePath(set, lang);
        const before = raws[lang] === null ? "{}\n" : raws[lang]!;
        const after = C.applyEdits(before, sourceObj, ld.filter(d => d.edited).map(d => ({ segs: d.segs, value: d.value })));
        if (after !== null) {
          out.set(path, after);
          if (lang === set.source) sourceObj = JSON.parse(after);
        }
        const liveIds = new Set(C.flatten(sourceObj).map(e => e.id));
        review = C.updateReview(review, set.id, lang, lang === set.source, ld.map(d => ({ id: d.id, source: d.source, value: d.value })), liveIds);
        const ed = ld.filter(d => d.edited).length;
        lines.push(`- **${set.label}**, ${langName(lang)} (\`${path}\`) : ${ed} correction${ed > 1 ? "s" : ""}, ${ld.length - ed} validation${ld.length - ed > 1 ? "s" : ""} sans changement.`);
      }
    }
    if (updateOnly) lines.push(`- Rejouée sur la dernière version de ${head.branch}, sans nouvelle relecture.`);
    out.set(REVIEW_FILE, C.serializeReview(review));

    const tree = [...out].map(([path, content]) => ({ path, mode: "100644", type: "blob", content }));
    const newTree = await this.request<{ sha: string }>(`/repos/${repo}/git/trees`, { method: "POST", body: { base_tree: commit.tree.sha, tree } });
    // Une PR reprise reçoit un commit de fusion (sa dernière version, puis la branche principale) : pas de réécriture
    // de son historique, et GitHub la voit à jour.
    const message = title + (open ? `\n\nReprend la PR #${open.number} sur la dernière version de ${head.branch}.` : "") +
      "\n\n" + TOOL_MARK + " par " + who + ".";
    const newCommit = await this.request<{ sha: string }>(`/repos/${repo}/git/commits`, { method: "POST", body: { message, tree: newTree.sha, parents: open ? [open.sha, head.sha] : [head.sha] } });

    const corrections = drafts ? drafts.filter(d => d.edited) : [];
    const section = describeReview(note, lines, corrections, clashes.map(c => `${c.id} (${c.lang})`), head.branch);
    if (clashes.length) notes.push(`${clashes.length} clé${clashes.length > 1 ? "s ont" : " a"} aussi changé sur ${head.branch} depuis la PR #${open!.number} : le texte de ${head.branch} est gardé et ${clashes.length > 1 ? "ces clés repassent" : "la clé repasse"} à relire.`);

    // Une fois la branche avancée, lever seulement si rien n'a abouti : une erreur garde les modifications dans le
    // navigateur, et elles seraient sinon envoyées une seconde fois.
    let pr: { number: number; html_url: string } | null = null;
    if (open && await this.moveBranch(repo, open, newCommit.sha)) {
      const st = await this.prState(repo, open.number);
      if (st.state === "open") pr = { number: open.number, html_url: open.url };
      // Fermée sans fusion juste après la mise à jour : rien n'a abouti, l'envoi peut être refait.
      else if (!st.merged) throw new Error(`La PR #${open.number} a été fermée pendant l'envoi. Réessaie : une nouvelle PR sera créée.`);
      // Sinon fusionnée pendant l'envoi, avec ou sans le nouveau commit : une nouvelle PR le porte (plus bas).
    }
    if (pr) {
      const body = open!.body + "\n\n---\n\n" + `### Mise à jour du ${new Date().toLocaleDateString("fr-CH")}, par ${who}\n\n` + section;
      if (body.length > 65000) notes.push(`La description de la PR #${pr.number} est trop longue pour y ajouter ce résumé.`);
      else await this.request(`/repos/${repo}/pulls/${pr.number}`, { method: "PATCH", body: { body } })
        .catch(() => notes.push(`La description de la PR #${pr!.number} n'a pas pu être mise à jour.`));
      return { repo, url: pr.html_url, number: pr.number, updated: true, notes };
    }
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
    const branch = `${BRANCH_PREFIX}${stamp}-${Math.random().toString(36).slice(2, 6)}`;
    await this.request(`/repos/${repo}/git/refs`, { method: "POST", body: { ref: "refs/heads/" + branch, sha: newCommit.sha } });
    try {
      pr = await this.request<{ html_url: string; number: number }>(`/repos/${repo}/pulls`, { method: "POST", body: { title, head: branch, base: head.branch, body: section } });
    } catch (e) {
      // La PR reprise a été fusionnée avec le nouveau commit : il n'y a plus rien à proposer, la relecture est passée.
      if (open && (e as GhError).status === 422 && /no commits between/i.test((e as GhError).message)) {
        return { repo, url: open.url, number: open.number, updated: true, notes: [...notes, `La PR #${open.number} a été fusionnée avec cette relecture.`] };
      }
      throw e;
    }
    return { repo, url: pr.html_url, number: pr.number, updated: false, notes };
  }

  /**
   * Conflits entre la PR de relecture ouverte et main tel qu'il est : lus à l'ouverture de la fenêtre d'envoi, pour
   * qu'Alex les tranche avant d'envoyer. Rien n'est écrit.
   */
  async reviewPr(repo: string): Promise<ReviewPrState> {
    const head = await this.repoHead(repo);
    const open = await this.reusablePr(repo, head.sha);
    if (!open) return { pr: null, upToDate: false, clashes: [] };
    const pr = { number: open.number, url: open.url };
    if (open.mergeBase === head.sha) return { pr, upToDate: true, clashes: [] };
    const atMain = (path: string) => this.getFile(repo, path, head.sha);
    // L'état de relecture rejoué n'est pas utilisé ici : inutile de lire celui de main, qui pèse lourd.
    return { pr, upToDate: false, clashes: (await this.replayPr(repo, open, C.emptyReview(), atMain, new Map())).clashes };
  }

  // PR ouverte par l'outil que la relecture peut reprendre : la plus récente dont tous les commits viennent de l'outil
  // et tous les fichiers sont des fichiers relus du dépôt. Un commit fait à la main (des tests, une clé supprimée) ne
  // serait pas rejoué fidèlement : la PR n'est alors pas reprise. Un commit de fusion (« Update branch », un conflit
  // réglé sur GitHub) est accepté : le rejeu part de la base commune, qu'il a avancée.
  private async reusablePr(repo: string, mainSha: string): Promise<OpenPr | null> {
    type Pr = { number: number; html_url: string; body?: string | null; head?: { ref?: string; sha: string; repo?: { full_name: string } } };
    const prs = (await this.request<Pr[]>(`/repos/${repo}/pulls?state=open&per_page=50`))
      .filter(p => p.head?.ref?.startsWith(BRANCH_PREFIX) && p.head.repo?.full_name === repo)
      .sort((a, b) => b.number - a.number);
    const allowed = reviewedPaths(repo);
    for (const p of prs) {
      type Cmp = { merge_base_commit: { sha: string }; total_commits?: number; commits?: { commit: { message: string }; parents?: unknown[] }[]; files?: { filename: string }[] };
      const cmp = await this.request<Cmp>(`/repos/${repo}/compare/${mainSha}...${p.head!.sha}`);
      const files = (cmp.files || []).map(f => f.filename);
      const commits = cmp.commits || [];
      // GitHub tronque les listes (250 commits, 300 fichiers) : une PR aussi grande n'est pas une PR de l'outil seul.
      if (files.length >= 300 || (cmp.total_commits ?? commits.length) !== commits.length) continue;
      if (!files.every(f => allowed.has(f)) || !commits.every(c => c.commit.message.includes(TOOL_MARK) || (c.parents?.length ?? 0) > 1)) continue;
      return { number: p.number, url: p.html_url, body: p.body || "", ref: p.head!.ref!, sha: p.head!.sha, mergeBase: cmp.merge_base_commit.sha, files };
    }
    return null;
  }

  // Rejoue sur la branche principale ce que la PR a écrit (out reçoit les fichiers changés) et renvoie l'état de
  // relecture obtenu, avec les clés en conflit (« clé (langue) »).
  private async replayPr(repo: string, open: OpenPr, mainReview: C.Review, atMain: (path: string) => Promise<string | null>, out: Map<string, string>) {
    const at = (path: string, sha: string) => this.getFile(repo, path, sha);
    const skip = new Set<string>();
    const clashes: PrClash[] = [];
    const live = new Map<string, Set<string>>();
    const replayed = new Set<string>(); // « jeu|langue|clé » dont la PR a écrit la valeur
    for (const set of SETS.filter(s => s.repo === repo)) {
      const srcPath = filePath(set, set.source);
      const srcRaw = await atMain(srcPath);
      if (srcRaw === null) continue;
      let sourceObj: C.JsonObject = parseJson(srcRaw, srcPath);
      const mainSource = C.toMap(C.flatten(sourceObj));
      const liveIds = new Set(mainSource.keys());
      const prSrcRaw = await at(srcPath, open.sha);
      const prSource = C.toMap(C.flatten(prSrcRaw === null ? {} : parseJson<C.JsonObject>(prSrcRaw, srcPath)));
      live.set(set.id, liveIds);
      for (const lang of [set.source, ...set.langs.filter(l => l !== set.source)]) {
        const path = filePath(set, lang);
        if (!open.files.includes(path)) continue;
        const [baseRaw, headRaw, mainRaw] = await Promise.all([at(path, open.mergeBase), at(path, open.sha), atMain(path)]);
        if (headRaw === null) continue;
        const mainObj: C.JsonObject = parseJson(mainRaw ?? "{}", path);
        const r = C.replayValues(parseJson(baseRaw ?? "{}", path), parseJson(headRaw, path), mainObj, liveIds);
        const mainMap = C.toMap(C.flatten(mainObj));
        for (const e of r.clashes) {
          skip.add(`${set.id}|${lang}|${e.id}`);
          clashes.push({ pr: open.number, set: set.id, lang, id: e.id, segs: e.segs, mine: e.value, main: mainMap.get(e.id)?.value,
            source: mainSource.get(e.id)!.value, prSource: prSource.get(e.id)?.value ?? mainSource.get(e.id)!.value });
        }
        for (const e of r.edits) replayed.add(`${set.id}|${lang}|${e.id}`);
        const after = C.applyEdits(mainRaw ?? "{}\n", sourceObj, r.edits);
        if (after === null) continue;
        out.set(path, after);
        if (lang === set.source) sourceObj = JSON.parse(after);
      }
    }
    let review = mainReview;
    if (open.files.includes(REVIEW_FILE)) {
      const [base, last] = await Promise.all([at(REVIEW_FILE, open.mergeBase), at(REVIEW_FILE, open.sha)]);
      review = C.replayReview(mainReview, C.parseReview(base), C.parseReview(last), id => live.get(id) ?? null, skip);
    }
    return { review, clashes, replayed };
  }

  // État d'une PR ; en cas d'échec de lecture, elle est supposée ouverte (le cas le plus prudent).
  private prState(repo: string, number: number): Promise<{ state: string; merged: boolean }> {
    return this.request<{ state: string; merged?: boolean }>(`/repos/${repo}/pulls/${number}`)
      .then(p => ({ state: p.state, merged: !!p.merged }), () => ({ state: "open", merged: false }));
  }

  // Avance la branche de la PR (sans forcer : le nouveau commit descend de sa dernière version). false si la PR a été
  // fusionnée entre-temps (sa branche a pu être supprimée) ; sinon l'erreur est levée et rien n'a bougé.
  private async moveBranch(repo: string, open: OpenPr, sha: string): Promise<boolean> {
    try {
      await this.request(`/repos/${repo}/git/refs/heads/${encPath(open.ref)}`, { method: "PATCH", body: { sha, force: false } });
      return true;
    } catch (e) {
      const st = await this.prState(repo, open.number);
      if (st.merged) return false;
      if (st.state !== "open") throw new Error(`La PR #${open.number} a été fermée pendant l'envoi. Réessaie : une nouvelle PR sera créée.`);
      throw e;
    }
  }
}

// Corps de la PR (ou de la section ajoutée à une PR reprise) : note, résumé, corrections, conflits avec main.
function describeReview(note: string, lines: string[], corrections: C.Draft[], clashes: string[], mainBranch: string): string {
  let body = (note ? note + "\n\n" : "") + "### Résumé\n" + lines.join("\n") + "\n";
  if (corrections.length) {
    const esc = (s: string) => String(s).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
    body += "\n### Corrections\n| Clé | Langue | Avant | Après |\n|---|---|---|---|\n" +
      corrections.slice(0, 80).map(d => `| \`${d.id}\` | ${d.lang} | ${esc(d.original || "_(vide)_")} | ${esc(d.value)} |`).join("\n") + "\n" +
      (corrections.length > 80 ? `\n… et ${corrections.length - 80} autres corrections (voir les fichiers modifiés).\n` : "");
  }
  if (clashes.length) {
    body += `\n### Modifiées aussi sur ${mainBranch}\nCes valeurs ont changé sur ${mainBranch} depuis la PR : le texte de ${mainBranch} est gardé et la clé repasse à relire.\n` +
      clashes.slice(0, 80).map(c => `- \`${c}\``).join("\n") + "\n";
  }
  return body + `\n_Le fichier \`${REVIEW_FILE}\` enregistre les clés relues. Il est mis à jour par l'outil de relecture des traductions._\n`;
}
