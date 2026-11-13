import { useEffect, useRef, useState } from "react";
import { authOptions } from "../api/auth";

/* Google Identity Services: Google draws its own button, and the callback gets a signed ID token. */
interface GoogleIdApi {
  initialize(config: { client_id: string; callback: (r: { credential?: string }) => void; ux_mode?: "popup" }): void;
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } };
  }
}

let script: Promise<GoogleIdApi> | null = null;
function loadGoogle(): Promise<GoogleIdApi> {
  script ??= new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "https://accounts.google.com/gsi/client";
    el.async = true;
    el.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error("Google sign-in didn’t load")));
    el.onerror = () => {
      script = null;
      reject(new Error("Google sign-in didn’t load"));
    };
    document.head.appendChild(el);
  });
  return script;
}

/** "Continue with Google", shown only when the server has a Google client ID. */
export function GoogleSignIn({ onCredential, disabled }: { onCredential: (credential: string) => void; disabled?: boolean }) {
  const [clientId, setClientId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const slot = useRef<HTMLDivElement>(null);
  const handler = useRef(onCredential);
  handler.current = onCredential;

  useEffect(() => {
    let live = true;
    authOptions().then((o) => live && setClientId(o.google_client_id)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let live = true;
    loadGoogle()
      .then((google) => {
        const el = slot.current;
        if (!live || !el) return;
        google.initialize({ client_id: clientId, ux_mode: "popup", callback: (r) => r.credential && handler.current(r.credential) });
        google.renderButton(el, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "left",
          width: Math.max(200, Math.min(400, Math.round(el.clientWidth) || 320)),
        });
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [clientId]);

  if (!clientId) return null;
  return (
    <div className="flex flex-col gap-3" data-google-signin>
      <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      {failed ? (
        <p className="text-sm text-muted-foreground">Google sign-in couldn’t load. Check your connection, or sign in with your password.</p>
      ) : (
        <div ref={slot} className={disabled ? "pointer-events-none min-h-10 w-full opacity-50" : "min-h-10 w-full"} aria-busy={disabled || undefined} />
      )}
    </div>
  );
}
