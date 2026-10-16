import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, CheckCircle2, ChevronRight, Info, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { deleteOrphans, dismissNotice, openPr, useApp } from "@/store";

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon-sm" className="-my-1 -mr-2 shrink-0 text-muted-foreground" aria-label="Fermer le message" onClick={onClick}>
      <X />
    </Button>
  );
}

// Messages de l'application : pull request créée, erreur GitHub…
export function Notices() {
  const notices = useApp(s => s.notices);
  if (!notices.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {notices.map(n => (
        <Alert key={n.id} role={n.kind === "error" ? "alert" : "status"}
          className={cn("shadow-xs", n.kind === "error" ? "border-destructive/30 bg-destructive/5" : "border-success/30 bg-success/5")}>
          {n.kind === "error" ? <AlertTriangle className="text-destructive" /> : <CheckCircle2 className="text-success" />}
          <AlertDescription className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 text-foreground">
            <p>
              {n.text}
              {n.link ? <> <a href={n.link.href} target="_blank" rel="noopener" className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-4 hover:underline">{n.link.text}<ArrowUpRight className="size-3.5" /></a></> : null}
            </p>
            <CloseButton onClick={() => dismissNotice(n.id)} />
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

// Pas encore d'état de relecture pour ce jeu de fichiers : proposer de partir de l'existant.
export function InitNotice() {
  return (
    <Alert className="border-primary/25 bg-accent/60 shadow-xs">
      <Info className="text-primary" />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3 text-foreground">
        <p className="max-w-[75ch]">Ces fichiers n'ont pas encore d'état de relecture. Si tout l'existant a déjà été relu (par exemple dans Lokalise), marque-le comme relu : seules les nouvelles clés apparaîtront ensuite.</p>
        <Button size="sm" onClick={() => openPr("init")}>Marquer l'existant comme relu</Button>
      </AlertDescription>
    </Alert>
  );
}

// Modifications d'un jeu de fichiers ou d'une langue retirés de la configuration : jamais envoyées,
// gardées sur cet ordinateur pour que le texte des corrections puisse être recopié.
export function OrphanNotice() {
  const orphans = useApp(s => s.orphans);
  const [hidden, setHidden] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const list = Object.values(orphans);
  if (!list.length || hidden) return null;

  const n = list.length, pl = n > 1;
  const where = [...new Set(list.map(d => `${d.set} (${d.lang})`))].join(", ");
  const edited = list.filter(d => d.edited);
  const onDelete = () => {
    if (!confirm) { setConfirm(true); timer.current = window.setTimeout(() => setConfirm(false), 4000); return; }
    clearTimeout(timer.current);
    deleteOrphans();
  };

  return (
    <Alert role="status" className="border-[color:var(--st-source)]/40 bg-[color:var(--st-source)]/5 shadow-xs">
      <AlertTriangle className="text-[color:var(--st-source)]" />
      <AlertDescription className="flex flex-col gap-3 text-foreground">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-[75ch]">
            {`${n} modification${pl ? "s" : ""} enregistrée${pl ? "s" : ""} sur cet ordinateur concerne${pl ? "nt" : ""} des fichiers que l'outil ne propose plus : ${where}. ${pl ? "Elles ne seront pas envoyées" : "Elle ne sera pas envoyée"} sur GitHub.` +
              (edited.length ? " Recopie les corrections à garder avant de les supprimer." : "")}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant={confirm ? "destructive" : "outline"} onClick={onDelete}>{confirm ? "Confirmer la suppression" : "Supprimer ces modifications"}</Button>
            <CloseButton onClick={() => setHidden(true)} />
          </div>
        </div>
        {edited.length ? (
          <Collapsible>
            <CollapsibleTrigger className="group inline-flex items-center gap-1 text-sm font-medium text-foreground/80 hover:text-foreground">
              <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
              {edited.length > 1 ? `Voir les ${edited.length} corrections` : "Voir la correction"}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 overflow-auto rounded-lg border bg-card">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr><th className="px-3 py-2 font-medium">Fichiers</th><th className="px-3 py-2 font-medium">Langue</th><th className="px-3 py-2 font-medium">Clé</th><th className="px-3 py-2 font-medium">Correction</th></tr>
                  </thead>
                  <tbody className="divide-y border-t align-top">
                    {edited.map(d => (
                      <tr key={`${d.set}|${d.lang}|${d.id}`}>
                        <td className="px-3 py-2">{String(d.set)}</td>
                        <td className="px-3 py-2 font-mono text-xs uppercase">{String(d.lang)}</td>
                        <td className="px-3 py-2 font-mono text-xs break-all">{String(d.id)}</td>
                        <td className="px-3 py-2 break-words">{String(d.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
