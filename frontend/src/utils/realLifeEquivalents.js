/**
 * Reference intensities (PM literals). Derivation comments per phase3-visuals-plan.
 */
export const DRIVING_KM_PER_G = 0.000192; // gCO₂ per metre driven → km = G / (0.000192 × 1000) = G / 0.192

export const FLIGHT_HOURS_PER_G = 0.000000255; // hours ≈ G × this (economy-seat proxy per plan)

export const SMARTPHONE_CHARGES = 8.22; // gCO₂ per full charge estimate

/** PM literal; comment mentions ~0.909 g/h for 10 W LED — we use grams per hour for bulb time below. */
export const LED_BULB_HOURS = 0.00909;

/** Effective LED grams per hour: resolve PM numeric vs prose (0.909 g/h): use prose for readability. */
const LED_GRAMS_PER_HOUR = 0.909;

export const TREE_ABSORBED_PER_YEAR = 21000;

export const TREE_ABSORBED_PER_DAY = 57.5;

export const STREAMING_MINUTES = 0.036; // gCO₂ per minute

export const COFFEE_CUPS = 200;

export const GOOGLE_SEARCHES = 0.2;

export function drivingKmFromG(g) {
  if (g == null || g <= 0) return 0;
  const gPerKm = DRIVING_KM_PER_G * 1000;
  if (!gPerKm) return 0;
  return g / gPerKm;
}

export function googleSearchesFromG(g) {
  if (!GOOGLE_SEARCHES || g <= 0) return 0;
  return g / GOOGLE_SEARCHES;
}

export function smartphoneChargeFraction(g) {
  if (!SMARTPHONE_CHARGES || g <= 0) return 0;
  return g / SMARTPHONE_CHARGES;
}

export function streamingMinutes(g) {
  if (!STREAMING_MINUTES || g <= 0) return 0;
  return g / STREAMING_MINUTES;
}

export function coffeeCupFraction(g) {
  if (!COFFEE_CUPS || g <= 0) return 0;
  return g / COFFEE_CUPS;
}

export function flightHours(g) {
  if (g <= 0) return 0;
  return g * FLIGHT_HOURS_PER_G;
}

export function bulbHours(g) {
  if (!LED_GRAMS_PER_HOUR || g <= 0) return 0;
  return g / LED_GRAMS_PER_HOUR;
}

export function bulbMinutes(g) {
  return bulbHours(g) * 60;
}

export function treeAbsorptionDays(g) {
  if (!TREE_ABSORBED_PER_DAY || g <= 0) return 0;
  return g / TREE_ABSORBED_PER_DAY;
}

export function treeAbsorptionWeeks(g) {
  return treeAbsorptionDays(g) / 7;
}

/** Format count for readable 0.1–999 range (significant digits). */
function fmtQty(n, maxDecimals = 1) {
  if (n <= 0) return null;
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  if (n >= 1) return n.toFixed(1);
  if (n >= 0.1) return n.toFixed(maxDecimals);
  return n.toPrecision(2);
}

/**
 * @returns {{ icon: string, sentence: string }[]}
 */
export function pickEquivalents(gScaledGrams) {
  const G = Number(gScaledGrams);
  if (G == null || Number.isNaN(G) || G <= 0) {
    return [{ icon: 'eco', sentence: 'Carbon estimate rounds to zero at this resolution.' }];
  }

  const out = [];

  if (G < 1) {
    const s = fmtQty(googleSearchesFromG(G));
    if (s) out.push({ icon: 'search', sentence: `Equivalent to about ${s} Google searches.` });
    const ch = fmtQty(smartphoneChargeFraction(G));
    if (ch) out.push({ icon: 'smartphone', sentence: `Equivalent to about ${ch} of a smartphone full charge.` });
    const led = fmtQty(bulbMinutes(G));
    if (led) out.push({ icon: 'lightbulb', sentence: `Equivalent to about ${led} minutes of a 10 W LED bulb.` });
    return out.slice(0, 3).length ? out.slice(0, 3) : [{ icon: 'eco', sentence: 'Impact is smaller than everyday reference equivalents at this scale.' }];
  }

  if (G < 100) {
    const ch = fmtQty(smartphoneChargeFraction(G));
    if (ch) out.push({ icon: 'smartphone', sentence: `Equivalent to about ${ch} smartphone full charges.` });
    const m = fmtQty(streamingMinutes(G));
    if (m) out.push({ icon: 'play_circle', sentence: `Equivalent to about ${m} minutes of HD streaming.` });
    const c = fmtQty(coffeeCupFraction(G));
    if (c) out.push({ icon: 'local_cafe', sentence: `Equivalent to about ${c} cups of brewed coffee.` });
    return out.slice(0, 3).length ? out.slice(0, 3) : [{ icon: 'eco', sentence: 'Impact is modest at this scale.' }];
  }

  if (G <= 10_000) {
    const km = fmtQty(drivingKmFromG(G));
    if (km) out.push({ icon: 'directions_car', sentence: `Equivalent to driving roughly ${km} km in a petrol car.` });
    const d = fmtQty(treeAbsorptionDays(G));
    if (d) out.push({ icon: 'forest', sentence: `About ${d} tree-days of typical CO₂ absorption.` });
    const h = fmtQty(bulbHours(G), 2);
    if (h && out.length < 3) out.push({ icon: 'lightbulb', sentence: `Equivalent to roughly ${h} hours of a 10 W LED bulb.` });
    return out.slice(0, 3);
  }

  const km = fmtQty(drivingKmFromG(G));
  if (km) out.push({ icon: 'directions_car', sentence: `Equivalent to driving roughly ${km} km in a petrol car.` });
  const w = fmtQty(treeAbsorptionWeeks(G));
  if (w) out.push({ icon: 'forest', sentence: `About ${w} tree-weeks of typical CO₂ absorption.` });
  const fh = fmtQty(flightHours(G));
  if (fh) out.push({ icon: 'flight', sentence: `Equivalent to about ${fh} hours of economy-seat flight intensity (reference model).` });
  return out.slice(0, 3).filter(Boolean);
}
