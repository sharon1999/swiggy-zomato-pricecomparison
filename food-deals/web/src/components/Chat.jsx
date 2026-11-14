import { Fragment, useEffect, useRef, useState } from "react";
import { streamNdjson } from "../api.js";
import { CompareCard, ItemCard, OfferCard } from "./Cards.jsx";
import { Button, Status, cx } from "./ui.jsx";

const SUGGESTIONS = [
  "Lowest price burgers today",
  "Which shop has the highest offer today?",
  "Best chicken biryani under ₹300",
  "Cheapest veg dinner within 30 min",
  "Is pizza cheaper on Swiggy or Zomato?",
];

/** **bold**, bullet / numbered lists and paragraphs, rendered as React (no innerHTML). */
function Markdown({ text }) {
  const bold = (s) => s.split(/\*\*(.+?)\*\*/g).map((part, k) => (k % 2 ? <b key={k}>{part}</b> : <Fragment key={k}>{part}</Fragment>));
  const blocks = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(?:[-*•]|(\d+)\.)\s+(.*)/);
    if (m) {
      const type = m[1] ? "ol" : "ul";
      const last = blocks.at(-1);
      if (last?.type === type) last.items.push(m[2]);
      else blocks.push({ type, items: [m[2]] });
    } else if (line.trim()) {
      blocks.push({ type: "p", text: line });
    }
  }
  return blocks.map((b, k) =>
    b.type === "p" ? (
      <p key={k} className="m-0 mb-1.5 last:mb-0">
        {bold(b.text)}
      </p>
    ) : (
      (() => {
        const List = b.type;
        return (
          <List key={k} className={cx("mb-1.5 mt-1 pl-5", b.type === "ol" ? "list-decimal" : "list-disc")}>
            {b.items.map((it, j) => (
              <li key={j}>{bold(it)}</li>
            ))}
          </List>
        );
      })()
    ),
  );
}

function ConfirmAction({ ev, onAnswer }) {
  const [answered, setAnswered] = useState(false);
  const answer = (yes) => {
    setAnswered(true);
    onAnswer(yes);
  };
  return (
    <div className="grid gap-2 rounded-xl border-2 border-swiggy p-3">
      <b>Confirm before ordering</b>
      <div className="text-[13px] text-muted">
        {ev.platform} wants to run <b>{ev.action}</b>. Nothing happens until you approve.
      </div>
      <pre className="m-0 max-h-[140px] overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-2 text-[11px]">{JSON.stringify(ev.input, null, 2)}</pre>
      <div className="flex gap-2">
        <Button variant="primary" disabled={answered} onClick={() => answer(true)}>
          Confirm
        </Button>
        <Button disabled={answered} onClick={() => answer(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function Chat({ ai }) {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const session = useRef(null);
  const listRef = useRef(null);
  const nextId = useRef(0);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [entries, status]);

  const push = (e) => setEntries((prev) => [...prev, { id: nextId.current++, ...e }]);

  async function stream(url, body) {
    setBusy(true);
    setStatus("Thinking…");
    const started = performance.now();
    let botOpen = false;
    let gotText = false;
    try {
      await streamNdjson(url, body, (ev) => {
        if (ev.type === "session") session.current = ev.sessionId;
        else if (ev.type === "status") setStatus(ev.text);
        else if (ev.type === "text") {
          const open = botOpen;
          botOpen = gotText = true;
          setEntries((prev) => {
            const last = prev.at(-1);
            if (open && last?.kind === "bot") return [...prev.slice(0, -1), { ...last, text: last.text + ev.delta }];
            return [...prev, { id: nextId.current++, kind: "bot", text: ev.delta }];
          });
        } else if (ev.type === "cards") {
          botOpen = false;
          push({ kind: "cards", ev });
        } else if (ev.type === "confirm") push({ kind: "confirm", ev });
        else if (ev.type === "error") push({ kind: "error", text: ev.text });
      });
    } catch (err) {
      push({ kind: "error", text: `Connection problem: ${err.message}` });
    } finally {
      setStatus(null);
      if (gotText) push({ kind: "timer", text: `⏱ Decided in ${((performance.now() - started) / 1000).toFixed(0)}s` });
      setBusy(false);
    }
  }

  function ask(text) {
    if (!text || busy) return;
    push({ kind: "user", text });
    stream("/api/chat", { sessionId: session.current, message: text });
  }

  return (
    <div className="flex max-h-[calc(100vh-32px)] flex-col gap-3 rounded-[14px] border border-line bg-panel p-4 shadow-card">
      <div>
        <h2 className="m-0 text-base font-bold">Ask the deal finder</h2>
        <p className="m-0 mt-0.5 text-[13px] text-muted">
          {ai ? "Ask in plain words. It checks both apps and picks for you." : "AI is off. Add ANTHROPIC_API_KEY to .env and restart. Search still works."}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            className="cursor-pointer rounded-full border border-line bg-bg px-2.5 py-1.5 text-left text-xs hover:border-accent"
            onClick={() => ask(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <div ref={listRef} className="flex min-h-20 flex-1 flex-col gap-2.5 overflow-y-auto">
        {entries.map((e) => {
          if (e.kind === "user")
            return (
              <div key={e.id} className="max-w-[85%] self-end rounded-xl bg-ink px-3 py-2.5 text-sm text-panel">
                {e.text}
              </div>
            );
          if (e.kind === "bot")
            return (
              <div key={e.id} className="rounded-xl border border-line bg-bg px-3 py-2.5 text-sm">
                <Markdown text={e.text} />
              </div>
            );
          if (e.kind === "error")
            return (
              <div key={e.id} className="rounded-xl bg-zomato-soft px-3 py-2.5 text-sm text-zomato">
                {e.text}
              </div>
            );
          if (e.kind === "timer")
            return (
              <div key={e.id} className="text-[11px] font-semibold text-accent">
                {e.text}
              </div>
            );
          if (e.kind === "confirm")
            return <ConfirmAction key={e.id} ev={e.ev} onAnswer={(yes) => stream("/api/confirm", { sessionId: session.current, approved: yes })} />;
          if (e.kind === "cards") {
            const { ev } = e;
            return (
              <div key={e.id} className="grid gap-1.5">
                {ev.kind === "items" && ev.items.slice(0, 3).map((i, k) => <ItemCard key={i.id} i={i} best={k === 0} mini />)}
                {ev.kind === "offers" && ev.offers.slice(0, 3).map((o, k) => <OfferCard key={k} o={o} first={k === 0} />)}
                {ev.kind === "compare" && ev.rows.slice(0, 2).map((r, k) => <CompareCard key={k} row={r} />)}
              </div>
            );
          }
          return null;
        })}
        {status && <Status>{status}</Status>}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = input.trim();
          setInput("");
          ask(v);
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-3.5 py-3 outline-none focus:border-accent"
          placeholder="e.g. cheapest burger with 4+ rating"
          autoComplete="off"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button variant="primary" type="submit" disabled={busy}>
          Ask
        </Button>
      </form>
    </div>
  );
}
