import type { Route } from "@playwright/test";

/**
 * Fausse API GitHub, branchée sur les requêtes du navigateur (context.route) : aucun appel réseau réel.
 * files : "propriétaire/dépôt:chemin" pour la branche principale, "propriétaire/dépôt@sha:chemin" pour un autre commit.
 */
export interface PullInfo {
  number: number; ref: string; sha: string; repo?: string; base?: string;
  baseRef?: string;     // branche visée (« main » par défaut) : la branche d'une autre PR quand elles sont empilées
  body?: string;
  merged?: boolean;     // fusionnée : absente de la liste des PR ouvertes
  mergeAtRead?: number; // devient fusionnée à la n-ième lecture de GET /pulls/{number} (fusion pendant un envoi)
  reads?: number;
}

export class FakeGitHub {
  files: Record<string, string> = {};
  pulls: Record<string, PullInfo[]> = {};
  userStatus = 200;
  pullGate: Promise<void> | null = null; // si défini, la création d'une PR attend que le test le libère
  failPulls = 0;      // nombre de créations de PR à refuser (422) avant d'accepter
  calls: string[] = [];
  posts = {
    trees: [] as { repo: string; body: { base_tree: string; tree: { path: string; content: string }[] } }[],
    commits: [] as { repo: string; body: { message: string; tree: string; parents: string[] } }[],
    refs: [] as { repo: string; body: { ref: string; sha: string } }[],
    pulls: [] as { repo: string; body: { title: string; head: string; base: string; body: string } }[],
    refUpdates: [] as { repo: string; ref: string; body: { sha: string; force: boolean } }[],
    pullUpdates: [] as { repo: string; number: number; body: { body: string } }[],
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
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)$/))) return json(200, { default_branch: "main", full_name: m[1] });
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/git\/ref\/heads\/main$/))) return json(200, { object: { sha: "base" } });
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/))) {
      const ref = url.searchParams.get("ref") || "base";
      const path = decodeURIComponent(m[2]);
      const key = ref === "base" ? `${m[1]}:${path}` : `${m[1]}@${ref}:${path}`;
      if (key in this.files) return route.fulfill({ status: 200, headers: cors, body: this.files[key] });
      return json(404, { message: "Not Found" });
    }
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/pulls$/)) && method === "GET") {
      return json(200, (this.pulls[m[1]] || []).filter(pr => !pr.merged).map(pr => ({
        number: pr.number, html_url: `https://github.com/${m![1]}/pull/${pr.number}`,
        base: { sha: pr.base || "base", ref: pr.baseRef || "main" },
        head: { ref: pr.ref, sha: pr.sha, repo: { full_name: pr.repo || m![1] } },
      })));
    }
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/))) {
      const pr = (this.pulls[m[1]] || []).find(x => x.number === Number(m![2]));
      if (!pr) return json(404, { message: "Not Found" });
      if (method === "PATCH") {
        const body = JSON.parse(req.postData() || "{}");
        this.posts.pullUpdates.push({ repo: m[1], number: pr.number, body });
        pr.body = body.body;
        return json(200, { number: pr.number });
      }
      pr.reads = (pr.reads || 0) + 1;
      if (pr.mergeAtRead && pr.reads >= pr.mergeAtRead) pr.merged = true;
      return json(200, {
        number: pr.number, html_url: `https://github.com/${m[1]}/pull/${pr.number}`,
        state: pr.merged ? "closed" : "open", merged: !!pr.merged, body: pr.body ?? "",
        head: { ref: pr.ref, sha: pr.sha },
      });
    }
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/git\/refs\/heads\/(.+)$/)) && method === "PATCH") {
      const ref = decodeURIComponent(m[2]);
      const body = JSON.parse(req.postData() || "{}");
      this.posts.refUpdates.push({ repo: m[1], ref, body });
      const pr = (this.pulls[m[1]] || []).find(x => x.ref === ref);
      if (pr) pr.sha = body.sha;
      return json(200, { ref: "refs/heads/" + ref, object: { sha: body.sha } });
    }
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/git\/commits\/([^/]+)$/)) && method === "GET") {
      return json(200, { sha: m[2], tree: { sha: m[2] === "base" ? "tree0" : "tree-" + m[2] } });
    }
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/git\/(trees|commits|refs)$/)) && method === "POST") {
      const kind = m[2] as "trees" | "commits" | "refs";
      (this.posts[kind] as { repo: string; body: unknown }[]).push({ repo: m[1], body: JSON.parse(req.postData() || "{}") });
      return json(201, { sha: `${kind}-${++this.n}` });
    }
    if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/pulls$/)) && method === "POST") {
      this.posts.pulls.push({ repo: m[1], body: JSON.parse(req.postData() || "{}") });
      if (this.pullGate) await this.pullGate;
      if (this.failPulls > 0) { this.failPulls--; return json(422, { message: "Validation Failed" }); }
      const number = this.posts.pulls.length;
      return json(201, { html_url: `https://github.com/${m[1]}/pull/${number}`, number });
    }
    return json(500, { message: `route non simulée : ${method} ${p}` });
  }
}
