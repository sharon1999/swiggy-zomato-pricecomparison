import { useState } from "react";
import { api } from "../api.js";
import { cx } from "./ui.jsx";

const LABEL = { connected: "Live", needs_auth: "Sign-in needed", error: "Error" };

function Dot({ on, err }) {
  return <span className={cx("size-2 rounded-full", on ? "bg-accent" : err ? "bg-zomato" : "bg-muted")} />;
}

const pill = "flex items-center gap-2 rounded-full border border-line bg-bg py-1.5 pl-3 pr-2 text-[13px]";
const pillBtn = "cursor-pointer rounded-full border border-line bg-panel px-2.5 py-1 text-xs font-semibold disabled:opacity-50";

export function Header({ status, onChanged, toast }) {
  const [busy, setBusy] = useState(null);

  async function connect(p) {
    setBusy(p);
    try {
      const r = await api(`/api/connect/${p}`, {});
      if (r.authUrl) {
        toast("Opening sign-in page. Approve there and you'll come back here.");
        location.href = r.authUrl;
        return;
      }
      toast(r.status === "connected" ? `${p} connected` : `Couldn't connect to ${p}: ${r.status}. Using demo data.`);
    } catch (err) {
      toast(`Couldn't connect to ${p}: ${err.message}. Using demo data.`);
    }
    setBusy(null);
    onChanged();
  }

  async function disconnect(p) {
    setBusy(p);
    await api(`/api/disconnect/${p}`, {}).catch((err) => toast(err.message));
    setBusy(null);
    onChanged();
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-panel px-4 py-3.5 md:px-6 md:py-[18px]">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-accent text-[22px] font-extrabold text-accent-ink">₹</span>
        <div>
          <h1 className="m-0 text-xl font-bold tracking-tight">Food Deals</h1>
          <p className="m-0 mt-0.5 text-[13px] text-muted">Cheapest food & best offers across Swiggy and Zomato, decided for you.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {status &&
          Object.entries(status.platforms).map(([p, s]) => {
            const live = s.status === "connected";
            return (
              <div key={p} className={pill} title={s.error ?? ""}>
                <Dot on={live} err={s.status === "error"} />
                <b>{s.label}</b> {LABEL[s.status] ?? "Demo data"}
                <button className={pillBtn} disabled={busy === p} onClick={() => (live ? disconnect(p) : connect(p))}>
                  {busy === p ? (live ? "…" : "Connecting…") : live ? "Disconnect" : "Connect"}
                </button>
              </div>
            );
          })}
        {status && (
          <div className={cx(pill, "pr-3")}>
            <Dot on={status.ai} />
            <b>AI</b> {status.ai ? "On" : "Off"}
          </div>
        )}
      </div>
    </header>
  );
}
