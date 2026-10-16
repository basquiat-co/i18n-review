import { test as base, expect, type Page } from "@playwright/test";
import { hash, type JsonObject } from "../src/lib/core";
import { FakeGitHub } from "./fake-github";

export { expect };

export const APP = "basquiat-co/basquiat-app";
export const FR_PATH = "app/i18n/fr/app.json";
export const DE_PATH = "app/i18n/de/app.json";
export const REVIEW = ".i18n-review.json";

// Jeu de fichiers « Application mobile (app.json) », source fr, cible de.
export const FR = {
  hello: "Bonjour {name}",
  bye: "Au revoir",
  menu: { open: "Ouvrir", close: "Fermer" },
  files: { one: "{{count}} fichier", other: "{{count}} fichiers" },
  members: "{count, plural, one {# membre} other {# membres}}",
};
export const DE = {
  hello: "Hallo {name}",
  bye: "Tschüss",
  menu: { open: "Öffnen" },
  files: { one: "{{count}} Datei", other: "{{count}} Dateien" },
  members: "{count, plural, one {# Mitglied} other {# Mitglieder}}",
};
export const json = (o: JsonObject) => JSON.stringify(o, null, 2) + "\n";

// Statuts de départ en allemand : hello relue, bye source modifiée, members modifiée hors relecture,
// menu.open et files.* nouvelles, menu.close manquante. Tout le français est relu.
export function reviewFile(extraDe: Record<string, string> = {}) {
  const fr = Object.fromEntries(["hello", "bye", "menu.open", "menu.close", "files.one", "files.other", "members"]
    .map(id => [id, hash(id.split(".").reduce((o: any, k) => o[k], FR))]));
  return json({
    version: 1,
    sets: {
      app: {
        fr,
        de: {
          hello: hash(FR.hello) + " " + hash(DE.hello),
          bye: hash("Au revoir !") + " " + hash(DE.bye),
          members: hash(FR.members) + " " + hash("{count, plural, one {# Mitglied} other {# Leute}}"),
          ...extraDe,
        },
      },
    },
  });
}

export function defaultFiles(): Record<string, string> {
  return {
    [`${APP}:${FR_PATH}`]: json(FR),
    [`${APP}:${DE_PATH}`]: json(DE),
    [`${APP}:${REVIEW}`]: reviewFile(),
  };
}

export const test = base.extend<{ gh: FakeGitHub }>({
  // auto : la fausse API est branchée pour chaque test, même s'il ne lit pas `gh`.
  // Le test échoue aussi si la page lève une exception non rattrapée.
  gh: [async ({ context }, use) => {
    const gh = new FakeGitHub();
    gh.files = defaultFiles();
    await context.route("https://api.github.com/**", route => gh.handle(route));
    await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    const errors: string[] = [];
    context.on("weberror", e => errors.push(e.error().message));
    await use(gh);
    expect(errors, "exceptions JavaScript dans la page").toEqual([]);
  }, { auto: true }],
});

/* ---------- Raccourcis d'interface (sélecteurs accessibles) ---------- */

export async function login(page: Page, opts: { storage?: Record<string, string> } = {}) {
  await page.goto("./");
  if (opts.storage) {
    await page.evaluate(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, opts.storage);
    await page.reload();
  }
  await page.getByLabel("Jeton GitHub").fill("github_pat_test");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.locator("[data-id]").first()).toBeVisible();
}

export const row = (page: Page, id: string) => page.locator(`[data-id="${id}"]`);
export const field = (page: Page, id: string, lang = "allemand", part?: string) =>
  page.getByLabel(`Traduction ${lang} de ${id}${part ? ", " + part : ""}`, { exact: true });
export const summary = (page: Page) => page.locator("#send-summary");
export const filter = (page: Page, label: string) => page.getByRole("button", { name: new RegExp("^" + label + "\\b") });

/** Remplace le texte d'un champ puis le quitte (la modification est enregistrée en sortie de champ). */
export async function edit(page: Page, id: string, value: string, part?: string) {
  const f = field(page, id, "allemand", part);
  await f.fill(value);
  await f.blur();
}

export async function createPr(page: Page) {
  await page.getByRole("button", { name: "Préparer la pull request" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Créer la pull request" }).click();
}
