import { useState } from "react";
import { GitPullRequestArrow, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ClashNote, DriftNote } from "@/components/DriftNote";
import { REVIEW_FILE, langName, setById } from "@/lib/config";
import { needsChoice } from "@/lib/core";
import { clashKey } from "@/lib/github";
import { driftedDrafts } from "@/lib/rows";
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
  const data = useApp(s => s.data);
  const list = Object.values(drafts);
  // Seuls les conflits restent : le reste a été réglé à la relecture de main (validation, retrait).
  const conflicts = pr.mode === "drafts" ? driftedDrafts(drafts, data).filter(x => needsChoice(x.drift)) : [];
  // Conflits avec la PR ouverte ; une correction tapée sur la clé les tranche déjà (la plus récente l'emporte).
  const clashes = pr.mode === "drafts" ? pr.clashes.filter(c => !drafts[clashKey(c)]?.edited) : [];
  const undecided = clashes.filter(c => pr.choices[clashKey(c)]?.main !== c.main || !pr.choices[clashKey(c)]);
  const blocked = pr.submitting || pr.checking || conflicts.length > 0 || undecided.length > 0 || (pr.mode === "drafts" && !list.length);
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
          {" "}Si une pull request de relecture ouverte ne contient que des traductions, tes modifications y sont ajoutées, sur la dernière version du dépôt.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor="pr-title">Titre</Label>
        <Input id="pr-title" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
      </div>

      {pr.mode === "drafts" && pr.checking ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Comparaison avec la dernière version de la branche principale…</p>
      ) : null}
      {pr.refused || pr.checkError || pr.dropped ? (
        <div role="alert" className="flex flex-col gap-1 rounded-lg border border-[color:var(--st-source)] bg-[color:color-mix(in_oklab,var(--st-source)_8%,transparent)] px-3 py-2 text-sm">
          {pr.refused ? <p>Rien n'a été envoyé : la branche principale a changé pendant ta relecture.{conflicts.length || undecided.length ? " Revois les textes ci-dessous, puis crée la pull request." : ""}</p> : null}
          {pr.checkError ? <p>{pr.checkError}{pr.refused ? "" : " L'envoi la vérifiera de toute façon."}</p> : null}
          {pr.dropped ? <p>{pr.dropped}</p> : null}
        </div>
      ) : null}
      {conflicts.length ? (
        <section className="flex flex-col gap-2" aria-labelledby="pr-conflicts">
          <h3 id="pr-conflicts" className="text-sm font-medium">
            {conflicts.length} correction{conflicts.length > 1 ? "s" : ""} à revoir avant l'envoi
          </h3>
          <p className="text-sm text-muted-foreground">Les développeurs ont changé ces textes sur la branche principale pendant ta relecture. Choisis pour chacun.</p>
          <div className="flex max-h-72 flex-col gap-2 overflow-auto">
            {conflicts.map(x => (
              <div key={x.key} className="flex flex-col gap-1">
                <span className="font-mono text-xs break-all">{x.draft.id} <span className="uppercase">· {x.draft.lang}</span></span>
                <DriftNote draftKey={x.key} draft={x.draft} now={x.now} gone={x.drift === "gone"} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {clashes.length ? (
        <section className="flex flex-col gap-2" aria-labelledby="pr-clashes">
          <h3 id="pr-clashes" className="text-sm font-medium">
            {clashes.length} texte{clashes.length > 1 ? "s" : ""} de ta PR de relecture {clashes.length > 1 ? "changés" : "changé"} aussi sur la branche principale
          </h3>
          <p className="text-sm text-muted-foreground">Un développeur a modifié ces textes après ton envoi précédent. Choisis pour chacun ; rien n'est envoyé avant.</p>
          <div className="flex max-h-72 flex-col gap-2 overflow-auto">
            {clashes.map(c => (
              <div key={clashKey(c)} className="flex flex-col gap-1">
                <span className="font-mono text-xs break-all">{c.id} <span className="uppercase">· {c.lang}</span></span>
                <ClashNote clash={c} choice={pr.choices[clashKey(c)]} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

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
        <Button type="submit" disabled={blocked}>
          {pr.submitting ? <><Loader2 className="animate-spin" />Création en cours…</> : "Créer la pull request"}
        </Button>
      </DialogFooter>
    </form>
  );
}
