import { useEffect, useState } from "react";
import { CheckCheck, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { refresh, setSearch, useApp } from "@/store";

export function Toolbar({ countLine, canValidate, onValidate }: { countLine: string; canValidate: boolean; onValidate: () => void }) {
  const search = useApp(s => s.search);
  const loading = useApp(s => s.loading);
  const [q, setQ] = useState(search);
  // Remis à zéro quand on change de fichiers (sans retirer l'espace qu'on est en train de taper).
  useEffect(() => setQ(prev => (prev.trim() === search ? prev : search)), [search]);
  useEffect(() => {
    if (q.trim() === search) return;
    const t = setTimeout(() => setSearch(q.trim()), 150);
    return () => clearTimeout(t);
  }, [q, search]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher une clé ou un texte" aria-label="Chercher" className="h-9 bg-card pl-9" />
        </div>
        <span className="min-w-0 truncate text-sm text-muted-foreground">{countLine}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="bg-card" disabled={!canValidate} onClick={onValidate}><CheckCheck />Valider les lignes affichées</Button>
        <Button variant="outline" size="sm" className="bg-card" disabled={loading} onClick={() => refresh(true)}>
          <RefreshCw className={cn(loading && "animate-spin")} />Recharger depuis GitHub
        </Button>
      </div>
    </div>
  );
}
