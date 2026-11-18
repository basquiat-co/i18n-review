import { Lightbulb, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { langName } from "@/lib/config";
import type { KeySuggestion } from "@/lib/rows";
import { setAside, takeSuggestion, unsettle } from "@/store";

// Suggestion d'un développeur sous la clé qu'elle vise : son contexte, les textes proposés, et la décision d'Alex.
// Elle n'écrit rien : reprendre crée des corrections (qu'Alex peut retoucher), et la PR retire la suggestion.
export function SuggestionCard({ s }: { s: KeySuggestion }) {
  const { item, settled, applicable } = s;
  const proposed = Object.entries(item.proposed);
  return (
    <div role="group" aria-label={`Suggestion pour ${item.key}`}
      className="col-span-full flex flex-col gap-1.5 rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-sm">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <Lightbulb className="size-3.5 shrink-0" aria-hidden="true" />
        <span>Suggestion de <strong className="font-medium text-foreground">{item.author || "un développeur"}</strong></span>
        {item.pr ? <a href={item.pr.url} target="_blank" rel="noopener" className="font-medium text-primary underline-offset-4 hover:underline">PR #{item.pr.number}</a> : null}
      </p>
      {item.context ? <p className="break-words whitespace-pre-wrap">{item.context}</p> : null}
      {proposed.length ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
          {proposed.map(([lang, text]) => (
            <div key={lang} className="contents">
              <dt className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase" title={langName(lang)}>{lang}</dt>
              <dd className="break-words whitespace-pre-wrap">{text}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {item.pending ? (
          <span className="text-xs font-medium text-draft">
            Réglée dans la <a href={item.pending.url} target="_blank" rel="noopener" className="text-primary underline-offset-4 hover:underline">PR #{item.pending.number}</a>, retirée à sa fusion
          </span>
        ) : settled ? (
          <>
            <span className="text-xs font-medium text-draft">{settled === "taken" ? "Reprise dans ta relecture" : "Mise de côté"} · retirée à l'envoi</span>
            <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => unsettle(item)}><Undo2 />Revenir dessus</Button>
          </>
        ) : (
          <>
            {applicable ? <Button type="button" size="sm" variant="outline" className="h-7 bg-card" onClick={() => takeSuggestion(item)}>Reprendre dans ma relecture</Button> : null}
            <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setAside(item)}>{proposed.length ? "Mettre de côté" : "C'est noté"}</Button>
          </>
        )}
      </div>
    </div>
  );
}
