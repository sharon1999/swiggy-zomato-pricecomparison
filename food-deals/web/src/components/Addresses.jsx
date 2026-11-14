import { useCallback, useEffect, useState } from "react";
import { api, cityOf } from "../api.js";
import { Plat, cx } from "./ui.jsx";

/** Delivery address picker per connected platform, with a same-city check. */
export function Addresses({ status, onChanged, toast }) {
  const livePlats = Object.entries(status?.platforms ?? {})
    .filter(([, s]) => s.status === "connected")
    .map(([p]) => p);
  const key = livePlats.join(",");
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    const out = await Promise.all(
      (key ? key.split(",") : []).map(async (p) => {
        try {
          return { p, ...(await api(`/api/${p}/addresses`)) };
        } catch (err) {
          toast(`Couldn't load ${p} addresses: ${err.message}`);
          return null;
        }
      }),
    );
    setRows(out.filter(Boolean));
  }, [key, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function choose(p, id) {
    try {
      await api(`/api/${p}/address`, { id });
    } catch (err) {
      toast(err.message);
    }
    await load();
    onChanged(p);
  }

  if (!rows.length) return null;
  const cities = rows.map((r) => cityOf(r.addresses.find((a) => a.id === r.selected)?.area ?? ""));
  const mismatch = rows.length === 2 && cities[0] && cities[1] && cities[0] !== cities[1];

  return (
    <div className="mt-2.5 grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-x-3 gap-y-1.5">
      {rows.map((r) => (
        <label key={r.p} className="flex min-w-0 items-center gap-2 text-[13px] text-muted">
          <Plat p={r.p} />
          <select
            className={cx(
              "min-w-0 max-w-full flex-1 rounded-lg border bg-panel px-2 py-1.5 text-ink",
              mismatch ? "border-warn" : "border-line",
            )}
            value={r.selected ?? ""}
            onChange={(e) => choose(r.p, e.target.value)}
          >
            {r.addresses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
                {a.area ? ` · ${a.area}` : ""}
              </option>
            ))}
          </select>
        </label>
      ))}
      {mismatch && (
        <div className="col-span-full text-xs text-warn">
          Your Swiggy and Zomato addresses are in different cities, so prices won't be comparable. Pick the same place for both.
        </div>
      )}
    </div>
  );
}
