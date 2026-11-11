import { useState, type FormEvent } from "react";
import { LogIn, UserPlus, Loader2, AlertCircle } from "lucide-react";
import { ApiError } from "../api/client";
import { login, register } from "../api/auth";
import { Card, CardContent, CardHeader } from "../components/ui";
import { Brand } from "../components/Brand";
import { Button } from "../components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "../components/ui/alert";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { cn } from "cn";

/** Where to go after signing in: only an in-app path, never another site. */
export function safeNext(search: string): string {
  const next = new URLSearchParams(search).get("next") ?? "";
  if (!next || next.startsWith("/") || next.includes("//") || next.includes("\\") || next.startsWith("login")) return "study";
  return next;
}

/* Real sign-in and invite sign-up (routers/auth.py). Rendered outside the shell. */
export function LoginScreen({ onSignedIn }: { onSignedIn: (next: string) => void }) {
  // Invite links (/?invite=CODE, redirected here by the server) open sign-up with the code filled in.
  const [invite, setInvite] = useState(() => (new URLSearchParams(location.search).get("invite") ?? "").slice(0, 64));
  const [mode, setMode] = useState<"login" | "register">(() => (invite ? "register" : "login"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    <main className="flex min-h-dvh items-center justify-center bg-background p-4" id="main">
      <Card className="w-full max-w-sm">
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <CardHeader>
        <Brand />
        <h1 className="text-xl font-semibold tracking-tight text-balance" tabIndex={-1} data-page-title>{isLogin ? "Sign in" : "Create an account"}</h1>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
        <div className="grid gap-2"><Label htmlFor="email">Email</Label><Input id="email" value={email} onChange={(e) => { setEmail(e.target.value); setMissing(false); }} type="email" autoComplete="email" aria-describedby="email-err" aria-invalid={missing && !email.trim() ? true : undefined} />{missing && !email.trim() ? <p id="email-err" className="flex items-start gap-1.5 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /><span>Enter your email.</span></p> : null}</div>
        <div className="grid gap-2"><Label htmlFor="password">Password</Label><Input id="password" value={password} onChange={(e) => { setPassword(e.target.value); setMissing(false); }} type="password" autoComplete={isLogin ? "current-password" : "new-password"} aria-describedby="password-err" aria-invalid={missing && !password ? true : undefined} />{missing && !password ? <p id="password-err" className="flex items-start gap-1.5 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /><span>Enter your password.</span></p> : null}</div>
        {!isLogin && <div className="grid gap-2"><Label htmlFor={"invite-code"}>Invite code</Label><Input id="invite-code" value={invite} onChange={(e) => setInvite(e.target.value)} autoComplete="off" /></div>}
        {error && <Alert variant="destructive" role="alert"><AlertTitle>{isLogin ? "Couldn’t sign in" : "Couldn’t create the account"}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="default" aria-disabled={busy || undefined} aria-busy={busy || undefined} className={cn(busy && "opacity-50")} onClick={(event) => { if (busy) { event.preventDefault(); return; } }}>{busy ? <Loader2 className="animate-spin" aria-hidden /> : (isLogin ? <LogIn aria-hidden /> : <UserPlus aria-hidden />)}{busy ? (isLogin ? "Signing in…" : "Creating account…") : isLogin ? "Sign in" : "Create account"}</Button>
          <Button type="button" variant="ghost" aria-disabled={(!!(busy)) || undefined} className={cn((!!(busy)) ? "opacity-50" : "")} onClick={(event) => { if (!!(busy)) { event.preventDefault(); return; } (() => { setMode(isLogin ? "register" : "login"); setError(""); setMissing(false); })(); }}>{isLogin ? "I have an invite code" : "I already have an account"}</Button>
        </div>
        </CardContent>
      </form>
      </Card>
    </main>
  );
}
