import { useEffect, useRef, useState } from "react";
import { GitPullRequestArrow, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setById } from "@/lib/config";
import { discardAll, openPr, useApp } from "@/store";

// Barre d'envoi, collée en bas : ce qui partira dans la pull request.
export function SendBar() {
  const drafts = useApp(s => s.drafts);
  const list = Object.values(drafts);
  const edited = list.filter(d => d.edited).length, validated = list.length - edited;
  const repos = new Set(list.map(d => setById(d.set).repo));

  // « Tout annuler » demande une confirmation pendant 4 secondes.
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onDiscard = () => {
    if (!confirm) { setConfirm(true); timer.current = window.setTimeout(() => setConfirm(false), 4000); return; }
    clearTimeout(timer.current); setConfirm(false); discardAll();
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] md:px-6">
      <div className="pointer-events-auto mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border bg-card/95 px-4 py-3 shadow-[0_8px_30px_-8px_rgb(15_23_42/0.25)] backdrop-blur-md md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className={list.length ? "grid size-8 shrink-0 place-items-center rounded-full bg-draft text-sm font-semibold text-primary-foreground tabular-nums dark:text-background" : "hidden"}>{list.length}</span>
          <div className="flex min-w-0 flex-col">
            <span id="send-summary" className="text-sm" aria-live="polite">
              {list.length
                ? <><strong className="font-semibold tabular-nums">{edited}</strong>{` correction${edited > 1 ? "s" : ""} · `}<strong className="font-semibold tabular-nums">{validated}</strong>{` validation${validated > 1 ? "s" : ""} sans changement` + (repos.size > 1 ? ` · ${repos.size} dépôts` : "")}</>
                : <span className="text-muted-foreground">Aucune modification en attente.</span>}
            </span>
            <span className="hidden text-xs text-muted-foreground lg:block">
              <kbd className="rounded border bg-muted px-1 font-sans text-[11px]">Ctrl</kbd> + <kbd className="rounded border bg-muted px-1 font-sans text-[11px]">Entrée</kbd> dans un champ : valider et passer au suivant
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={confirm ? "destructive" : "ghost"} size="sm" disabled={!list.length} onClick={onDiscard}>
            <Trash2 />{confirm ? "Confirmer l'annulation" : "Tout annuler"}
          </Button>
          <Button size="sm" disabled={!list.length} onClick={() => openPr("drafts")}><GitPullRequestArrow />Préparer la pull request</Button>
        </div>
      </div>
    </div>
  );
}
