import { useState } from "react";
import { GitPullRequestArrow, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { REVIEW_FILE, langName, setById } from "@/lib/config";
import { closePr, submitPr, useApp } from "@/store";

export function PrDialog() {
  const pr = useApp(s => s.pr);
  return (
    <Dialog open={pr.open} onOpenChange={o => { if (!o) closePr(); }}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-2xl"
        onEscapeKeyDown={e => { if (pr.submitting) e.preventDefault(); }}
        onInteractOutside={e => e.preventDefault()}
      >
        {/* Le contenu est recréé à chaque ouverture : titre et note repartent des valeurs par défaut. */}
        {pr.open ? <PrForm key={String(pr.open) + pr.mode} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PrForm() {
  const pr = useApp(s => s.pr);
  const drafts = useApp(s => s.drafts);
  const list = Object.values(drafts);
  const set = setById(pr.setId);
  const byRepo = [...new Set(list.map(d => setById(d.set).repo))];
  const edited = list.filter(d => d.edited);
  const langs = [...new Set(list.map(d => langName(d.lang)))].join(", ");
  const [title, setTitle] = useState(() => pr.mode === "init"
    ? `i18n : état de relecture initial pour ${set.label}`
    : `i18n : relecture ${langs} du ${new Date().toLocaleDateString("fr-CH")}`);
  const [note, setNote] = useState("");

  return (
    <form className="contents" onSubmit={e => { e.preventDefault(); void submitPr(title.trim() || "i18n : relecture", note.trim()); }}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-lg"><GitPullRequestArrow className="size-5 text-primary" />Créer la pull request</DialogTitle>
        <DialogDescription>
          {pr.mode === "init"
            ? `La pull request ajoutera ${REVIEW_FILE} dans ${set.repo} et marquera comme relues toutes les clés actuelles de « ${set.label} » (${set.langs.map(langName).join(", ")}). Les clés sans traduction restent à faire.`
            : byRepo.length > 1
              ? `Une pull request sera créée dans chacun de ces dépôts : ${byRepo.join(", ")}.`
              : `La pull request sera créée dans ${byRepo[0]}.`}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor="pr-title">Titre</Label>
        <Input id="pr-title" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
      </div>

      {pr.mode === "drafts" ? (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pr-note">Note pour les développeurs (facultatif)</Label>
            <Textarea id="pr-note" rows={2} value={note} onChange={e => setNote(e.target.value)} className="min-h-16" />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">
              {edited.length} correction{edited.length > 1 ? "s" : ""}, {list.length - edited.length} validation{list.length - edited.length > 1 ? "s" : ""} sans changement
            </h3>
            {edited.length ? (
              <div className="max-h-72 overflow-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/95 text-left text-xs text-muted-foreground backdrop-blur">
                    <tr><th className="px-3 py-2 font-medium">Clé</th><th className="px-3 py-2 font-medium">Langue</th><th className="px-3 py-2 font-medium">Avant → après</th></tr>
                  </thead>
                  <tbody className="divide-y align-top">
                    {edited.map(d => (
                      <tr key={`${d.set}|${d.lang}|${d.id}`}>
                        <td className="px-3 py-2 font-mono text-xs break-all">{d.id}</td>
                        <td className="px-3 py-2 font-mono text-xs uppercase">{d.lang}</td>
                        <td className="px-3 py-2 break-words">
                          {d.original ? <del className="text-muted-foreground">{d.original}</del> : <em className="text-muted-foreground">(vide)</em>}
                          <br />
                          <ins className="font-medium text-success no-underline">{d.value}</ins>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" disabled={pr.submitting} onClick={closePr}>Fermer</Button>
        <Button type="submit" disabled={pr.submitting}>
          {pr.submitting ? <><Loader2 className="animate-spin" />Création en cours…</> : "Créer la pull request"}
        </Button>
      </DialogFooter>
    </form>
  );
}
