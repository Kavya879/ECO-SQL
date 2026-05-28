import React from 'react';
import { formatMassCo2Eq } from '../utils/carbonUnits.js';

const TIERS = [
  { key: '1k', hits: 1000, label: '1K hits' },
  { key: '100k', hits: 100000, label: '100K hits' },
  { key: '1m', hits: 1000000, label: '1M hits' },
];

export default function ScaledEmissionsCard({ sciBefore, effectiveMultiplier }) {
  const B = Number(sciBefore);

  if (!Number.isFinite(B) || B < 0) return null;

  const viewPairs = TIERS.map(({ key, hits, label }) => {
    const mb = hits * B;
    return { key, label, hits, mb };
  });

  const summaryBefore = effectiveMultiplier * B;

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
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Measured</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, marginBottom: 4 }}>
              <strong>{fmtMass(row.mb).value}</strong> <span style={{ fontSize: 11 }}>{fmtMass(row.mb).unit}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-dim)' }}>
        Measured-only mode: after-optimization values appear only when you run the improved query and capture a real SCI.
      </div>

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>At your selected scale ({effectiveMultiplier.toLocaleString()} hits)</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          <span>
            Measured total: <strong>{formatMassCo2Eq(summaryBefore).value}</strong> {formatMassCo2Eq(summaryBefore).unit}
          </span>
        </div>
      </div>
    </div>
  );
}
