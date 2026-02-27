import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('30');

  useEffect(() => {
    async function fetchStats() {
      setLoading(true);
      try {
        const res = await fetch(`/api/dashboard-stats?dateRange=${dateRange}`);
        const data = await res.json();
        if (res.ok) setStats(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, [dateRange]);

  const handleExportReport = () => {
    window.open(`/api/export-report?dateRange=${dateRange}`, '_blank');
  };

  if (loading && !stats) return <div>Loading...</div>;

  const s = stats || {};
  const trendSci = s.pctChangeSci ?? 0;
  const trendScore = s.pctChangeScore ?? 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Dashboard - Overview</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            style={{
              padding: '8px 12px',
              background: '#21262d',
              border: '1px solid #30363d',
              borderRadius: 6,
              color: '#c9d1d9',
            }}
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="all">All time</option>
          </select>
          <button
            onClick={handleExportReport}
            style={{
              padding: '8px 16px',
              background: '#3fb950',
              color: '#0d1117',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Export Report
          </button>
          <span style={{ color: '#8b949e', cursor: 'pointer' }} title="Placeholder">🔔</span>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <KpiCard
          title="Total Queries Analyzed"
          value={s.totalQueries?.toLocaleString() ?? '0'}
          trend={trendSci !== 0 ? `${trendSci > 0 ? '↑' : '↓'} ${Math.abs(trendSci).toFixed(1)}% vs last period` : null}
        />
        <KpiCard
          title="Avg gCO2 per Query"
          value={(s.avgGco2PerQuery ?? 0).toFixed(2)}
          trend={
            trendSci !== 0
              ? trendSci < 0
                ? `↓ ${Math.abs(trendSci).toFixed(1)}% Improved`
                : `↑ ${trendSci.toFixed(1)}%`
              : null
          }
        />
        <KpiCard
          title="Sustainability Score"
          value={`${s.sustainabilityScore ?? 0}/100`}
          trend={trendScore !== 0 ? `${trendScore > 0 ? '↑' : ''}${trendScore.toFixed(1)} pts this period` : null}
        />
        <KpiCard
          title="Total CO2 Saved (est.)"
          value={`${(s.totalCo2Saved ?? 0).toFixed(1)} kg`}
          trend={null}
        />
      </div>

      <div style={{ display: 'flex', gap: 24, marginBottom: 24 }}>
        <div
          style={{
            flex: 1,
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <h3 style={{ margin: '0 0 16px 0', fontSize: 14 }}>
            Emissions Trend - Daily average gCO2 per query
          </h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {['Daily', 'Weekly', 'Monthly'].map((l) => (
              <button
                key={l}
                style={{
                  padding: '4px 12px',
                  background: l === 'Daily' ? '#3fb950' : '#21262d',
                  color: l === 'Daily' ? '#0d1117' : '#c9d1d9',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <EmissionsChart trend={s.emissionsTrend || []} baseline={s.baselineReference ?? 0} />
        </div>

        <div
          style={{
            width: 360,
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Recent Queries</h3>
            <Link to="/reports" style={{ color: '#3fb950', fontSize: 12 }}>
              View all →
            </Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(s.recentQueries || []).map((q) => (
              <Link
                key={q.queryId}
                to={`/reports?highlight=${q.queryId}`}
                style={{
                  padding: 8,
                  background: '#0d1117',
                  borderRadius: 6,
                  color: '#c9d1d9',
                  textDecoration: 'none',
                  fontSize: 12,
                }}
              >
                <div style={{ fontFamily: 'monospace', marginBottom: 4 }}>{q.queryPreview}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#8b949e', fontSize: 11 }}>
                  <span>{(q.runtimeMs / 1000).toFixed(2)}s</span>
                  <span>{q.gco2eq?.toFixed(2)} g</span>
                  <span
                    style={{
                      color:
                        q.classification === 'SUSTAINABLE'
                          ? '#3fb950'
                          : q.classification === 'MODERATE'
                          ? '#d29922'
                          : '#f85149',
                    }}
                  >
                    {q.classification}
                  </span>
                </div>
              </Link>
            ))}
            {(!s.recentQueries || s.recentQueries.length === 0) && (
              <div style={{ color: '#8b949e', fontSize: 13 }}>No analyses yet. Analyze a query to get started.</div>
            )}
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: '#8b949e' }}>
            SUSTAINABLE {s.classificationPercentages?.sustainable ?? 0}% · HIGH IMPACT{' '}
            {s.classificationPercentages?.highImpact ?? 0}%
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ title, value, trend }) {
  return (
    <div
      style={{
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
      {trend && (
        <div
          style={{
            fontSize: 12,
            color: trend.includes('↓') && trend.includes('Improved') ? '#3fb950' : '#8b949e',
            marginTop: 4,
          }}
        >
          {trend}
        </div>
      )}
    </div>
  );
}

function EmissionsChart({ trend, baseline }) {
  if (!trend.length) {
    return (
      <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e' }}>
        No data for this period
      </div>
    );
  }

  const maxVal = Math.max(...trend.map((t) => t.avgSci), baseline, 0.01);
  const h = 160;

  return (
    <div style={{ position: 'relative', height: h + 40 }}>
      <svg width="100%" height={h} viewBox={`0 0 ${trend.length * 8} ${h}`} preserveAspectRatio="none">
        <polyline
          fill="none"
          stroke="#3fb950"
          strokeWidth="2"
          points={trend
            .map((t, i) => `${i * 8},${h - (t.avgSci / maxVal) * h}`)
            .join(' ')}
        />
        <polyline
          fill="none"
          stroke="#58a6ff"
          strokeWidth="1"
          strokeDasharray="4,4"
          points={trend.map((_, i) => `${i * 8},${h - (baseline / maxVal) * h}`).join(' ')}
        />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#8b949e', marginTop: 8 }}>
        <span>Operational Emissions</span>
        <span>Baseline Reference</span>
      </div>
    </div>
  );
}
