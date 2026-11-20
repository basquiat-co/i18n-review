import { test, expect, login, edit, createPr, summary, row, filter, APP, FR_PATH, DE_PATH, REVIEW, FR, DE, json } from "./fixtures";
import { hash } from "../src/lib/core";
import type { Page } from "@playwright/test";
import type { FakeGitHub } from "./fake-github";

// Une PR de l'outil déjà ouverte (#7). Depuis son point de départ (« old »), main a supprimé la clé « gone »
// (et, avec clash, changé « members ») ; la PR, elle, a corrigé hello, gone et members.
const REF = "i18n-review/202611171504-abcd";
const MAIN_MEMBERS = "{count, plural, one {# Mitglied} other {# Mitglieder (neu)}}";

const TOOL_COMMIT = "i18n : relecture allemand du 17.11.2026\n\nCréé avec l'outil de relecture des traductions par Camille Relectrice.";

function openPr(gh: FakeGitHub, { files = [DE_PATH, REVIEW], commits = [TOOL_COMMIT], state = "open", merged = false, clash = false } = {}) {
  gh.pulls[APP] = [{ number: 7, ref: REF, sha: "pr7", body: "Corps initial", state, merged }];
  gh.compares.pr7 = { mergeBase: "old", files, commits };
  const review = JSON.parse(gh.files[`${APP}:${REVIEW}`]);
  gh.files[`${APP}@old:${FR_PATH}`] = json({ ...FR, gone: "Parti" });
  gh.files[`${APP}@old:${DE_PATH}`] = json({ ...DE, gone: "Weg" });
  gh.files[`${APP}@old:${REVIEW}`] = json(review);
  gh.files[`${APP}@pr7:${DE_PATH}`] = json({ ...DE, hello: "Hallo, {name}", gone: "Fort", members: "{count, plural, one {# Person} other {# Personen}}" });
  const pr = structuredClone(review);
  pr.sets.app.de.hello = hash(FR.hello) + " " + hash("Hallo, {name}");
  pr.sets.app.de.gone = hash("Parti") + " " + hash("Fort");
  pr.sets.app.de.members = hash(FR.members) + " " + hash("{count, plural, one {# Person} other {# Personen}}");
  gh.files[`${APP}@pr7:${REVIEW}`] = json(pr);
  if (clash) gh.files[`${APP}:${DE_PATH}`] = json({ ...DE, members: MAIN_MEMBERS });
}
const PR_MEMBERS = "{count, plural, one {# Person} other {# Personen}}";

test("une PR de l'outil ouverte est reprise sur la dernière version de main, sans nouvelle PR", async ({ page, gh }) => {
  openPr(gh);
  await login(page);
  await edit(page, "bye", "Tschau");
  // hello est en attente dans la PR #7 ; la valider telle qu'affichée (texte de main) ne défait pas la correction.
  await filter(page, "En attente").click();
  await row(page, "hello").getByRole("button", { name: "Valider", exact: true }).click();
  await createPr(page);

  const notice = page.getByText(/Pull request #7 mise à jour dans basquiat-co\/basquiat-app\./);
  await expect(notice).toBeVisible();
  await expect(page.getByRole("link", { name: "Ouvrir la PR #7" })).toBeVisible();

  expect(gh.posts.pulls).toHaveLength(0);
  expect(gh.posts.refs).toHaveLength(0);
  expect(gh.posts.refUpdates).toEqual([{ repo: APP, ref: REF, body: { sha: "commits-2", force: false } }]);
  expect(gh.posts.commits[0].body.parents).toEqual(["pr7", "base"]);
  expect(gh.posts.commits[0].body.message).toContain("Reprend la PR #7 sur la dernière version de main.");
  // hello et members viennent de la PR, bye de la relecture ; gone, supprimée sur main, n'est pas recréée.
  expect(gh.written(DE_PATH)).toBe(json({ ...DE, hello: "Hallo, {name}", bye: "Tschau", members: PR_MEMBERS }));
  const de = JSON.parse(gh.written(REVIEW)!).sets.app.de;
  expect(de.hello).toBe(hash(FR.hello) + " " + hash("Hallo, {name}"));
  expect(de.bye).toBe(hash(FR.bye) + " " + hash("Tschau"));
  expect(de.gone).toBeUndefined();

  const body = gh.posts.pullUpdates[0].body.body;
  expect(body.startsWith("Corps initial\n\n---\n\n### Mise à jour du ")).toBe(true);
  expect(body).toContain("| `bye` | de |");
});

const clashNote = (page: Page) => page.getByRole("dialog").getByRole("group", { name: "Conflit avec la PR #7 : members (de)" });

test("un texte de la PR ouverte changé aussi sur main bloque l'envoi ; Alex garde le sien", async ({ page, gh }) => {
  openPr(gh, { clash: true });
  await login(page);
  await edit(page, "bye", "Tschau");
  await page.getByRole("button", { name: "Préparer la pull request" }).click();
  const dialog = page.getByRole("dialog");
  const create = dialog.getByRole("button", { name: "Créer la pull request" });
  await expect(clashNote(page)).toContainText(PR_MEMBERS);
  await expect(clashNote(page)).toContainText(MAIN_MEMBERS);
  await expect(create).toBeDisabled();
  await clashNote(page).getByRole("button", { name: "Garder ma version" }).click();
  await expect(clashNote(page).getByRole("button", { name: "Garder ma version" })).toHaveAttribute("aria-pressed", "true");
  await create.click();

  await expect(page.getByText(/Pull request #7 mise à jour dans basquiat-co\/basquiat-app\./)).toBeVisible();
  expect(gh.written(DE_PATH)).toBe(json({ ...DE, hello: "Hallo, {name}", bye: "Tschau", members: PR_MEMBERS }));
  expect(JSON.parse(gh.written(REVIEW)!).sets.app.de.members).toBe(hash(FR.members) + " " + hash(PR_MEMBERS));
  const body = gh.posts.pullUpdates[0].body.body;
  expect(body).toContain("| `members` | de |");
  expect(body).not.toContain("Modifiées aussi");
});

test("un texte de la PR ouverte changé aussi sur main : Alex prend celui de main, qui est marqué relu", async ({ page, gh }) => {
  openPr(gh, { clash: true });
  await login(page);
  await edit(page, "bye", "Tschau");
  await page.getByRole("button", { name: "Préparer la pull request" }).click();
  await clashNote(page).getByRole("button", { name: "Prendre celle de la branche principale" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Créer la pull request" }).click();

  await expect(page.getByText(/Pull request #7 mise à jour/)).toBeVisible();
  expect(gh.written(DE_PATH)).toBe(json({ ...DE, hello: "Hallo, {name}", bye: "Tschau", members: MAIN_MEMBERS }));
  expect(JSON.parse(gh.written(REVIEW)!).sets.app.de.members).toBe(hash(FR.members) + " " + hash(MAIN_MEMBERS));
});

test("si main change encore le texte après le choix d'Alex, rien n'est envoyé et il choisit à nouveau", async ({ page, gh }) => {
  openPr(gh, { clash: true });
  await login(page);
  await edit(page, "bye", "Tschau");
  await page.getByRole("button", { name: "Préparer la pull request" }).click();
  const dialog = page.getByRole("dialog");
  await clashNote(page).getByRole("button", { name: "Garder ma version" }).click();
  gh.moveMain("m2", { [`${APP}:${DE_PATH}`]: json({ ...DE, members: "{count, plural, one {# Mitglied} other {# Mitglieder (neu 2)}}" }) });
  await dialog.getByRole("button", { name: "Créer la pull request" }).click();

  await expect(dialog.getByRole("alert")).toContainText("Rien n'a été envoyé");
  expect(gh.writes()).toBe(0);
  await expect(clashNote(page)).toContainText("(neu 2)");
  await expect(clashNote(page).getByRole("button", { name: "Garder ma version" })).toHaveAttribute("aria-pressed", "false");
  await expect(dialog.getByRole("button", { name: "Créer la pull request" })).toBeDisabled();
});

test("garder sa version quand main a aussi changé la source : la clé repasse « source modifiée »", async ({ page, gh }) => {
  openPr(gh, { clash: true });
  const newSource = "{count, plural, one {# membre actif} other {# membres actifs}}";
  gh.files[`${APP}@pr7:${FR_PATH}`] = json(FR);
  gh.files[`${APP}:${FR_PATH}`] = json({ ...FR, members: newSource });
  await login(page);
  await edit(page, "bye", "Tschau");
  await page.getByRole("button", { name: "Préparer la pull request" }).click();
  await expect(clashNote(page)).toContainText(newSource);
  await clashNote(page).getByRole("button", { name: "Garder ma version" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Créer la pull request" }).click();

  await expect(page.getByText(/Pull request #7 mise à jour/)).toBeVisible();
  // relue face à la source qu'Alex avait en l'écrivant, pas face à la nouvelle
  expect(JSON.parse(gh.written(REVIEW)!).sets.app.de.members).toBe(hash(FR.members) + " " + hash(PR_MEMBERS));
});

test("si le conflit disparaît après le choix d'Alex (main remis), rien n'est envoyé", async ({ page, gh }) => {
  openPr(gh, { clash: true });
  await login(page);
  await edit(page, "bye", "Tschau");
  await page.getByRole("button", { name: "Préparer la pull request" }).click();
  const dialog = page.getByRole("dialog");
  await clashNote(page).getByRole("button", { name: "Prendre celle de la branche principale" }).click();
  gh.moveMain("m2", { [`${APP}:${DE_PATH}`]: json(DE) });
  await dialog.getByRole("button", { name: "Créer la pull request" }).click();

  await expect(dialog.getByRole("alert")).toContainText("Rien n'a été envoyé");
  expect(gh.writes()).toBe(0);
  await expect(clashNote(page)).toBeHidden();
  await expect(dialog.getByRole("button", { name: "Créer la pull request" })).toBeEnabled();
});

test("une PR où un développeur a fusionné main (Update branch) est reprise", async ({ page, gh }) => {
  openPr(gh, { commits: [TOOL_COMMIT, "Merge branch 'main' into " + REF] });
  await login(page);
  await edit(page, "bye", "Tschau");
  await createPr(page);
  await expect(page.getByText(/Pull request #7 mise à jour/)).toBeVisible();
  expect(gh.posts.pulls).toHaveLength(0);
});

test("une PR ouverte où quelqu'un a commité à la main n'est pas reprise : nouvelle PR", async ({ page, gh }) => {
  openPr(gh, { commits: [TOOL_COMMIT, "Fix the tests after the review"] });
  await login(page);
  await edit(page, "bye", "Tschau");
  await createPr(page);
  await expect(page.getByRole("link", { name: "Ouvrir la PR #1" })).toBeVisible();
  expect(gh.posts.refUpdates).toHaveLength(0);
  expect(gh.posts.commits[0].body.parents).toEqual(["base"]);
});

test("une PR ouverte dont un fichier est illisible n'empêche pas d'envoyer : nouvelle PR", async ({ page, gh }) => {
  openPr(gh);
  gh.files[`${APP}@pr7:${DE_PATH}`] = "{ cassé";
  await login(page);
  await edit(page, "bye", "Tschau");
  await createPr(page);
  await expect(page.getByText(/La PR #7 n'a pas pu être reprise .* une nouvelle PR est créée\./)).toBeVisible();
  await expect(page.getByRole("link", { name: "Ouvrir la PR #1" })).toBeVisible();
  expect(gh.posts.commits[0].body.parents).toEqual(["base"]);
  expect(gh.written(DE_PATH)).toBe(json({ ...DE, bye: "Tschau" }));
});

test("une PR ouverte qui contient d'autres fichiers n'est pas reprise : nouvelle PR", async ({ page, gh }) => {
  openPr(gh, { files: [DE_PATH, REVIEW, "src/app.test.ts"] });
  await login(page);
  await edit(page, "bye", "Tschau");
  await createPr(page);
  await expect(page.getByRole("link", { name: "Ouvrir la PR #1" })).toBeVisible();
  await expect(page.getByText(/Pull request créée dans basquiat-co\/basquiat-app\./)).toBeVisible();
  expect(gh.posts.refUpdates).toHaveLength(0);
  expect(gh.posts.commits[0].body.parents).toEqual(["base"]);
  expect(gh.posts.pulls[0].body.head).toBe(gh.posts.refs[0].body.ref.replace("refs/heads/", ""));
  expect(gh.written(DE_PATH)).toBe(json({ ...DE, bye: "Tschau" }));
});

test("PR fusionnée (et branche supprimée) pendant l'envoi : la relecture part dans une nouvelle PR", async ({ page, gh }) => {
  openPr(gh, { state: "closed", merged: true });
  gh.refGone = true;
  await login(page);
  await edit(page, "bye", "Tschau");
  await createPr(page);
  await expect(page.getByRole("link", { name: "Ouvrir la PR #1" })).toBeVisible();
  expect(gh.posts.refUpdates).toHaveLength(1);
  expect(gh.posts.refs).toHaveLength(1);
  expect(gh.posts.refs[0].body.sha).toBe(gh.posts.refUpdates[0].body.sha);
  expect(gh.posts.pullUpdates).toHaveLength(0);
});

test("PR fusionnée juste après la mise à jour de sa branche, sans le nouveau commit : nouvelle PR", async ({ page, gh }) => {
  openPr(gh);
  gh.mergeOnMove = true;
  await login(page);
  await edit(page, "bye", "Tschau");
  await createPr(page);
  await expect(page.getByRole("link", { name: "Ouvrir la PR #1" })).toBeVisible();
  expect(gh.posts.refs).toHaveLength(1);
  expect(gh.posts.refs[0].body.sha).toBe(gh.posts.refUpdates[0].body.sha);
});

test("PR fusionnée avec le nouveau commit pendant l'envoi : la relecture est passée", async ({ page, gh }) => {
  openPr(gh);
  gh.mergeOnMove = true;
  gh.noCommitsBetween = true;
  await login(page);
  await edit(page, "bye", "Tschau");
  await createPr(page);
  await expect(page.getByText(/La PR #7 a été fusionnée avec cette relecture\./)).toBeVisible();
  await expect(page.getByRole("link", { name: "Ouvrir la PR #7" })).toBeVisible();
  await expect(summary(page)).toContainText("Aucune modification en attente");
});

test("PR fermée sans fusion pendant l'envoi : erreur, rien n'est perdu", async ({ page, gh }) => {
  openPr(gh, { state: "closed" });
  gh.refGone = true;
  await login(page);
  await edit(page, "bye", "Tschau");
  await createPr(page);
  await expect(page.getByText(/La PR #7 a été fermée pendant l'envoi\..*Tes modifications sont conservées/)).toBeVisible();
  await expect(summary(page)).toContainText("1 correction");
  expect(gh.posts.refs).toHaveLength(0);
});

test("si la branche de la PR ouverte refuse la mise à jour, rien n'est perdu", async ({ page, gh }) => {
  openPr(gh);
  gh.refGone = true; // la PR reste ouverte : l'erreur est signalée
  await login(page);
  await edit(page, "bye", "Tschau");
  await createPr(page);
  await expect(page.getByText(/La pull request n'a pas pu être créée\..*Tes modifications sont conservées/)).toBeVisible();
  await expect(summary(page)).toContainText("1 correction");
  expect(gh.posts.pulls).toHaveLength(0);
});

test("une nouvelle PR ne demande aucune fusion automatique", async ({ page, gh }) => {
  await login(page);
  await edit(page, "bye", "Tschau");
  await createPr(page);
  const notice = page.getByText(/Pull request créée dans basquiat-co\/basquiat-app\./);
  await expect(notice).toBeVisible();
  await expect(notice).not.toContainText("automatique");
  expect(gh.calls.filter(c => c.includes("/graphql"))).toHaveLength(0);
});

const updateButton = (page: Page) => page.getByRole("button", { name: "Mettre à jour ma PR" });

test("sans modification en cours, « Mettre à jour ma PR » rejoue la PR ouverte sur main", async ({ page, gh }) => {
  openPr(gh);
  await login(page);
  await expect(page.getByRole("button", { name: "Préparer la pull request" })).toBeHidden();
  await updateButton(page).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("La PR #7 sera rejouée sur la dernière version de la branche principale");
  await dialog.getByRole("button", { name: "Mettre à jour la PR" }).click();

  await expect(page.getByText(/Pull request #7 mise à jour dans basquiat-co\/basquiat-app\./)).toBeVisible();
  expect(gh.posts.pulls).toHaveLength(0);
  expect(gh.posts.commits[0].body.parents).toEqual(["pr7", "base"]);
  expect(gh.written(DE_PATH)).toBe(json({ ...DE, hello: "Hallo, {name}", members: PR_MEMBERS }));
  expect(gh.posts.pullUpdates[0].body.body).toContain("Rejouée sur la dernière version de main, sans nouvelle relecture.");
});

test("« Mettre à jour ma PR » : un texte changé des deux côtés est tranché par Alex avant d'écrire", async ({ page, gh }) => {
  openPr(gh, { clash: true });
  await login(page);
  await updateButton(page).click();
  const dialog = page.getByRole("dialog");
  const submit = dialog.getByRole("button", { name: "Mettre à jour la PR" });
  await expect(clashNote(page)).toContainText(MAIN_MEMBERS);
  await expect(submit).toBeDisabled();
  await clashNote(page).getByRole("button", { name: "Prendre celle de la branche principale" }).click();
  await submit.click();

  await expect(page.getByText(/Pull request #7 mise à jour/)).toBeVisible();
  expect(gh.written(DE_PATH)).toBe(json({ ...DE, hello: "Hallo, {name}", members: MAIN_MEMBERS }));
  expect(JSON.parse(gh.written(REVIEW)!).sets.app.de.members).toBe(hash(FR.members) + " " + hash(MAIN_MEMBERS));
});

test("« Mettre à jour ma PR » sur une PR déjà à jour : rien à faire, rien n'est écrit", async ({ page, gh }) => {
  openPr(gh);
  gh.compares.pr7.mergeBase = "base";
  await login(page);
  await updateButton(page).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("La PR #7 est déjà à jour avec la branche principale.");
  await expect(dialog.getByRole("button", { name: "Mettre à jour la PR" })).toBeDisabled();
  expect(gh.writes()).toBe(0);
});

test("sans PR de relecture ouverte, pas de bouton « Mettre à jour ma PR »", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("button", { name: "Préparer la pull request" })).toBeDisabled();
  await expect(updateButton(page)).toBeHidden();
});

test("« Mettre à jour ma PR » quand la PR est fusionnée pendant la mise à jour : aucune nouvelle PR", async ({ page, gh }) => {
  openPr(gh);
  gh.mergeOnMove = true;
  await login(page);
  await updateButton(page).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mettre à jour la PR" }).click();
  await expect(page.getByText(/La PR #7 a été fusionnée pendant la mise à jour/)).toBeVisible();
  expect(gh.posts.refs).toHaveLength(0);
  expect(gh.posts.pulls).toHaveLength(0);
});

test("« Mettre à jour ma PR » quand la PR ne peut pas être relue : la fenêtre le dit, rien n'est possible", async ({ page, gh }) => {
  openPr(gh);
  await login(page);
  gh.mainStatus = 500;
  await updateButton(page).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Ta PR de relecture n'a pas pu être relue");
  await expect(dialog.getByRole("alert")).not.toContainText("L'envoi la vérifiera");
  await expect(dialog.getByRole("button", { name: "Mettre à jour la PR" })).toBeDisabled();
});
