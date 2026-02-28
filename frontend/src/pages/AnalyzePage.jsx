import React, { useState, useEffect, useRef } from 'react';
import { analyzeQuery, getDatabases, getHardwareConfig } from '../api/api.js';
import { fmtEnergy, fmtGco2, fmtRuntime, classificationBadge } from '../utils/format.js';

const SAMPLE_QUERY = `-- Carbon footprint analysis: Multi-table join query
SELECT
    c.customer_id,
    c.name,
    c.region,
    SUM(o.total_amount) AS total_revenue,
    COUNT(o.order_id) AS order_count
FROM customers c
INNER JOIN orders o ON c.customer_id = o.customer_id
WHERE o.order_date >= '2024-01-01'
GROUP BY c.customer_id, c.name, c.region
HAVING SUM(o.total_amount) > 50000
ORDER BY total_revenue DESC
LIMIT 100;`;

const DEFAULTS = {
  cpuCores: 16,
  powerPerCore: 15,
  cpuUtilization: 0.65,
  ramGb: 64,
  pue: 1.3,
  gridIntensity: 442,
  te: 1600000,
  el: 35040,
  rr: 0.5,
  tor: 8760,
};

function ResultMetric({ label, value, unit, color }) {
  return (
    <div className="result-metric">
      <div className="result-metric-label">{label}</div>
      <div>
        <span className="result-metric-value" style={color ? { color } : {}}>{value}</span>
        {unit && <span className="result-metric-unit">{unit}</span>}
      </div>
    </div>
  );
}

function SustainabilityGauge({ score }) {
  const r = 44;
  const cx = 56, cy = 56;
  const pct = Math.min(score / 100, 1);
  const circumference = 2 * Math.PI * r * 0.75;
  const offset = circumference * (1 - pct);
  const color = score >= 70 ? '#00ff88' : score >= 40 ? '#f5a623' : '#ff4d4d';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width="112" height="80" viewBox="0 0 112 80">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e2832" strokeWidth="7"
          strokeDasharray={circumference} strokeDashoffset={0}
          strokeLinecap="round" transform={`rotate(135 ${cx} ${cy})`} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="7"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform={`rotate(135 ${cx} ${cy})`}
          className="gauge-arc" />
        <text x={cx} y={cy - 2} textAnchor="middle" fill={color} fontSize="16" fontWeight="700" fontFamily="JetBrains Mono">{score}</text>
        <text x={cx} y={cx + 14} textAnchor="middle" fill="#4a5568" fontSize="8">/100</text>
      </svg>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: -6 }}>Sustainability Rating</div>
    </div>
  );
}

export default function AnalyzePage() {
  const [sql, setSql] = useState('');
  const [databases, setDatabases] = useState([]);
  const [selectedDb, setSelectedDb] = useState('');
  const [hw, setHw] = useState(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    getDatabases().then(d => {
      setDatabases(d.databases || []);
      if (d.databases?.length > 0) setSelectedDb(d.databases[0].name);
    }).catch(() => {});
    
    getHardwareConfig().then(config => {
      setHw(prev => ({
        ...prev,
        cpuCores: config.cpuCores || prev.cpuCores,
        powerPerCore: config.powerPerCore || prev.powerPerCore,
        cpuUtilization: config.cpuUtilization || prev.cpuUtilization,
        ramGb: config.ramGb || prev.ramGb,
        pue: config.pue || prev.pue,
        gridIntensity: config.gridIntensity || prev.gridIntensity,
        te: config.te || prev.te,
        el: config.el || prev.el,
        rr: config.rr || prev.rr,
        tor: config.tor || prev.tor,
      }));
    }).catch(() => {
      // Fall back to defaults if hardware detection fails
    });
  }, []);

  const lineCount = sql.split('\n').length;

  const handleAnalyze = async () => {
    if (!sql.trim()) { setError('Please enter a SQL query.'); return; }
    if (!selectedDb) { setError('Please select a database.'); return; }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await analyzeQuery({
        sql,
        database: selectedDb,
        ...hw,
      });
      setResult(res);
    } catch (e) {
      setError(e.response?.data?.detail || e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };

  const updateHw = (key, val) => setHw(prev => ({ ...prev, [key]: val }));

  const cls = result?.classification;
  const badgeCls = !cls ? '' : 
    cls === 'EXCELLENT' ? 'badge-excellent' : 
    cls === 'GOOD' ? 'badge-good' : 
    cls === 'MODERATE' ? 'badge-moderate' : 
    cls === 'POOR' ? 'badge-poor' : 
    'badge-critical';
  const clsColor = !cls ? 'var(--text-primary)' : 
    cls === 'EXCELLENT' || cls === 'GOOD' ? 'var(--green)' : 
    cls === 'MODERATE' ? 'var(--amber)' : 
    'var(--red)';

  const queryMeta = (() => {
    if (!sql.trim()) return null;
    const lines = sql.split('\n').filter(l => l.trim()).length;
    const tables = (result?.tables_involved || []).length;
    const hasJoin = /\bJOIN\b/i.test(sql);
    const type = sql.trim().match(/^(\w+)/i)?.[1]?.toUpperCase() || 'SQL';
    return { lines, tables, hasJoin, type };
  })();

  return (
    <>
      <div className="page-header">
        <div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>QueryCarbon › </span>
          <span className="page-title" style={{ fontSize: 15 }}>Analyze Query</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {result ? `Query #${result.query_id}` : 'New Analysis'}
        </div>
      </div>

      <div className="analyze-layout">
        {/* Left: SQL Editor + Hardware */}
        <div className="editor-panel">
          <div className="editor-wrapper">
            <div className="editor-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>SQL Query Editor</span>
                <span className="tag">SQL</span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Database-agnostic analysis</span>
            </div>

            {/* Database selector */}
            <div style={{ padding: '10px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Database:</span>
              <select
                className="form-control"
                style={{ width: 220, height: 30, padding: '4px 32px 4px 10px', fontSize: 12 }}
                value={selectedDb}
                onChange={e => setSelectedDb(e.target.value)}
              >
                {databases.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                {databases.length === 0 && <option>Loading...</option>}
              </select>
            </div>


            <div className="editor-body">
              <div className="line-numbers">
                {Array.from({ length: Math.max(lineCount, 10) }, (_, i) => (
                  <div key={i} className="line-num">{i + 1}</div>
                ))}
              </div>
              <textarea
                ref={textareaRef}
                className="sql-textarea"
                value={sql}
                onChange={e => setSql(e.target.value)}
                placeholder="-- Write your SQL query here..."
                spellCheck={false}
                onKeyDown={e => {
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    const s = e.target.selectionStart;
                    const v = sql.substring(0, s) + '  ' + sql.substring(e.target.selectionEnd);
                    setSql(v);
                    setTimeout(() => e.target.setSelectionRange(s + 2, s + 2), 0);
                  }
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleAnalyze();
                  }
                }}
              />
            </div>

            <div className="editor-footer">
              <div className="editor-actions">
                <button 
                  className="btn btn-primary" 
                  onClick={handleAnalyze} 
                  disabled={loading}
                  title="Run query (Ctrl+Enter)"
                >
                  {loading ? <><span className="spinner" /> Analyzing...</> : <>⚡ Analyze Query</>}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => { setSql(''); setResult(null); setError(null); }} title="Clear editor">◎ Clear</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setSql(SAMPLE_QUERY)} title="Load example query">⊡ Load Sample</button>
              </div>
              {queryMeta && (
                <div style={{ display: 'flex', gap: 12, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                  <span>{queryMeta.lines} lines</span>
                  {result?.tables_involved?.length > 0 && <span>· {result.tables_involved.length} tables</span>}
                  {queryMeta.hasJoin && <span>· JOIN detected</span>}
                </div>
              )}
            </div>
          </div>

          {/* Hardware Config */}
          <div className="hw-panel">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div className="hw-title">⊟ Hardware Configuration</div>
              <button 
                className="btn btn-ghost btn-sm"
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{ fontSize: 11, padding: '4px 8px' }}
              >
                {showAdvanced ? '⊟ Hide Advanced' : '⊞ Show Advanced'}
              </button>
            </div>
            <div className="hw-grid">
              <div className="form-group">
                <label className="form-label">CPU Cores</label>
                <input type="number" className="form-control form-control-mono" min="1" max="256"
                  value={hw.cpuCores} onChange={e => updateHw('cpuCores', +e.target.value)} />
                <span className="form-hint">physical cores</span>
              </div>
              <div className="form-group">
                <label className="form-label">RAM (GB)</label>
                <input type="number" className="form-control form-control-mono" min="1"
                  value={hw.ramGb} onChange={e => updateHw('ramGb', +e.target.value)} />
                <span className="form-hint">gigabytes</span>
              </div>
              <div className="form-group">
                <label className="form-label">Grid Carbon Intensity (gCO₂/kWh)</label>
                <input type="number" className="form-control form-control-mono" min="0"
                  value={hw.gridIntensity} onChange={e => updateHw('gridIntensity', +e.target.value)} />
                <span className="form-hint">regional intensity (India: 442, US: 386, EU: 233)</span>
              </div>

              {showAdvanced && (
                <>
                  <div className="form-group hw-full" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, marginTop: 4 }}>
                    <label className="form-label">CPU Utilization — <span style={{ color: 'var(--green)' }}>{Math.round(hw.cpuUtilization * 100)}%</span></label>
                    <div className="slider-container">
                      <input type="range" className="slider" min="0" max="1" step="0.01"
                        value={hw.cpuUtilization} onChange={e => updateHw('cpuUtilization', +e.target.value)} />
                    </div>
                    <span className="form-hint">query resource intensity (auto: 50%)</span>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Power/Core (W)</label>
                    <input type="number" className="form-control form-control-mono" min="1"
                      value={hw.powerPerCore} onChange={e => updateHw('powerPerCore', +e.target.value)} />
                    <span className="form-hint">watts per core</span>
                  </div>
                  <div className="form-group">
                    <label className="form-label">PUE Factor</label>
                    <input type="number" className="form-control form-control-mono" min="1" max="3" step="0.01"
                      value={hw.pue} onChange={e => updateHw('pue', +e.target.value)} />
                    <span className="form-hint">power usage efficiency</span>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Total Embodied Carbon (gCO₂)</label>
                    <input type="number" className="form-control form-control-mono" min="0"
                      value={hw.te} onChange={e => updateHw('te', +e.target.value)} />
                    <span className="form-hint">hardware lifecycle emissions</span>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Hardware Lifespan (hr)</label>
                    <input type="number" className="form-control form-control-mono" min="1"
                      value={hw.el} onChange={e => updateHw('el', +e.target.value)} />
                    <span className="form-hint">expected lifespan hours</span>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Resource Ratio (RR)</label>
                    <input type="number" className="form-control form-control-mono" min="0" max="1" step="0.01"
                      value={hw.rr} onChange={e => updateHw('rr', +e.target.value)} />
                    <span className="form-hint">reserved resource ratio</span>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Total Operating Time (hr)</label>
                    <input type="number" className="form-control form-control-mono" min="1"
                      value={hw.tor} onChange={e => updateHw('tor', +e.target.value)} />
                    <span className="form-hint">expected annual operating hours</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: Results Panel */}
        <div className="results-panel">
          {/* Hardware section label */}
          <div className="hw-panel" style={{ padding: '14px 18px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>⊟ Hardware Configuration</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
              <span>CPU: {hw.cpuCores} cores</span>
              <span>RAM: {hw.ramGb} GB</span>
              <span>Util: {Math.round(hw.cpuUtilization * 100)}%</span>
              <span>PUE: {hw.pue}</span>
              <span>Grid: {hw.gridIntensity} gCO₂/kWh</span>
              <span>DB: {selectedDb || '—'}</span>
            </div>
          </div>

          {error && (
            <div style={{ background: 'rgba(255,77,77,0.08)', border: '1px solid rgba(255,77,77,0.2)', borderRadius: 'var(--radius-sm)', padding: '12px 16px', fontSize: 12, color: 'var(--red)' }}>
              ⚠ {error}
            </div>
          )}

          {loading && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              <div style={{ fontSize: 12 }}>Executing query &amp; calculating emissions...</div>
            </div>
          )}

          {result && !loading && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Analysis Results</span>
                <span className={`badge ${badgeCls}`}>{cls}</span>
              </div>

              {/* Gauge + legend */}
              <div className="card" style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'center' }}>
                <SustainabilityGauge score={result.sustainability_score} />
                <div>
                  {[
                    { label: 'Excellent', color: '#00ff88', range: '90 – 100' },
                    { label: 'Good', color: '#4dc9ff', range: '70 – 89' },
                    { label: 'Moderate', color: '#f5a623', range: '50 – 69' },
                    { label: 'Poor', color: '#ff8844', range: '25 – 49' },
                    { label: 'Critical', color: '#ff4d4d', range: '0 – 24' },
                  ].map(d => (
                    <div key={d.label} className="legend-item">
                      <div className="legend-label"><div className="legend-dot" style={{ background: d.color }} />{d.label}</div>
                      <span className="legend-range">{d.range}</span>
                    </div>
                  ))}
                </div>
              </div>

              <ResultMetric label="Energy Consumption" value={result.energy_kwh.toFixed(8)} unit="kWh" />
              <ResultMetric label="Operational Emissions" value={fmtGco2(result.operational_emissions_gco2)} unit="gCO₂" />
              <ResultMetric label="Embodied Emissions" value={fmtGco2(result.embodied_emissions_gco2)} unit="gCO₂" />

              <div className="sci-box">
                <div className="sci-label">Total SCI Score · Software Carbon Intensity</div>
                <div className="sci-value" style={{ color: clsColor }}>{fmtGco2(result.sci)}</div>
                <div className="sci-unit">gCO₂ / query</div>
              </div>

              {/* Results preview */}
              {result.results_preview?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                    Query Results: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{result.row_count} row{result.row_count !== 1 ? 's' : ''}</span> 
                    (showing first {Math.min(result.results_preview.length, 10)})
                  </div>
                  <div className="results-preview">
                    <table>
                      <thead>
                        <tr>{result.fields.map(f => <th key={f}>{f}</th>)}</tr>
                      </thead>
                      <tbody>
                        {result.results_preview.map((row, i) => (
                          <tr key={i}>
                            {result.fields.map(f => <td key={f}>{String(row[f] ?? '')}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Runtime info */}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
                QID-{result.query_id} · Actual: <span title={`Measured time: ${result.actual_runtime_ms.toFixed(3)}ms`}>{result.actual_runtime_ms.toFixed(3)}ms</span>
                {result.tables_involved?.length > 0 && ` · ${result.tables_involved.length} table ${result.tables_involved.length > 1 ? 'JOIN' : ''}`}
              </div>
            </>
          )}

          {!result && !loading && !error && (
            <div className="empty-state">
              <div className="empty-state-icon">⚡</div>
              <div className="empty-state-text">
                Enter a SQL query and click <strong>Analyze Query</strong> to measure the carbon footprint (or press <code>Ctrl+Enter</code>).
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
