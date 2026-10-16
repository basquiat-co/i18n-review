import { Progress } from "@/components/ui/progress";
import { StatusDot } from "@/components/StatusBadge";
import { STATUS_INFO, langName, type FilterKey } from "@/lib/config";
import { cn } from "@/lib/utils";
import { setFilter, useApp } from "@/store";

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

/**
 * Vue d'ensemble : la progression de la relecture (chiffre principal + jauge) et une tuile par statut.
 * Les tuiles servent aussi de filtres pour la liste des clés.
 */
export function Overview({ counts, langs }: { counts: Record<string, number>; langs: string[] }) {
  const filter = useApp(s => s.filter);
  const done = counts.ok || 0, total = counts.all || 0;
  const p = pct(done, total);
  return (
    <section className="grid gap-3 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <div className="flex flex-col justify-between gap-3 rounded-xl border bg-card p-4 shadow-xs sm:gap-4 sm:p-5">
        <div>
          <p className="text-sm text-muted-foreground">Progression de la relecture</p>
          <p className="mt-1 text-4xl font-semibold tracking-tight sm:text-5xl">{p}<span className="ml-0.5 text-2xl text-muted-foreground">%</span></p>
        </div>
        <div className="flex flex-col gap-2">
          <Progress value={p} aria-label={`${p} % des clés relues`} className="h-2" />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{done}</span> clé{done > 1 ? "s" : ""} relue{done > 1 ? "s" : ""} sur <span className="tabular-nums">{total}</span> · {langs.map(langName).join(", ")}
          </p>
        </div>
      </div>
      <div role="group" aria-label="Filtrer par statut" className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-3 sm:overflow-visible sm:px-0 sm:pb-0">
        {STATUS_INFO.map(s => (
          <FilterTile key={s.key} k={s.key} label={s.label} status={s.status} value={counts[s.key] || 0} active={filter === s.key} />
        ))}
      </div>
    </section>
  );
}

function FilterTile({ k, label, status, value, active }: { k: FilterKey; label: string; status?: Parameters<typeof StatusDot>[0]["status"]; value: number; active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setFilter(k)}
      className={cn(
        "group flex min-h-[4.75rem] w-36 shrink-0 snap-start flex-col justify-between gap-2 rounded-xl border bg-card p-3 text-left shadow-xs transition-[border-color,box-shadow,background-color] outline-none sm:min-h-[5.25rem] sm:w-auto sm:p-3.5",
        "hover:border-foreground/20 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active && "border-primary bg-accent ring-1 ring-primary hover:border-primary",
      )}
    >
      <span className="flex items-center gap-2 text-[13px] leading-tight text-muted-foreground group-aria-pressed:text-accent-foreground">
        {status ? <StatusDot status={status} /> : null}
        {label}
      </span>
      <span className={cn("text-2xl font-semibold tracking-tight", value === 0 && "text-muted-foreground/70")}>{value}</span>
    </button>
  );
}
