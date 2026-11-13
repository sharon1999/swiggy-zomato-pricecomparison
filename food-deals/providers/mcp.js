// Live connection to the official Swiggy / Zomato MCP servers.
//
// Each platform runs its own MCP server and signs the user in with OAuth.
// Your password never touches this app; we only keep the access token
// (in data/tokens.json, on your machine).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";

export const MCP_SERVERS = {
  swiggy: { url: "https://mcp.swiggy.com/food", label: "Swiggy Food" },
  zomato: { url: "https://mcp-server.zomato.com/mcp", label: "Zomato" },
};

const STORE = path.resolve("data/tokens.json");

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE, "utf8"));
  } catch {
    return {};
  }
}
function writeStore(patch) {
  const all = { ...readStore(), ...patch };
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(all, null, 2), { mode: 0o600 });
}

/** OAuth client provider that persists to a local JSON file, one slot per platform. */
class LocalOAuthProvider {
  constructor(platform, redirectUrl) {
    this.platform = platform;
    this._redirectUrl = redirectUrl;
    this.pendingAuthUrl = null;
  }
  _get() {
    return readStore()[this.platform] ?? {};
  }
  _set(patch) {
    writeStore({ [this.platform]: { ...this._get(), ...patch } });
  }
  get redirectUrl() {
    return this._redirectUrl;
  }
  get clientMetadata() {
    return {
      client_name: "Food Deals (personal)",
      redirect_uris: [this._redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  state() {
    // "<platform>.<random>": tells /callback which platform is finishing
    // sign-in, and is long/random enough for strict OAuth servers (Zomato).
    const s = `${this.platform}.${crypto.randomBytes(16).toString("hex")}`;
    this._set({ state: s });
    return s;
  }
  checkState(s) {
    return s && s === this._get().state;
  }
  clientInformation() {
    return this._get().client;
  }
  saveClientInformation(info) {
    this._set({ client: info });
  }
  tokens() {
    return this._get().tokens;
  }
  saveTokens(tokens) {
    this._set({ tokens });
  }
  redirectToAuthorization(url) {
    // We're a server, not a browser: hand the URL to the UI to open.
    this.pendingAuthUrl = url.toString();
  }
  saveCodeVerifier(v) {
    this._set({ verifier: v });
  }
  codeVerifier() {
    return this._get().verifier;
  }
  invalidateCredentials(scope) {
    const cur = this._get();
    if (scope === "all") writeStore({ [this.platform]: {} });
    else if (scope === "tokens") this._set({ ...cur, tokens: undefined });
    else if (scope === "client") this._set({ ...cur, client: undefined });
    else if (scope === "verifier") this._set({ ...cur, verifier: undefined });
  }
}

export class McpPlatform {
  constructor(platform, redirectUrl) {
    this.platform = platform;
    this.server = MCP_SERVERS[platform];
    this.auth = new LocalOAuthProvider(platform, redirectUrl);
    this.client = null;
    this.transport = null;
    this.tools = [];
    this.status = "disconnected"; // disconnected | needs_auth | connected | error
    this.error = null;
  }

  get connected() {
    return this.status === "connected";
  }

  _newTransport() {
    return new StreamableHTTPClientTransport(new URL(this.server.url), { authProvider: this.auth });
  }

  /** Try to connect. Returns { status, authUrl? }. */
  async connect() {
    this.error = null;
    this.auth.pendingAuthUrl = null;
    this.transport = this._newTransport();
    this.client = new Client({ name: "food-deals", version: "1.0.0" });
    try {
      await this.client.connect(this.transport);
      const { tools } = await this.client.listTools();
      this.tools = tools;
      this.status = "connected";
      return { status: this.status };
    } catch (err) {
      if (err instanceof UnauthorizedError || this.auth.pendingAuthUrl) {
        this.status = "needs_auth";
        return { status: this.status, authUrl: this.auth.pendingAuthUrl };
      }
      this.status = "error";
      this.error = err.message;
      return { status: this.status, error: err.message };
    }
  }

  /** Called from /callback after the user approves in the platform's sign-in page. */
  async finishAuth(code) {
    if (!this.transport) this.transport = this._newTransport();
    await this.transport.finishAuth(code);
    return this.connect();
  }

  /** Reconnect silently on startup if we already hold a token. */
  async resume() {
    if (this.auth.tokens()) await this.connect();
    return this.status;
  }

  async disconnect() {
    try {
      await this.client?.close();
    } catch {}
    this.auth.invalidateCredentials("all");
    this.status = "disconnected";
    this.tools = [];
  }

  async callTool(name, args) {
    if (!this.connected) throw new Error(`${this.server.label} is not connected`);
    const res = await this.client.callTool({ name, arguments: args ?? {} });
    const text = (res.content ?? [])
      .map((c) => (c.type === "text" ? c.text : `[${c.type}]`))
      .join("\n");
    return { isError: !!res.isError, text, structured: res.structuredContent };
  }

  /** Best-guess "search dishes/restaurants" tool, for the plain search bar. */
  findSearchTool() {
    const scored = this.tools
      .map((t) => {
        const n = t.name.toLowerCase();
        let s = 0;
        if (n.includes("search")) s += 3;
        if (/dish|item|menu|food/.test(n)) s += 2;
        if (n.includes("restaurant")) s += 1;
        return { t, s };
      })
      .filter((x) => x.s >= 3)
      .sort((a, b) => b.s - a.s);
    return scored[0]?.t ?? null;
  }
}

/** Is this MCP tool one that spends money or commits an order? Those need a human "yes". */
export function isRiskyTool(name) {
  const n = name.toLowerCase();
  if (/^(get|list|search|track|fetch|view|show|check|report)/.test(n)) return false;
  // Anything that orders, pays, books, or changes your real cart/addresses.
  return /(place|confirm|checkout|submit|pay|book|cancel|delete|create|flush|update|apply|bind)/.test(n);
}
