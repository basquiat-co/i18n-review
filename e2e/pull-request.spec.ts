import { test, expect, login, edit, summary, APP, DE_PATH, FR_PATH, REVIEW, DE, FR, json, reviewFile } from "./fixtures";
import type { FakeGitHub } from "./fake-github";

test("pendant l'envoi, le panneau ne peut être ni fermé ni rouvert (pas de PR en double)", async ({ page, gh }) => {
  let release!: () => void;
  gh.pullGate = new Promise(r => { release = r; });
  await login(page);
  await edit(page, "bye", "Tschau");
  await page.getByRole("button", { name: "Préparer la pull request" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Créer la pull request" }).click();
  await expect.poll(() => gh.posts.pulls.length).toBe(1); // la création est en cours

  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Fermer" })).toBeDisabled();
  // Même déclenché derrière le panneau, « Préparer » ne relance rien. (Sélecteur CSS : le panneau peut retirer
  // le reste de la page de l'arbre d'accessibilité, le bouton n'a alors plus de rôle visible.)
  await page.locator("button", { hasText: "Préparer la pull request" }).evaluate((b: HTMLButtonElement) => b.click());
  await expect(dialog.getByRole("button", { name: /Création en cours/ })).toBeDisabled();

  release();
  await expect(page.getByRole("link", { name: "Ouvrir la PR #1" })).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(gh.posts.refs).toHaveLength(1);
  expect(gh.posts.pulls).toHaveLength(1);
});

test("hors envoi, Échap et « Fermer » referment le panneau", async ({ page }) => {
  await login(page);
  await edit(page, "bye", "Tschau");
  await page.getByRole("button", { name: "Préparer la pull request" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Préparer la pull request" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Fermer" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(summary(page)).toContainText("1 correction");
});

test("si GitHub refuse la PR, les modifications restent et on peut réessayer", async ({ page, gh }) => {
  gh.failPulls = 1;
  await login(page);
  await edit(page, "bye", "Tschau");
  await page.getByRole("button", { name: "Préparer la pull request" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Créer la pull request" }).click();
  await expect(page.getByText(/La pull request n'a pas pu être envoyée\. GitHub a refusé l'opération : Validation Failed/)).toBeVisible();
  await expect(page.getByText(/Tes modifications sont conservées/)).toBeVisible();
  await expect(summary(page)).toContainText("1 correction");

  await page.getByRole("button", { name: "Préparer la pull request" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Créer la pull request" }).click();
  await expect(page.getByRole("link", { name: "Ouvrir la PR #2" })).toBeVisible();
  expect(gh.written(DE_PATH)).toBe(json({ ...DE, bye: "Tschau" }));
  expect(gh.posts.pulls.map(p => p.repo)).toEqual([APP, APP]);
});

/* ---------- Une seule PR ouverte : l'envoi suivant la met à jour ---------- */

// Une PR de l'outil déjà ouverte, dont la branche porte une correction (hello) absente de la branche principale.
function openPr(gh: FakeGitHub, pr: { number: number; ref: string; sha: string; baseRef?: string; mergeAtRead?: number }) {
  (gh.pulls[APP] ||= []).push({ ...pr, body: "### Résumé\n- première relecture\n" });
  gh.files[`${APP}@${pr.sha}:${FR_PATH}`] = json(FR);
  gh.files[`${APP}@${pr.sha}:${DE_PATH}`] = json({ ...DE, hello: "Hallo, {name}" });
  gh.files[`${APP}@${pr.sha}:${REVIEW}`] = reviewFile();
}
async function send(page: import("@playwright/test").Page) {
  await edit(page, "bye", "Tschau");
  await page.getByRole("button", { name: "Préparer la pull request" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Créer la pull request" }).click();
}

test("une PR de l'outil déjà ouverte reçoit l'envoi suivant, sans nouvelle PR ni nouvelle branche", async ({ page, gh }) => {
  openPr(gh, { number: 7, ref: "i18n-review/202610161200-abcd", sha: "pr7" });
  await login(page);
  await send(page);
  await expect(page.getByText(`Pull request mise à jour dans ${APP}.`)).toBeVisible();
  await expect(page.getByRole("link", { name: "Ouvrir la PR #7" })).toHaveAttribute("href", `https://github.com/${APP}/pull/7`);

  expect(gh.posts.pulls).toHaveLength(0);
  expect(gh.posts.refs).toHaveLength(0);
  // Le commit part de la tête de la PR et garde ce qu'elle contenait déjà.
  expect(gh.posts.trees[0].body.base_tree).toBe("tree-pr7");
  expect(gh.posts.commits[0].body.parents).toEqual(["pr7"]);
  expect(gh.written(DE_PATH)).toBe(json({ ...DE, hello: "Hallo, {name}", bye: "Tschau" }));
  expect(gh.posts.refUpdates).toEqual([{ repo: APP, ref: "i18n-review/202610161200-abcd", body: { sha: "commits-2", force: false } }]);
  // La description garde l'envoi précédent et ajoute celui-ci.
  const body = gh.posts.pullUpdates[0].body.body;
  expect(body).toContain("- première relecture");
  expect(body).toMatch(/## Mise à jour du \d{2}\.\d{2}\.\d{4} par Camille Relectrice/);
  expect(body).toContain("| `bye` | de | Tschüss | Tschau |");
});

test("avec des PR empilées, c'est le sommet de la pile qui est mis à jour", async ({ page, gh }) => {
  openPr(gh, { number: 7, ref: "i18n-review/202610161200-abcd", sha: "pr7" });
  openPr(gh, { number: 9, ref: "i18n-review/202610171200-efgh", sha: "pr9", baseRef: "i18n-review/202610181200-ijkl" });
  openPr(gh, { number: 8, ref: "i18n-review/202610181200-ijkl", sha: "pr8", baseRef: "i18n-review/202610161200-abcd" });
  await login(page);
  await send(page);
  await expect(page.getByRole("link", { name: "Ouvrir la PR #9" })).toBeVisible();
  expect(gh.posts.commits[0].body.parents).toEqual(["pr9"]);
  expect(gh.posts.refUpdates.map(r => r.ref)).toEqual(["i18n-review/202610171200-efgh"]);
  expect(gh.posts.pulls).toHaveLength(0);
});

test("une PR fusionnée juste avant l'écriture n'est pas modifiée : une nouvelle PR part de la branche principale", async ({ page, gh }) => {
  // Lectures de la PR : au chargement de l'écran et au choix de la PR, ouverte ; juste avant d'écrire, fusionnée.
  openPr(gh, { number: 7, ref: "i18n-review/202610161200-abcd", sha: "pr7", mergeAtRead: 3 });
  await login(page);
  await send(page);
  await expect(page.getByText(`Pull request créée dans ${APP}.`)).toBeVisible();

  expect(gh.posts.refUpdates).toHaveLength(0);
  expect(gh.posts.pullUpdates).toHaveLength(0);
  expect(gh.posts.pulls).toHaveLength(1);
  expect(gh.posts.pulls[0].body.base).toBe("main");
  expect(gh.posts.pulls[0].body.head).toMatch(/^i18n-review\//);
  // Le commit envoyé repart de la branche principale, pas de la branche fusionnée.
  expect(gh.posts.commits.at(-1)!.body.parents).toEqual(["base"]);
  expect(gh.posts.refs[0].body.sha).toBe("commits-4");
  expect(gh.written(DE_PATH)).toBe(json({ ...DE, bye: "Tschau" }));
});
