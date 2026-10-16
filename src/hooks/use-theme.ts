import { useEffect } from "react";
import { useApp } from "@/store";

// Clair, sombre ou selon le système : pose la classe .dark sur <html> (le script de index.html le fait
// déjà avant le premier rendu, pour éviter un flash).
export function useApplyTheme() {
  const theme = useApp(s => s.theme);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && mq.matches));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}
