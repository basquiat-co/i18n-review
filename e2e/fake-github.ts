import type { Route } from "@playwright/test";

/**
 * Fausse API GitHub, branchée sur les requêtes du navigateur (context.route) : aucun appel réseau réel.
 * files : "propriétaire/dépôt:chemin" pour la branche principale, "propriétaire/dépôt@sha:chemin" pour un autre commit.
 */
export interface PullInfo { number: number; ref: string; sha: string; repo?: string }

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
      return json(200, (this.pulls[m[1]] || []).map(pr => ({
        number: pr.number, html_url: `https://github.com/${m![1]}/pull/${pr.number}`,
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
      const number = this.posts.pulls.length;
      return json(201, { html_url: `https://github.com/${m[1]}/pull/${number}`, number });
    }
    return json(500, { message: `route non simulée : ${method} ${p}` });
  }
}
