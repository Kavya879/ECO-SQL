import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { getDashboard } from '../api/api.js';
import { fmtGco2, fmtRuntime, fmtTimeAgo } from '../utils/format.js';

const DAYS_OPTIONS = [7, 30, 90];

/* ─── Tier helpers ──────────────────────────────────────────── */
function tierConfig(cls) {
  const c = String(cls || '').toUpperCase();
  if (c === 'EXCELLENT' || c === 'SUSTAINABLE') return { letter: 'A', cls: 'tier-excellent', score_cls: 'green' };
  if (c === 'GOOD')     return { letter: 'B', cls: 'tier-good',     score_cls: '' };
  if (c === 'MODERATE') return { letter: 'C', cls: 'tier-moderate', score_cls: 'amber' };
  if (c === 'POOR')     return { letter: 'D', cls: 'tier-poor',     score_cls: 'red' };
  if (c === 'CRITICAL' || c === 'HIGH IMPACT') return { letter: 'F', cls: 'tier-critical', score_cls: 'red' };
  return { letter: '?', cls: 'tier-moderate', score_cls: '' };
}

/* ─── SQL syntax highlighter (simple keyword pass) ─────────── */
function SqlSnippet({ sql = '' }) {
  const keywords = /\b(SELECT|FROM|WHERE|JOIN|LEFT|INNER|OUTER|ON|GROUP BY|ORDER BY|HAVING|LIMIT|UNION|INSERT|UPDATE|DELETE|WITH|AS|AND|OR|NOT|IN|LIKE|COUNT|SUM|AVG|MAX|MIN|DISTINCT|CASE|WHEN|THEN|END|CROSS)\b/gi;
  const parts = sql.split(keywords);
  return (
    <div className="sql-snippet">
      {parts.map((part, i) =>
        keywords.test(part)
          ? <span key={i} className="sql-kw">{part}</span>
          : part
      )}
    </div>
  );
}

/* ─── Recharts Tooltip ──────────────────────────────────────── */
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 6, padding: '10px 14px', fontSize: 12,
    }}>
      <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color, fontFamily: 'var(--font-mono)' }}>
          {p.name === 'avg_gco2' ? 'Operational: ' : 'Baseline: '}
          <strong>{parseFloat(p.value).toFixed(4)} gCO₂</strong>
        </div>
      ))}
    </div>
  );
}

/* ─── Donut chart (CSS conic-gradient) ──────────────────────── */
const TIER_COLORS = [
  { key: 'excellent', label: 'Excellent', color: '#00FF88' },
  { key: 'good',      label: 'Good',      color: '#a5eeff' },
  { key: 'moderate',  label: 'Moderate',  color: '#e5c364' },
  { key: 'poor',      label: 'Poor',      color: '#ffb4ab' },
  { key: 'critical',  label: 'Critical',  color: '#93000a' },
];

function TierDonut({ dist, total }) {
  const safe = (v) => Math.max(0, parseFloat(v) || 0);

  const vals = [
    safe(dist?.sustainable_pct || dist?.excellent_pct || 45),
    safe(dist?.good_pct || 25),
    safe(dist?.moderate_pct || 15),
    safe(dist?.poor_pct || 10),
    safe(dist?.high_impact_pct || dist?.critical_pct || 5),
  ];

  let acc = 0;
  const stops = vals.map((v, i) => {
    const start = acc;
    acc += v;
    return `${TIER_COLORS[i].color} ${start}% ${acc}%`;
  });

  return (
    <div className="donut-wrap">
      <div className="donut-ring" style={{ background: `conic-gradient(${stops.join(', ')})` }}>
        <div className="donut-inner">
          <div className="donut-center-value">
            {total >= 1000 ? (total / 1000).toFixed(1) + 'k' : total}
          </div>
          <div className="donut-center-label">Total</div>
        </div>
      </div>
      <div className="donut-legend">
        {TIER_COLORS.map((t, i) => (
          <div key={t.key} className="donut-legend-item">
            <div className="donut-dot" style={{ background: t.color }} />
            {t.label} ({vals[i].toFixed(0)}%)
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays]     = useState(30);
  const navigate            = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await getDashboard({ days })); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const stats  = data?.stats;
  const trend  = data?.trend  || [];
  const recent = data?.recent || [];
  const dist   = data?.distribution;
  const total  = parseInt(stats?.total_queries || 0);

  const avgScore = Math.max(0, Math.min(100, Math.round(
    100 - (parseFloat(stats?.avg_gco2_per_query || 0) / 10) * 100
  )));

  const trendData = trend.map(r => ({
    day: new Date(r.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    avg_gco2: parseFloat(r.avg_gco2) || 0,
    baseline: 0.5,
  }));

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-head">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-desc">Carbon footprint overview for your query workload</div>
        </div>
        <div className="page-actions">
          <select
            className="select"
            style={{ width: 150 }}
            value={days}
            onChange={e => setDays(parseInt(e.target.value))}
          >
            {DAYS_OPTIONS.map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <button className="btn btn-outline btn-sm" onClick={() => navigate('/reports')}>
            <span className="material-symbols-outlined sz-16">download</span>
            Export Report
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-card-top">
            <span className="kpi-label">Total Queries ({days}d)</span>
            <span className="material-symbols-outlined kpi-icon">database</span>
          </div>
          <div className="kpi-value">{loading ? '—' : total.toLocaleString()}</div>
          <div className="kpi-trend up">
            <span className="material-symbols-outlined sz-16">trending_up</span>
            All time
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card-top">
            <span className="kpi-label">Avg Sustainability Score</span>
            <span className="material-symbols-outlined kpi-icon">eco</span>
          </div>
          <div className="kpi-value green">{loading ? '—' : `${avgScore}/100`}</div>
          <div className="kpi-trend neutral">
            Score target: 90+
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card-top">
            <span className="kpi-label">CO₂ Emitted</span>
            <span className="material-symbols-outlined kpi-icon">co2</span>
          </div>
          <div className="kpi-value">
            {loading ? '—' : `${parseFloat(stats?.total_co2_kg || 0).toFixed(3)} kg`}
          </div>
          <div className="kpi-trend neutral">
            Last {days} days
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="charts-row">
        {/* Line chart */}
        <div className="chart-card">
          <div className="chart-card-title">
            Sustainability Score Trend
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
              Daily avg emissions · Last {days} days
            </span>
          </div>
          {loading ? (
            <div className="empty-state" style={{ flex: 1 }}>
              <span className="spinner" style={{ margin: '0 auto' }} />
            </div>
          ) : trendData.length === 0 ? (
            <div className="empty-state" style={{ flex: 1 }}>
              <span className="material-symbols-outlined empty-icon">bar_chart</span>
              <div className="empty-text">No trend data yet. Analyze some queries to see trends.</div>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trendData} margin={{ left: -10 }}>
                  <defs>
                    <linearGradient id="opGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#00FF88" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#00FF88" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="baseGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#00daf8" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#00daf8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(59,75,61,0.4)" />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: '#849585', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                    axisLine={false} tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#849585', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                    axisLine={false} tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone" dataKey="avg_gco2"
                    stroke="#00FF88" strokeWidth={2}
                    fill="url(#opGrad)" dot={false} name="avg_gco2"
                  />
                  <Area
                    type="monotone" dataKey="baseline"
                    stroke="#00daf8" strokeWidth={1.5}
                    fill="url(#baseGrad)" dot={false}
                    strokeDasharray="4 4" name="baseline"
                  />
                </AreaChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', gap: 20, marginTop: 8 }}>
                {[
                  { color: '#00FF88', label: 'Operational Emissions' },
                  { color: '#00daf8', label: 'Baseline Reference', dashed: true },
                ].map(l => (
                  <div key={l.label} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 11, color: 'var(--text-muted)',
                  }}>
                    <div style={{
                      width: 20, height: 2,
                      background: l.color,
                      borderTop: l.dashed ? `2px dashed ${l.color}` : undefined,
                    }} />
                    {l.label}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Donut */}
        <div className="chart-card">
          <div className="chart-card-title">Tier Breakdown</div>
          {loading ? (
            <div className="empty-state" style={{ flex: 1 }}>
              <span className="spinner" style={{ margin: '0 auto' }} />
            </div>
          ) : (
            <TierDonut dist={dist} total={total} />
          )}
        </div>
      </div>

      {/* Recent Heavy Queries */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">
            <span className="material-symbols-outlined sz-16">table_rows</span>
            Recent Heavy Queries
          </span>
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--green)' }}
            onClick={() => navigate('/reports')}
          >
            View All
            <span className="material-symbols-outlined sz-16">arrow_forward</span>
          </button>
        </div>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 80 }}>Score</th>
                <th style={{ width: 110 }}>Tier</th>
                <th style={{ width: 150 }}>Database</th>
                <th>SQL Snippet</th>
                <th style={{ width: 90, textAlign: 'right' }}>CO₂ (g)</th>
                <th style={{ width: 110, textAlign: 'right' }}>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32 }}>
                  <span className="spinner" style={{ display: 'inline-block' }} />
                </td></tr>
              ) : recent.length === 0 ? (
                <tr><td colSpan={6}>
                  <div className="empty-state" style={{ padding: '24px 0' }}>
                    <div className="empty-text">No queries yet. Head to Analyze to run your first query.</div>
                  </div>
                </td></tr>
              ) : recent.map(r => {
                const tc = tierConfig(r.classification);
                const co2 = parseFloat(r.total_emissions_gco2 || 0);
                const co2Color = co2 < 1 ? 'var(--green)' : co2 < 5 ? 'var(--amber)' : 'var(--red)';
                return (
                  <tr key={r.id}>
                    <td>
                      <div
                        className={`score-box ${tc.score_cls}`}
                        style={{
                          background: `rgba(var(--score-bg, 0,255,136), 0.1)`,
                          border: `1px solid rgba(var(--score-bd, 0,255,136), 0.3)`,
                        }}
                      >
                        {tc.letter}
                      </div>
                    </td>
                    <td><span className={`tier-pill ${tc.cls}`}>{r.classification || 'UNKNOWN'}</span></td>
                    <td className="mono dim" style={{ fontSize: 11 }}>{r.database_name || '—'}</td>
                    <td className="col-code">
                      <SqlSnippet sql={r.query_text || ''} />
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: co2Color }}>
                      {fmtGco2(co2)}
                    </td>
                    <td style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                      {fmtTimeAgo(r.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
