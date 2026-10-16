import { Check, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brand } from "@/components/Brand";
import { MAX_LANGS, SETS, langName, setById } from "@/lib/config";
import { activeLangs } from "@/lib/rows";
import type { Theme } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { logout, selectSet, setTheme, toggleLang, useApp } from "@/store";

function SetPicker() {
  const setId = useApp(s => s.setId);
  const set = setById(setId);
  return (
    <Select value={setId} onValueChange={selectSet}>
      <SelectTrigger aria-label="Fichiers" className="h-9 w-full min-w-0 bg-card sm:w-72">
        <SelectValue>{set.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {SETS.map(s => (
          <SelectItem key={s.id} value={s.id}>
            <span className="truncate">{s.label}</span>
            <span className="ml-auto pl-3 font-mono text-[11px] text-muted-foreground">{s.repo.split("/")[1]}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LangPicker() {
  const setId = useApp(s => s.setId);
  const prefs = useApp(s => s.langPrefs);
  const set = setById(setId);
  const langs = activeLangs(set, prefs);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label={`Langues (${MAX_LANGS} max)`}>
      {set.langs.map(l => {
        const on = langs.includes(l);
        const full = !on && langs.length >= MAX_LANGS;
        return (
          <button
            key={l}
            type="button"
            aria-pressed={on}
            disabled={full}
            title={full ? `${MAX_LANGS} langues au plus : retire une langue pour en ajouter une autre.` : on && langs.length === 1 ? "Il faut garder au moins une langue." : undefined}
            onClick={() => toggleLang(l)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border bg-card px-3 text-[13px] font-medium transition-colors outline-none",
              "hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-45",
              on && "border-foreground bg-foreground text-background hover:bg-foreground/90",
            )}
          >
            {on ? <Check className="size-3.5" aria-hidden="true" /> : null}
            {langName(l)}
            {l === set.source ? <span className={cn("text-[11px] font-normal", on ? "text-background/70" : "text-muted-foreground")}>source</span> : null}
          </button>
        );
      })}
    </div>
  );
}

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Clair", icon: Sun },
  { value: "dark", label: "Sombre", icon: Moon },
  { value: "system", label: "Comme le système", icon: Monitor },
];

function UserMenu() {
  const user = useApp(s => s.user)!;
  const theme = useApp(s => s.theme);
  const initials = (user.name || user.login).split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5 sm:px-2" aria-label={`Compte ${user.login}`}>
          <Avatar className="size-7">
            {user.avatar_url ? <AvatarImage src={user.avatar_url} alt="" /> : null}
            <AvatarFallback className="bg-accent text-[11px] font-semibold text-accent-foreground">{initials}</AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium sm:inline">{user.login}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span>{user.name || user.login}</span>
          <span className="text-xs font-normal text-muted-foreground">@{user.login}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Apparence</DropdownMenuLabel>
        {THEMES.map(t => (
          <DropdownMenuItem key={t.value} onSelect={() => setTheme(t.value)}>
            <t.icon />{t.label}{theme === t.value ? <Check className="ml-auto" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout()}><LogOut />Se déconnecter</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 md:px-6">
        <Brand />
        <div className="order-3 flex w-full min-w-0 flex-wrap items-center gap-3 md:order-none md:w-auto md:flex-1">
          <SetPicker />
          <LangPicker />
        </div>
        <div className="ml-auto"><UserMenu /></div>
      </div>
    </header>
  );
}
