import React from 'react';
import { formatMassCo2Eq } from '../utils/carbonUnits.js';
import { fmtGco2 } from '../utils/format.js';

const TIERS = [
  { key: '1k', hits: 1000, label: '1K hits' },
  { key: '100k', hits: 100000, label: '100K hits' },
  { key: '1m', hits: 1000000, label: '1M hits' },
];

export default function ScaledEmissionsCard({ sciBefore, totalSciDeltaEstimated, effectiveMultiplier }) {
  const B = Number(sciBefore);
  const D = totalSciDeltaEstimated != null ? Number(totalSciDeltaEstimated) : null;
  const hasAfter = D != null && Number.isFinite(D);

  const sciAfter = hasAfter ? Math.max(0, B + D) : B;

  if (!Number.isFinite(B) || B < 0) return null;

  const viewPairs = TIERS.map(({ key, hits, label }) => {
    const mb = hits * B;
    const ma = hits * sciAfter;
    const savings = hasAfter ? mb - ma : null;
    return { key, label, hits, mb, ma, savings };
  });

  const summaryBefore = effectiveMultiplier * B;
  const summaryAfter = effectiveMultiplier * (hasAfter ? sciAfter : B);
  const summarySavings = hasAfter ? summaryBefore - summaryAfter : null;

  const fmtMass = (g) => formatMassCo2Eq(g);

  const colStyle = {
    flex: 1,
    minWidth: 100,
    padding: '14px 12px',
    background: 'var(--bg-surface-lo)',
    borderRadius: 'var(--r-md)',
    border: '1px solid var(--border-muted)',
    textAlign: 'center',
  };

  return (
    <div className="chart-card" style={{ padding: '16px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="material-symbols-outlined sz-16">stacked_bar_chart</span>
        Scaled emissions (SCI × executions)
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {viewPairs.map((row) => (
          <div key={row.key} style={colStyle}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{row.label}</div>
            {hasAfter ? (
              <>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Before</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                  <strong>{fmtMass(row.mb).value}</strong> <span style={{ fontSize: 10 }}>{fmtMass(row.mb).unit}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>After</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                  <strong>{fmtMass(row.ma).value}</strong> <span style={{ fontSize: 10 }}>{fmtMass(row.ma).unit}</span>
                </div>
              </>
            ) : (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, marginBottom: 4 }}>
                <strong>{fmtMass(row.mb).value}</strong> <span style={{ fontSize: 11 }}>{fmtMass(row.mb).unit}</span>
              </div>
            )}
            {hasAfter && row.savings != null && row.savings > 1e-9 && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>
                Saved {fmtMass(row.savings).value} {fmtMass(row.savings).unit}
              </div>
            )}
          </div>
        ))}
      </div>

      {hasAfter && D < 0 && (
        <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-muted)' }}>
          Est. ΔSCI (simulations):{' '}
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>{fmtGco2(D)} gCO₂eq</span>{' '}
          · Savings per run ≈ {fmtGco2(Math.abs(D))} gCO₂eq · At selected scale: {fmtGco2(Math.abs(D) * effectiveMultiplier)} gCO₂eq total avoided
          (SCI × {effectiveMultiplier.toLocaleString()} hits).
        </div>
      )}

      {!hasAfter && (
        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-dim)' }}>
          After optimisation column matches before — optimisation delta not estimated for this run.
        </div>
      )}

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>At your selected scale ({effectiveMultiplier.toLocaleString()} hits)</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          <span>
            Before: <strong>{formatMassCo2Eq(summaryBefore).value}</strong> {formatMassCo2Eq(summaryBefore).unit}
          </span>
          <span>
            After: <strong>{formatMassCo2Eq(summaryAfter).value}</strong> {formatMassCo2Eq(summaryAfter).unit}
          </span>
          {hasAfter && summarySavings != null && summarySavings > 1e-9 && (
            <span style={{ color: 'var(--green)' }}>
              Saved {formatMassCo2Eq(summarySavings).value} {formatMassCo2Eq(summarySavings).unit}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
