import { useEffect, useState, type FormEvent } from "react";

import { App } from "./App";
import {
  closeHubSession,
  createHubSession,
  heartbeatHubSession,
  inspectHub,
  savedAddresses,
} from "./hub.ts";

type GateState = "checking" | "viewer" | "open" | "active";

export function HubGate() {
  const [state, setState] = useState<GateState>("checking");
  const [address, setAddress] = useState("");
  const [save, setSave] = useState(false);
  const [error, setError] = useState<string>();
  const [opening, setOpening] = useState(false);
  const addresses = savedAddresses();

  useEffect(() => {
    let live = true;
    void inspectHub()
      .then((status) => {
        if (live) setState(!status.hub ? "viewer" : status.active ? "active" : "open");
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setState("open");
      });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (state !== "active") return;
    const heartbeat = window.setInterval(() => {
      void heartbeatHubSession().then((active) => {
        if (!active) setState("open");
      });
    }, 30_000);
    const close = (event: PageTransitionEvent) => {
      if (!event.persisted) void closeHubSession(true);
    };
    window.addEventListener("pagehide", close);
    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("pagehide", close);
    };
  }, [state]);

  if (state === "viewer") return <App />;
  if (state === "active") {
    return (
      <div className="hub-active">
        <button
          className="hub-close"
          onClick={() => void closeHubSession().then(() => setState("open"))}
        >
          Open another address
        </button>
        <App />
      </div>
    );
  }
  if (state === "checking") {
    return (
      <main className="startup">
        <strong className="brand">ncx</strong>
        <p>Opening ncx…</p>
      </main>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setOpening(true);
    setError(undefined);
    void createHubSession(address.trim(), save)
      .then(() => setState("active"))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setOpening(false));
  };

  return (
    <main className="hub-open">
      <form className="hub-open-panel" onSubmit={submit}>
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
        <button type="submit" disabled={opening || !address.trim()}>
          {opening ? "Opening…" : "Open"}
        </button>
      </form>
    </main>
  );
}
