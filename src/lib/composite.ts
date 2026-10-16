import * as C from "./core";
import { FORM_LABEL } from "./config";

/**
 * Champs d'édition d'un pluriel écrit dans une seule chaîne (JSON ou ICU), ou null pour un texte simple.
 * fields : [{ label, value }] de la traduction, src : [{ label, value }] de la source, build(values) → la chaîne complète.
 */
export interface Composite {
  kind: "Pluriel" | "Variantes";
  fields: { label: string; value: string }[];
  src: { label: string; value: string }[];
  build: (values: string[]) => string;
}

export function compositeOf(r: { source: string; value: string }, current: string): Composite | null {
  const json = C.parseJsonPlural(r.source);
  if (json) {
    const cur = C.parseJsonPlural(current) || {};
    const forms = [...Object.keys(json), ...Object.keys(cur).filter(f => !(f in json))];
    return {
      kind: "Pluriel",
      fields: forms.map(f => ({ label: FORM_LABEL[f] || f, value: cur[f] || "" })),
      src: Object.keys(json).map(f => ({ label: FORM_LABEL[f] || f, value: json[f] })),
      build: vals => { const o: Record<string, string> = {}; forms.forEach((f, i) => o[f] = vals[i]); return C.stringifyJsonPlural(o, r.value || r.source); },
    };
  }
  const sp = C.parseIcu(r.source);
  if (!sp) return null;
  // La traduction garde sa propre structure ; une clé encore vide part de celle de la source, sans texte.
  const tp = current === ""
    ? sp.map((p): C.IcuPart => p.t === "text" ? { ...p, v: "" } : { ...p, branches: p.branches.map(b => ({ ...b, v: "" })) })
    : C.parseIcu(current);
  if (!tp) return null;
  const args = tp.filter(p => p.t === "arg").length;
  const kind = tp.every(p => p.t !== "arg" || p.type === "plural") ? "Pluriel" : "Variantes";
  const branchLabel = (p: C.IcuArg, sel: string) => {
    const lab = p.type === "select" ? (sel === "other" ? "autre cas" : sel)
      : /^=\d+$/.test(sel) ? "exactement " + sel.slice(1) : (FORM_LABEL[sel] || sel);
    return args > 1 || p.type !== "plural" ? `${p.name} · ${lab}` : lab;
  };
  const describe = (parts: C.IcuPart[], ref: C.IcuPart[] | null) => {
    const out: { label: string; value: string; at: number[] }[] = [];
    parts.forEach((p, i) => {
      if (p.t === "text") {
        const twin = ref && ref[i] && ref[i].t === "text" ? (ref[i] as C.IcuText).v : "";
        if (p.v.trim() !== "" || twin.trim() !== "") out.push({ label: "texte", value: p.v, at: [i] });
      } else p.branches.forEach((b, k) => out.push({ label: branchLabel(p, b.sel), value: b.v, at: [i, k] }));
    });
    return out;
  };
  const fields = describe(tp, sp);
  return {
    kind,
    fields: fields.map(f => ({ label: f.label, value: f.value })),
    src: describe(sp, null).map(f => ({ label: f.label, value: f.value })),
    build: vals => {
      const parts: C.IcuPart[] = JSON.parse(JSON.stringify(tp));
      fields.forEach((f, n) => {
        if (f.at.length === 1) (parts[f.at[0]] as C.IcuText).v = vals[n];
        else (parts[f.at[0]] as C.IcuArg).branches[f.at[1]].v = vals[n];
      });
      return C.serializeIcu(parts);
    },
  };
}

// Le texte peut être édité forme par forme (pluriel JSON ou ICU dans la source).
export const isSplittable = (source: string) => !!(C.parseJsonPlural(source) || C.parseIcu(source));
