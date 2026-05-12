import React, { useMemo } from 'react';
import { fmtGco2 } from '../utils/format.js';

export default function SciBeforeAfterBarChart({ sciBefore, totalSciDeltaEstimated, compact }) {
  const { B, sciAfter, hasAfter, improvement } = useMemo(() => {
    const B = Number(sciBefore);
    if (!Number.isFinite(B)) return { B: null, sciAfter: null, hasAfter: false, improvement: null };

    const D = totalSciDeltaEstimated;
    if (D != null && Number.isFinite(Number(D))) {
      const rawAfter = B + Number(D);
      const sciAfter = Math.max(0, rawAfter);
      return { B, sciAfter, hasAfter: true, improvement: sciAfter < B };
    }
    return { B, sciAfter: null, hasAfter: false, improvement: null };
  }, [sciBefore, totalSciDeltaEstimated]);

  if (B == null) {
    return (
      <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: compact ? 0 : 16 }}>
        SCI values unavailable — analyse the query first.
      </p>
    );
  }

  const pct = hasAfter && B > 0 ? (((B - sciAfter) / B) * 100).toFixed(1) : null;

  return (
    <div style={{ marginBottom: compact ? 8 : 20 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 10 }}>
        SCI before vs after optimisation (gCO₂eq / query)
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {/* Before */}
        <div style={{
          padding: '14px 16px',
          background: 'var(--bg-surface-lo)',
          borderRadius: 'var(--r-md)',
          border: '1px solid var(--border-muted)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>Before</div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700,
            color: 'var(--cyan)',
          }}>
            {fmtGco2(B)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>gCO₂eq / query</div>
        </div>

        {/* After */}
        <div style={{
          padding: '14px 16px',
          background: 'var(--bg-surface-lo)',
          borderRadius: 'var(--r-md)',
          border: hasAfter
            ? `1px solid ${improvement ? 'rgba(0,255,136,0.3)' : 'rgba(255,180,0,0.3)'}`
            : '1px solid var(--border-muted)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
            After (predicted)
          </div>
          {hasAfter ? (
            <>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700,
                color: improvement ? 'var(--green)' : 'var(--amber)',
              }}>
                {fmtGco2(sciAfter)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>gCO₂eq / query</div>
              {pct != null && Number(pct) > 0 && (
                <div style={{
                  marginTop: 8, fontSize: 11, fontFamily: 'var(--font-mono)',
                  color: 'var(--green)',
                }}>
                  ↓ {pct}% reduction
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 500,
                color: 'var(--text-dim)',
              }}>
                —
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.5 }}>
                Pending simulation. Install hypopg / pg_hint_plan on the target DB to get a predicted value.
              </div>
            </>
          )}
        </div>
      </div>

      {hasAfter && (
        <div style={{
          marginTop: 8, padding: '8px 12px',
          background: 'var(--bg-code)', borderRadius: 'var(--r-sm)',
          fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
          display: 'flex', gap: 16,
        }}>
          <span>Δ {fmtGco2(totalSciDeltaEstimated)} gCO₂eq per query</span>
          {pct != null && <span>({pct}% {improvement ? 'saved' : 'increase'})</span>}
        </div>
      )}
    </div>
  );
}
