import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-[oklch(0.42_0.2_290)] text-primary-foreground shadow-sm ring-1 ring-black/5", className)}>
      <Languages className="size-4" />
    </span>
  );
}

export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight whitespace-nowrap">Relecture des traductions</div>
        <div className="text-xs text-muted-foreground">Lift</div>
      </div>
    </div>
  );
}
