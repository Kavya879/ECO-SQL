import React, { useMemo, useState } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ZAxis,
  ResponsiveContainer,
} from 'recharts';
import { fmtGco2 } from '../utils/format.js';

/** @param {{ points?: Array<{ runFrequency: number, avgSciGco2eqPerQuery: number, snippet?: string }> }} props */

export default function QueryVolumeSciScatter({ points = [] }) {
  const [logX, setLogX] = useState(false);

  const data = useMemo(() => points.map((p) => ({
    xv: logX ? Math.log10(1 + p.runFrequency) : p.runFrequency,
    yv: p.avgSciGco2eqPerQuery || 0,
    snip: (p.snippet || '').slice(0, 200),
    freq: p.runFrequency,
  })), [points, logX]);

  if (!data.length) {
    return (
      <div className="empty-state" style={{ flex: 1, minHeight: 200 }}>
        <span className="material-symbols-outlined empty-icon">bubble_chart</span>
        <div className="empty-text">No history yet for volume vs SCI. Analyze queries to populate this chart.</div>
      </div>
    );
  }

  const lowVolume = points.length > 1 && points.every((p) => Number(p.runFrequency) <= 2);

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={logX} onChange={(e) => setLogX(e.target.checked)} />
          Log₁₀ axis for run count
        </label>
        {points.length <= 5 && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Grouped by identical SQL fingerprint</span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ left: -10, right: 16, bottom: 8, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(59,75,61,0.35)" />
          <XAxis
            type="number"
            dataKey="xv"
            name={logX ? 'log₁₀(1+runs)' : 'Runs'}
            tick={{ fill: '#849585', fontSize: 10, fontFamily: 'var(--font-mono)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="number"
            dataKey="yv"
            name="SCI"
            tick={{ fill: '#849585', fontSize: 10, fontFamily: 'var(--font-mono)' }}
            axisLine={false}
            tickLine={false}
            label={{ value: 'Avg SCI gCO₂eq/run', angle: -90, position: 'insideLeft', fill: '#849585', fontSize: 10 }}
          />
          <ZAxis range={[48, 48]} />
          <Tooltip
            cursor={{ strokeDasharray: '3 3', stroke: 'var(--cyan)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const dot = payload[0].payload;
              return (
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '10px 12px',
                  maxWidth: 360,
                  fontSize: 12,
                }}>
                  <div style={{ color: 'var(--text-muted)', marginBottom: 6 }}>
                    {dot.freq?.toLocaleString()} runs · avg SCI {fmtGco2(dot.yv)} gCO₂eq
                  </div>
                  <pre style={{
                    whiteSpace: 'pre-wrap',
                    margin: 0,
                    fontSize: 10,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-dim)',
                    maxHeight: 120,
                    overflow: 'auto',
                  }}>{dot.snip || '(no snippet)'}</pre>
                </div>
              );
            }}
          />
          <Scatter name="queries" data={data} fill="var(--green)" shape="circle" />
        </ScatterChart>
      </ResponsiveContainer>
      {lowVolume && (
        <p style={{ marginTop: 8, fontSize: 11, color: 'var(--text-dim)' }}>
          Most points show low run counts — rerun the same fingerprint to accumulate volume on the horizontal axis.
        </p>
      )}
    </div>
  );
}
