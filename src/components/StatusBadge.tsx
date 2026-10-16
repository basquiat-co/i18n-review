import type { Status } from "@/lib/core";
import { PILL } from "@/lib/config";
import { cn } from "@/lib/utils";

// Couleur de chaque statut (variables CSS --st-*) : toujours avec son libellé, jamais seule.
export const statusColor = (s: Status) => `var(--st-${s})`;

export function StatusDot({ status, className }: { status: Status; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: statusColor(status) }} />;
}

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border bg-card px-2.5 text-xs font-medium whitespace-nowrap text-foreground/80", className)}>
      <StatusDot status={status} className="size-1.5" />
      {PILL[status]}
    </span>
  );
}

// Modification en attente sur cette ligne : corrigée (texte changé) ou validée telle quelle.
export function DraftBadge({ edited, plural }: { edited: boolean; plural?: boolean }) {
  const label = edited ? (plural ? "Corrigé" : "Corrigée") : (plural ? "Validé" : "Validée");
  return (
    <span className="inline-flex h-6 items-center rounded-full bg-draft px-2.5 text-xs font-medium whitespace-nowrap text-primary-foreground dark:text-background">
      {label}
    </span>
  );
}

export function PendingLink({ pending }: { pending: { number: number; url: string } }) {
  return (
    <a href={pending.url} target="_blank" rel="noopener" className="text-xs font-medium text-primary underline-offset-4 hover:underline">
      PR #{pending.number}
    </a>
  );
}
