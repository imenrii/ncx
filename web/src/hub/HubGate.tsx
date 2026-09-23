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
  splitHubAddress,
  type HubStatus,
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
  const [policy, setPolicy] = useState<HubStatus>();
  const passwordAuth = policy?.password === true;
  const [state, setState] = useState<GateState>("checking");
  const [target, setTarget] = useState(() => splitHubAddress(deepLink.address ?? ""));
  const address = target.credential.trim()
    ? `${target.credential.trim()}:${target.path.trim()}`
    : target.path.trim();
  const setAddress = (value: string) => setTarget(splitHubAddress(value));
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(deepLink.error);
  const [activeError, setActiveError] = useState<string>();
  const [opening, setOpening] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const addresses = savedAddresses().map(splitHubAddress);
  const credentials = [...new Set(addresses.map((item) => item.credential).filter(Boolean))];
  const paths = addresses.filter((item) => item.credential === target.credential.trim()).map((item) => item.path);

  useEffect(() => {
    let live = true;
    void inspectHub()
      .then((status) => {
        if (!live) return;
        setPolicy(status);
        if (!status.hub) {
          setState("viewer");
          return;
        }
        const target = deepLink.address;
        if (status.mode === "local" && target) {
          setTarget({ credential: "", path: "" });
          setError("Remote sessions are disabled");
          setState("open");
          return;
        }
        const current = currentHubSessionRecord();
        if (!status.active || !current) {
          if (target && status.password === false) startKeySession(target);
          else setState(target ? "prompt" : "open");
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
        if (status.password === false) startKeySession(target ?? current.address);
        else setState("prompt");
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

  const startKeySession = (candidate: string) => {
    setOpening(true);
    setState("retargeting");
    const current = currentHubSessionRecord();
    const next = current ? replaceHubSession(candidate, { save: true })
      : createHubSession(candidate, { save: true }).then(record => ({ record, cleanupWarning: undefined }));
    void next.then(result => acceptReplacement(result.cleanupWarning)).catch(restoreActive).finally(() => setOpening(false));
  };
  const modeLabel = policy?.mode === "http" ? <span className="hub-mode" title="Unencrypted HTTP">HTTP</span> : null;

  const submitAddress = (event: FormEvent) => {
    event.preventDefault();
    const candidate = address.trim();
    if (!target.path.trim() || opening) return;
    if (isRemoteAddress(target.path.trim())) {
      setError("Enter the SSH identity in Credential and the file path in Dataset address.");
      return;
    }
    if (target.credential.trim() && !isRemoteAddress(candidate)) {
      setError("Enter a valid SSH identity and an absolute dataset path.");
      return;
    }
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
    if (isRemoteAddress(candidate) && passwordAuth) {
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
        <App allowComparison={false} sessionActions={<>
          <button
            className="btn hub-open-another"
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
          <button className="btn hub-close" onClick={close}>Close Session</button>
          {modeLabel}
        </>} />
        {activeError && <p className="hub-error hub-active-error" role="alert">{activeError}</p>}
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
            {modeLabel}
          </header>
          <div className="hub-grid">
            <form className="hub-open-panel" onSubmit={submitAddress}>
              <label className="hub-label" htmlFor="Credential">Credential</label>
              <input
                className="field"
                id="Credential"
                disabled={policy?.mode === "local"}
                list="hub-saved-credentials"
                value={target.credential}
                onChange={(event) => setTarget({ ...target, credential: event.currentTarget.value })}
                placeholder="username@hostname"
                aria-label="Credential (leave blank for local files)"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
              />
              <datalist id="hub-saved-credentials">
                {credentials.map((item) => <option value={item} key={item} />)}
              </datalist>
              <label className="hub-label" htmlFor="hub-address">Dataset address</label>
              <input
                className="field"
                id="hub-address"
                list="hub-saved-addresses"
                value={target.path}
                onChange={(event) => setTarget({ ...target, path: event.currentTarget.value })}
                placeholder="/path/run.nc"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                required
              />
              <datalist id="hub-saved-addresses">
                {paths.map((item) => <option value={item} key={item} />)}
              </datalist>
              {error && <p className="hub-error" role="alert">{error}</p>}
              <div className="dialog-actions">
                {currentHubSessionRecord() && (
                  <button type="button" className="btn" onClick={cancelToActive}>Cancel</button>
                )}
                <button type="submit" className="btn primary" disabled={opening || state === "prompt" || !target.path.trim()}>
                  {state === "prompt" ? "Connect…" : opening ? "Opening…" : "Open dataset"}
                </button>
              </div>
            </form>
          </div>
        </section>
      </main>
      {hub && passwordAuth && (
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
              className="field"
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
              <button type="button" className="btn" onClick={cancelToActive}>Cancel</button>
              <button type="submit" className="btn primary" disabled={opening || !password}>
                {opening ? "Connecting…" : "Connect"}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
