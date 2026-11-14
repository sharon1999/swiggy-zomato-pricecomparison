/** GET (no body) or POST JSON. Throws on HTTP errors and `{ error }` replies,
 *  except order replies that carry `failed` / `uncertain` (shown in the cart). */
export async function api(url, body) {
  const res = await fetch(
    url,
    body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j.error && !j.failed && !j.uncertain)) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

/** POST and read a newline-delimited JSON stream, calling onEvent per line. */
export async function streamNdjson(url, body, onEvent) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim()) onEvent(JSON.parse(line));
    }
  }
}

export const rs = (n) => `₹${Math.round(n)}`;

export const cityOf = (area = "") =>
  (area.split(",").pop() ?? "").trim().toLowerCase().replace("bangalore", "bengaluru").replace("trivandrum", "thiruvananthapuram");
