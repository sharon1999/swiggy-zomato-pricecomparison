// Turn a long saved-address string into "Locality, City" (no house number,
// state, PIN or country), so the address pickers are short and the two
// platforms' cities can be compared.

const STATES = new Set([
  "india", "kerala", "karnataka", "tamil nadu", "maharashtra", "gujarat", "telangana", "andhra pradesh",
  "delhi", "new delhi", "haryana", "uttar pradesh", "west bengal", "rajasthan", "punjab", "goa", "odisha",
  "madhya pradesh", "bihar", "assam", "jharkhand", "chhattisgarh", "uttarakhand", "himachal pradesh",
]);

export function shortArea(line = "") {
  const parts = line
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((p) => !/\d{5,}/.test(p) && !STATES.has(p.toLowerCase().replace(/\s+\d+$/, "")));
  return parts.slice(-2).join(", ");
}

export function cityOf(area = "") {
  const c = area.split(",").pop()?.trim().toLowerCase() ?? "";
  return c.replace("bangalore", "bengaluru").replace("trivandrum", "thiruvananthapuram");
}
