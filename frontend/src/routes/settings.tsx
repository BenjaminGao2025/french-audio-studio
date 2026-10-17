import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, Chip } from "@/components/fr/kit";
import { btn, meta } from "@/components/fr/kit-utils";
import { api, setToken, USE_MOCK } from "@/api";
import { useMe, usePhase } from "@/api/hooks";
import { DataView } from "@/components/fr/states";
import { getLocale, setLocale, useLocale, useT, type Locale } from "@/i18n";
import { getTheme, setTheme, type Theme } from "@/theme/theme";

export const Route = createFileRoute("/settings")({
  head: () => meta("Settings", "Language, theme, coach profile and account."),
  component: Settings,
});

function Settings() {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const me = useMe();
  const phase = usePhase();
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [palette, setPalette] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.dataset["theme"] || "ink-blue"
      : "ink-blue",
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-xl space-y-6 px-4 py-10 md:px-10">
        <h1 className="fr text-3xl">{t("settings")}</h1>

        <section className="panel space-y-4 p-6">
          <h2 className="font-medium">Language / 语言</h2>
          <div className="flex gap-2">
            {(["zh", "en"] as Locale[]).map((l) => (
              <button
                key={l}
                onClick={() => setLocale(l)}
                className={`${btn.ghost} ${locale === l ? "border-primary" : ""}`}
              >
                {l === "zh" ? "中文" : "English"}
              </button>
            ))}
          </div>
        </section>

        <section className="panel space-y-4 p-6">
          <h2 className="font-medium">Theme</h2>
          <div className="flex flex-wrap gap-2">
            {(["light", "dark", "system"] as Theme[]).map((th) => (
              <button
                key={th}
                onClick={() => {
                  setTheme(th);
                  setThemeState(th);
                }}
                className={`${btn.ghost} ${theme === th ? "border-primary" : ""}`}
              >
                {th}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {(["ink-blue", "sage"] as const).map((p) => (
              <button
                key={p}
                onClick={() => {
                  document.documentElement.dataset["theme"] = p;
                  window.localStorage.setItem("1000h.palette", p);
                  setPalette(p);
                }}
                className={`${btn.ghost} ${palette === p ? "border-primary" : ""}`}
              >
                {p === "ink-blue" ? "Ink blue" : "Sage (green)"}
              </button>
            ))}
          </div>
        </section>

        <section className="panel space-y-2 p-6">
          <h2 className="font-medium">Phase</h2>
          <DataView query={phase} skeletonLines={2}>
            {(p) => (
              <p className="text-sm text-muted-foreground">
                {p.name} · weekly target {Math.round(p.week_target_min / 60)}h ·{" "}
                {p.new_cards_per_day} new cards/day
              </p>
            )}
          </DataView>
        </section>

        <section className="panel space-y-3 p-6">
          <h2 className="font-medium">Account</h2>
          <DataView query={me} skeletonLines={1}>
            {(u) => <p className="text-sm text-muted-foreground">{u.email}</p>}
          </DataView>
          {USE_MOCK && <Chip tone="warn">Mock data mode (VITE_USE_MOCK)</Chip>}
          <div>
            <button
              className={btn.ghost}
              onClick={() => {
                void api.auth.logout().finally(() => {
                  setToken(null);
                  void navigate({ to: "/login" });
                });
              }}
            >
              {t("logout")}
            </button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

// locale is read at render; keep getLocale referenced for future SSR use.
void getLocale;
