import { useState } from "react";
import { ArrowRight, ExternalLink, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/Brand";
import { login, rememberedToken, useApp } from "@/store";

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full border bg-card text-xs font-semibold tabular-nums">{n}</span>
      <span className="pt-0.5 text-sm leading-relaxed text-muted-foreground">{children}</span>
    </li>
  );
}

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[12px] whitespace-nowrap text-foreground">{children}</code>
);

export function LoginScreen() {
  const loginError = useApp(s => s.loginError);
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(rememberedToken);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const error = localError || loginError;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = token.trim();
    if (!t) { setLocalError("Colle d'abord ton jeton GitHub."); return; }
    setLocalError(""); setBusy(true);
    await login(t, remember);
    setBusy(false);
  };

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      {/* halo de fond, purement décoratif */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_50%_-10%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent)]" />
      <div className="w-full max-w-[34rem]">
        <div className="mb-6 flex items-center gap-2.5">
          <BrandMark />
          <span className="text-sm font-semibold tracking-tight">Relecture des traductions</span>
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-[0_12px_40px_-16px_rgb(15_23_42/0.25)] sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">Connecte-toi avec un jeton GitHub</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            L'outil lit les fichiers de traduction directement sur GitHub et propose tes corrections sous forme de pull request. Rien ne transite par un autre serveur.
          </p>

          <ol className="mt-6 flex flex-col gap-3">
            <Step n={1}>
              Ouvre{" "}
              <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
                GitHub → Fine-grained token<ExternalLink className="size-3.5" />
              </a>.
            </Step>
            <Step n={2}>Propriétaire : <Code>basquiat-co</Code>. Dépôts : <Code>basquiat-app</Code>, <Code>basquiat-service</Code>, <Code>lift-agentic-service</Code>.</Step>
            <Step n={3}>Permissions : <Code>Contents</Code> en lecture et écriture, <Code>Pull requests</Code> en lecture et écriture.</Step>
            <Step n={4}>Copie le jeton et colle-le ici.</Step>
          </ol>

          <form className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <LockKeyhole className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="github_pat_…" autoComplete="off" aria-label="Jeton GitHub" className="h-10 pl-9 font-mono text-sm" />
              </div>
              <Button type="submit" className="h-10" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : null}Se connecter{busy ? null : <ArrowRight />}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="remember" checked={remember} onCheckedChange={v => setRemember(v === true)} />
              <Label htmlFor="remember" className="text-sm font-normal text-muted-foreground">Se souvenir du jeton sur cet ordinateur</Label>
            </div>
            <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
          </form>
        </div>
        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" aria-hidden="true" />Le jeton reste dans ce navigateur et n'est envoyé qu'à api.github.com.
        </p>
      </div>
    </main>
  );
}
