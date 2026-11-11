import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { loadMe, useSession } from "./api/auth";
import { loginUrl } from "./api/client";
import { Spinner } from "./components/ui";
import { LoginScreen, safeNext } from "./screens/Login";
import { BASE, routeUrl } from "./state/store";
import "./styles.css";

const onLoginPage = () => location.pathname.replace(/\/+$/, "") === BASE + "login";

/* Resolves the real session before the app renders; the login page lives outside the shell. */
function AuthGate() {
  const { status } = useSession();
  useEffect(() => {
    void loadMe();
  }, []);
  useEffect(() => {
    if (status === "out" && !onLoginPage()) location.replace(loginUrl());
  }, [status]);

  if (onLoginPage() && status !== "in" && status !== "checking")
    return <LoginScreen onSignedIn={(next) => location.assign(routeUrl(next))} />;
  if (status === "in") {
    // Signed in on the login page: go where `next` points (before App reads the address).
    if (onLoginPage()) history.replaceState(null, "", routeUrl(safeNext(location.search)));
    return <App />;
  }
  if (status === "error")
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-4" id="main">
        <div className="rounded-lg border bg-card p-4 text-card-foreground flex flex-col gap-4 w-full max-w-sm">
          <Alert variant="destructive" role="alert"><AlertTitle>Couldn’t reach the server</AlertTitle><AlertDescription>Your sign-in is kept. Check your connection and try again.</AlertDescription></Alert>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="default" onClick={() => void loadMe()}>Try again</Button>
          </div>
        </div>
      </main>
    );
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4" id="main">
      <Spinner label="Loading…" />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate />
  </StrictMode>,
);

import { Button } from "./components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "./components/ui/alert";