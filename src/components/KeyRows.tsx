import { useRef } from "react";
import { AlertTriangle, Check, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AutoTextarea, focusNext } from "@/components/AutoTextarea";
import { DraftBadge, PendingLink, StatusBadge } from "@/components/StatusBadge";
import * as C from "@/lib/core";
import { FORM_LABEL, langName, type FileSet } from "@/lib/config";
import { compositeOf, isSplittable } from "@/lib/composite";
import { canValidateRow, draftKey, formVars, worstStatus, type Cell, type Key } from "@/lib/rows";
import { cn } from "@/lib/utils";
import { editCell, toggleRaw, undo, useApp, validate } from "@/store";

export interface Layout { set: FileSet; langs: string[]; showSource: boolean; cols: number }

function VarWarning({ vars }: { vars: string[] }) {
  if (!vars.length) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium text-[color:var(--st-modified)] dark:text-[color:var(--st-source)]">
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
      Variable absente : {vars.map(v => "{" + v + "}").join(", ")}
    </div>
  );
}

function LangTag({ lang }: { lang: string }) {
  return <span className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{lang}</span>;
}

function FormName({ children, className, ...props }: React.ComponentProps<"span">) {
  return <span {...props} className={cn("font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase", className)}>{children}</span>;
}

export function KeyPath({ segs, id }: { segs: string[]; id: string }) {
  return (
    <div className="font-mono text-[13px] leading-snug break-all">
      {segs.length > 1 ? <><span className="text-muted-foreground">{segs.slice(0, -1).join(".")}.</span>{segs[segs.length - 1]}</> : id}
    </div>
  );
}

function KeyMeta({ cells, tag }: { cells: Cell[]; tag?: string | null }) {
  const drafts = cells.filter(c => c.draft).length;
  if (!tag && !drafts) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tag ? <span className="inline-flex h-5 items-center rounded-md border px-1.5 text-[11px] font-medium text-muted-foreground">{tag}</span> : null}
      {drafts ? <span className="text-xs text-draft">{drafts} modification{drafts > 1 ? "s" : ""} en attente</span> : null}
    </div>
  );
}

/* ---------- Cellule d'une langue pour une clé simple ---------- */
function LangCell({ cell, set }: { cell: Cell; set: FileSet }) {
  const rk = draftKey(set.id, cell.lang, cell.id);
  const raw = useApp(s => !!s.rawRows[rk]);
  const current = cell.draft ? cell.draft.value : cell.value;
  const comp = raw ? null : compositeOf(cell, current);
  const splittable = isSplittable(cell.source);
  const baseId = `t-${set.id}-${cell.lang}-${cell.id}`;
  const label = `Traduction ${langName(cell.lang)} de ${cell.id}`;
  const refs = useRef<(HTMLTextAreaElement | null)[]>([]);

  const read = () => {
    if (!comp) return refs.current[0]?.value ?? current;
    const vals = comp.fields.map((f, n) => refs.current[n]?.value ?? f.value);
    if (vals.every((v, n) => v === comp.fields[n].value)) return current; // rien touché : texte d'origine intact
    return comp.build(vals);
  };
  const commit = (explicit: boolean) => {
    const v = read();
    if (explicit || v !== current) editCell(cell, v, explicit);
  };
  const submit = (t: HTMLTextAreaElement) => { commit(true); focusNext(t); };

  const fields = comp
    ? comp.fields.map((f, n) => (
      <label key={n + "\u0000" + f.value} className="flex flex-col gap-1">
        <FormName>{f.label}</FormName>
        <AutoTextarea id={`${baseId}-${n}`} ref={t => { refs.current[n] = t; }} defaultValue={f.value} aria-label={`${label}, ${f.label}`}
          onBlur={() => commit(false)} onSubmit={submit} />
      </label>
    ))
    : [<AutoTextarea key={current} id={baseId} ref={t => { refs.current[0] = t; }} defaultValue={current} aria-label={label}
      onBlur={() => commit(false)} onSubmit={submit} />];

  const canValidate = canValidateRow(cell) && (current !== "" || cell.source === "");
  const showToggle = splittable && (comp || C.parseIcu(current) || C.parseJsonPlural(current) || current === "");
  return (
    <div className={cn("flex min-w-0 flex-col gap-2")}>
      <div className="flex flex-wrap items-center gap-2">
        <LangTag lang={cell.lang} />
        <StatusBadge status={cell.status} />
        {cell.draft ? <DraftBadge edited={cell.draft.edited} /> : null}
        {cell.pending ? <PendingLink pending={cell.pending} /> : null}
      </div>
      <div className={cn("flex flex-col gap-2", cell.draft && "[&_textarea]:border-draft/60")}>{fields}</div>
      {cell.lang === set.source ? null : <VarWarning vars={C.missingPlaceholders(cell.source, current)} />}
      <div className="flex flex-wrap items-center gap-1.5">
        {canValidate ? <Button size="sm" variant="outline" className="h-7" onMouseDown={e => e.preventDefault()} onClick={() => commit(true)}><Check />Valider</Button> : null}
        {cell.draft ? <Button size="sm" variant="ghost" className="h-7" onClick={() => undo([cell])}><Undo2 />Annuler</Button> : null}
        {showToggle ? (
          <Button size="sm" variant="link" className="h-7 px-1 text-muted-foreground" onClick={() => toggleRaw(rk)}>{comp ? "Texte brut" : "Par formes"}</Button>
        ) : null}
      </div>
    </div>
  );
}

function SourceText({ text }: { text: string }) {
  return <div dir="auto" className={cn("text-sm leading-relaxed break-words whitespace-pre-wrap", !text && "text-muted-foreground italic")}>{text || "(vide)"}</div>;
}

function SourceCell({ k, set }: { k: Key; set: FileSet }) {
  const comp = compositeOf({ source: k.source, value: k.source }, k.source);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2 min-[860px]:hidden"><LangTag lang={set.source} /><span className="text-xs text-muted-foreground">source</span></div>
      {comp ? (
        <div className="flex flex-col gap-2">
          {comp.src.map((f, n) => <div key={n} className="flex flex-col gap-0.5"><FormName>{f.label}</FormName><SourceText text={f.value} /></div>)}
          {comp.src.some(f => f.value.includes("#")) ? <p className="text-xs text-muted-foreground"># est remplacé par le nombre ; garde les {"{variables}"} telles quelles.</p> : null}
        </div>
      ) : <SourceText text={k.source} />}
    </div>
  );
}

function rowClass(draft: boolean) {
  return cn("key-grid relative px-4 py-4 transition-colors md:px-5",
    draft && "bg-draft-bg before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-draft");
}

export function KeyRow({ k, layout }: { k: Key; layout: Layout }) {
  return (
    <div className={rowClass(k.cells.some(c => c.draft))} data-id={k.id}>
      <div className="flex min-w-0 flex-col gap-2">
        <KeyPath segs={k.segs} id={k.id} />
        <KeyMeta cells={k.cells} tag={isSplittable(k.source) ? "Pluriel" : null} />
      </div>
      {layout.showSource ? <SourceCell k={k} set={layout.set} /> : null}
      {k.cells.map(c => <LangCell key={c.lang} cell={c} set={layout.set} />)}
    </div>
  );
}

/* ---------- Pluriel en sous-clés ({ zero, one, other }) : une carte, une ligne par forme ---------- */
function FormField({ cell, form, groupId, set }: { cell: Cell; form: string; groupId: string; set: FileSet }) {
  const current = cell.draft ? cell.draft.value : cell.value;
  const commit = (t: HTMLTextAreaElement, explicit: boolean) => {
    if (explicit || t.value !== current) editCell(cell, t.value, explicit);
  };
  return (
    <AutoTextarea key={current} id={`t-${set.id}-${cell.lang}-${cell.id}`} defaultValue={current}
      aria-label={`Traduction ${langName(cell.lang)} de ${groupId}, forme ${FORM_LABEL[form] || form}`}
      className={cn(cell.draft && "border-draft/60")}
      onBlur={e => commit(e.currentTarget, false)} onSubmit={t => { commit(t, true); focusNext(t); }} />
  );
}

export function PluralGroup({ groupId, keys, layout }: { groupId: string; keys: Key[]; layout: Layout }) {
  const { set, langs, showSource } = layout;
  const allCells = keys.flatMap(k => k.cells);
  return (
    <div className={rowClass(allCells.some(c => c.draft))} data-id={groupId}>
      <div className="flex min-w-0 flex-col gap-2">
        <KeyPath segs={keys[0].segs.slice(0, -1)} id={groupId} />
        <KeyMeta cells={allCells} tag={`Pluriel · ${keys.length} formes`} />
      </div>
      <div className="forms-grid">
        {keys.map(k => {
          const formLabel = FORM_LABEL[k.form!] || k.form!;
          return (
            <div key={k.id} className="form-line border-t border-dashed pt-3 first:border-t-0 first:pt-0">
              {showSource ? (
                <div className="flex min-w-0 flex-col gap-1"><FormName>{formLabel}</FormName><SourceText text={k.source} /></div>
              ) : null}
              {k.cells.map((cell, li) => {
                const langStatus = worstStatus(keys.map(x => x.cells[li]));
                const current = cell.draft ? cell.draft.value : cell.value;
                return (
                  <div key={cell.lang} className="flex min-w-0 flex-col gap-1.5">
                    {showSource ? null : <FormName className={li > 0 ? "min-[860px]:invisible" : undefined} aria-hidden={li > 0 ? true : undefined}>{formLabel}</FormName>}
                    {cell.status === langStatus ? null : <StatusBadge status={cell.status} className="self-start" />}
                    <FormField cell={cell} form={k.form!} groupId={groupId} set={set} />
                    <VarWarning vars={cell.lang === set.source ? [] : formVars(k.form, cell.source, current)} />
                  </div>
                );
              })}
            </div>
          );
        })}
        {/* Dernière ligne : l'état et les actions de chaque langue. */}
        <div className="form-line border-t border-dashed pt-3">
          {showSource ? <div /> : null}
          {langs.map((lang, li) => {
            const cells = keys.map(k => k.cells[li]);
            const drafts = cells.filter(c => c.draft);
            const pending = cells.find(c => c.pending);
            return (
              <div key={lang} className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <LangTag lang={lang} />
                  <StatusBadge status={worstStatus(cells)} />
                  {drafts.length ? <DraftBadge plural edited={drafts.some(d => d.draft!.edited)} /> : null}
                  {pending ? <PendingLink pending={pending.pending!} /> : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {cells.some(canValidateRow) ? <Button size="sm" variant="outline" className="h-7" onClick={() => validate(cells)}><Check />Valider le pluriel</Button> : null}
                  {drafts.length ? <Button size="sm" variant="ghost" className="h-7" onClick={() => undo(drafts)}><Undo2 />Annuler</Button> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
