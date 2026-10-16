import { test, expect, login, row, summary, createPr, APP, DE_PATH, REVIEW } from "./fixtures";

const draft = (set: string, lang: string, id: string, value: string, edited: boolean) =>
  ({ set, lang, id, segs: id.split("."), value, original: "", exists: false, source: "x", edited });

test("les modifications d'un jeu ou d'une langue retirés sont mises de côté, jamais envoyées", async ({ page, gh }) => {
  await login(page, {
    storage: {
      "i18n-set": "ancien",
      "i18n-drafts": JSON.stringify({
        "app|de|menu.close": draft("app", "de", "menu.close", "Schließen", true),
        "ancien|de|x": draft("ancien", "de", "x", "Texte d'une correction perdue", true),
        "app|it|bye": draft("app", "it", "bye", "Ciao", false),
      }),
    },
  });

  const notice = page.getByText(/concernent des fichiers que l'outil ne propose plus/);
  await expect(notice).toContainText("2 modifications");
  await expect(notice).toContainText("ancien (de)");
  await page.getByText("Voir la correction").click();
  await expect(page.getByText("Texte d'une correction perdue")).toBeVisible();
  await expect(summary(page)).toContainText("1 correction · 0 validation");
  await expect(row(page, "menu.close")).toContainText("Corrigée");

  await createPr(page);
  await expect(page.getByRole("link", { name: "Ouvrir la PR #1" })).toBeVisible();
  expect(new Set(gh.posts.trees.map(t => t.repo))).toEqual(new Set([APP]));
  expect(gh.posts.trees[0].body.tree.map(t => t.path)).toEqual([DE_PATH, REVIEW]);
  expect(gh.written(REVIEW)).not.toContain('"ancien"');

  // L'avertissement revient au démarrage tant que les modifications ne sont pas supprimées.
  await page.reload();
  await expect(notice).toBeVisible();
  await page.getByRole("button", { name: "Supprimer ces modifications" }).click();
  expect(await page.evaluate(() => localStorage.getItem("i18n-drafts-orphans"))).not.toBeNull();
  await page.getByRole("button", { name: "Confirmer la suppression" }).click();
  await expect(notice).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("i18n-drafts-orphans"))).toBeNull();
  await page.reload();
  await expect(page.locator("[data-id]").first()).toBeVisible();
  await expect(notice).toBeHidden();
});
