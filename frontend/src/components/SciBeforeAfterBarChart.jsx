import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { fmtGco2 } from '../utils/format.js';

export default function SciBeforeAfterBarChart({ sciBefore, totalSciDeltaEstimated, compact }) {
  const data = useMemo(() => {
    const B = Number(sciBefore);
    if (!Number.isFinite(B)) return null;

    const D = totalSciDeltaEstimated;
    const rows = [{ name: 'Before', sci: Math.max(B, 0) }];
    if (D != null && Number.isFinite(Number(D))) {
      const rawAfter = B + Number(D);
      rows.push({
        name: 'After (est.)',
        sci: Math.max(0, rawAfter),
        hint: rawAfter < 0 ? 'Rounded to zero for display' : null,
      });
    }
    return rows;
  }, [sciBefore, totalSciDeltaEstimated]);

  if (!data?.length) {
    return (
      <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: compact ? 0 : 16 }}>
        SCI bar chart unavailable — analyse the query first.
      </p>
    );
  }

  const hasAfter = data.length > 1;

  return (
    <div style={{ marginBottom: compact ? 8 : 20, height: compact ? 180 : 220 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600 }}>
        SCI before vs after optimisation (gCO₂eq / query)
      </div>
      {!hasAfter && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
          Estimated after SCI unavailable — enable hypopg / pg_hint_plan or rerun when simulations populate ΔSCI.
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -10, right: 10, bottom: 0, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(59,75,61,0.35)" />
          <XAxis dataKey="name" tick={{ fill: '#849585', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fill: '#849585', fontSize: 10, fontFamily: 'var(--font-mono)' }}
            axisLine={false}
            tickLine={false}
            label={{ value: 'gCO₂eq', angle: -90, position: 'insideLeft', fill: '#849585', fontSize: 10 }}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload;
              return (
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  padding: '8px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                }}>
                  <div>{row.name}</div>
                  <strong style={{ color: payload[0].color }}>
                    {fmtGco2(row.sci)} gCO₂eq
                  </strong>
                  {row.hint && (
                    <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-dim)' }}>{row.hint}</div>
                  )}
                </div>
              );
            }}
          />
          <Bar dataKey="sci" radius={[4, 4, 0, 0]} name="SCI">
            {data.map((entry, idx) => (
              <Cell
                key={`cell-${idx}`}
                fill={
                  idx === 0
                    ? 'var(--cyan)'
                    : data.length > 1 && entry.sci < data[0].sci
                      ? 'var(--green)'
                      : 'var(--amber)'
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
