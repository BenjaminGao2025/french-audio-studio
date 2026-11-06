import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api, setToken } from "@/api";
import { btn, meta } from "@/components/fr/kit-utils";
import { useT } from "@/i18n";

export const Route = createFileRoute("/login")({
  head: () => meta("Sign in", "Sign in to your French study cockpit."),
  component: Login,
});

function Login() {
  const t = useT();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="grid min-h-screen place-items-center bg-background px-6">
      <form
        className="panel w-full max-w-sm space-y-4 p-8"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          void api.auth
            .login(email, password)
            .then(async (r) => {
              setToken(r.token);
              await api.auth.session(); // sets the cookie <audio> needs
              return api.auth.me();
            })
            .then(() => navigate({ to: "/" }))
            .catch((err) => setError(err instanceof Error ? err.message : "Sign-in failed"))
            .finally(() => setBusy(false));
        }}
      >
        <div className="fr text-2xl font-semibold">1000H</div>
        <h1 className="text-lg font-semibold">{t("login")}</h1>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("email")}
          className="w-full rounded-lg border border-input bg-background px-4 py-2.5 outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("password")}
          className="w-full rounded-lg border border-input bg-background px-4 py-2.5 outline-none focus:ring-2 focus:ring-ring"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button className={`${btn.primary} w-full`} disabled={busy}>
          {t("login")}
        </button>
      </form>
    </div>
  );
}
