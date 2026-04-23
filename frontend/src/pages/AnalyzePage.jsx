import React, { useState, useEffect, useRef, useCallback } from 'react';
import { analyzeQuery, getDatabases, getHardwareConfig, optimizeQuery } from '../api/api.js';
import { fmtEnergy, fmtGco2, fmtRuntime } from '../utils/format.js';
import FindingCard from '../components/FindingCard.jsx';

const SQL_DRAFT_KEY = 'analyzeSqlDraft';

const DEFAULTS = {
  cpuCores: 16, powerPerCore: 10, cpuUtilization: 0.5,
  ramGb: 32, pue: 1.3, gridIntensity: 475,
  te: 100000, el: 48180, rr: 0.05, tor: 11000,
};

/* ─── SQL rewriter (apply finding to SQL) ───────────────────── */
function applyFindingToSql(sql, finding) {
  const id = finding.rule_id || finding.pattern_id || '';

  // EXPLAIN findings: inject CREATE INDEX DDL
  if (finding.track === 'explain_analysis' && finding.index_ddl) {
    return [
      `-- ⚡ INDEX SUGGESTION [${id}] — severity: ${finding.severity}`,
      `-- Run this statement, then re-analyze:`,
      `${finding.index_ddl};`,
      ``,
      `-- ── Original query (unchanged) ──`,
      sql,
    ].join('\n');
  }

  let s = sql;

  // R4: SELECT * → SELECT <columns>
  if (id === 'R4' || (finding.title || '').includes('SELECT *')) {
    const cols = finding.suggested_columns?.join(', ') || 'id, name, created_at';
    s = s.replace(/SELECT\s+\*/gi, `SELECT ${cols}`);
    return s !== sql ? s : `-- TODO: Replace SELECT * with explicit columns\n${sql}`;
  }

  // R6: LIKE '%...' leading wildcard
  if (id === 'R6') {
    return `-- ⚠ Leading-wildcard LIKE cannot use index. Consider full-text search:\n-- CREATE INDEX … USING GIN(col gin_trgm_ops);\n${sql}`;
  }

  // R7: DISTINCT → GROUP BY
  if (id === 'R7') {
    s = s.replace(/SELECT\s+DISTINCT\s+/gi, 'SELECT ');
    const cols = s.match(/SELECT\s+([\s\S]+?)\s+FROM/i)?.[1]?.trim() || 'col';
    if (!/(GROUP BY)/i.test(s)) {
      s = s.replace(/;?\s*$/, '') + `\nGROUP BY ${cols};`;
    }
    return s;
  }

  // R8: OR → UNION ALL
  if (id === 'R8') {
    return `-- ⚡ Rewrite OR as UNION ALL for better index utilization:\n${sql}\n-- TODO: Split WHERE x=a OR x=b into two queries joined with UNION ALL`;
  }

  // R9: NOT IN → NOT EXISTS
  if (id === 'R9') {
    s = s.replace(/NOT\s+IN\s*\(/gi, 'NOT EXISTS (SELECT 1 FROM ');
    return s !== sql ? s : `-- TODO: Replace NOT IN with NOT EXISTS\n${sql}`;
  }

  // R11: functions on indexed cols
  if (id === 'R11') {
    return `-- ⚡ Avoid wrapping indexed columns in functions; use range predicates:\n${sql}\n-- Example: WHERE created_at >= '2024-01-01' instead of WHERE YEAR(created_at) = 2024`;
  }

  // R12: implicit cast / type mismatch
  if (id === 'R12') {
    return `-- ⚠ Implicit type cast prevents index use. Ensure literal type matches column type:\n${sql}`;
  }

  // R1: N+1 / subquery → JOIN
  if (id === 'R1') {
    return `-- ⚡ Replace correlated subquery with a JOIN:\n${sql}\n-- TODO: Refactor subquery into a JOIN to allow the query planner to optimise`;
  }

  // R2: Missing index
  if (id === 'R2') {
    const table  = finding.table  || 'your_table';
    const column = finding.column || 'your_column';
    return `-- ⚡ Add an index to improve filter performance:\nCREATE INDEX CONCURRENTLY idx_${table}_${column} ON ${table}(${column});\n\n-- Original query:\n${sql}`;
  }

  // R3: CROSS JOIN / cartesian product
  if (id === 'R3') {
    return `-- ⚠ Cartesian CROSS JOIN detected – add explicit JOIN condition:\n${sql}\n-- TODO: Replace CROSS JOIN with INNER JOIN … ON t1.id = t2.fk_id`;
  }

  // R5: ORDER BY without LIMIT
  if (id === 'R5') {
    if (!/\bLIMIT\b/i.test(s)) {
      s = s.replace(/;?\s*$/, '') + '\nLIMIT 100;';
    }
    return s;
  }

  // R10: Non-SARGable predicate
  if (id === 'R10') {
    return `-- ⚡ Predicate is non-SARGable (prevents index seek). Rewrite to avoid functions on the LHS:\n${sql}`;
  }

  // Fallback: prepend suggestion as comment
  return `-- 💡 [${id}] ${finding.suggestion || finding.description || ''}\n${sql}`;
}

/* ─── Tier colours ───────────────────────────────────────────── */
function tierInfo(cls) {
  const c = String(cls || '').toUpperCase();
  if (c === 'EXCELLENT' || c === 'SUSTAINABLE')
    return { pillCls: 'tier-excellent', numCls: '',      icon: 'verified' };
  if (c === 'GOOD')
    return { pillCls: 'tier-good',      numCls: '',      icon: 'thumb_up' };
  if (c === 'MODERATE')
    return { pillCls: 'tier-moderate',  numCls: 'amber', icon: 'warning' };
  if (c === 'POOR')
    return { pillCls: 'tier-poor',      numCls: 'red',   icon: 'error' };
  return   { pillCls: 'tier-critical',  numCls: 'red',   icon: 'dangerous' };
}

export default function AnalyzePage() {
  const [sql, setSql]               = useState('');
  const [databases, setDbs]         = useState([]);
  const [selectedDb, setDb]         = useState('');
  const [hw, setHw]                 = useState(DEFAULTS);
  const [hwOpen, setHwOpen]         = useState(false);
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState(null);
  const [error, setError]           = useState(null);
  const [activeTab, setTab]         = useState('results');
  const [optimizing, setOptimizing] = useState(false);
  const [optResult, setOptResult]   = useState(null);
  const [optError, setOptError]     = useState(null);
  const [filterSev, setFilterSev]   = useState('all');
  const [toast, setToast]           = useState('');
  const textareaRef                 = useRef(null);

  /* ── Load draft / copied query on mount ── */
  useEffect(() => {
    const copied = sessionStorage.getItem('queryToCopy');
    if (copied) { setSql(copied); sessionStorage.removeItem('queryToCopy'); }
    else {
      const saved = sessionStorage.getItem(SQL_DRAFT_KEY);
      if (saved) setSql(saved);
    }

    getDatabases()
      .then(d => {
        setDbs(d.databases || []);
        if (d.databases?.length) setDb(d.databases[0].name);
      }).catch(() => {});

    getHardwareConfig()
      .then(cfg => setHw(prev => ({ ...prev, ...cfg })))
      .catch(() => {});
  }, []);

  /* ── Persist draft ── */
  useEffect(() => {
    if (sql) sessionStorage.setItem(SQL_DRAFT_KEY, sql);
    else sessionStorage.removeItem(SQL_DRAFT_KEY);
  }, [sql]);

  const lineCount = Math.max(sql.split('\n').length, 10);

  /* ── Analyze ── */
  const handleAnalyze = async () => {
    if (!sql.trim()) { setError('Please enter a SQL query.'); return; }
    if (!selectedDb) { setError('Please select a database.'); return; }
    setLoading(true); setError(null); setResult(null);
    setOptResult(null); setOptError(null); setTab('results');
    try {
      const res = await analyzeQuery({ sql, database: selectedDb, ...hw });
      setResult(res);
      if (res.query_id) runOptimize(res.query_id);
    } catch (e) {
      setError(e.response?.data?.detail || e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  };

  /* ── Optimize ── */
  const runOptimize = useCallback(async (queryId) => {
    setOptimizing(true); setOptError(null);
    try {
      const res = await optimizeQuery(queryId);
      setOptResult(res);
      if ((res.findings?.length || 0) > 0) setTab('optimization');
    } catch (e) {
      setOptError(e.response?.data?.error || e.message);
    } finally { setOptimizing(false); }
  }, []);

  /* ── Apply finding to editor ── */
  const handleApply = (finding) => {
    const newSql = applyFindingToSql(sql, finding);
    setSql(newSql);
    setResult(null); setOptResult(null);
    setToast('✓ Fix applied — review the query and re-analyze.');
    setTimeout(() => setToast(''), 3500);
    textareaRef.current?.focus();
  };

  /* ── Tab key in textarea ── */
  const handleKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = e.target.selectionStart;
      const v = sql.substring(0, s) + '  ' + sql.substring(e.target.selectionEnd);
      setSql(v);
      setTimeout(() => e.target.setSelectionRange(s + 2, s + 2), 0);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault(); handleAnalyze();
    }
  };

  const updateHw = (k, v) => setHw(prev => ({ ...prev, [k]: v }));

  const findings  = optResult?.findings || [];
  const filtered  = filterSev === 'all' ? findings
    : findings.filter(f => {
      const s = String(f.severity || '').toLowerCase();
      if (filterSev === 'high')   return s === 'high'   || s === 'critical';
      if (filterSev === 'medium') return s === 'medium' || s === 'moderate';
      if (filterSev === 'low')    return s === 'low';
      return true;
    });

  const highCount   = findings.filter(f => ['high','critical'].includes(String(f.severity).toLowerCase())).length;
  const totalCount  = findings.length;

  const hasResultSet = Array.isArray(result?.fields) && result.fields.length > 0;
  const previewRows  = result?.results_preview || [];

  const cls   = result?.classification;
  const tInfo = tierInfo(cls);

  /* ─── Render ─────────────────────────────────────────────── */
  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-head">
        <div>
          <div className="page-title">Analyze Query</div>
          <div className="page-desc">Construct and profile your SQL queries for carbon &amp; performance impact.</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <label className="field-label">Target Database</label>
          <div style={{ position: 'relative' }}>
            <select
              className="select"
              style={{ width: 200 }}
              value={selectedDb}
              onChange={e => setDb(e.target.value)}
            >
              {databases.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
              {databases.length === 0 && <option value="">Loading…</option>}
            </select>
          </div>
        </div>
      </div>

      {/* ── Editor Card ── */}
      <div className="editor-card">
        <div className="editor-toolbar">
          <div className="editor-toolbar-left">
            <button className="toolbar-btn" title="Format query">
              <span className="material-symbols-outlined sz-16">subject</span>
            </button>
            <button
              className="toolbar-btn"
              title="Clear editor"
              onClick={() => { setSql(''); setResult(null); setError(null); setOptResult(null); }}
            >
              <span className="material-symbols-outlined sz-16">delete_sweep</span>
            </button>
            <div className="toolbar-divider" />
            <div className="connection-status">
              <span className="pulse-dot" />
              Connection active
            </div>
          </div>
          <div className="editor-toolbar-right">
            {result && (
              <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                QID-{result.query_id}
              </span>
            )}
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {lineCount} lines
            </span>
          </div>
        </div>

        <div className="editor-body">
          <div className="line-gutter">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="line-num">{i + 1}</div>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            className="sql-area"
            value={sql}
            onChange={e => setSql(e.target.value)}
            placeholder="-- Write your SQL query here…&#10;-- Press Ctrl+Enter to analyze"
            spellCheck={false}
            onKeyDown={handleKeyDown}
            style={{ minHeight: 280 }}
          />
        </div>

        <div className="editor-footer">
          <div className="editor-footer-info">
            <span className="material-symbols-outlined sz-16">info</span>
            {result ? `Last result: ${fmtRuntime(result.db_runtime_ms ? result.db_runtime_ms / 1000 : result.actual_runtime_ms / 1000)}` : 'Ready to analyze'}
          </div>
          <div className="editor-footer-actions">
            <button
              className="btn btn-outline btn-sm"
              onClick={() => {
                const sample = `SELECT f.title, c.name AS category, COUNT(r.rental_id) AS rental_count\nFROM film f\nJOIN film_category fc ON f.film_id = fc.film_id\nJOIN category c ON fc.category_id = c.category_id\nLEFT JOIN inventory i ON f.film_id = i.film_id\nLEFT JOIN rental r ON i.inventory_id = r.inventory_id\nGROUP BY f.title, c.name\nORDER BY rental_count DESC\nLIMIT 20;`;
                setSql(sample);
              }}
            >
              Load Sample
            </button>
            <button
              className="btn btn-primary"
              onClick={handleAnalyze}
              disabled={loading}
              title="Ctrl+Enter"
            >
              {loading
                ? <><span className="spinner" /> Analyzing…</>
                : <><span className="material-symbols-outlined sz-16">bolt</span> Analyze Query</>
              }
            </button>
          </div>
        </div>
      </div>

      {/* ── Advanced Hardware Config ── */}
      <div className="collapsible">
        <div className="collapsible-header" onClick={() => setHwOpen(v => !v)}>
          <div className="collapsible-header-left">
            <span className="material-symbols-outlined sz-16"
              style={{ color: hwOpen ? 'var(--green)' : 'var(--text-muted)' }}>tune</span>
            Advanced Hardware Config
          </div>
          <span className={`material-symbols-outlined collapsible-icon${hwOpen ? ' open' : ''}`}>expand_more</span>
        </div>

        {hwOpen && (
          <div className="collapsible-body">
            {[
              { label: 'CPU Cores',              key: 'cpuCores',      type: 'number', min: 1, max: 512, hint: 'physical cores' },
              { label: 'RAM (GB)',               key: 'ramGb',         type: 'number', min: 1,           hint: 'gigabytes' },
              { label: 'Grid Carbon (gCO₂/kWh)', key: 'gridIntensity', type: 'number', min: 0,           hint: 'India:442 · US:386 · EU:233' },
              { label: 'Power/Core (W)',          key: 'powerPerCore',  type: 'number', min: 1,           hint: 'watts per core' },
              { label: 'PUE Factor',              key: 'pue',           type: 'number', min: 1, step: 0.01, hint: 'power usage effectiveness' },
              { label: 'CPU Utilization',         key: 'cpuUtilization',type: 'number', min: 0, max: 1, step: 0.01, hint: '0 – 1 (50% = 0.5)' },
            ].map(({ label, key, hint, ...rest }) => (
              <div key={key} className="field">
                <label className="field-label">{label}</label>
                <input
                  className="input input-mono"
                  value={hw[key]}
                  onChange={e => updateHw(key, parseFloat(e.target.value) || 0)}
                  {...rest}
                />
                <span className="field-hint">{hint}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="error-box fade-in">
          <span className="material-symbols-outlined sz-16">error</span>
          {error}
        </div>
      )}

      {/* ── Results ── */}
      {result && !loading && (
        <div className="results-section fade-in">
          {/* Target Query card */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">
                <span className="material-symbols-outlined sz-16" style={{ color: 'var(--cyan)' }}>code</span>
                Target Query
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-outline btn-sm" onClick={() => { setResult(null); setOptResult(null); }}>
                  Clear Results
                </button>
                <button className="btn btn-primary btn-sm" onClick={handleAnalyze}>
                  <span className="material-symbols-outlined sz-16">play_arrow</span>
                  Re-Analyze
                </button>
              </div>
            </div>
            <pre style={{
              padding: '14px 16px',
              background: 'var(--bg-code)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--text-muted)',
              lineHeight: 1.7,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              maxHeight: 200,
            }}>
              {sql}
            </pre>
          </div>

          {/* Score + Metrics Grid */}
          <div className="results-grid">
            {/* Score card */}
            <div className="score-card">
              <div className="score-label">Sustainability Score</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 12 }}>
                <span className={`score-number ${tInfo.numCls}`}>
                  {result.sustainability_score ?? '—'}
                </span>
                <span className="score-denom">/100</span>
              </div>
              <div className={`tier-pill ${tInfo.pillCls}`} style={{ fontSize: 11, padding: '4px 12px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{tInfo.icon}</span>
                TIER: {cls || 'UNKNOWN'}
              </div>
            </div>

            {/* Metrics 2×2 */}
            <div className="metrics-grid">
              <div className="metric-tile">
                <div className="metric-tile-top">
                  <span className="material-symbols-outlined metric-tile-icon" style={{ color: 'var(--cyan)' }}>bolt</span>
                  <span className="metric-tile-label">Energy Est.</span>
                </div>
                <div>
                  <div className="metric-tile-value">{fmtEnergy(result.energy_kwh)}</div>
                </div>
              </div>

              <div className="metric-tile">
                <div className="metric-tile-top">
                  <span className="material-symbols-outlined metric-tile-icon" style={{ color: 'var(--amber)' }}>factory</span>
                  <span className="metric-tile-label">Operational</span>
                </div>
                <div>
                  <div className="metric-tile-value">{fmtGco2(result.operational_emissions_gco2)}</div>
                  <div className="metric-tile-unit">gCO₂eq</div>
                </div>
              </div>

              <div className="metric-tile">
                <div className="metric-tile-top">
                  <span className="material-symbols-outlined metric-tile-icon" style={{ color: 'var(--text-dim)' }}>domain</span>
                  <span className="metric-tile-label">Embodied</span>
                </div>
                <div>
                  <div className="metric-tile-value">{fmtGco2(result.embodied_emissions_gco2)}</div>
                  <div className="metric-tile-unit">gCO₂eq</div>
                </div>
              </div>

              <div className="metric-tile total">
                <div className="metric-tile-top">
                  <span className="material-symbols-outlined metric-tile-icon" style={{ color: 'var(--green)' }}>public</span>
                  <span className="metric-tile-label">Total Footprint</span>
                </div>
                <div>
                  <div className={`metric-tile-value green`}>{fmtGco2(result.sci)}</div>
                  <div className="metric-tile-unit">gCO₂eq / run</div>
                </div>
              </div>
            </div>
          </div>

          {/* Tabs: Results | Optimization */}
          <div className="card">
            <div className="panel-tabs">
              <button
                className={`panel-tab${activeTab === 'results' ? ' active' : ''}`}
                onClick={() => setTab('results')}
              >
                <span className="material-symbols-outlined sz-16">table_rows</span>
                Data Preview
              </button>
              <button
                className={`panel-tab${activeTab === 'optimization' ? ' active' : ''}`}
                onClick={() => setTab('optimization')}
              >
                <span className="material-symbols-outlined sz-16">tips_and_updates</span>
                Optimization
                {optimizing && <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />}
                {!optimizing && totalCount > 0 && (
                  <span className={`panel-tab-badge${highCount > 0 ? ' amber' : ''}`}>{totalCount}</span>
                )}
              </button>
            </div>

            {/* Results tab */}
            {activeTab === 'results' && (
              <div style={{ padding: '16px' }}>
                {hasResultSet ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        <span className="material-symbols-outlined sz-16">table_rows</span>{' '}
                        <strong style={{ color: 'var(--text)' }}>{result.row_count}</strong> rows returned
                        <span className="preview-badge" style={{ marginLeft: 8 }}>
                          Showing first {Math.min(previewRows.length, 10)}
                        </span>
                      </div>
                    </div>
                    <div style={{ overflow: 'auto', maxHeight: 280, border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
                      <table className="preview-table" style={{ width: '100%' }}>
                        <thead>
                          <tr>{result.fields.map(f => <th key={f}>{f}</th>)}</tr>
                        </thead>
                        <tbody>
                          {previewRows.length > 0 ? previewRows.map((row, i) => (
                            <tr key={i}>
                              {result.fields.map(f => (
                                <td key={f}>{String(row[f] ?? '')}</td>
                              ))}
                            </tr>
                          )) : (
                            <tr>
                              <td colSpan={result.fields.length} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>
                                Query executed, 0 rows returned.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 32, display: 'block', marginBottom: 8, opacity: 0.4 }}>check_circle</span>
                    Query executed successfully.
                    {typeof result.row_count === 'number' && ` Affected rows: ${result.row_count}.`}
                  </div>
                )}
                {/* Runtime info */}
                <div style={{
                  marginTop: 12, paddingTop: 10,
                  borderTop: '1px solid var(--border)',
                  display: 'flex', gap: 16,
                  fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)',
                }}>
                  <span>QID-{result.query_id}</span>
                  <span>Analysis: {((result.analysis_runtime_ms ?? result.actual_runtime_ms) / 1000).toFixed(3)}s</span>
                  {typeof result.db_runtime_ms === 'number' && (
                    <span>DB: {(result.db_runtime_ms / 1000).toFixed(3)}s</span>
                  )}
                  {result.tables_involved?.length > 0 && (
                    <span>{result.tables_involved.length} table(s)</span>
                  )}
                </div>
              </div>
            )}

            {/* Optimization tab */}
            {activeTab === 'optimization' && (
              <div style={{ padding: '16px' }}>
                {optimizing && (
                  <div className="opt-scanning">
                    <span className="spinner" />
                    Scanning query plan, indexes and patterns…
                  </div>
                )}

                {optError && !optimizing && (
                  <div className="error-box">
                    <span className="material-symbols-outlined sz-16">error</span>
                    Optimizer error: {optError}
                  </div>
                )}

                {!optimizing && !optError && findings.length === 0 && (
                  <div className="empty-state" style={{ padding: '28px 0' }}>
                    <span className="material-symbols-outlined empty-icon" style={{ color: 'var(--green)' }}>
                      verified
                    </span>
                    <div className="empty-text">
                      <strong>No optimization issues found.</strong>{' '}
                      This query follows efficient patterns.
                    </div>
                  </div>
                )}

                {!optimizing && findings.length > 0 && (
                  <>
                    <div className="findings-header">
                      <div className="findings-title">
                        <span className="material-symbols-outlined sz-16" style={{ color: 'var(--amber)' }}>warning</span>
                        {totalCount} Finding{totalCount !== 1 ? 's' : ''}
                        {highCount > 0 && (
                          <span style={{ color: 'var(--red)', fontSize: 11, fontWeight: 400 }}>
                            ({highCount} high impact)
                          </span>
                        )}
                      </div>
                      <div className="sev-filter">
                        {[
                          { id: 'all', label: 'All' },
                          { id: 'high', label: 'High' },
                          { id: 'medium', label: 'Medium' },
                          { id: 'low', label: 'Low' },
                        ].map(({ id, label }) => (
                          <button
                            key={id}
                            className={`sev-chip ${id}${filterSev === id ? ' active' : ''}`}
                            onClick={() => setFilterSev(id)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {filtered.length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', padding: '16px 0' }}>
                        No findings at this severity level.
                      </p>
                    ) : (
                      filtered.map((f, i) => (
                        <FindingCard key={i} finding={f} onApply={handleApply} />
                      ))
                    )}

                    {optResult?.summary && (
                      <div style={{
                        marginTop: 12, padding: '12px 14px',
                        background: 'var(--bg-surface-lo)',
                        borderRadius: 'var(--r-md)',
                        fontSize: 12, color: 'var(--text-muted)',
                        display: 'flex', flexDirection: 'column', gap: 6,
                      }}>
                        {optResult.summary.performanceImpact && (
                          <div>
                            <span style={{ color: 'var(--text-dim)' }}>Performance: </span>
                            {optResult.summary.performanceImpact}
                          </div>
                        )}
                        {optResult.summary.carbonImpact && (
                          <div>
                            <span style={{ color: 'var(--text-dim)' }}>Carbon: </span>
                            {optResult.summary.carbonImpact}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {!result && !loading && !error && (
        <div className="empty-state" style={{ marginTop: 32 }}>
          <span className="material-symbols-outlined empty-icon">bolt</span>
          <div className="empty-text">
            Enter a SQL query above and click <strong>Analyze Query</strong> to measure carbon
            footprint and get optimization suggestions.
            <br />Press <code>Ctrl+Enter</code> to run.
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="toast">
          <span className="material-symbols-outlined sz-16" style={{ color: 'var(--green)' }}>check_circle</span>
          {toast}
        </div>
      )}
    </div>
  );
}
