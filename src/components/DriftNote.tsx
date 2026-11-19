import { GitMerge } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Draft, MainNow } from "@/lib/core";
import type { ClashChoice, PrClash } from "@/lib/github";
import { chooseClash, keepMine, takeMain } from "@/store";

const Text = ({ text }: { text: string | undefined }) =>
  text ? <span className="break-words whitespace-pre-wrap">{text}</span> : <em className="text-muted-foreground">(vide)</em>;

// Une correction dont main a changé la source ou le texte depuis : ce qui a changé, et le choix d'Alex.
export function DriftNote({ draftKey, draft, now, compact, gone }: { draftKey: string; draft: Draft; now: MainNow; compact?: boolean; gone?: boolean }) {
  if (gone) {
    return (
      <div role="group" aria-label={`Changé sur main : ${draft.id} (${draft.lang})`}
        className="flex flex-col gap-1.5 rounded-lg border border-[color:var(--st-source)] bg-[color:color-mix(in_oklab,var(--st-source)_8%,transparent)] px-3 py-2 text-xs">
        <p className="flex items-center gap-1.5 font-medium"><GitMerge className="size-3.5 shrink-0" aria-hidden="true" />Clé supprimée de la branche principale pendant ta relecture</p>
        <p>Ta correction : <Text text={draft.value} /></p>
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <Button type="button" size="sm" variant="outline" className="h-7 bg-card" onClick={() => takeMain(draftKey)}>Retirer</Button>
        </div>
      </div>
    );
  }
  const sourceMoved = !now.isSource && now.source !== draft.source;
  const valueMoved = draft.exists ? now.value !== draft.original : now.value !== undefined;
  return (
    <div role="group" aria-label={`Changé sur main : ${draft.id} (${draft.lang})`}
      className="flex flex-col gap-1.5 rounded-lg border border-[color:var(--st-source)] bg-[color:color-mix(in_oklab,var(--st-source)_8%,transparent)] px-3 py-2 text-xs">
      <p className="flex items-center gap-1.5 font-medium"><GitMerge className="size-3.5 shrink-0" aria-hidden="true" />Changé sur la branche principale pendant ta relecture</p>
      {sourceMoved ? <p>Source : <del className="text-muted-foreground"><Text text={draft.source} /></del> → <Text text={now.source} /></p> : null}
      {valueMoved ? <p>Texte actuel : <del className="text-muted-foreground"><Text text={draft.original} /></del> → <Text text={now.value} /></p> : null}
      {compact ? null : <p>Ta correction : <Text text={draft.value} /></p>}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        <Button type="button" size="sm" variant="outline" className="h-7 bg-card" onClick={() => keepMine(draftKey)}>Garder ma correction</Button>
        <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => takeMain(draftKey)}>Prendre le texte actuel</Button>
      </div>
    </div>
  );
}

// Un texte que la PR de relecture ouverte avait écrit et que main a changé depuis : Alex garde le sien ou prend celui
// de main. Le bouton du choix fait reste enfoncé.
export function ClashNote({ clash, choice }: { clash: PrClash; choice: ClashChoice | undefined }) {
  const keep = choice && choice.main === clash.main ? choice.keep : null;
  return (
    <div role="group" aria-label={`Conflit avec la PR #${clash.pr} : ${clash.id} (${clash.lang})`}
      className="flex flex-col gap-1.5 rounded-lg border border-[color:var(--st-source)] bg-[color:color-mix(in_oklab,var(--st-source)_8%,transparent)] px-3 py-2 text-xs">
      <p className="flex items-center gap-1.5 font-medium"><GitMerge className="size-3.5 shrink-0" aria-hidden="true" />Changé sur la branche principale depuis ta PR #{clash.pr}</p>
      {clash.prSource !== clash.source ? <p>Source : <del className="text-muted-foreground"><Text text={clash.prSource} /></del> → <Text text={clash.source} /></p> : null}
      <p>Dans ta PR : <Text text={clash.mine} /></p>
      <p>Sur la branche principale : <Text text={clash.main} /></p>
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        <Button type="button" size="sm" variant={keep === "mine" ? "default" : "outline"} className="h-7" aria-pressed={keep === "mine"} onClick={() => chooseClash(clash, "mine")}>Garder ma version</Button>
        <Button type="button" size="sm" variant={keep === "main" ? "default" : "outline"} className="h-7" aria-pressed={keep === "main"} onClick={() => chooseClash(clash, "main")}>Prendre celle de la branche principale</Button>
      </div>
    </div>
  );
}
