import { useState, type FormEvent } from "react";
import { LogIn, UserPlus } from "lucide-react";
import { ApiError } from "../api/client";
import { login, register } from "../api/auth";
import { Banner, Button, FieldText } from "../components/ui";

/** Where to go after signing in: only an in-app path, never another site. */
export function safeNext(search: string): string {
  const next = new URLSearchParams(search).get("next") ?? "";
  if (!next || next.startsWith("/") || next.includes("//") || next.includes("\\") || next.startsWith("login")) return "study";
  return next;
}

/* Real sign-in and invite sign-up (routers/auth.py). Rendered outside the shell. */
export function LoginScreen({ onSignedIn }: { onSignedIn: (next: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) {
      setMissing(true);
      return;
    }
    setBusy(true);
    setError("");
    // Read before signing in: the session change re-renders the gate, which rewrites the address.
    const next = safeNext(location.search);
    try {
      if (mode === "login") await login(email.trim(), password);
      else await register(email.trim(), password, invite.trim());
      onSignedIn(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn’t reach the server. Check your connection and try again.");
      setBusy(false);
    }
  };

  const isLogin = mode === "login";
  return (
    <main className="login-page" id="main">
      <form className="panel stack gap-4 login-card" onSubmit={submit} noValidate>
        <div className="row gap-3">
          <span className="brand-mark" aria-hidden>1000</span>
          <span className="t-strong">1000H French</span>
        </div>
        <h1 className="t-page" tabIndex={-1} data-page-title>{isLogin ? "Sign in" : "Create an account"}</h1>
        {!isLogin && <p className="t-support">Sign-up needs an invite code from the person who shared this site with you.</p>}
        <FieldText
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(v) => { setEmail(v); setMissing(false); }}
          error={missing && !email.trim() ? "Enter your email." : undefined}
        />
        <FieldText
          label="Password"
          type="password"
          autoComplete={isLogin ? "current-password" : "new-password"}
          value={password}
          onChange={(v) => { setPassword(v); setMissing(false); }}
          error={missing && !password ? "Enter your password." : undefined}
        />
        {!isLogin && <FieldText label="Invite code" autoComplete="off" value={invite} onChange={setInvite} />}
        {error && <Banner tone="error" title={isLogin ? "Couldn’t sign in" : "Couldn’t create the account"} live="assertive">{error}</Banner>}
        <div className="btn-row">
          <Button kind="primary" type="submit" busy={busy} icon={isLogin ? <LogIn aria-hidden /> : <UserPlus aria-hidden />}>
            {busy ? (isLogin ? "Signing in…" : "Creating account…") : isLogin ? "Sign in" : "Create account"}
          </Button>
          <Button kind="tertiary" disabled={busy} onClick={() => { setMode(isLogin ? "register" : "login"); setError(""); setMissing(false); }}>
            {isLogin ? "I have an invite code" : "I already have an account"}
          </Button>
        </div>
      </form>
    </main>
  );
}
