import { useEffect, useRef, useState, type FormEvent } from "react";

import { App } from "./App";
import {
  closeHubSession,
  createHubSession,
  currentHubSessionRecord,
  heartbeatHubSession,
  hubBasePath,
  inspectHub,
  isRemoteAddress,
  parseHubDeepLink,
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
  const [save, setSave] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(deepLink.error);
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
          void retargetHubSession(target!)
            .then(() => {
              if (live) {
                setAddress(target!);
                setState("active");
              }
            })
            .catch((cause: unknown) => {
              if (!live) return;
              setError(cause instanceof Error ? cause.message : String(cause));
              void closeHubSession().finally(() => {
                if (live) setState("open");
              });
            });
          return;
        }
        setState("closing");
        void closeHubSession().then(() => {
          if (!live) return;
          setPassword("");
          setAddress(target ?? "");
          setState("prompt");
        });
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

  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    const candidate = address.trim();
    if (!candidate || opening) return;
    setError(undefined);
    if (isRemoteAddress(candidate)) {
      setAddress(candidate);
      setPassword("");
      setState("prompt");
      return;
    }
    setOpening(true);
    void createHubSession(candidate, { save })
      .then(() => setState("active"))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setOpening(false));
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    const entered = password;
    setPassword("");
    if (!entered || opening) return;
    setOpening(true);
    void createHubSession(address.trim(), { password: entered, save })
      .then(() => setState("active"))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => {
        setPassword("");
        setOpening(false);
      });
  };

  const cancelPassword = () => {
    setPassword("");
    setError(undefined);
    setOpening(false);
    setState("open");
  };

  const close = () => {
    setState("closing");
    void closeHubSession().then(() => setState("open"));
  };

  if (state === "viewer") return <App />;
  if (state === "active") {
    return (
      <div className="hub-active">
        <button className="hub-close" onClick={close}>
          Open another address
        </button>
        <App />
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
        <form className="hub-open-panel" onSubmit={submitAddress}>
          <strong className="brand">ncx</strong>
          <h1>Open NetCDF</h1>
          <label htmlFor="hub-address">Server or SSH address</label>
          <input
            id="hub-address"
            list="hub-saved-addresses"
            value={address}
            onChange={(event) => setAddress(event.currentTarget.value)}
            placeholder="/data/run.nc or user@host:/path/run.nc"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            required
          />
          <datalist id="hub-saved-addresses">
            {addresses.map((item) => <option value={item} key={item} />)}
          </datalist>
          <label className="hub-save">
            <input type="checkbox" checked={save} onChange={(event) => setSave(event.currentTarget.checked)} />
            Save this address in this browser
          </label>
          {error && <p className="hub-error" role="alert">{error}</p>}
          <button type="submit" disabled={opening || state === "prompt" || !address.trim()}>
            {state === "prompt" ? "Connect…" : opening ? "Opening…" : "Connect"}
          </button>
        </form>
      </main>
      {hub && (
        <dialog
          ref={dialog}
          className="hub-password-dialog"
          aria-labelledby="hub-password-title"
          onCancel={(event) => {
            event.preventDefault();
            cancelPassword();
          }}
        >
          <form onSubmit={submitPassword}>
            <h2 id="hub-password-title">Connect to SSH</h2>
            <p>Enter the password for <code>{address}</code>.</p>
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
              <button type="button" onClick={cancelPassword}>Cancel</button>
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
