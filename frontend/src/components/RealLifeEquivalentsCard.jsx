import React, { useMemo } from 'react';
import { useScaleMultiplier } from '../context/ScaleMultiplierContext.jsx';
import { pickEquivalents } from '../utils/realLifeEquivalents.js';

export default function RealLifeEquivalentsCard({
  sciBefore,
}) {
  const { effectiveMultiplier } = useScaleMultiplier();

  const rows = useMemo(() => {
    const B = Number(sciBefore);
    if (!Number.isFinite(B)) return [];
    let sciPick = B;
    if (sciPick < 0) sciPick = 0;
    const gScaled = sciPick * effectiveMultiplier;
    return pickEquivalents(gScaled);
  }, [sciBefore, effectiveMultiplier]);

  if (!rows.length) return null;

  return (
    <div className="chart-card" style={{ padding: '16px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="material-symbols-outlined sz-16">public</span>
        Real-life equivalents
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
        At {effectiveMultiplier.toLocaleString()}× execution intensity (measured SCI baseline).
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((r, i) => (
          <li key={`${r.icon}-${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span className="material-symbols-outlined sz-18" style={{ color: 'var(--cyan)', marginTop: 2 }}>
              {r.icon}
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>{r.sentence}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
