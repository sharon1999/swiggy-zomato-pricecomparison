import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { CompareCard, ItemCard, OfferCard } from "./Cards.jsx";
import { Button, Spinner, cx } from "./ui.jsx";

const TABS = [
  ["cheapest", "Cheapest"],
  ["compare", "Swiggy vs Zomato"],
  ["offers", "Top offers today"],
];
const VEG = [
  ["", "All"],
  ["true", "Veg"],
  ["nonveg", "Non-veg"],
];
const field = "rounded-lg border border-line bg-panel px-2 py-1.5 w-[84px]";

export function SearchPanel({ refreshKey, addresses }) {
  const [q, setQ] = useState("");
  const qRef = useRef("");
  qRef.current = q;
  const [submits, setSubmits] = useState(0);
  const [tab, setTab] = useState("cheapest");
  const [veg, setVeg] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [maxDraft, setMaxDraft] = useState("");
  const [minRating, setMinRating] = useState("");
  const [maxEta, setMaxEta] = useState("");
  const [category, setCategory] = useState("");
  const [res, setRes] = useState({ loading: true, tab: "cheapest" });
  const reqId = useRef(0);

  // Re-run on submit, tab, filter, connection or address change (not on every keystroke).
  // Cheapest tab with nothing typed = the home feed: cheapest dishes near you.
  useEffect(() => {
    const id = ++reqId.current;
    const p = new URLSearchParams();
    const query = qRef.current.trim();
    if (query) p.set("q", query);
    if (veg) p.set("veg", veg);
    if (maxPrice) p.set("maxPrice", maxPrice);
    if (minRating) p.set("minRating", minRating);
    if (maxEta) p.set("maxEta", maxEta);
    const isHome = tab === "cheapest" && !query;
    if (isHome && category) p.set("category", category);
    const url = isHome
      ? "/api/home"
      : tab === "cheapest"
        ? (p.set("sort", "price"), "/api/search")
        : tab === "compare"
          ? "/api/compare"
          : "/api/top-offers";
    setRes((r) => ({ ...r, loading: true, home: isHome, tab }));
    api(`${url}?${p}`)
      .then((data) => id === reqId.current && setRes({ loading: false, data, query, home: isHome, tab }))
      .catch((err) => id === reqId.current && setRes({ loading: false, error: err.message, home: isHome, tab }));
  }, [tab, veg, maxPrice, minRating, maxEta, category, refreshKey, submits]);

  const commitMax = () => setMaxPrice(maxDraft.trim());
  const d = res.data;

  const demo = Object.entries(d?.sources ?? {})
    .filter(([, m]) => m === "demo")
    .map(([p]) => p);
  const anyLive = Object.values(d?.sources ?? {}).includes("live");
  const notices = [...(d?.warnings ?? [])];
  if (demo.length && !anyLive) notices.push(`${demo.join(" & ")} showing demo data. Connect at the top for real prices.`);

  // Right after a tab click React renders once with the old tab's data
  // (different shape) before the effect starts the new request: treat as loading.
  const loading = res.loading || res.tab !== tab;
  let body;
  if (loading) {
    body = (
      <div className="col-span-full flex items-center justify-center gap-2 py-8 text-muted">
        <Spinner />
        {res.home && <span className="text-[13px]">Finding the cheapest food near you on Swiggy & Zomato…</span>}
      </div>
    );
  } else if (res.error) {
    body = <Empty>Couldn't load results: {res.error}</Empty>;
  } else if (tab === "cheapest") {
    body = d?.items?.length ? (
      d.items.map((i, k) => <ItemCard key={i.id} i={i} best={k === 0} />)
    ) : (
      <Empty>{res.query || res.home ? "Nothing matches. Try fewer filters." : "Search a dish above, or tap a question on the right, to compare live prices."}</Empty>
    );
  } else if (tab === "compare") {
    body = d?.rows?.length ? d.rows.map((r) => <CompareCard key={`${r.restaurant}:${r.dish}`} row={r} />) : <Empty>Nothing to compare.</Empty>;
  } else {
    body = d?.offers?.length ? (
      d.offers.map((o, k) => <OfferCard key={`${o.platform}:${o.restaurant}`} o={o} first={k === 0} />)
    ) : (
      <Empty>No offers found.</Empty>
    );
  }

  return (
    <section className="min-w-0">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmits((n) => n + 1);
        }}
      >
        <input
          type="search"
          className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-3.5 py-3 outline-none focus:border-accent"
          placeholder="Search a dish, e.g. burger, biryani, pizza"
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button type="submit" variant="primary">
          Search
        </Button>
      </form>

      {addresses}

      <div className="my-3 flex flex-wrap items-center gap-x-3.5 gap-y-2.5 text-[13px] text-muted">
        <div className="inline-flex overflow-hidden rounded-[10px] border border-line bg-panel">
          {VEG.map(([v, label]) => (
            <button
              key={label}
              className={cx("cursor-pointer border-0 px-3 py-1.5", veg === v ? "bg-ink text-panel" : "bg-transparent text-muted")}
              onClick={() => setVeg(v)}
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          Max ₹{" "}
          <input
            className={field}
            type="number"
            min="0"
            step="10"
            placeholder="any"
            value={maxDraft}
            onChange={(e) => setMaxDraft(e.target.value)}
            onBlur={commitMax}
            onKeyDown={(e) => e.key === "Enter" && commitMax()}
          />
        </label>
        <label>
          Rating ≥{" "}
          <select className={field} value={minRating} onChange={(e) => setMinRating(e.target.value)}>
            <option value="">any</option>
            <option>3.5</option>
            <option>4</option>
            <option>4.3</option>
          </select>
        </label>
        <label>
          Within{" "}
          <select className={field} value={maxEta} onChange={(e) => setMaxEta(e.target.value)}>
            <option value="">any</option>
            <option value="25">25 min</option>
            <option value="35">35 min</option>
            <option value="45">45 min</option>
          </select>
        </label>
      </div>

      <nav className="mb-3.5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            className={cx(
              "cursor-pointer whitespace-nowrap border-0 border-b-2 bg-transparent px-3 py-2.5 font-semibold",
              tab === t ? "border-accent text-ink" : "border-transparent text-muted",
            )}
            onClick={() => setTab(t)}
          >
            {label}
          </button>
        ))}
      </nav>

      {res.home && tab === "cheapest" && (
        <HomeHeader data={!loading && d?.home ? d : null} category={category} setCategory={setCategory} />
      )}
      {!loading && notices.length > 0 && (
        <div className="mb-3 rounded-[10px] bg-warn-soft px-3 py-2 text-[13px] text-warn">{notices.join(" ")}</div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">{body}</div>
    </section>
  );
}

/** Title + category chips above the home feed. */
function HomeHeader({ data, category, setCategory }) {
  const live = Object.values(data?.sources ?? {}).includes("live");
  const chips = data?.categories ?? [];
  return (
    <div className="mb-3 grid gap-2">
      <div>
        <h2 className="m-0 text-lg font-bold tracking-tight">Cheapest near you right now</h2>
        <p className="m-0 text-[13px] text-muted">
          {live
            ? `Lowest prices across Swiggy & Zomato from ${data.total} dishes, cheapest first. Search above for something specific.`
            : "Search above for something specific."}
        </p>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {[{ name: "", count: null }, ...chips].map((c) => (
            <button
              key={c.name || "all"}
              className={cx(
                "cursor-pointer rounded-full border px-3 py-1 text-[13px] capitalize",
                category === c.name ? "border-ink bg-ink text-panel" : "border-line bg-panel text-ink hover:border-accent",
              )}
              onClick={() => setCategory(c.name)}
            >
              {c.name || "All"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ children }) {
  return <div className="col-span-full py-8 text-center text-muted">{children}</div>;
}
