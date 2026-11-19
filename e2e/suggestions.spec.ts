import { test, expect, login, edit, field, summary, createPr, APP, DE_PATH, REVIEW, DE } from "./fixtures";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import type { FakeGitHub } from "./fake-github";

// Les développeurs ne modifient plus un texte existant : ils le suggèrent dans i18n-suggestions/<branche>.json.
// Alex voit chaque suggestion sous sa clé, la reprend ou la met de côté ; sa PR la retire du fichier.

const CAT = "app/i18n/{lang}/app.json";
const FILE = "i18n-suggestions/feat-team.json";
const BYE = { catalog: CAT, key: "bye", context: "Bouton qui ferme la session.", proposed: { de: "Bis bald" } };
const OPEN = { catalog: CAT, key: "menu.open", context: "Ouvre le menu, 12 caractères au plus." };
const suggestions = (...items: object[]) => JSON.stringify({ author: "Jimmy, with Claude", items }, null, 2) + "\n";

function withSuggestions(gh: FakeGitHub, ...items: object[]) {
  gh.files[`${APP}:${FILE}`] = suggestions(...items);
  gh.fileCommits[`${APP}:${FILE}`] = ["c-last", "c-first"];
  gh.commitPulls["c-first"] = 42;
}
const card = (page: Page, key: string) => page.getByRole("group", { name: `Suggestion pour ${key}` });
const sentFile = (gh: FakeGitHub) => JSON.parse(gh.written(FILE)!);

test("une suggestion s'affiche sous sa clé, avec son contexte, son auteur et sa PR", async ({ page, gh }) => {
  withSuggestions(gh, BYE);
  await login(page);
  const c = card(page, "bye");
  await expect(c).toContainText("Bouton qui ferme la session.");
  await expect(c).toContainText("Jimmy, with Claude");
  await expect(c).toContainText("Bis bald");
  await expect(c.getByRole("link", { name: "PR #42" })).toHaveAttribute("href", `https://github.com/${APP}/pull/42`);
});

test("reprendre une suggestion en fait une correction ; la PR l'écrit et retire la suggestion du fichier", async ({ page, gh }) => {
  withSuggestions(gh, BYE, OPEN);
  await login(page);
  await card(page, "bye").getByRole("button", { name: "Reprendre dans ma relecture" }).click();
  await expect(field(page, "bye")).toHaveValue("Bis bald");
  await expect(summary(page)).toContainText("1 correction");
  await expect(summary(page)).toContainText("1 suggestion réglée");
  await expect(card(page, "bye")).toContainText("Reprise dans ta relecture");

  await createPr(page);
  await expect(page.getByText(/Pull request créée dans basquiat-co\/basquiat-app\./)).toBeVisible();
  expect(JSON.parse(gh.written(DE_PATH)!).bye).toBe("Bis bald");
  expect(sentFile(gh)).toEqual({ author: "Jimmy, with Claude", items: [OPEN] });
  expect(gh.posts.pulls[0].body.body).toContain("`bye`");
  // Envoyée : la décision n'est plus gardée sur l'ordinateur, c'est la PR qui la porte.
  expect(await page.evaluate(() => localStorage.getItem("i18n-suggestions-settled"))).toBeNull();
});

test("une suggestion qu'une PR de l'outil ouverte retire est montrée réglée ; PR fermée, elle revient", async ({ page, gh }) => {
  withSuggestions(gh, BYE, OPEN);
  // La PR a été ouverte avant que le fichier n'existe (rien à sa base d'origine « old ») ; reprise depuis, elle a pour
  // base commune avec main « mb », où le fichier est là. C'est à celle-ci qu'elle est comparée.
  gh.pulls[APP] = [{ number: 7, ref: "i18n-review/202611181000-abcd", sha: "pr7", body: "", base: "old" }];
  gh.compares.pr7 = { mergeBase: "mb", files: [] };
  gh.files[`${APP}@mb:${FILE}`] = suggestions(BYE, OPEN);
  gh.files[`${APP}@pr7:${FILE}`] = suggestions(OPEN);
  await login(page);
  await expect(card(page, "bye")).toContainText("Réglée dans la PR #7");
  await expect(card(page, "bye").getByRole("button")).toHaveCount(0);
  await expect(card(page, "menu.open").getByRole("button", { name: "C'est noté" })).toBeVisible();

  gh.pulls[APP] = []; // fermée sans fusion
  await page.getByRole("button", { name: "Recharger depuis GitHub" }).click();
  await expect(card(page, "bye").getByRole("button", { name: "Reprendre dans ma relecture" })).toBeVisible();
});

test("une suggestion dans une langue que ce jeu ne relit pas ne se reprend pas, elle se met de côté", async ({ page, gh }) => {
  withSuggestions(gh, { catalog: CAT, key: "bye", context: "Bouton.", proposed: { en: "Bye" } });
  await login(page);
  await expect(card(page, "bye")).toContainText("Bye");
  await expect(card(page, "bye").getByRole("button", { name: "Reprendre dans ma relecture" })).toHaveCount(0);
  await expect(card(page, "bye").getByRole("button", { name: "Mettre de côté" })).toBeVisible();
});

test("régler toutes les suggestions sans rien corriger s'envoie aussi ; le fichier vidé est supprimé", async ({ page, gh }) => {
  withSuggestions(gh, BYE, OPEN);
  await login(page);
  await card(page, "bye").getByRole("button", { name: "Mettre de côté" }).click();
  await card(page, "menu.open").getByRole("button", { name: "C'est noté" }).click();
  await expect(summary(page)).toContainText("2 suggestions réglées");
  await createPr(page);
  await expect(page.getByText(/Pull request créée/)).toBeVisible();
  expect(gh.deleted(FILE)).toBe(true);
  expect(gh.written(DE_PATH)).toBeUndefined();
});

test("annuler les corrections d'une suggestion reprise la remet à régler", async ({ page, gh }) => {
  withSuggestions(gh, BYE);
  await login(page);
  await card(page, "bye").getByRole("button", { name: "Reprendre dans ma relecture" }).click();
  await expect(card(page, "bye")).toContainText("Reprise dans ta relecture");
  await page.locator('[data-id="bye"]').getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(card(page, "bye").getByRole("button", { name: "Reprendre dans ma relecture" })).toBeVisible();
  await expect(summary(page)).toContainText("Aucune modification en attente.");
});

test("revenir sur une décision avant l'envoi", async ({ page, gh }) => {
  withSuggestions(gh, OPEN);
  await login(page);
  await card(page, "menu.open").getByRole("button", { name: "C'est noté" }).click();
  await card(page, "menu.open").getByRole("button", { name: "Revenir dessus" }).click();
  await expect(card(page, "menu.open").getByRole("button", { name: "C'est noté" })).toBeVisible();
  await expect(summary(page)).toContainText("Aucune modification en attente.");
});

test("une suggestion sur une clé qui n'existe plus est signalée et peut être mise de côté", async ({ page, gh }) => {
  withSuggestions(gh, { catalog: CAT, key: "gone", context: "Ancien bouton." });
  await login(page);
  const notice = page.getByText(/1 suggestion porte sur une clé qui n'existe plus \(gone\)/);
  await expect(notice).toBeVisible();
  await page.getByRole("button", { name: "La mettre de côté" }).click();
  await expect(notice).toBeHidden();
  await expect(summary(page)).toContainText("1 suggestion réglée");
});

test("une suggestion sur un simple objet parent, sans ligne, est signalée", async ({ page, gh }) => {
  withSuggestions(gh, { catalog: CAT, key: "menu", context: "Tout le menu." });
  await login(page);
  await expect(page.getByText(/1 suggestion porte sur une clé qui n'existe plus \(menu\)/)).toBeVisible();
});

test("une PR reprise rejoue les suggestions qu'elle avait retirées, sans toucher aux nouvelles", async ({ page, gh }) => {
  const NEW = { catalog: CAT, key: "menu.close", context: "Ajoutée depuis." };
  // La PR #7 de l'outil, partie de « old », avait retiré la suggestion bye. Depuis, main en a reçu une autre.
  const REF = "i18n-review/202611181000-abcd";
  const TOOL = "i18n : relecture\n\nCréé avec l'outil de relecture des traductions par Camille.";
  gh.pulls[APP] = [{ number: 7, ref: REF, sha: "pr7", body: "Corps", autoMerge: true }];
  gh.compares.pr7 = { mergeBase: "old", files: [FILE, REVIEW], commits: [TOOL] };
  gh.files[`${APP}@old:${FILE}`] = suggestions(BYE, OPEN);
  gh.files[`${APP}@pr7:${FILE}`] = suggestions(OPEN);
  gh.files[`${APP}@old:${REVIEW}`] = gh.files[`${APP}:${REVIEW}`];
  gh.files[`${APP}@pr7:${REVIEW}`] = gh.files[`${APP}:${REVIEW}`];
  withSuggestions(gh, BYE, OPEN, NEW);
  await login(page);
  await edit(page, "menu.open", "Aufmachen");
  await createPr(page);
  await expect(page.getByText(/Pull request #7 mise à jour/)).toBeVisible();
  expect(sentFile(gh).items).toEqual([OPEN, NEW]);
});

// Captures prises par make i18n-capture (lift-agentic-service) : vraies images WebP, données fictives.
const SHOT = (kind: string) => readFileSync(new URL(`./assets/${kind}.webp`, import.meta.url));
const shotPath = (key: string, kind: string) => `i18n-suggestions/feat-team/${key}.de.${kind}.webp`;
function withShots(gh: FakeGitHub, key: string) {
  for (const kind of ["current", "proposed"]) gh.binaries[`${APP}:${shotPath(key, kind)}`] = SHOT(kind);
}

test("les captures d'une suggestion s'affichent sous elle, texte actuel et texte proposé", async ({ page, gh }) => {
  withSuggestions(gh, BYE);
  withShots(gh, "bye");
  await login(page);
  const c = card(page, "bye");
  for (const alt of ["Texte actuel (de)", "Texte proposé (de)"]) {
    const img = c.getByRole("img", { name: alt });
    await expect(img).toBeVisible();
    // Décodée : lue avec le jeton depuis le dépôt, ce n'est pas un lien cassé.
    await expect.poll(() => img.evaluate(i => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await expect(c.getByText("Texte proposé · allemand")).toBeVisible();
  // Le lien « agrandir » mène à une image, pas au type brut renvoyé par l'API GitHub.
  const href = await c.getByRole("link", { name: "Texte actuel (de)" }).getAttribute("href");
  expect(await page.evaluate(async u => (await fetch(u!)).headers.get("content-type"), href)).toBe("image/webp");
});

test("régler une suggestion supprime ses captures, et seulement les siennes", async ({ page, gh }) => {
  withSuggestions(gh, BYE, OPEN);
  withShots(gh, "bye");
  withShots(gh, "menu.open");
  await login(page);
  await card(page, "bye").getByRole("button", { name: "Mettre de côté" }).click();
  await createPr(page);
  await expect(page.getByText(/Pull request créée/)).toBeVisible();
  expect(gh.deleted(shotPath("bye", "current"))).toBe(true);
  expect(gh.deleted(shotPath("bye", "proposed"))).toBe(true);
  expect(gh.deleted(shotPath("menu.open", "current"))).toBe(false);
});

test("une PR reprise supprime à nouveau les captures qu'elle avait retirées", async ({ page, gh }) => {
  const REF = "i18n-review/202611181000-abcd";
  const TOOL = "i18n : relecture\n\nCréé avec l'outil de relecture des traductions par Camille.";
  const shot = shotPath("bye", "current");
  gh.pulls[APP] = [{ number: 7, ref: REF, sha: "pr7", body: "Corps", autoMerge: true }];
  gh.compares.pr7 = { mergeBase: "old", files: [FILE, shot, REVIEW], commits: [TOOL] };
  gh.files[`${APP}@old:${FILE}`] = suggestions(BYE, OPEN);
  gh.files[`${APP}@pr7:${FILE}`] = suggestions(OPEN);
  gh.files[`${APP}@old:${REVIEW}`] = gh.files[`${APP}:${REVIEW}`];
  gh.files[`${APP}@pr7:${REVIEW}`] = gh.files[`${APP}:${REVIEW}`];
  withSuggestions(gh, BYE, OPEN);
  withShots(gh, "bye");
  await login(page);
  await edit(page, "menu.open", "Aufmachen");
  await createPr(page);
  await expect(page.getByText(/Pull request #7 mise à jour/)).toBeVisible();
  expect(gh.deleted(shot)).toBe(true);
});

test("sans dossier de suggestions, rien ne change", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("group", { name: /^Suggestion pour/ })).toHaveCount(0);
  await expect(field(page, "bye")).toHaveValue(DE.bye);
});

test("un fichier de suggestions illisible est ignoré, les autres s'affichent", async ({ page, gh }) => {
  gh.files[`${APP}:${FILE}`] = "{ pas du json";
  gh.files[`${APP}:i18n-suggestions/ok.json`] = suggestions(OPEN);
  await login(page);
  await expect(card(page, "menu.open")).toBeVisible();
});
