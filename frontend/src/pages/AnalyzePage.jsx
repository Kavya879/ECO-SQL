import React, { useState, useEffect, useRef } from 'react';
import { analyzeQuery, getDatabases, getHardwareConfig } from '../api/api.js';
import { fmtEnergy, fmtGco2, fmtRuntime, classificationBadge } from '../utils/format.js';
import { ResultMetric, SustainabilityGauge, MetricTile, SectionCard, ReportBlock, SummaryMetric, InlinePill, QueryComparison } from '../components/analyze/AnalysisUI.jsx';

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
  powerPerCore: 10,
  cpuUtilization: 0.5,
  ramGb: 32,
  pue: 1.3,
  gridIntensity: 475,
  te: 100000,
  el: 48180,
  rr: 0.05,
  tor: 11000,
};

function hasMeaningfulItems(items, placeholderPrefixes = []) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.some(item => {
    const text = String(item?.issue || item?.problem || item || '').trim();
    if (!text) return false;
    return !placeholderPrefixes.some(prefix => text.toLowerCase().startsWith(prefix.toLowerCase()));
  });
}

function formatReportItems(items, kind) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  return items.map((item, index) => {
    if (kind === 'rule') {
      return {
        title: item.issue,
        body: [
          `Why inefficient: ${item.why_inefficient}`,
          `Rule violated: ${item.rule_violated}`,
          `Fix: ${item.fix}`,
        ],
        tone: item.rule_violated === 'N/A' ? 'neutral' : 'warning',
      };
    }

    if (kind === 'plan') {
      return {
        title: item.problem,
        body: [
          `Why it happens: ${item.why_it_happens}`,
          `Fix: ${item.fix}`,
        ],
        tone: 'warning',
      };
    }

    if (kind === 'schema') {
      return {
        title: item.problem,
        body: [`Fix: ${item.fix}`],
        tone: 'warning',
      };
    }

    return {
      title: `Item ${index + 1}`,
      body: [String(item)],
      tone: 'neutral',
    };
  });
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
    // Check for copied query from reports page
    const copiedQuery = sessionStorage.getItem('queryToCopy');
    if (copiedQuery) {
      setSql(copiedQuery);
      sessionStorage.removeItem('queryToCopy');
    }
    
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

  const optimizationReport = result?.optimization_report;
  const ruleIssues = optimizationReport?.rule_based_issues || [];
  const planIssues = optimizationReport?.execution_plan_issues || [];
  const schemaIssues = optimizationReport?.data_schema_issues || [];
  const meaningfulRuleIssues = hasMeaningfulItems(ruleIssues, ['no rule-based issues detected']);
  const meaningfulPlanIssues = hasMeaningfulItems(planIssues, ['no major execution-plan issue detected']);
  const meaningfulSchemaIssues = hasMeaningfulItems(schemaIssues, ['no schema/data issue detected']);
  const hasOptimizationFindings = meaningfulRuleIssues || meaningfulPlanIssues || meaningfulSchemaIssues || (result?.query_optimizations?.total_rewrites > 0);
  const reportOptimized = !hasOptimizationFindings;

  const reportSections = optimizationReport ? [
    {
      title: '1. Rule-Based Issues',
      items: formatReportItems(ruleIssues, 'rule'),
      accent: meaningfulRuleIssues ? 'var(--amber)' : 'var(--green)',
    },
    {
      title: '2. Execution Plan Issues',
      items: formatReportItems(planIssues, 'plan'),
      accent: meaningfulPlanIssues ? 'var(--amber)' : 'var(--green)',
    },
    {
      title: '3. Data / Schema Issues',
      items: formatReportItems(schemaIssues, 'schema'),
      accent: meaningfulSchemaIssues ? 'var(--amber)' : 'var(--green)',
    },
  ] : [];

  const queryComparison = optimizationReport?.query_comparison || result?.query_optimizations || null;
  const comparisonSummary = [];
  if (queryComparison) {
    const oldSql = String(queryComparison.original_sql || sql || '').trim();
    const newSql = String(queryComparison.suggested_sql || queryComparison.optimized_sql || '').trim();
    const originalLines = oldSql ? oldSql.split('\n').filter(line => line.trim()).length : 0;
    const suggestedLines = newSql ? newSql.split('\n').filter(line => line.trim()).length : 0;
    comparisonSummary.push({ label: 'Status', value: queryComparison.changed === false ? 'Unchanged' : 'Suggested rewrite' });
    comparisonSummary.push({ label: 'Old lines', value: String(originalLines) });
    comparisonSummary.push({ label: 'New lines', value: String(suggestedLines) });
  }

  const summaryMetrics = [
    { label: 'Energy', value: fmtEnergy(result?.energy_kwh || 0), unit: 'kWh', accent: 'var(--green)', sublabel: 'power consumed' },
    { label: 'Operational', value: fmtGco2(result?.operational_emissions_gco2 || 0), unit: 'gCO₂', accent: 'var(--blue)', sublabel: 'runtime emissions' },
    { label: 'Embodied', value: fmtGco2(result?.embodied_emissions_gco2 || 0), unit: 'gCO₂', accent: 'var(--amber)', sublabel: 'hardware share' },
    { label: 'SCI', value: fmtGco2(result?.sci || 0), unit: 'gCO₂/query', accent: clsColor, sublabel: 'carbon intensity' },
    { label: 'Runtime', value: fmtRuntime(result?.actual_runtime_ms || 0), unit: '', accent: 'var(--text-primary)', sublabel: 'measured execution' },
  ];

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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>Analysis Results</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>{cls || 'Pending'}</div>
                </div>
                <span className={`badge ${badgeCls}`} style={{ transform: 'scale(1.05)', transformOrigin: 'right center' }}>{cls}</span>
              </div>

              <SectionCard eyebrow="Overview" title="Carbon Summary" rightLabel={`${result.tier_label} · ${result.sustainability_score}/100`}>
                <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16, alignItems: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <SustainabilityGauge score={result.sustainability_score} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: clsColor, letterSpacing: '-0.4px' }}>{result.tier_label}</div>
                    <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: '1.65' }}>{result.tier_description}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                      {[
                        { label: 'Excellent', color: '#00ff88', range: '90 – 100' },
                        { label: 'Good', color: '#4dc9ff', range: '70 – 89' },
                        { label: 'Moderate', color: '#f5a623', range: '50 – 69' },
                        { label: 'Poor', color: '#ff8844', range: '25 – 49' },
                        { label: 'Critical', color: '#ff4d4d', range: '0 – 24' },
                      ].map(d => (
                        <div key={d.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 10, color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border-subtle)', borderRadius: 999, padding: '5px 9px' }}>
                          <div className="legend-dot" style={{ background: d.color }} />
                          <span>{d.label}</span>
                          <span style={{ color: 'var(--text-muted)' }}>{d.range}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="analysis-metrics-grid">
                  {summaryMetrics.map(metric => (
                    <MetricTile key={metric.label} {...metric} />
                  ))}
                </div>
              </SectionCard>

              {queryComparison && (
                <QueryComparison
                  originalSql={String(queryComparison.original_sql || sql || '').trim()}
                  suggestedSql={String(queryComparison.suggested_sql || queryComparison.optimized_sql || '').trim()}
                  changed={queryComparison.changed !== false}
                  summary={comparisonSummary}
                  originalLabel="Original SQL"
                  suggestedLabel="Suggested SQL"
                />
              )}

              {/* Index Rule Analysis - Debug View */}
              {result.index_rule_count !== undefined && (
                <>
                  {result.index_rule_count > 0 ? (
                    <SectionCard eyebrow="Index Signals" title={`PostgreSQL Index Issues (${result.index_rule_count})`} rightLabel={`-${result.index_combined_runtime_reduction_pct}% runtime`}>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid rgba(255, 152, 0, 0.1)', lineHeight: '1.6' }}>
                        Carbon impact: <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>-{result.index_combined_carbon_reduction_pct}%</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {result.index_violations && result.index_violations.map((v, i) => (
                          <div key={i} className="report-item" style={{ padding: '14px 15px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--amber)', fontWeight: 700 }}>{v.rule_id}</span>
                              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{v.confidence} confidence</span>
                            </div>
                            <div className="report-item-body" style={{ color: 'var(--text-secondary)' }}>{v.carbon_reason}</div>
                            {v.recommendation && <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 8, fontStyle: 'italic', lineHeight: '1.6' }}>💡 {v.recommendation}</div>}
                          </div>
                        ))}
                      </div>
                    </SectionCard>
                  ) : (
                    <div style={{ background: 'rgba(0, 200, 100, 0.08)', border: '1px solid rgba(0, 200, 100, 0.2)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', marginTop: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
                      <span style={{ color: 'var(--green)' }}>✓ No index issues detected</span>
                    </div>
                  )}
                </>
              )}

              {/* Query Optimizations */}
              {result.query_optimizations && (
                <>
                  {hasOptimizationFindings ? (
                    <SectionCard eyebrow="Optimization" title={`Query Optimization ${result.query_optimizations.total_rewrites > 0 ? `(${result.query_optimizations.total_rewrites} applied)` : 'Findings'}`} rightLabel={result.query_optimizations.total_rewrites > 0 ? 'rewrites applied' : 'review findings'}>
                      <div style={{ fontSize: 12, color: 'var(--cyan)', fontWeight: 700, marginBottom: 10, lineHeight: '1.5' }}>
                        {result.query_optimizations.total_rewrites > 0 ? '✓ Rewrites applied' : '⚠️ Review findings'}
                      </div>
                      
                      {/* Rewrites List */}
                      {result.query_optimizations.rewrites_applied.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                          {result.query_optimizations.rewrites_applied.map((rewrite, i) => (
                            <div key={i} style={{ background: 'rgba(0,0,0,0.2)', padding: '12px 14px', borderRadius: '6px', fontSize: 10.5 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--cyan)', fontWeight: 700 }}>{rewrite.rule_id}</span>
                                <span style={{ fontSize: 9, color: 'var(--green)' }}>-{rewrite.estimated_carbon_reduction_pct}% carbon</span>
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 5 }}>{rewrite.rewrite_name}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: '1.45', marginBottom: 8 }}>{rewrite.description}</div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 9.5 }}>
                                <div style={{ background: 'rgba(255,77,77,0.1)', padding: '8px 10px', borderRadius: '4px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', maxHeight: '96px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'pre-wrap' }}>
                                  <strong style={{ color: 'var(--red)' }}>Before:</strong> {rewrite.before_snippet}
                                </div>
                                <div style={{ background: 'rgba(0,200,100,0.1)', padding: '8px 10px', borderRadius: '4px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', maxHeight: '96px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'pre-wrap' }}>
                                  <strong style={{ color: 'var(--green)' }}>After:</strong> {rewrite.after_snippet}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {/* Optimization Notes */}
                      {result.query_optimizations.optimization_notes && (
                        <div style={{ background: 'rgba(0,0,0,0.15)', padding: '10px 12px', borderRadius: '6px', fontSize: 10, color: 'var(--text-secondary)', lineHeight: '1.55', whiteSpace: 'pre-wrap' }}>
                          {result.query_optimizations.optimization_notes}
                        </div>
                      )}
                    </SectionCard>
                  ) : (
                    <div style={{ background: 'rgba(77, 201, 255, 0.08)', border: '1px solid rgba(77, 201, 255, 0.2)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', marginTop: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
                      <span style={{ color: 'var(--cyan)' }}>✓ No automatic rewrite needed</span>
                    </div>
                  )}
                </>
              )}

              {/* Strict Optimization Report */}
              {result.optimization_report_text && (
                <SectionCard eyebrow="Report" title="Production SQL Optimization Report" rightLabel={reportOptimized ? 'optimized' : 'needs work'}>
                  <div className="analysis-report-summary">
                    <div className="analysis-report-summary-card"><div className="analysis-report-summary-label">Rules</div><div className="analysis-report-summary-value" style={{ color: meaningfulRuleIssues ? 'var(--amber)' : 'var(--green)' }}>{ruleIssues.length}</div></div>
                    <div className="analysis-report-summary-card"><div className="analysis-report-summary-label">Plan</div><div className="analysis-report-summary-value" style={{ color: meaningfulPlanIssues ? 'var(--amber)' : 'var(--green)' }}>{planIssues.length}</div></div>
                    <div className="analysis-report-summary-card"><div className="analysis-report-summary-label">Schema</div><div className="analysis-report-summary-value" style={{ color: meaningfulSchemaIssues ? 'var(--amber)' : 'var(--green)' }}>{schemaIssues.length}</div></div>
                  </div>

                  <div className="analysis-report-grid">
                    <ReportBlock title="1. Rule-Based Issues" items={reportSections[0]?.items || []} accent={reportSections[0]?.accent} />
                    <ReportBlock title="2. Execution Plan Issues" items={reportSections[1]?.items || []} accent={reportSections[1]?.accent} />
                    <ReportBlock title="3. Data / Schema Issues" items={reportSections[2]?.items || []} accent={reportSections[2]?.accent} />
                  </div>

                  <div className="analysis-report-optimized">
                    <div className="analysis-report-optimized-card">
                      <div className="analysis-report-optimized-title">4. Optimized Query</div>
                      <div className="analysis-report-optimized-body">{optimizationReport.optimized_query}</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div className="analysis-report-optimized-card">
                        <div className="analysis-report-optimized-title">6. Performance Impact</div>
                        <div className="analysis-report-optimized-body">
                          <div>Before: {optimizationReport.performance_impact.before.runtime_ms} ms, {optimizationReport.performance_impact.before.sci_gco2eq} gCO2eq</div>
                          <div>After: {optimizationReport.performance_impact.after.runtime_ms} ms, {optimizationReport.performance_impact.after.sci_gco2eq} gCO2eq</div>
                          <div>Expected improvement: {optimizationReport.performance_impact.expected_improvement.runtime_reduction_pct}% runtime, {optimizationReport.performance_impact.expected_improvement.carbon_reduction_pct}% carbon</div>
                        </div>
                      </div>
                      <div className="analysis-report-optimized-card">
                        <div className="analysis-report-optimized-title">7. Trade-Offs</div>
                        <div className="analysis-report-optimized-body">{optimizationReport.trade_offs.map((item, idx) => <div key={idx}>• {item}</div>)}</div>
                      </div>
                    </div>
                  </div>
                </SectionCard>
              )}

              {/* Results preview */}
              {result.results_preview?.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
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
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
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
