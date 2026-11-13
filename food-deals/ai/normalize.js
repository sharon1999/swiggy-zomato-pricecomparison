// Live MCP servers return results in their own format. This turns them into
// the app's common listing shape so the search page can price and compare them.

import { aiAvailable, createMessage } from "./claude.js";

const LISTING_SCHEMA = {
  type: "object",
  properties: {
    listings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          restaurant: { type: "string" },
          dish: { type: "string" },
          price: { type: "number", description: "Current item price in rupees" },
          originalPrice: { type: ["number", "null"], description: "Strike-through price if discounted" },
          veg: { type: "boolean" },
          rating: { type: ["number", "null"] },
          etaMins: { type: ["number", "null"] },
          deliveryFee: { type: ["number", "null"] },
          offerLabel: { type: ["string", "null"], description: "Offer text exactly as shown, e.g. '50% OFF up to ₹100'" },
          offerType: { type: ["string", "null"], enum: ["percent", "flat", "bogo", "freeDelivery", null] },
          offerPct: { type: ["number", "null"] },
          offerMax: { type: ["number", "null"] },
          offerAmount: { type: ["number", "null"] },
          offerMinOrder: { type: ["number", "null"] },
        },
        required: ["restaurant", "dish", "price", "originalPrice", "veg", "rating", "etaMins", "deliveryFee", "offerLabel", "offerType", "offerPct", "offerMax", "offerAmount", "offerMinOrder"],
        additionalProperties: false,
      },
    },
  },
  required: ["listings"],
  additionalProperties: false,
};

export async function normalizeLiveResults(platform, query, raw) {
  if (!aiAvailable()) throw new Error("AI key needed to read live results");
  const rawText = typeof raw === "string" ? raw : JSON.stringify(raw);

  const res = await createMessage({
    output_config: { effort: "low", format: { type: "json_schema", schema: LISTING_SCHEMA } },
    messages: [
      {
        role: "user",
        content:
          `Below is raw output from the ${platform} search tool for "${query}". ` +
          `Extract every dish (or, if only restaurants are listed, each restaurant's most relevant dish) ` +
          `with its price and any offer. Use only values present in the data; use null when a field is missing.\n\n` +
          rawText,
      },
    ],
  });
  if (res.stop_reason === "refusal") throw new Error("could not read live results");
  const text = res.content.find((b) => b.type === "text")?.text ?? "{}";
  const { listings = [] } = JSON.parse(text);

  return listings.map((l, i) => ({
    id: `${platform}-live-${i}-${l.dish}`,
    platform,
    source: "live",
    restaurant: l.restaurant,
    dish: l.dish,
    category: query,
    cuisine: [],
    veg: l.veg,
    price: l.price,
    originalPrice: l.originalPrice,
    rating: l.rating,
    etaMins: l.etaMins,
    deliveryFee: l.deliveryFee ?? 0,
    packagingFee: 0,
    platformFee: 0,
    offer: l.offerType
      ? {
          type: l.offerType,
          pct: l.offerPct,
          max: l.offerMax,
          amount: l.offerAmount,
          minOrder: l.offerMinOrder ?? 0,
          label: l.offerLabel ?? "",
        }
      : null,
  }));
}
