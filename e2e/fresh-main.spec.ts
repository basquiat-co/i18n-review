import { test, expect, login, edit, field, row, summary, APP, FR_PATH, DE_PATH, FR, DE, json } from "./fixtures";
import type { Page } from "@playwright/test";

// Alex garde la page ouverte pendant que les développeurs fusionnent sur main : l'écran suit main sans qu'il
// recharge, et une modification dont main a changé le texte ne l'écrase jamais sans qu'il l'ait vue.

const backToTab = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("focus")));
const contentReads = (calls: string[]) => calls.filter(c => c.includes("/contents/")).length;
const byeOnMain = (value: string) => ({ [`${APP}:${DE_PATH}`]: json({ ...DE, bye: value }) });
const conflict = (page: Page, id: string) => page.getByRole("group", { name: `Changé sur main : ${id} (de)` });

test("l'écran suit main quand Alex revient sur l'onglet, sans recharger", async ({ page, gh }) => {
  await login(page);
  await expect(field(page, "bye")).toHaveValue("Tschüss");
  gh.moveMain("m2", byeOnMain("Bis bald"));
  await backToTab(page);
  await expect(field(page, "bye")).toHaveValue("Bis bald");
  await expect(page.getByText(/À jour avec la branche principale · \d\d:\d\d/)).toBeVisible();
});

test("main est vérifiée toutes les minutes tant que la page est ouverte", async ({ page, gh }) => {
  await page.clock.install();
  await login(page);
  gh.moveMain("m2", byeOnMain("Bis bald"));
  await page.clock.runFor(59_000);
  await expect(field(page, "bye")).toHaveValue("Tschüss");
  await page.clock.runFor(2_000);
  await expect(field(page, "bye")).toHaveValue("Bis bald");
});

test("une fusion qui ne touche aucun fichier relu ne relit pas les fichiers", async ({ page, gh }) => {
  await login(page);
  const before = contentReads(gh.calls);
  gh.moveMain("m2", { [`${APP}:README.md`]: "doc" });
  await backToTab(page);
  await expect.poll(() => gh.calls.some(c => c.includes("/compare/base...m2"))).toBe(true);
  await page.waitForTimeout(200);
  expect(contentReads(gh.calls)).toBe(before);
});

test("la saisie en cours n'est jamais effacée ; à la sortie du champ, le conflit est montré", async ({ page, gh }) => {
  await login(page);
  const f = field(page, "bye");
  await f.fill("Tschau"); // le champ garde le focus : rien n'est encore enregistré
  const before = contentReads(gh.calls);
  gh.moveMain("m2", byeOnMain("Bis bald"));
  await backToTab(page);
  await expect.poll(() => contentReads(gh.calls)).toBeGreaterThan(before);
  await page.waitForTimeout(200);
  await expect(f).toHaveValue("Tschau");
  await expect(f).toBeFocused();

  await f.blur();
  const note = conflict(page, "bye");
  await expect(note).toContainText("Bis bald");
  await expect(summary(page)).toContainText("1 à revoir");
  await note.getByRole("button", { name: "Garder ma correction" }).click();
  await expect(note).toBeHidden();
  await expect(field(page, "bye")).toHaveValue("Tschau");
  await expect(summary(page)).toContainText("1 correction");
  await expect(summary(page)).not.toContainText("à revoir");
});

test("une validation d'un texte que main a changé est retirée, avec un message", async ({ page, gh }) => {
  await login(page);
  await row(page, "bye").getByRole("button", { name: "Valider", exact: true }).click();
  await expect(summary(page)).toContainText("1 validation");
  gh.moveMain("m2", byeOnMain("Bis bald"));
  await backToTab(page);
  await expect(page.getByRole("alert").filter({ hasText: "1 validation retirée" })).toContainText("bye (de)");
  await expect(summary(page)).toContainText("Aucune modification en attente.");
});

test("une correction sur une clé supprimée sur main est gardée, montrée, et retirée par Alex seulement", async ({ page, gh }) => {
  await login(page);
  await edit(page, "bye", "Tschau");
  await edit(page, "menu.open", "Aufmachen");
  const { bye: _fr, ...fr } = FR;
  const { bye: _de, ...de } = DE;
  gh.moveMain("m2", { [`${APP}:${FR_PATH}`]: json(fr), [`${APP}:${DE_PATH}`]: json(de) });
  await backToTab(page);
  await expect(summary(page)).toContainText("1 à revoir");
  await expect(summary(page)).toContainText("2 corrections");
  await expect(page.getByText(/retirée/)).toHaveCount(0);

  await page.getByRole("button", { name: "Préparer la pull request" }).click();
  const dialog = page.getByRole("dialog");
  const note = dialog.getByRole("group", { name: "Changé sur main : bye (de)" });
  await expect(note).toContainText("Clé supprimée");
  await expect(note).toContainText("Tschau");
  await expect(dialog.getByRole("button", { name: "Créer la pull request" })).toBeDisabled();
  await note.getByRole("button", { name: "Retirer" }).click();
  await expect(dialog.getByRole("button", { name: "Créer la pull request" })).toBeEnabled();
  await expect(summary(page)).toContainText("1 correction");
});

test("un fichier de langue vidé sur main ne retire aucune validation", async ({ page, gh }) => {
  await login(page);
  await row(page, "bye").getByRole("button", { name: "Valider", exact: true }).click();
  gh.moveMain("m2", { [`${APP}:${DE_PATH}`]: json({}) });
  await backToTab(page);
  await expect.poll(() => gh.calls.some(c => c.includes("/compare/base...m2"))).toBe(true);
  await page.waitForTimeout(300);
  await expect(page.getByText(/retirée/)).toHaveCount(0);
  await expect(summary(page)).toContainText("1 validation");
});

test("la fenêtre d'envoi relit main et bloque l'envoi tant qu'un conflit n'est pas tranché", async ({ page, gh }) => {
  await login(page);
  await edit(page, "bye", "Tschau");
  await edit(page, "menu.open", "Aufmachen");
  gh.moveMain("m2", byeOnMain("Bis bald")); // pas de retour sur l'onglet : seule la fenêtre d'envoi le voit
  await page.getByRole("button", { name: "Préparer la pull request" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("1 correction à revoir avant l'envoi")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Créer la pull request" })).toBeDisabled();

  await conflict(dialog as unknown as Page, "bye").getByRole("button", { name: "Prendre le texte actuel" }).click();
  await expect(dialog.getByText(/à revoir avant l'envoi/)).toBeHidden();
  await dialog.getByRole("button", { name: "Créer la pull request" }).click();
  await expect(page.getByText(/Pull request créée dans basquiat-co\/basquiat-app\./)).toBeVisible();
  const de = JSON.parse(gh.written(DE_PATH)!);
  expect(de.bye).toBe("Bis bald");
  expect(de.menu.open).toBe("Aufmachen");
});

test("l'envoi refuse une modification que main a dépassée entre-temps, sans rien écrire", async ({ page, gh }) => {
  await login(page);
  await edit(page, "bye", "Tschau");
  await page.getByRole("button", { name: "Préparer la pull request" }).click();
  const dialog = page.getByRole("dialog");
  const create = dialog.getByRole("button", { name: "Créer la pull request" });
  await expect(create).toBeEnabled(); // la vérification à l'ouverture est passée
  gh.moveMain("m2", byeOnMain("Bis bald"));
  await create.click();

  await expect(dialog.getByRole("alert")).toContainText("Rien n'a été envoyé : la branche principale a changé pendant ta relecture");
  expect(gh.writes()).toBe(0);
  await expect(dialog.getByText("1 correction à revoir avant l'envoi")).toBeVisible();
  await expect(create).toBeDisabled();
});

test("une vérification qui échoue ne dérange pas Alex", async ({ page, gh }) => {
  await login(page);
  const refReads = () => gh.calls.filter(c => c.includes("/git/ref/heads/main")).length;
  const before = refReads();
  gh.mainStatus = 500;
  await backToTab(page);
  await expect.poll(refReads).toBeGreaterThan(before);
  await page.waitForTimeout(200);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(field(page, "bye")).toHaveValue("Tschüss");
});

test("un fichier source vidé sur main ne retire aucune modification, et l'envoi nomme le fichier", async ({ page, gh }) => {
  await login(page);
  await edit(page, "bye", "Tschau");
  gh.moveMain("m2", { [`${APP}:${FR_PATH}`]: json({}) });
  await backToTab(page);
  await expect.poll(() => gh.calls.some(c => c.includes("/compare/base...m2"))).toBe(true);
  await page.waitForTimeout(300);
  await expect(page.getByText(/modification retirée/)).toHaveCount(0);
  await expect(summary(page)).toContainText("1 correction");

  await page.getByRole("button", { name: "Préparer la pull request" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Créer la pull request" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Fichier source introuvable ou vide" })).toContainText(FR_PATH);
  expect(gh.writes()).toBe(0);
  await expect(summary(page)).toContainText("1 correction");
});

test("si main ne peut pas être relue à l'ouverture de l'envoi, la fenêtre le dit", async ({ page, gh }) => {
  await login(page);
  await edit(page, "bye", "Tschau");
  gh.mainStatus = 500;
  await page.getByRole("button", { name: "Préparer la pull request" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("Impossible de relire la branche principale");
  await expect(dialog.getByRole("button", { name: "Créer la pull request" })).toBeEnabled();
});
