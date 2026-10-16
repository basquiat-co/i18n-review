import { useEffect } from "react";
import { ChevronDown, PartyPopper, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { autosize } from "@/components/AutoTextarea";
import { KeyRow, PluralGroup, type Layout } from "@/components/KeyRows";
import { langName } from "@/lib/config";
import { unitId, type Unit } from "@/lib/rows";
import { showMore, useApp } from "@/store";

function ColumnHeader({ layout }: { layout: Layout }) {
  const { set, langs, showSource } = layout;
  const cell = "text-[11px] font-medium tracking-wider text-muted-foreground uppercase";
  return (
    <div aria-hidden="true" className="key-grid hidden rounded-t-xl border-b bg-muted/60 px-5 py-2.5 min-[860px]:grid">
      <div className={cell}>Clé</div>
      {showSource ? <div className={cell}>{langName(set.source)} · source</div> : null}
      {langs.map(l => <div key={l} className={cell}>{langName(l)}{l === set.source ? " · source" : ""}</div>)}
    </div>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center text-muted-foreground">
      <span className="grid size-11 place-items-center rounded-full bg-muted text-foreground/70">{icon}</span>
      <p className="text-sm">{text}</p>
    </div>
  );
}

export function KeyList({ units, layout }: { units: Unit[]; layout: Layout }) {
  const shown = useApp(s => s.shown);
  const filter = useApp(s => s.filter);
  const search = useApp(s => s.search);

  // Les zones de texte suivent la largeur de la fenêtre.
  useEffect(() => {
    let timer: number | undefined;
    const onResize = () => { clearTimeout(timer); timer = window.setTimeout(() => document.querySelectorAll<HTMLTextAreaElement>("#rows textarea").forEach(autosize), 150); };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); clearTimeout(timer); };
  }, []);

  return (
    <section className="rounded-xl border bg-card shadow-xs" style={{ "--cols": String(layout.cols) } as React.CSSProperties}>
      {units.length ? <ColumnHeader layout={layout} /> : null}
      <div id="rows" className="divide-y">
        {units.length
          ? units.slice(0, shown).map(u => u.group
            ? <PluralGroup key={unitId(u)} groupId={u.group} keys={u.keys} layout={layout} />
            : <KeyRow key={unitId(u)} k={u.key!} layout={layout} />)
          : filter === "todo" && !search
            ? <Empty icon={<PartyPopper className="size-5" />} text="Tout est relu pour ces langues. Rien à faire ici." />
            : <Empty icon={<SearchX className="size-5" />} text="Aucune clé ne correspond." />}
      </div>
      {units.length > shown ? (
        <div className="flex justify-center border-t p-3">
          <Button variant="ghost" onClick={showMore}><ChevronDown />Afficher la suite ({units.length - shown} restantes)</Button>
        </div>
      ) : null}
    </section>
  );
}

export function KeyListSkeleton({ loading }: { loading: boolean }) {
  return (
    <section className="rounded-xl border bg-card shadow-xs" aria-busy={loading}>
      <p className="border-b px-5 py-3 text-sm text-muted-foreground">{loading ? "Chargement des fichiers depuis GitHub…" : "Aucune donnée chargée."}</p>
      {loading ? (
        <div className="divide-y">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="key-grid px-5 py-5" style={{ "--cols": "2" } as React.CSSProperties}>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
