import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";

let client = null;

/** True when an API key (or other Anthropic credential) is configured. */
export function aiAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Messages call with server-side refusal fallback turned on: if Opus 5.5
 * declines for policy reasons, the API retries on a fallback model in the
 * same call instead of returning nothing.
 */
export function createMessage(params) {
  return getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    ...params,
  });
}
