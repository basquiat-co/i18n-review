import type { Route } from "@playwright/test";

/**
 * Fausse API GitHub, branchée sur les requêtes du navigateur (context.route) : aucun appel réseau réel.
 * files : "propriétaire/dépôt:chemin" pour la branche principale, "propriétaire/dépôt@sha:chemin" pour un autre commit.
 */
export interface PullInfo { number: number; ref: string; sha: string; repo?: string; base?: string; body?: string; state?: string; merged?: boolean; autoMerge?: boolean }
/** Réponse de compare (branche principale...sha de la PR) : base commune et fichiers changés. */
export interface CompareInfo { mergeBase: string; files: string[]; commits?: string[] /* messages */ }

export class FakeGitHub {
  files: Record<string, string> = {};
  pulls: Record<string, PullInfo[]> = {};
  userStatus = 200;
  pullGate: Promise<void> | null = null; // si défini, la création d'une PR attend que le test le libère
  failPulls = 0;      // nombre de créations de PR à refuser (422) avant d'accepter
  compares: Record<string, CompareInfo> = {}; // par sha de PR ; par défaut base commune « base », aucun fichier
  allowAutoMerge = true;
  autoMergeError = ""; // si défini, GitHub refuse la fusion automatique avec ce message
  refGone = false;     // la branche a été supprimée (PR fusionnée) : la mise à jour de la ref échoue
  mergeOnMove = false; // la PR est fusionnée juste après la mise à jour de sa branche
  noCommitsBetween = false; // la création de PR répond « No commits between » (rien de nouveau à proposer)
  calls: string[] = [];
  posts = {
    trees: [] as { repo: string; body: { base_tree: string; tree: { path: string; content: string }[] } }[],
    commits: [] as { repo: string; body: { message: string; tree: string; parents: string[] } }[],
    refs: [] as { repo: string; body: { ref: string; sha: string } }[],
    pulls: [] as { repo: string; body: { title: string; head: string; base: string; body: string } }[],
    refUpdates: [] as { repo: string; ref: string; body: { sha: string; force: boolean } }[],
    pullUpdates: [] as { repo: string; number: number; body: { body: string } }[],
    graphql: [] as { query: string; variables: { id: string; method: string } }[],
  };
  private n = 0;

  /** Contenu du fichier écrit dans la dernière PR (arbre Git envoyé), ou undefined. */
  written(path: string): string | undefined {
    const tree = this.posts.trees.at(-1)?.body.tree || [];
    return tree.find(t => t.path === path)?.content;
  }

  async handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    this.calls.push(`${method} ${url.pathname}${url.search}`);
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
    const p = url.pathname;
    let m: RegExpMatchArray | null;

    if (p === "/user") return this.userStatus === 200 ? json(200, { login: "relectrice", name: "Camille Relectrice", avatar_url: "" }) : json(this.userStatus, { message: "Bad credentials" });
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)$/))) return json(200, { default_branch: "main", full_name: m[1], allow_auto_merge: this.allowAutoMerge, allow_merge_commit: true });
    if (p === "/graphql" && method === "POST") {
      this.posts.graphql.push(JSON.parse(req.postData() || "{}"));
      return json(200, this.autoMergeError ? { data: null, errors: [{ message: this.autoMergeError }] } : { data: { enablePullRequestAutoMerge: { clientMutationId: null } } });
    }
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/compare\/([^.]+)\.\.\.(.+)$/))) {
      const c = this.compares[m[3]] || { mergeBase: "base", files: [] };
      const commits = (c.commits || []).map(message => ({ commit: { message } }));
      return json(200, { merge_base_commit: { sha: c.mergeBase }, total_commits: commits.length, commits, files: c.files.map(filename => ({ filename })) });
    }
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/git\/refs\/heads\/(.+)$/)) && method === "PATCH") {
      this.posts.refUpdates.push({ repo: m[1], ref: decodeURIComponent(m[2]), body: JSON.parse(req.postData() || "{}") });
      if (this.refGone) return json(422, { message: "Reference does not exist" });
      if (this.mergeOnMove) for (const pr of this.pulls[m[1]] || []) Object.assign(pr, { state: "closed", merged: true });
      return json(200, { object: { sha: "moved" } });
    }
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/))) {
      const pr = (this.pulls[m[1]] || []).find(x => x.number === Number(m![2]));
      if (!pr) return json(404, { message: "Not Found" });
      if (method === "PATCH") {
        this.posts.pullUpdates.push({ repo: m[1], number: pr.number, body: JSON.parse(req.postData() || "{}") });
        return json(200, {});
      }
      return json(200, { number: pr.number, state: pr.state || "open", merged: !!pr.merged });
    }
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/git\/ref\/heads\/main$/))) return json(200, { object: { sha: "base" } });
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/))) {
      const ref = url.searchParams.get("ref") || "base";
      const path = decodeURIComponent(m[2]);
      const key = ref === "base" ? `${m[1]}:${path}` : `${m[1]}@${ref}:${path}`;
      if (key in this.files) return route.fulfill({ status: 200, headers: cors, body: this.files[key] });
      return json(404, { message: "Not Found" });
    }
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/pulls$/)) && method === "GET") {
      return json(200, (this.pulls[m[1]] || []).map(pr => ({
        number: pr.number, html_url: `https://github.com/${m![1]}/pull/${pr.number}`, body: pr.body ?? "", node_id: `PR_${pr.number}`, auto_merge: pr.autoMerge ? { merge_method: "merge" } : null,
        base: { sha: pr.base || "base" },
        head: { ref: pr.ref, sha: pr.sha, repo: { full_name: pr.repo || m![1] } },
      })));
    }
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/git\/commits\/base$/))) return json(200, { sha: "base", tree: { sha: "tree0" } });
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/git\/(trees|commits|refs)$/)) && method === "POST") {
      const kind = m[2] as "trees" | "commits" | "refs";
      (this.posts[kind] as { repo: string; body: unknown }[]).push({ repo: m[1], body: JSON.parse(req.postData() || "{}") });
      return json(201, { sha: `${kind}-${++this.n}` });
    }
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/pulls$/)) && method === "POST") {
      this.posts.pulls.push({ repo: m[1], body: JSON.parse(req.postData() || "{}") });
      if (this.pullGate) await this.pullGate;
      if (this.failPulls > 0) { this.failPulls--; return json(422, { message: "Validation Failed" }); }
      if (this.noCommitsBetween) return json(422, { message: "Validation Failed: No commits between main and the branch" });
      const number = this.posts.pulls.length;
      return json(201, { html_url: `https://github.com/${m[1]}/pull/${number}`, number, node_id: `PR_${number}` });
    }
    return json(500, { message: `route non simulée : ${method} ${p}` });
  }
}
