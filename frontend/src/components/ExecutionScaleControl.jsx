import React from 'react';
import { useScaleMultiplier } from '../context/ScaleMultiplierContext.jsx';

const presets = [
  { id: 'single', label: 'Single execution', mult: 1 },
  { id: 'k1', label: '1K hits', mult: 1000 },
  { id: 'k100k', label: '100K hits', mult: 100000 },
  { id: 'm1', label: '1M hits', mult: 1000000 },
];

export default function ExecutionScaleControl() {
  const { preset, customCount, updateFromControl } = useScaleMultiplier();

  return (
    <div
      className="chart-card"
      style={{
        marginBottom: 12,
        padding: '12px 14px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Execution scale</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`sev-chip all${preset === p.id ? ' active' : ''}`}
            onClick={() => updateFromControl({ preset: p.id })}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className={`sev-chip all${preset === 'custom' ? ' active' : ''}`}
          onClick={() =>
            updateFromControl({
              preset: 'custom',
              customCount: String(customCount || '').trim() ? customCount : '340000',
            })
          }
        >
          Custom
        </button>
      </div>
      {preset === 'custom' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          Hit count
          <input
            type="number"
            min={1}
            step={1}
            className="input input-mono"
            style={{ width: 140, height: 32 }}
            value={customCount}
            placeholder="e.g. 340000"
            onChange={(e) => updateFromControl({ preset: 'custom', customCount: e.target.value })}
          />
        </label>
      )}
    </div>
  );
}
