import { useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { Header } from "@/components/Header";
import { KeyList, KeyListSkeleton } from "@/components/KeyList";
import { LoginScreen } from "@/components/LoginScreen";
import { InitNotice, Notices, OrphanNotice } from "@/components/Notices";
import { Overview } from "@/components/Overview";
import { PrDialog } from "@/components/PrDialog";
import { SendBar } from "@/components/SendBar";
import { Toolbar } from "@/components/Toolbar";
import { BrandMark } from "@/components/Brand";
import { useApplyTheme } from "@/hooks/use-theme";
import { reviewEntries } from "@/lib/core";
import { STATUS_INFO, filePath, setById } from "@/lib/config";
import { activeLangs, buildUnits, canValidateRow, currentKeys, filterCounts, unitCells } from "@/lib/rows";
import { autoLogin, useApp, validate } from "@/store";

function Workspace() {
  const setId = useApp(s => s.setId);
  const data = useApp(s => s.data[s.setId]);
  const drafts = useApp(s => s.drafts);
  const prefs = useApp(s => s.langPrefs);
  const filter = useApp(s => s.filter);
  const search = useApp(s => s.search);
  const loading = useApp(s => s.loading);

  const set = setById(setId);
  const langKey = activeLangs(set, prefs).join(",");
  const langs = useMemo(() => langKey.split(","), [langKey]);
  const layout = useMemo(() => {
    const showSource = !langs.includes(set.source);
    return { set, langs, showSource, cols: langs.length + (showSource ? 1 : 0) };
  }, [set, langs]);
  const keys = useMemo(() => (data ? currentKeys(set, data, langs, drafts) : []), [set, data, langs, drafts]);
  const counts = useMemo(() => filterCounts(keys, STATUS_INFO.map(s => s.key)), [keys]);
  const units = useMemo(() => buildUnits(keys, filter, search), [keys, filter, search]);

  const files = langs.length === 1 ? filePath(set, langs[0]) : set.path.replace("{lang}", "{" + langs.join(", ") + "}");
  const countLine = `${units.length} clé${units.length > 1 ? "s" : ""} · ${set.repo.split("/")[1]} · ${files}`;
  const needsInit = !!data && Object.keys(reviewEntries(data.review, set.id, set.source)).length === 0;

  return (
    <>
      <Header />
      <main className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 pt-5 pb-40 md:px-6">
        <OrphanNotice />
        <Notices />
        {needsInit ? <InitNotice /> : null}
        {data ? (
          <>
            <Overview counts={counts} langs={langs} />
            <Toolbar countLine={countLine} canValidate={units.some(u => unitCells(u).some(canValidateRow))}
              onValidate={() => validate(units.flatMap(unitCells))} />
            <KeyList units={units} layout={layout} />
          </>
        ) : <KeyListSkeleton loading={loading} />}
      </main>
      <SendBar />
      <PrDialog />
    </>
  );
}

export function App() {
  useApplyTheme();
  const user = useApp(s => s.user);
  const booting = useApp(s => s.booting);
  useEffect(() => autoLogin(), []);
  if (booting) {
    return (
      <div className="grid min-h-dvh place-items-center" aria-busy="true">
        <div className="flex items-center gap-3 text-sm text-muted-foreground"><BrandMark /><Loader2 className="size-4 animate-spin" />Connexion à GitHub…</div>
      </div>
    );
  }
  return user ? <Workspace /> : <LoginScreen />;
}
