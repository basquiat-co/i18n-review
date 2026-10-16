import * as C from "./core";
import { API, BRANCH_PREFIX, REVIEW_FILE, filePath, knownSet, langName, type FileSet } from "./config";

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

export interface CreatedPr { repo: string; url: string; number: number }

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
    const pending = await this.loadPending(set, review);
    return { sha: head.sha, branch: head.branch, flat, review, pending };
  }

  // Clés déjà validées dans des pull requests ouvertes par l'outil.
  private async loadPending(set: FileSet, baseReview: C.Review) {
    const out: SetData["pending"] = {};
    set.langs.forEach(l => out[l] = new Map());
    type Pr = { number: number; html_url: string; head?: { ref?: string; sha: string; repo?: { full_name: string } } };
    let prs: Pr[] = [];
    try { prs = await this.request<Pr[]>(`/repos/${set.repo}/pulls?state=open&per_page=50`); } catch { return out; }
    prs = prs.filter(p => p.head?.ref?.startsWith(BRANCH_PREFIX) && p.head.repo?.full_name === set.repo).slice(0, 10);
    await Promise.all(prs.map(async p => {
      const raw = await this.getFile(set.repo, REVIEW_FILE, p.head!.sha).catch(() => null);
      if (!raw) return;
      let r: C.Review;
      try { r = C.parseReview(raw); } catch { return; }
      for (const l of set.langs) {
        const base = C.reviewEntries(baseReview, set.id, l), next = C.reviewEntries(r, set.id, l);
        for (const k of Object.keys(next)) if (next[k] !== base[k]) out[l].set(k, { number: p.number, url: p.html_url });
      }
    }));
    return out;
  }

  /* ---------- Création de la pull request ---------- */
  // Applique les modifications sur la dernière version de la branche principale, puis crée branche, commit et PR.
  async createPr(repo: string, title: string, note: string, who: string, { drafts, initSet }: { drafts?: C.Draft[]; initSet?: string }): Promise<CreatedPr> {
    const head = await this.repoHead(repo);
    const commit = await this.request<{ tree: { sha: string } }>(`/repos/${repo}/git/commits/${head.sha}`);
    let review = C.parseReview(await this.getFile(repo, REVIEW_FILE, head.sha));
    const tree: { path: string; mode: string; type: string; content: string }[] = [];
    const lines: string[] = [];

    const setIds = initSet ? [initSet] : [...new Set(drafts!.map(d => d.set))];
    for (const setId of setIds) {
      const set = knownSet(setId);
      const raws: Record<string, string | null> = {};
      for (const l of set.langs) raws[l] = await this.getFile(repo, filePath(set, l), head.sha);
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
        const ld = setDrafts.filter(d => d.lang === lang);
        const path = filePath(set, lang);
        const before = raws[lang] === null ? "{}\n" : raws[lang]!;
        const after = C.applyEdits(before, sourceObj, ld.filter(d => d.edited).map(d => ({ segs: d.segs, value: d.value })));
        if (after !== null) {
          tree.push({ path, mode: "100644", type: "blob", content: after });
          if (lang === set.source) sourceObj = JSON.parse(after);
        }
        const liveIds = new Set(C.flatten(sourceObj).map(e => e.id));
        review = C.updateReview(review, set.id, lang, lang === set.source, ld.map(d => ({ id: d.id, source: d.source, value: d.value })), liveIds);
        const ed = ld.filter(d => d.edited).length;
        lines.push(`- **${set.label}**, ${langName(lang)} (\`${path}\`) : ${ed} correction${ed > 1 ? "s" : ""}, ${ld.length - ed} validation${ld.length - ed > 1 ? "s" : ""} sans changement.`);
      }
    }
    tree.push({ path: REVIEW_FILE, mode: "100644", type: "blob", content: C.serializeReview(review) });

    const newTree = await this.request<{ sha: string }>(`/repos/${repo}/git/trees`, { method: "POST", body: { base_tree: commit.tree.sha, tree } });
    const newCommit = await this.request<{ sha: string }>(`/repos/${repo}/git/commits`, { method: "POST", body: { message: title + "\n\nCréé avec l'outil de relecture des traductions par " + who + ".", tree: newTree.sha, parents: [head.sha] } });
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
    const branch = `${BRANCH_PREFIX}${stamp}-${Math.random().toString(36).slice(2, 6)}`;
    await this.request(`/repos/${repo}/git/refs`, { method: "POST", body: { ref: "refs/heads/" + branch, sha: newCommit.sha } });

    const corrections = drafts ? drafts.filter(d => d.edited) : [];
    let body = (note ? note + "\n\n" : "") + "### Résumé\n" + lines.join("\n") + "\n";
    if (corrections.length) {
      const esc = (s: string) => String(s).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
      body += "\n### Corrections\n| Clé | Langue | Avant | Après |\n|---|---|---|---|\n" +
        corrections.slice(0, 80).map(d => `| \`${d.id}\` | ${d.lang} | ${esc(d.original || "_(vide)_")} | ${esc(d.value)} |`).join("\n") + "\n" +
        (corrections.length > 80 ? `\n… et ${corrections.length - 80} autres corrections (voir les fichiers modifiés).\n` : "");
    }
    body += `\n_Le fichier \`${REVIEW_FILE}\` enregistre les clés relues. Il est mis à jour par l'outil de relecture des traductions._\n`;
    const pr = await this.request<{ html_url: string; number: number }>(`/repos/${repo}/pulls`, { method: "POST", body: { title, head: branch, base: head.branch, body } });
    return { repo, url: pr.html_url, number: pr.number };
  }
}
