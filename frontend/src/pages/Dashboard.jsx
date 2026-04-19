import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getDashboard } from '../api/api.js';
import { fmtGco2, fmtRuntime, fmtTimeAgo, classificationBadge } from '../utils/format.js';

const DAYS_OPTIONS = [7, 30, 90];

function GaugeChart({ value, max = 10 }) {
  const r = 54;
  const cx = 70, cy = 70;
  const startAngle = Math.PI * 0.8;
  const endAngle = Math.PI * 0.2;
  const total = (2 * Math.PI) - (startAngle - endAngle);
  const circumference = total * r;
  const pct = Math.min(value / max, 1);
  const offset = circumference * (1 - pct);
  const color = value < 2 ? '#00ff88' : value < 5 ? '#f5a623' : '#ff4d4d';

  const polarToCart = (angle) => ({
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  });

  const describeArc = (startA, endA) => {
    const s = polarToCart(startA);
    const e = polarToCart(endA);
    const large = (endA - startA + 2 * Math.PI) % (2 * Math.PI) > Math.PI ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
  };

  return (
    <svg width="140" height="90" viewBox="0 0 140 90">
      <path d={describeArc(startAngle, startAngle + total)} fill="none" stroke="#1e2832" strokeWidth="8" strokeLinecap="round" />
      <path
        d={describeArc(startAngle, startAngle + total)}
        fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="gauge-arc"
      />
      <text x={cx} y={cy - 4} textAnchor="middle" fill={color} fontSize="18" fontWeight="700" fontFamily="JetBrains Mono">{fmtGco2(value)}</text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="#4a5568" fontSize="9" fontFamily="JetBrains Mono">gCO₂/query</text>
    </svg>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: '#1a2028', border: '1px solid #1e2832', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
        <div style={{ color: '#7a8a9a', marginBottom: 4 }}>{label}</div>
        {payload.map(p => (
          <div key={p.name} style={{ color: p.color, fontFamily: 'JetBrains Mono' }}>
            {p.name === 'avg_gco2' ? 'Operational: ' : 'Baseline: '}
            <strong>{parseFloat(p.value).toFixed(3)} gCO₂</strong>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getDashboard({ days });
      setData(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const stats = data?.stats;
  const trend = data?.trend || [];
  const recent = data?.recent || [];
  const dist = data?.distribution;

  const trendData = trend.map(r => ({
    day: new Date(r.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    avg_gco2: parseFloat(r.avg_gco2) || 0,
    baseline: 0.5,
  }));

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· Overview</span></div>
        </div>
        <div className="page-actions">
          <select
            className="form-control"
            style={{ width: 140, height: 34, padding: '4px 32px 4px 10px', fontSize: 12 }}
            value={days}
            onChange={e => setDays(parseInt(e.target.value))}
          >
            {DAYS_OPTIONS.map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/reports')}>↓ Export Report</button>
        </div>
      </div>

      <div className="page-body">
        <div className="stat-cards">
          <div className="stat-card">
            <div className="stat-info">
              <div className="stat-label">Total Queries Analyzed</div>
              <div className="stat-value">{loading ? '—' : parseInt(stats?.total_queries || 0).toLocaleString()}</div>
              <div className="stat-sub">All time</div>
            </div>
            <div className="stat-icon" style={{ background: 'rgba(0,255,136,0.08)' }}>⚡</div>
          </div>
          <div className="stat-card">
            <div className="stat-info">
              <div className="stat-label">Avg gCO₂ per Query</div>
              <div className="stat-value">{loading ? '—' : parseFloat(stats?.avg_gco2_per_query || 0).toFixed(2)}</div>
              <div className="stat-sub">grams CO₂ equivalent</div>
            </div>
            <div className="stat-icon" style={{ background: 'rgba(77,201,255,0.08)' }}>◎</div>
          </div>
          <div className="stat-card">
            <div className="stat-info">
              <div className="stat-label">Sustainability Score</div>
              <div className="stat-value green">
                {loading ? '—' : `${Math.max(0, Math.round(100 - (parseFloat(stats?.avg_gco2_per_query || 0) / 10) * 100))}/100`}
              </div>
              <div className="stat-sub up">↑ this period</div>
            </div>
            <div className="stat-icon" style={{ background: 'rgba(0,255,136,0.08)' }}>◈</div>
          </div>
          <div className="stat-card">
            <div className="stat-info">
              <div className="stat-label">Total CO₂ Emitted</div>
              <div className="stat-value">{loading ? '—' : parseFloat(stats?.total_co2_kg || 0).toFixed(2)} <span style={{ fontSize: 14 }}>kg</span></div>
              <div className="stat-sub">last {days} days</div>
            </div>
            <div className="stat-icon" style={{ background: 'rgba(245,166,35,0.08)' }}>⊙</div>
          </div>
        </div>

        <div className="dashboard-grid">
          <div className="chart-card">
            <div className="chart-header">
              <div>
                <div className="chart-title">Emissions Trend</div>
                <div className="chart-subtitle">Daily average gCO₂ per query · Last {days} days</div>
              </div>
            </div>
            {trendData.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📊</div>
                <div className="empty-state-text">No data yet. Analyze some queries to see trends.</div>
              </div>
            ) : (
              <div style={{ marginTop: 16 }}>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient id="opGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00ff88" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#00ff88" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="baseGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4dc9ff" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#4dc9ff" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2832" />
                    <XAxis dataKey="day" tick={{ fill: '#4a5568', fontSize: 11, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#4a5568', fontSize: 11, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="avg_gco2" stroke="#00ff88" strokeWidth={2.5} fill="url(#opGrad)" dot={false} name="avg_gco2" />
                    <Area type="monotone" dataKey="baseline" stroke="#4dc9ff" strokeWidth={1.5} fill="url(#baseGrad)" dot={false} strokeDasharray="4 4" name="baseline" />
                  </AreaChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', gap: 20, marginTop: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#7a8a9a' }}>
                    <div style={{ width: 24, height: 2, background: '#00ff88' }} /> Operational Emissions
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#7a8a9a' }}>
                    <div style={{ width: 24, height: 2, background: '#4dc9ff', borderTop: '2px dashed #4dc9ff' }} /> Baseline Reference
                  </div>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="chart-card">
              <div className="chart-title" style={{ marginBottom: 14 }}>Recent Queries</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Latest analyses</span>
                <button className="btn-ghost" style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none' }}
                  onClick={() => navigate('/reports')}>View all →</button>
              </div>
              {recent.length === 0 ? (
                <div className="empty-state" style={{ padding: '24px 0' }}>
                  <div className="empty-state-text">No queries yet</div>
                </div>
              ) : recent.map(r => {
                const cls = r.classification || 'SUSTAINABLE';
                const iconColor = cls === 'SUSTAINABLE' ? '#00ff88' : cls === 'MODERATE' ? '#f5a623' : '#ff4d4d';
                return (
                  <div key={r.id} className="recent-item">
                    <div className="recent-icon" style={{ background: `${iconColor}18`, color: iconColor }}>{cls[0]}</div>
                    <div className="recent-text">
                      <div className="recent-query">{r.query_text}</div>
                      <div className="recent-meta">{fmtTimeAgo(r.created_at)} · {fmtRuntime(r.runtime_s)} runtime</div>
                    </div>
                    <div className="recent-value" style={{ color: iconColor }}>{fmtGco2(r.total_emissions_gco2)} g</div>
                  </div>
                );
              })}
            </div>

            <div className="chart-card">
              <div className="chart-title" style={{ marginBottom: 12 }}>Distribution</div>
              <div>
                {[
                  { label: 'Sustainable', color: '#00ff88', val: dist?.sustainable_pct || 0, range: '0–2.0' },
                  { label: 'Moderate', color: '#f5a623', val: dist?.moderate_pct || 0, range: '2.0–5.0' },
                  { label: 'High Impact', color: '#ff4d4d', val: dist?.high_impact_pct || 0, range: '5.0+' },
                ].map(d => (
                  <div key={d.label}>
                    <div className="legend-item">
                      <div className="legend-label"><div className="legend-dot" style={{ background: d.color }} />{d.label}</div>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <span className="legend-range">{d.range}</span>
                        <span style={{ color: d.color, fontFamily: 'var(--font-mono)', fontSize: 12, minWidth: 36, textAlign: 'right' }}>{parseFloat(d.val).toFixed(0)}%</span>
                      </div>
                    </div>
                    <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, marginBottom: 10 }}>
                      <div style={{ width: `${Math.min(parseFloat(d.val), 100)}%`, height: '100%', background: d.color, borderRadius: 2, transition: 'width 0.8s ease' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
