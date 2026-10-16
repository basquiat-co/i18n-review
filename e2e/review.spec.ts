import { hash } from "../src/lib/core";
import { test, expect, login, row, field, summary, filter, edit, createPr, APP, DE, DE_PATH, FR, REVIEW, json } from "./fixtures";

test("connexion, statuts et filtres", async ({ page }) => {
  await login(page);
  await expect(row(page, "bye")).toContainText("Source modifiée");
  await expect(row(page, "menu.close")).toContainText("Manquante");
  await expect(row(page, "menu.open")).toContainText("Nouvelle");
  await expect(row(page, "members")).toContainText("Modifiée hors relecture");
  await expect(row(page, "files")).toContainText("Nouvelle");
  await expect(row(page, "hello")).toHaveCount(0); // relue : hors du filtre « À relire »
  await expect(page.getByText(/5 clés/)).toBeVisible();

  await expect(filter(page, "À relire")).toContainText("6");
  await expect(filter(page, "Manquantes")).toContainText("1");
  await expect(filter(page, "Nouvelles")).toContainText("3");
  await expect(filter(page, "Relues")).toContainText("1");
  await filter(page, "Relues").click();
  await expect(filter(page, "Relues")).toHaveAttribute("aria-pressed", "true");
  await expect(row(page, "hello")).toContainText("Relue");
  await expect(row(page, "bye")).toHaveCount(0);
});

test("corriger une traduction puis créer la pull request", async ({ page, gh }) => {
  await login(page);
  await edit(page, "bye", "Auf Wiedersehen");
  await expect(summary(page)).toContainText("1 correction");
  await expect(row(page, "bye")).toContainText("Corrigée");

  await page.getByRole("button", { name: "Préparer la pull request" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("basquiat-co/basquiat-app");
  await expect(dialog).toContainText("Tschüss");
  await expect(dialog).toContainText("Auf Wiedersehen");
  await expect(dialog.getByLabel("Titre")).toHaveValue(/^i18n : relecture allemand du /);
  await dialog.getByLabel(/Note pour les développeurs/).fill("Merci !");
  await dialog.getByRole("button", { name: "Créer la pull request" }).click();

  await expect(page.getByRole("link", { name: "Ouvrir la PR #1" })).toBeVisible();
  await expect(summary(page)).toHaveText("Aucune modification en attente.");
  expect(gh.posts.trees.map(t => t.repo)).toEqual([APP]);
  expect(gh.posts.trees[0].body.tree.map(t => t.path)).toEqual([DE_PATH, REVIEW]);
  expect(gh.written(DE_PATH)).toBe(json({ ...DE, bye: "Auf Wiedersehen" }));
  const review = JSON.parse(gh.written(REVIEW)!);
  expect(review.sets.app.de.bye).toBe(hash(FR.bye) + " " + hash("Auf Wiedersehen"));
  expect(review.sets.app.de.hello).toBe(hash(FR.hello) + " " + hash(DE.hello)); // les autres entrées restent
  const pr = gh.posts.pulls[0].body;
  expect(pr.base).toBe("main");
  expect(pr.head).toMatch(/^i18n-review\//);
  expect(pr.body).toContain("Merci !");
  expect(pr.body).toContain("| `bye` | de | Tschüss | Auf Wiedersehen |");
  expect(gh.posts.commits[0].body.message).toContain("par Camille Relectrice");
});

test("une clé manquante est ajoutée à sa place dans le fichier", async ({ page, gh }) => {
  await login(page);
  await edit(page, "menu.close", "Schließen");
  await createPr(page);
  await expect(page.getByRole("link", { name: "Ouvrir la PR #1" })).toBeVisible();
  expect(gh.written(DE_PATH)).toBe(json({ ...DE, menu: { open: "Öffnen", close: "Schließen" } }));
});

test("valider sans changement n'écrit que l'état de relecture", async ({ page, gh }) => {
  await login(page);
  await row(page, "members").getByRole("button", { name: "Valider", exact: true }).click();
  await expect(summary(page)).toContainText("0 correction · 1 validation sans changement");
  await expect(row(page, "members")).toContainText("Validée");
  await createPr(page);
  await expect(page.getByRole("link", { name: "Ouvrir la PR #1" })).toBeVisible();
  expect(gh.posts.trees[0].body.tree.map(t => t.path)).toEqual([REVIEW]);
  expect(JSON.parse(gh.written(REVIEW)!).sets.app.de.members).toBe(hash(FR.members) + " " + hash(DE.members));
});

test("Ctrl+Entrée valide et passe au champ suivant", async ({ page }) => {
  await login(page);
  await field(page, "menu.open").focus();
  await page.keyboard.press("Control+Enter");
  await expect(row(page, "menu.open")).toContainText("Validée");
  await expect(field(page, "menu.close")).toBeFocused();
});

test("une variable absente de la traduction est signalée", async ({ page }) => {
  await login(page);
  await filter(page, "Toutes").click();
  await edit(page, "hello", "Hallo");
  await expect(row(page, "hello")).toContainText("Variable absente : {name}");
});

test("pluriel en sous-clés : une carte, une ligne par forme", async ({ page, gh }) => {
  await login(page);
  await expect(field(page, "files", "allemand", "forme un")).toHaveValue("{{count}} Datei");
  await expect(field(page, "files", "allemand", "forme plusieurs")).toHaveValue("{{count}} Dateien");
  await row(page, "files").getByRole("button", { name: "Valider le pluriel" }).click();
  await expect(summary(page)).toContainText("0 correction · 2 validations sans changement");
  await createPr(page);
  await expect(page.getByRole("link", { name: "Ouvrir la PR #1" })).toBeVisible();
  const de = JSON.parse(gh.written(REVIEW)!).sets.app.de;
  expect(de["files.one"]).toBe(hash(FR.files.one) + " " + hash(DE.files.one));
  expect(de["files.other"]).toBe(hash(FR.files.other) + " " + hash(DE.files.other));
});

test("pluriel ICU : édition forme par forme ou en texte brut", async ({ page, gh }) => {
  await login(page);
  await expect(field(page, "members", "allemand", "un")).toHaveValue("# Mitglied");
  await edit(page, "members", "# Leute", "plusieurs");
  await expect(summary(page)).toContainText("1 correction");

  await row(page, "members").getByRole("button", { name: "Texte brut" }).click();
  await expect(field(page, "members")).toHaveValue("{count, plural, one {# Mitglied} other {# Leute}}");
  await row(page, "members").getByRole("button", { name: "Par formes" }).click();
  await expect(field(page, "members", "allemand", "plusieurs")).toHaveValue("# Leute");

  await createPr(page);
  await expect(page.getByRole("link", { name: "Ouvrir la PR #1" })).toBeVisible();
  expect(JSON.parse(gh.written(DE_PATH)!).members).toBe("{count, plural, one {# Mitglied} other {# Leute}}");
});

test("annuler une modification, puis tout annuler avec confirmation", async ({ page }) => {
  await login(page);
  await edit(page, "bye", "Ciao");
  await row(page, "bye").getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(summary(page)).toHaveText("Aucune modification en attente.");
  await expect(field(page, "bye")).toHaveValue("Tschüss");

  await edit(page, "bye", "Ciao");
  await edit(page, "menu.close", "Zu");
  await expect(summary(page)).toContainText("2 corrections");
  await page.getByRole("button", { name: "Tout annuler" }).click();
  await expect(summary(page)).toContainText("2 corrections"); // premier clic : demande confirmation
  await page.getByRole("button", { name: "Confirmer l'annulation" }).click();
  await expect(summary(page)).toHaveText("Aucune modification en attente.");
});

test("valider les lignes affichées", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Valider les lignes affichées" }).click();
  // bye, menu.open, files.one, files.other, members (menu.close est vide : rien à valider)
  await expect(summary(page)).toContainText("0 correction · 5 validations sans changement");
});

test("recherche dans les clés et les textes", async ({ page }) => {
  await login(page);
  await page.getByRole("searchbox", { name: "Chercher" }).fill("Fermer");
  await expect(row(page, "menu.close")).toBeVisible();
  await expect(page.locator("[data-id]")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Chercher" }).fill("Mitglied");
  await expect(row(page, "members")).toBeVisible();
  await expect(page.locator("[data-id]")).toHaveCount(1);
});

test("ajouter la langue source à l'écran", async ({ page }) => {
  await login(page);
  const fr = page.getByRole("button", { name: /^français/ });
  await expect(fr).toHaveAttribute("aria-pressed", "false");
  await fr.click();
  await expect(fr).toHaveAttribute("aria-pressed", "true");
  await filter(page, "Toutes").click();
  await expect(field(page, "bye", "français")).toHaveValue("Au revoir");
  await expect(field(page, "bye")).toHaveValue("Tschüss");
  // une langue doit toujours rester affichée
  await page.getByRole("button", { name: /^allemand/ }).click();
  await page.getByRole("button", { name: /^français/ }).click();
  await expect(field(page, "bye", "français")).toBeVisible();
});

test("les modifications survivent au rechargement de la page", async ({ page }) => {
  await login(page);
  await edit(page, "bye", "Servus");
  await page.reload();
  await expect(summary(page)).toContainText("1 correction");
  await expect(field(page, "bye")).toHaveValue("Servus");
});

test("sans état de relecture : marquer l'existant comme relu", async ({ page, gh }) => {
  delete gh.files[`${APP}:${REVIEW}`];
  await login(page);
  await expect(page.getByText(/n'ont pas encore d'état de relecture/)).toBeVisible();
  await page.getByRole("button", { name: "Marquer l'existant comme relu" }).click();
  await expect(page.getByRole("dialog")).toContainText("marquera comme relues toutes les clés actuelles");
  await page.getByRole("dialog").getByRole("button", { name: "Créer la pull request" }).click();
  await expect(page.getByRole("link", { name: "Ouvrir la PR #1" })).toBeVisible();
  expect(gh.posts.trees[0].body.tree.map(t => t.path)).toEqual([REVIEW]);
  const de = JSON.parse(gh.written(REVIEW)!).sets.app.de;
  expect(Object.keys(de).sort()).toEqual(["bye", "files.one", "files.other", "hello", "members", "menu.open"]);
});

test("une clé validée dans une PR ouverte est « en attente »", async ({ page, gh }) => {
  gh.pulls[APP] = [{ number: 7, ref: "i18n-review/202610161200-abcd", sha: "pr7" }];
  gh.files[`${APP}@pr7:${REVIEW}`] = gh.files[`${APP}:${REVIEW}`].replace(hash("Au revoir !"), hash(FR.bye));
  await login(page);
  await filter(page, "En attente").click();
  await expect(row(page, "bye")).toContainText("En attente");
  await expect(row(page, "bye").getByRole("link", { name: "PR #7" })).toHaveAttribute("href", `https://github.com/${APP}/pull/7`);
});

test("un jeton refusé est signalé", async ({ page, gh }) => {
  gh.userStatus = 401;
  await page.goto("./");
  await page.getByLabel("Jeton GitHub").fill("github_pat_expiré");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("Ce jeton est refusé par GitHub")).toBeVisible();
});

test("se déconnecter oublie le jeton", async ({ page }) => {
  await login(page);
  const direct = page.getByRole("button", { name: "Se déconnecter" });
  if (!(await direct.isVisible())) await page.getByRole("button", { name: /Compte/ }).click();
  await page.getByRole("button", { name: "Se déconnecter" }).or(page.getByRole("menuitem", { name: "Se déconnecter" })).click();
  await expect(page.getByLabel("Jeton GitHub")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Jeton GitHub")).toBeVisible();
});
