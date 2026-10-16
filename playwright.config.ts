import { defineConfig, devices } from "@playwright/test";

// Les tests tournent sur l'application compilée (vite preview). E2E_BASE_URL permet de viser une autre
// adresse, par exemple une ancienne version servie à part pour comparer les comportements.
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: external || "http://localhost:4173/",
    locale: "fr-CH",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: external ? undefined : {
    command: "npm run build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
