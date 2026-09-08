import { useEffect, useRef, useState, type FormEvent } from "react";

import { App } from "../app/App";
import {
  closeHubSession,
  createHubSession,
  currentHubSessionRecord,
  heartbeatHubSession,
  hubBasePath,
  inspectHub,
  isRemoteAddress,
  parseHubDeepLink,
  rememberAddress,
  replaceHubSession,
  retargetHubSession,
  savedAddresses,
  sessionTransition,
} from "./hub.ts";

type GateState = "checking" | "viewer" | "open" | "prompt" | "retargeting" | "closing" | "active";

interface DeepLinkState {
  address?: string;
  error?: string;
}

export function HubGate() {
  const [deepLink] = useState<DeepLinkState>(() => {
    if (!hubBasePath()) return {};
    try {
      return { address: parseHubDeepLink() };
    } catch (cause: unknown) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  const hub = hubBasePath() !== undefined;
  const [state, setState] = useState<GateState>("checking");
  const [address, setAddress] = useState(deepLink.address ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(deepLink.error);
  const [activeError, setActiveError] = useState<string>();
  const [opening, setOpening] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const addresses = savedAddresses();

  useEffect(() => {
    let live = true;
    void inspectHub()
      .then((status) => {
        if (!live) return;
        if (!status.hub) {
          setState("viewer");
          return;
        }
        const target = deepLink.address;
        const current = currentHubSessionRecord();
        if (!status.active || !current) {
          setState(target ? "prompt" : "open");
          return;
        }
        const transition = sessionTransition(current, target ?? current.address);
        if (transition === "same") {
          setAddress(current.address);
          setState("active");
          return;
        }
        if (transition === "retarget") {
          setState("retargeting");
          void retargetHubSession(target!, true)
            .then(() => {
              if (live) {
                setAddress(target!);
                setState("active");
              }
            })
            .catch((cause: unknown) => {
              if (!live) return;
              setActiveError(cause instanceof Error ? cause.message : String(cause));
              setAddress(current.address);
              setState("active");
            });
          return;
        }
        setPassword("");
        setAddress(target ?? "");
        setState("prompt");
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setState("open");
      });
    return () => { live = false; };
  }, [deepLink.address]);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (state === "prompt") {
      if (!node.open) node.showModal();
      node.querySelector<HTMLInputElement>("#hub-password")?.focus();
    } else if (node.open) {
      node.close();
    }
  }, [state]);

  useEffect(() => {
    if (state !== "active") return;
    const heartbeat = window.setInterval(() => {
      void heartbeatHubSession().then((active) => {
        if (!active) setState("open");
      });
    }, 30_000);
    return () => window.clearInterval(heartbeat);
  }, [state]);

  const restoreActive = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (currentHubSessionRecord()) {
      setActiveError(message);
      setAddress(currentHubSessionRecord()!.address);
      setState("active");
    } else {
      setError(message);
      setState("open");
    }
  };

  const acceptReplacement = (cleanupWarning?: string) => {
    setError(undefined);
    setActiveError(cleanupWarning);
    setState("active");
  };

  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    const candidate = address.trim();
    if (!candidate || opening) return;
    setError(undefined);
    setActiveError(undefined);
    const current = currentHubSessionRecord();
    const transition = sessionTransition(current, candidate);
    if (transition === "same") {
      rememberAddress(candidate);
      setState("active");
      return;
    }
    if (transition === "retarget") {
      setState("retargeting");
      void retargetHubSession(candidate, true)
        .then(() => setState("active"))
        .catch(restoreActive);
      return;
    }
    if (isRemoteAddress(candidate)) {
      setAddress(candidate);
      setPassword("");
      setState("prompt");
      return;
    }

    setOpening(true);
    setState("retargeting");
    const openingSession = current
      ? replaceHubSession(candidate, { save: true })
      : createHubSession(candidate, { save: true }).then((record) => ({ record, cleanupWarning: undefined }));
    void openingSession
      .then((result) => acceptReplacement(result.cleanupWarning))
      .catch(restoreActive)
      .finally(() => setOpening(false));
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    const entered = password;
    setPassword("");
    if (!entered || opening) return;
    const current = currentHubSessionRecord();
    setOpening(true);
    const openingSession = current
      ? replaceHubSession(address.trim(), { password: entered, save: true })
      : createHubSession(address.trim(), { password: entered, save: true }).then((record) => ({ record, cleanupWarning: undefined }));
    void openingSession
      .then((result) => acceptReplacement(result.cleanupWarning))
      .catch((cause: unknown) => {
        if (currentHubSessionRecord()) restoreActive(cause);
        else {
          setError(cause instanceof Error ? cause.message : String(cause));
          setState("prompt");
        }
      })
      .finally(() => {
        setPassword("");
        setOpening(false);
      });
  };

  const cancelToActive = () => {
    setPassword("");
    setError(undefined);
    setOpening(false);
    const current = currentHubSessionRecord();
    if (current) {
      setAddress(current.address);
      setState("active");
    } else {
      setState("open");
    }
  };

  const close = () => {
    setState("closing");
    setActiveError(undefined);
    void closeHubSession()
      .then(() => setState("open"))
      .catch(restoreActive);
  };

  if (state === "viewer") return <App />;
  if (state === "active") {
    return (
      <div className="hub-active">
        <div className="hub-session-actions">
          <button
            className="hub-open-another"
            onClick={() => {
              const current = currentHubSessionRecord();
              setAddress(current?.address ?? "");
              setError(undefined);
              setActiveError(undefined);
              setState("open");
            }}
          >
            Open another address
          </button>
          <button className="hub-close" onClick={close}>Close session</button>
        </div>
        {activeError && <p className="hub-error hub-active-error" role="alert">{activeError}</p>}
        <App allowComparison={false} />
      </div>
    );
  }
  if (state === "checking" || state === "retargeting" || state === "closing") {
    return (
      <main className="startup">
        <strong className="brand">ncx</strong>
        <p>
          {state === "checking" ? "Opening ncx…" : state === "retargeting" ? "Opening the new file…" : "Closing ncx…"}
        </p>
      </main>
    );
  }

  return (
    <>
      <main className="hub-open">
        <section className="hub-workspace" aria-label="Open NetCDF">
          <header className="hub-heading">
            <strong className="brand">ncx<span aria-hidden="true">/</span></strong>
          </header>
          <div className="hub-grid">
            <form className="hub-open-panel" onSubmit={submitAddress}>
              <label className="hub-label" htmlFor="hub-address">Dataset address</label>
              <input
                id="hub-address"
                list="hub-saved-addresses"
                value={address}
                onChange={(event) => setAddress(event.currentTarget.value)}
                placeholder="/data/run.nc or user@host:/path/run.nc"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                required
              />
              <datalist id="hub-saved-addresses">
                {addresses.map((item) => <option value={item} key={item} />)}
              </datalist>
              {error && <p className="hub-error" role="alert">{error}</p>}
              <div className="dialog-actions">
                {currentHubSessionRecord() && (
                  <button type="button" onClick={cancelToActive}>Cancel</button>
                )}
                <button type="submit" disabled={opening || state === "prompt" || !address.trim()}>
                  {state === "prompt" ? "Connect…" : opening ? "Opening…" : "Open dataset"}
                </button>
              </div>
            </form>
          </div>
        </section>
      </main>
      {hub && (
        <dialog
          ref={dialog}
          className="hub-password-dialog"
          aria-labelledby="hub-password-title"
          onCancel={(event) => {
            event.preventDefault();
            cancelToActive();
          }}
        >
          <form onSubmit={submitPassword}>
            <h2 id="hub-password-title">Connect to SSH</h2>
            <p><code>{address}</code></p>
            <label htmlFor="hub-password">SSH password</label>
            <input
              id="hub-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
            {error && <p className="hub-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button type="button" onClick={cancelToActive}>Cancel</button>
              <button type="submit" className="primary" disabled={opening || !password}>
                {opening ? "Connecting…" : "Connect"}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
