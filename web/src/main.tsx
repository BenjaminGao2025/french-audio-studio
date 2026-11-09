import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { loadMe, useSession } from "./api/auth";
import { loginUrl } from "./api/client";
import { Banner, Button, Spinner } from "./components/ui";
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
      <main className="login-page" id="main">
        <div className="panel stack gap-4 login-card">
          <Banner tone="error" title="Couldn’t reach the server" live="assertive">Your sign-in is kept. Check your connection and try again.</Banner>
          <div className="btn-row">
            <Button kind="primary" onClick={() => void loadMe()}>Try again</Button>
          </div>
        </div>
      </main>
    );
  return (
    <main className="login-page" id="main">
      <Spinner label="Loading…" />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate />
  </StrictMode>,
);
