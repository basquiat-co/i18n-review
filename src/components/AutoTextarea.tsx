import { useLayoutEffect, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const MAX = 300; // ~12 lignes, ensuite la zone défile

export function autosize(t: HTMLTextAreaElement) {
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight + 2, MAX) + "px";
  t.style.overflowY = t.scrollHeight + 2 > MAX ? "auto" : "hidden";
}

// Zone de saisie non contrôlée (la valeur n'est lue qu'à la validation), à la hauteur de son texte.
// Ctrl/Cmd + Entrée appelle onSubmit.
export function AutoTextarea({ className, onSubmit, ref, ...props }: Omit<React.ComponentProps<"textarea">, "onSubmit"> & { onSubmit?: (t: HTMLTextAreaElement) => void }) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => { if (inner.current) autosize(inner.current); });
  return (
    <Textarea
      {...props}
      ref={t => {
        inner.current = t;
        if (typeof ref === "function") ref(t); else if (ref) ref.current = t;
      }}
      rows={1}
      dir="auto"
      data-autosize=""
      className={cn("field-sizing-fixed min-h-10 resize-y bg-card leading-relaxed", className)}
      onInput={e => { autosize(e.currentTarget); props.onInput?.(e); }}
      onKeyDown={e => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && onSubmit) { e.preventDefault(); onSubmit(e.currentTarget); }
        props.onKeyDown?.(e);
      }}
    />
  );
}

// Passe au champ suivant de la liste (ou reste sur le même s'il n'y en a pas), curseur en fin de texte.
export function focusNext(current: HTMLTextAreaElement) {
  const all = [...document.querySelectorAll<HTMLTextAreaElement>("#rows textarea")];
  const next = all[all.indexOf(current) + 1] || current;
  next.focus();
  next.setSelectionRange(next.value.length, next.value.length);
}
