import { test, expect, login, edit, summary, APP, DE_PATH, DE, json } from "./fixtures";

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
  await expect(page.getByText(/La pull request n'a pas pu être créée\. GitHub a refusé l'opération : Validation Failed/)).toBeVisible();
  await expect(page.getByText(/Tes modifications sont conservées/)).toBeVisible();
  await expect(summary(page)).toContainText("1 correction");

  await page.getByRole("button", { name: "Préparer la pull request" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Créer la pull request" }).click();
  await expect(page.getByRole("link", { name: "Ouvrir la PR #2" })).toBeVisible();
  expect(gh.written(DE_PATH)).toBe(json({ ...DE, bye: "Tschau" }));
  expect(gh.posts.pulls.map(p => p.repo)).toEqual([APP, APP]);
});
