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
  LabelList,
} from 'recharts';
import { fmtGco2 } from '../utils/format.js';

export default function SciBeforeAfterBarChart({ sciBefore, totalSciDeltaEstimated, compact }) {
  const { data, hasAfter } = useMemo(() => {
    const B = Number(sciBefore);
    if (!Number.isFinite(B)) return { data: null, hasAfter: false };

    const D = totalSciDeltaEstimated;
    const before = { name: 'Before', sci: Math.max(B, 0), placeholder: false };

    if (D != null && Number.isFinite(Number(D))) {
      const rawAfter = B + Number(D);
      return {
        data: [before, {
          name: 'After (est.)',
          sci: Math.max(0, rawAfter),
          placeholder: false,
          hint: rawAfter < 0 ? 'Rounded to zero for display' : null,
        }],
        hasAfter: true,
      };
    }

    // Always render two bars so the chart doesn't show a single full-width block.
    // The second bar is a ghost placeholder indicating no estimate is available yet.
    return {
      data: [before, { name: 'After (est.)', sci: Math.max(B, 0), placeholder: true }],
      hasAfter: false,
    };
  }, [sciBefore, totalSciDeltaEstimated]);

  if (!data?.length) {
    return (
      <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: compact ? 0 : 16 }}>
        SCI bar chart unavailable — analyse the query first.
      </p>
    );
  }

  return (
    <div style={{ marginBottom: compact ? 8 : 20, height: compact ? 180 : 220 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
          SCI before vs after optimisation (gCO₂eq / query)
        </span>
        {!hasAfter && (
          <span style={{
            fontSize: 10, color: 'var(--text-dim)',
            background: 'var(--bg-code)', border: '1px solid var(--border-muted)',
            borderRadius: 4, padding: '2px 6px',
          }}>
            After estimate pending — run a query with hypopg / pg_hint_plan installed
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barCategoryGap="40%" margin={{ left: -10, right: 10, bottom: 0, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(59,75,61,0.35)" />
          <XAxis dataKey="name" tick={{ fill: '#849585', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fill: '#849585', fontSize: 10, fontFamily: 'var(--font-mono)' }}
            axisLine={false}
            tickLine={false}
            label={{ value: 'gCO₂eq', angle: -90, position: 'insideLeft', fill: '#849585', fontSize: 10 }}
            domain={[0, (dataMax) => dataMax * 1.25]}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload;
              if (row.placeholder) {
                return (
                  <div style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    padding: '8px 12px', borderRadius: 6, fontSize: 12,
                  }}>
                    <div style={{ color: 'var(--text-muted)' }}>After (est.)</div>
                    <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-dim)' }}>
                      No simulation data yet. Install hypopg / pg_hint_plan on the target DB for an estimated delta.
                    </div>
                  </div>
                );
              }
              return (
                <div style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  padding: '8px 12px', borderRadius: 6, fontSize: 12,
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
          <Bar dataKey="sci" radius={[4, 4, 0, 0]} name="SCI" maxBarSize={80}>
            {data.map((entry, idx) => (
              <Cell
                key={`cell-${idx}`}
                fill={
                  entry.placeholder
                    ? 'rgba(132,149,133,0.2)'
                    : idx === 0
                      ? 'var(--cyan)'
                      : entry.sci < data[0].sci
                        ? 'var(--green)'
                        : 'var(--amber)'
                }
                stroke={entry.placeholder ? 'rgba(132,149,133,0.4)' : undefined}
                strokeWidth={entry.placeholder ? 1 : 0}
                strokeDasharray={entry.placeholder ? '4 3' : undefined}
              />
            ))}
            <LabelList
              dataKey="sci"
              position="top"
              formatter={(v) => fmtGco2(v)}
              style={{ fontSize: 10, fill: '#849585', fontFamily: 'var(--font-mono)' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
