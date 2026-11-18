import { test } from "node:test";
import assert from "node:assert/strict";
import { finalPrice } from "../engine/pricing.js";
import { similarity, groupAcrossPlatforms } from "../engine/matcher.js";
import { demoListings } from "../providers/demo.js";
import { priceAll } from "../engine/pricing.js";

const base = { price: 200, deliveryFee: 30, packagingFee: 10, platformFee: 10 };

test("percent offer respects the cap", () => {
  const p = finalPrice({ ...base, offer: { type: "percent", pct: 60, max: 100, minOrder: 0, label: "60%" } });
  assert.equal(p.discount, 100);
  assert.equal(p.total, 200 - 100 + 50);
});

test("flat offer needs the minimum order", () => {
  const p = finalPrice({ ...base, offer: { type: "flat", amount: 75, minOrder: 249, label: "Flat 75" } });
  assert.equal(p.discount, 0);
  assert.match(p.offerNote, /Add ₹49 more/);
});

test("free delivery removes the delivery fee", () => {
  const p = finalPrice({ ...base, offer: { type: "freeDelivery", minOrder: 0, label: "Free del" } });
  assert.equal(p.total, 200 + 20);
});

test("BOGO halves the per-item price", () => {
  const p = finalPrice({ ...base, offer: { type: "bogo", minOrder: 0, label: "BOGO" } });
  assert.equal(p.units, 2);
  assert.equal(p.perUnit, Math.round(250 / 2));
});

test("estimated (Zomato) offers are shown, not baked into the price", async () => {
  const { parseOffer } = await import("../providers/zomatoLive.js");
  const o = parseOffer("60% OFF up to ₹120");
  assert.deepEqual([o.type, o.pct, o.max, o.estimated], ["percent", 60, 120, true]);
  assert.equal(parseOffer("Flat ₹75 OFF").amount, 75);
  const p = finalPrice({ price: 300, offer: o });
  assert.equal(p.total, 300);
  assert.equal(p.estTotal, 180);
  assert.match(p.offerNote, /≈₹180 if eligible/);
});

test("matcher treats name variants as the same dish", () => {
  assert.ok(similarity("Chicken Dum Biryani", "Chkn Dum Biryani") >= 0.6);
  assert.ok(similarity("Veg Biryani", "Mutton Biryani") < 0.6);
});

test("a burger is never matched with its combo or a bigger size", async () => {
  const { sameDish } = await import("../engine/matcher.js");
  assert.equal(sameDish("McAloo Tikki Burger", "McAloo Tikki Burger Combo"), false);
  assert.equal(sameDish("Chicken Biryani", "Chicken Biryani (Serves 2)"), false);
  assert.equal(sameDish("Crispy Chicken Burger (VR)", "Crispy Chicken Burger (VR)"), true);
  const { shortArea, cityOf } = await import("../engine/area.js");
  assert.equal(cityOf(shortArea("12, MG Road, Pattom, Thiruvananthapuram, Kerala 695033, India")), "thiruvananthapuram");
});

test("demo data groups into one row per dish with both platforms", () => {
  const all = priceAll([...demoListings("swiggy"), ...demoListings("zomato")]);
  const rows = groupAcrossPlatforms(all);
  assert.equal(rows.length, all.length / 2);
  assert.ok(rows.every((r) => r.byPlatform.swiggy && r.byPlatform.zomato));
});

test("a flat offer bigger than the dish isn't shown as a near-free price", async () => {
  const { finalPrice } = await import("../engine/pricing.js");
  const { parseOffer } = await import("../providers/zomatoLive.js");
  const p = finalPrice({ price: 30, offer: parseOffer("Flat ₹75 OFF") });
  assert.equal(p.total, 30);
  assert.equal(p.estTotal, null);
  assert.equal(p.offerNote, "Flat ₹75 OFF on a bigger order");
});
