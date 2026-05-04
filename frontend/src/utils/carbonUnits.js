/**
 * Format mass in gCO₂eq with unit auto-scaling (Features 3–4).
 * Rules: show g for < 1000 g; kg for 1000–999999 g; t for ≥ 1e6 g.
 */
export function formatMassCo2Eq(grams) {
  const g = Number(grams);
  if (g == null || Number.isNaN(g)) {
    return { value: '—', unit: '', numeric: null };
  }
  if (g === 0) return { value: '0', unit: 'gCO₂eq', numeric: 0 };

  const abs = Math.abs(g);
  if (abs >= 1_000_000) {
    const v = g / 1_000_000;
    return { value: v >= 100 ? v.toFixed(1) : v.toFixed(3), unit: 'tCO₂eq', numeric: g };
  }
  if (abs >= 1000) {
    const v = g / 1000;
    return { value: v >= 100 ? v.toFixed(1) : v.toFixed(3), unit: 'kgCO₂eq', numeric: g };
  }
  if (abs < 1) {
    return { value: g.toFixed(6), unit: 'gCO₂eq', numeric: g };
  }
  if (abs < 100) {
    return { value: g.toFixed(4), unit: 'gCO₂eq', numeric: g };
  }
  return { value: g.toFixed(2), unit: 'gCO₂eq', numeric: g };
}
