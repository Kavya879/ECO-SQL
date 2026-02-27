import { useState, useCallback } from 'react';

const SAMPLE_QUERY = `-- Carbon footprint analysis: Multi-table join query
SELECT c.customer_id, c.name, c.region,
       SUM(o.total_amount) AS total_revenue,
       COUNT(o.order_id) AS order_count,
       AVG(p.unit_price) AS avg_price
FROM customers c
INNER JOIN orders o ON c.customer_id = o.customer_id
INNER JOIN order_items oi ON o.order_id = oi.order_id
INNER JOIN products p ON oi.product_id = p.product_id
WHERE o.order_date >= '2024-01-01'
  AND c.region IN ('APAC', 'EMEA')
GROUP BY c.customer_id, c.name, c.region
HAVING SUM(o.total_amount) > 50000
ORDER BY total_revenue DESC
LIMIT 100;`;

function extractMetadata(sql) {
  const lines = sql.trim() ? sql.split(/\n/).length : 0;
  const tableMatch = sql.matchAll(/\b(?:from|join)\s+([a-z0-9_."]+)/gi);
  const tables = [...new Set([...tableMatch].map((m) => m[1].split(/[\s.]/)[0].replace(/"/g, '')))];
  const hasJoin = /\b(?:inner|left|right|full)\s+join\b/i.test(sql);
  return { lines, tables: tables.length, hasJoin };
}

export default function AnalyzeQuery() {
  const [query, setQuery] = useState('');
  const [hw, setHw] = useState({
    cpu_cores: 16,
    ram_gb: 64,
    cpu_utilization: 65,
    pue: 1.3,
    grid_carbon_intensity: 442,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const metadata = extractMetadata(query);

  const loadSample = useCallback(() => {
    setQuery(SAMPLE_QUERY);
  }, []);

  const clear = useCallback(() => {
    setQuery('');
    setResult(null);
    setError('');
    setShowModal(false);
  }, []);

  const analyze = useCallback(async () => {
    if (!query.trim()) {
      setError('Please enter a SQL query');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/analyze-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          hardwareConfig: {
            cpu_cores: Number(hw.cpu_cores) || 16,
            ram_gb: Number(hw.ram_gb) || 64,
            cpu_utilization: (Number(hw.cpu_utilization) || 65) / 100,
            pue: Number(hw.pue) || 1.3,
            grid_carbon_intensity: Number(hw.grid_carbon_intensity) || 442,
          },
          dryRun: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed');
      setResult(data);
      setShowModal(true);
    } catch (err) {
      setError(err.message || 'Analysis failed');
    } finally {
      setLoading(false);
    }
  }, [query, hw]);

  const classificationColor = result
    ? result.classification === 'SUSTAINABLE'
      ? '#3fb950'
      : result.classification === 'MODERATE'
      ? '#d29922'
      : '#f85149'
    : '#8b949e';


  return (
    <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 80px)' }}>
      {/* Left: SQL Editor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <div>
            <span style={{ fontWeight: 600, marginRight: 8 }}>SQL Query Editor</span>
            <span
              style={{
                background: '#3fb950',
                color: '#0d1117',
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              SQL
            </span>
          </div>
          <span style={{ fontSize: 12, color: '#8b949e' }}>
            Database-agnostic analysis
          </span>
        </div>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter your SQL query..."
          style={{
            flex: 1,
            background: '#0d1117',
            border: '1px solid #30363d',
            borderRadius: 6,
            color: '#c9d1d9',
            padding: 12,
            fontFamily: 'monospace',
            fontSize: 13,
            resize: 'none',
          }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={analyze}
              disabled={loading}
              style={{
                background: '#3fb950',
                color: '#0d1117',
                border: 'none',
                padding: '8px 16px',
                borderRadius: 6,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              {loading ? 'Analyzing...' : 'Analyze Query'}
            </button>
            <button
              onClick={clear}
              style={{
                background: 'transparent',
                color: '#c9d1d9',
                border: '1px solid #30363d',
                padding: '8px 16px',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
            <button
              onClick={loadSample}
              style={{
                background: 'transparent',
                color: '#c9d1d9',
                border: '1px solid #30363d',
                padding: '8px 16px',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Load Sample
            </button>
          </div>
          <span style={{ fontSize: 12, color: '#8b949e' }}>
            {metadata.lines} lines - {metadata.tables} tables
            {metadata.hasJoin ? ' - JOIN detected' : ''}
          </span>
        </div>
        {error && (
          <div
            style={{
              marginTop: 8,
              padding: 12,
              background: 'rgba(248,81,73,0.15)',
              border: '1px solid #f85149',
              borderRadius: 6,
              color: '#f85149',
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Right: Hardware Config + Results */}
      <div
        style={{
          width: 320,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          background: '#161b22',
          borderRadius: 8,
          padding: 16,
          border: '1px solid #30363d',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14 }}>
          {result ? `Query #${String(result.queryId).slice(0, 8)}...` : 'Configuration'}
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ fontSize: 12 }}>
            CPU Cores
            <input
              type="number"
              value={hw.cpu_cores}
              onChange={(e) => setHw((p) => ({ ...p, cpu_cores: e.target.value }))}
              style={{
                display: 'block',
                marginTop: 4,
                width: '100%',
                padding: 8,
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: 4,
                color: '#c9d1d9',
              }}
            />
            <span style={{ color: '#8b949e', fontSize: 11 }}>physical cores</span>
          </label>
          <label style={{ fontSize: 12 }}>
            RAM (GB)
            <input
              type="number"
              value={hw.ram_gb}
              onChange={(e) => setHw((p) => ({ ...p, ram_gb: e.target.value }))}
              style={{
                display: 'block',
                marginTop: 4,
                width: '100%',
                padding: 8,
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: 4,
                color: '#c9d1d9',
              }}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            CPU Utilization - {hw.cpu_utilization}%
            <input
              type="range"
              min="10"
              max="100"
              value={hw.cpu_utilization}
              onChange={(e) =>
                setHw((p) => ({ ...p, cpu_utilization: e.target.value }))
              }
              style={{ display: 'block', marginTop: 4, width: '100%' }}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            PUE Factor
            <input
              type="number"
              step="0.1"
              value={hw.pue}
              onChange={(e) => setHw((p) => ({ ...p, pue: e.target.value }))}
              style={{
                display: 'block',
                marginTop: 4,
                width: '100%',
                padding: 8,
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: 4,
                color: '#c9d1d9',
              }}
            />
            <span style={{ color: '#8b949e', fontSize: 11 }}>power usage eff.</span>
          </label>
          <label style={{ fontSize: 12 }}>
            Grid Carbon Intensity (gCO2eq/kWh)
            <input
              type="number"
              value={hw.grid_carbon_intensity}
              onChange={(e) =>
                setHw((p) => ({ ...p, grid_carbon_intensity: e.target.value }))
              }
              style={{
                display: 'block',
                marginTop: 4,
                width: '100%',
                padding: 8,
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: 4,
                color: '#c9d1d9',
              }}
            />
            <span style={{ color: '#8b949e', fontSize: 11 }}>
              regional avg. India (IN) 2024
            </span>
          </label>
        </div>

        {result && (
          <div style={{ marginTop: 8, borderTop: '1px solid #30363d', paddingTop: 16 }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 13 }}>Analysis Results</h4>
            <div
              style={{
                display: 'inline-block',
                padding: '4px 12px',
                borderRadius: 6,
                background: classificationColor + '33',
                color: classificationColor,
                fontWeight: 600,
                marginBottom: 12,
              }}
            >
              • {result.classification}
              {result.runtimeSource === 'estimated' && (
                <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.9 }}>
                  (estimated)
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div>Energy Consumption: {result.energyKwh?.toExponential(4)} kWh</div>
              <div>Operational Emissions: {result.operationalCo2?.toFixed(2)} gCO2eq</div>
              <div>Embodied Emissions: {result.embodiedCo2?.toFixed(2)} gCO2eq</div>
              <div
                style={{
                  background: '#3fb95022',
                  padding: 8,
                  borderRadius: 4,
                  fontWeight: 600,
                  color: '#3fb950',
                  marginTop: 8,
                }}
              >
                Total SCI Score: {result.sciPerQuery?.toFixed(2)} gCO2eq/query
              </div>
              <span style={{ color: '#8b949e', fontSize: 11 }}>
                Software Carbon Intensity
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Emission Analysis Complete Modal */}
      {showModal && result && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#161b22',
              borderRadius: 12,
              padding: 24,
              maxWidth: 560,
              width: '90%',
              border: '1px solid #30363d',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: 16,
              }}
            >
              <div>
                <h2 style={{ margin: 0, color: '#3fb950', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>Emission Analysis Complete</span>
                </h2>
                <p style={{ margin: '4px 0 0 0', color: '#8b949e', fontSize: 13 }}>
                  Query #{String(result.queryId).slice(0, 8)}... • Analyzed just now
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#8b949e',
                  cursor: 'pointer',
                  fontSize: 20,
                }}
              >
                ×
              </button>
            </div>

            <div
              style={{
                padding: 12,
                background: 'rgba(210,153,34,0.15)',
                borderRadius: 8,
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>
                  {result.tier === 'excellent' || result.tier === 'good'
                    ? 'Sustainable Emission Query'
                    : result.tier === 'moderate'
                    ? 'Moderate Emission Query'
                    : 'High Impact Query'}
                </div>
                <div style={{ fontSize: 13, color: '#8b949e' }}>
                  {result.tier === 'excellent' || result.tier === 'good'
                    ? 'This query performs well within green thresholds'
                    : result.tier === 'moderate'
                    ? 'This query falls within acceptable thresholds, with room for optimization'
                    : 'This query exceeds recommended emission thresholds'}
                </div>
              </div>
              <span
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  background: classificationColor + '44',
                  color: classificationColor,
                  fontWeight: 600,
                }}
              >
                {result.classification}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 24, marginBottom: 24 }}>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    height: 48,
                    borderRadius: 8,
                    background: 'linear-gradient(90deg, #3fb950 0%, #3fb950 25%, #d29922 25%, #d29922 62.5%, #f85149 62.5%, #f85149 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#0d1117', zIndex: 1 }}>
                    {result.sciPerQuery?.toFixed(2)} gCO2/query
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 6 }}>
                  <span style={{ color: '#3fb950' }}>0-2 Sustainable</span>
                  <span style={{ color: '#d29922' }}>2-5 Moderate</span>
                  <span style={{ color: '#f85149' }}>5+ High Impact</span>
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <div style={{ color: '#8b949e', fontSize: 12 }}>SUSTAINABILITY RATING</div>
                <div style={{ fontSize: 32, fontWeight: 700, color: '#3fb950' }}>
                  {result.sustainabilityRating}/100
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>
                  ENERGY USED
                </div>
                <div style={{ fontWeight: 600 }}>
                  {result.energyKwh?.toExponential(4)} kilowatt hours (kWh)
                </div>
                <div
                  style={{
                    height: 4,
                    background: '#30363d',
                    borderRadius: 2,
                    marginTop: 4,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, (result.energyKwh / 0.001) * 100)}%`,
                      height: '100%',
                      background: '#3fb950',
                    }}
                  />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>
                  OPERATIONAL CO2
                </div>
                <div style={{ fontWeight: 600 }}>
                  {result.operationalCo2?.toFixed(2)} grams CO2 equivalent
                </div>
                <div
                  style={{
                    height: 4,
                    background: '#30363d',
                    borderRadius: 2,
                    marginTop: 4,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, (result.operationalCo2 / 10) * 100)}%`,
                      height: '100%',
                      background: '#58a6ff',
                    }}
                  />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>
                  EMBODIED CO2
                </div>
                <div style={{ fontWeight: 600 }}>
                  {result.embodiedCo2?.toFixed(2)} grams CO2 equivalent
                </div>
                <div
                  style={{
                    height: 4,
                    background: '#30363d',
                    borderRadius: 2,
                    marginTop: 4,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, (result.embodiedCo2 / 2) * 100)}%`,
                      height: '100%',
                      background: '#a371f7',
                    }}
                  />
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingTop: 16,
                borderTop: '1px solid #30363d',
              }}
            >
              <span style={{ fontSize: 12, color: '#8b949e' }}>
                {result.numTables} table{result.numTables !== 1 ? 's' : ''} •{' '}
                Runtime {(result.runtimeMs / 1000).toFixed(2)}s
                {result.runtimeSource === 'estimated' && ' (estimated)'}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => window.open(`/api/export-query/${result.queryId}`, '_blank')}
                  style={{
                    padding: '8px 16px',
                    border: '1px solid #30363d',
                    background: 'transparent',
                    color: '#c9d1d9',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  Export
                </button>
                <button
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    background: '#3fb950',
                    color: '#0d1117',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Optimize Query
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
