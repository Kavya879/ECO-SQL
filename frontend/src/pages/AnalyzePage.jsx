import React, { useState, useEffect, useRef, useCallback } from 'react';
import { analyzeQuery, getDatabases, getHardwareConfig, optimizeQuery } from '../api/api.js';
import { fmtGco2 } from '../utils/format.js';
import FindingCard from '../components/FindingCard.jsx';

// ─── Sample query ───────────────────────────────────────────────────────────

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

// ─── Small sub-components ────────────────────────────────────────────────────

function ResultMetric({ label, value, unit, color }) {
  return (
    <div className="result-metric">
      <div className="result-metric-label">{label}</div>
      <div>
        <span className="result-metric-value" style={color ? { color } : {}}>{value}</span>
        {unit && <span className="result-metric-unit"> {unit}</span>}
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

const SEV_COLOR = { high: 'var(--red)', medium: 'var(--amber)', low: 'var(--blue)' };

function SeveritySummary({ findings }) {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of findings) if (counts[f.severity] != null) counts[f.severity]++;
  return (
    <div className="sev-strip">
      {Object.entries(counts).map(([sev, n]) => (
        <div key={sev} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: SEV_COLOR[sev] }} />
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: SEV_COLOR[sev] }}>
            {n} {sev}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Apply suggestion to SQL ─────────────────────────────────────────────────

/**
 * Rewrite the SQL string based on the optimization finding.
 *
 * EXPLAIN findings (index_ddl)  → prepend a runnable CREATE INDEX statement.
 * SQL-pattern findings (R1–R12) → perform an actual structural rewrite where
 *   feasible; fall back to an annotated TODO template for complex cases.
 */
function applyFindingToSql(sql, finding) {
  const id = finding.rule_id || finding.pattern_id || '';

  // ── EXPLAIN findings: load CREATE INDEX DDL into editor ──────────────────
  if (finding.track === 'explain_analysis' && finding.index_ddl) {
    return [
      `-- ⚡ INDEX SUGGESTION [${id}] — severity: ${finding.severity}`,
      `-- Run this statement to create the suggested index, then re-analyze:`,
      `${finding.index_ddl};`,
      ``,
      `-- ────────────────────────────────────────────────────`,
      `-- Original query (unchanged):`,
      sql,
    ].join('\n');
  }

  // ── R4 — OR equality conditions → IN ─────────────────────────────────────
  if (id === 'R4') {
    const valPat = `'[^']*'|"[^"]*"|\\d+(?:\\.\\d+)?`;
    const re = new RegExp(
      `\\b(\\w+)\\s*=\\s*(${valPat})(?:\\s+OR\\s+\\1\\s*=\\s*(${valPat}))+`,
      'gi',
    );
    const fixed = sql.replace(re, (match, col) => {
      const vals = [...match.matchAll(new RegExp(`=\\s*(${valPat})`, 'g'))].map(m => m[1]);
      return `${col} IN (${vals.join(', ')})`;
    });
    if (fixed !== sql) {
      return `-- ⚡ FIXED [R4]: Replaced OR equality conditions with IN\n${fixed}`;
    }
    return `-- TODO [R4]: Replace col = X OR col = Y with col IN (X, Y)\n${sql}`;
  }

  // ── R6 — large OFFSET → keyset pagination ────────────────────────────────
  if (id === 'R6') {
    const orderMatch = sql.match(/ORDER\s+BY\s+([a-zA-Z_][a-zA-Z0-9_.]*)/i);
    const sortCol    = orderMatch ? orderMatch[1] : 'sort_column';
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    const limitVal   = limitMatch ? limitMatch[1] : 'N';

    // Strip OFFSET from LIMIT N OFFSET M or standalone OFFSET M
    let fixed = sql
      .replace(/\bLIMIT\s+\d+\s+OFFSET\s+\d+/i, `LIMIT ${limitVal}`)
      .replace(/\bOFFSET\s+\d+/i, '');

    // Insert keyset WHERE condition
    if (/\bWHERE\b/i.test(fixed)) {
      fixed = fixed.replace(/\bWHERE\b/i, `WHERE ${sortCol} > :last_seen_value\n  AND`);
    } else {
      fixed = fixed.replace(
        /\bORDER\s+BY\b/i,
        `WHERE ${sortCol} > :last_seen_value\nORDER BY`,
      );
    }

    return [
      `-- ⚡ FIXED [R6]: Replaced OFFSET with keyset (cursor) pagination`,
      `-- Replace :last_seen_value with the last "${sortCol}" value from your previous page`,
      fixed,
    ].join('\n');
  }

  // ── R7 — implicit type coercion → explicit casts ──────────────────────────
  if (id === 'R7') {
    let fixed = sql;
    // _id columns: strip quotes for numeric values
    fixed = fixed.replace(/\b(\w+_id)\s*=\s*'(\d+)'/gi, '$1 = $2');
    // _at / _date columns: add ::timestamptz
    fixed = fixed.replace(/\b(\w+_(?:at|date))\s*=\s*'([^']+)'/gi, "$1 = '$2'::timestamptz");
    // _count / _num / _amount: add ::numeric
    fixed = fixed.replace(/\b(\w+_(?:count|num|amount))\s*=\s*'(\d+(?:\.\d+)?)'/gi, '$1 = $2::numeric');

    if (fixed !== sql) {
      return `-- ⚡ FIXED [R7]: Added explicit type casts to prevent implicit coercion\n${fixed}`;
    }
    return `-- TODO [R7]: Add explicit casts — e.g. col_id = 123 (not '123'), col_at = '2024-01-01'::timestamptz\n${sql}`;
  }

  // ── R8 — leading wildcard LIKE ────────────────────────────────────────────
  if (id === 'R8') {
    let changed = false;
    const fixed = sql.replace(/\bLIKE\s+'%([^%']+)'/gi, (_, rest) => {
      changed = true;
      return `LIKE '${rest}%'`;
    });
    if (changed) {
      return [
        `-- ⚡ FIXED [R8]: Converted leading wildcard to trailing wildcard (prefix search)`,
        `-- If you need substring/suffix search: CREATE EXTENSION pg_trgm;`,
        `-- then: CREATE INDEX ON table USING gin(col gin_trgm_ops);`,
        fixed,
      ].join('\n');
    }
    return [
      `-- TODO [R8]: Remove leading % from LIKE patterns to allow B-tree index use`,
      `-- For arbitrary substring search add pg_trgm + GIN index`,
      sql,
    ].join('\n');
  }

  // ── R9 — HAVING without GROUP BY → WHERE ────────────────────────────────
  if (id === 'R9') {
    const fixed = sql.replace(/\bHAVING\b/i, 'WHERE');
    if (fixed !== sql) {
      return `-- ⚡ FIXED [R9]: Replaced HAVING with WHERE (no GROUP BY present)\n${fixed}`;
    }
    return `-- TODO [R9]: Replace HAVING with WHERE when not aggregating\n${sql}`;
  }

  // ── R11 — COUNT(column) → COUNT(*) ──────────────────────────────────────
  if (id === 'R11') {
    const fixed = sql.replace(
      /\bCOUNT\s*\(\s*([a-zA-Z_][a-zA-Z0-9_."]*)\s*\)/gi,
      (match, col) => (col.trim() === '*' ? match : 'COUNT(*)'),
    );
    if (fixed !== sql) {
      return [
        `-- ⚡ FIXED [R11]: Replaced COUNT(column) with COUNT(*)`,
        `-- Revert if you intentionally need to exclude NULL rows`,
        fixed,
      ].join('\n');
    }
    return `-- TODO [R11]: Replace COUNT(col) with COUNT(*) if NULL exclusion is unintentional\n${sql}`;
  }

  // ── R12 — UNION → UNION ALL ───────────────────────────────────────────────
  if (id === 'R12') {
    const fixed = sql.replace(/\bUNION\b(?!\s+ALL)/gi, 'UNION ALL');
    if (fixed !== sql) {
      return [
        `-- ⚡ FIXED [R12]: Replaced UNION with UNION ALL (skips O(n log n) dedup)`,
        `-- ⚠  Verify both sides produce disjoint rows before keeping this change`,
        fixed,
      ].join('\n');
    }
    return `-- TODO [R12]: Replace UNION with UNION ALL if rows are guaranteed distinct\n${sql}`;
  }

  // ── R1 — NOT IN subquery → LEFT JOIN anti-join ───────────────────────────
  if (id === 'R1') {
    const fromMatch = sql.match(/\bFROM\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/i);
    const outerTable = fromMatch?.[1] ?? 'a';
    const outerAlias = fromMatch?.[2] ?? outerTable;
    const innerMatch = sql.match(/NOT\s+IN\s*\(\s*SELECT\s+(\w+)\s+FROM\s+(\w+)/i);
    const innerCol   = innerMatch?.[1] ?? 'id';
    const innerTable = innerMatch?.[2] ?? 'b';

    return [
      `-- ⚡ REWRITE [R1]: Replace NOT IN with LEFT JOIN anti-join`,
      `-- NOT IN returns wrong results when subquery contains NULLs`,
      `-- Fill in the correct join column names below:`,
      `SELECT ${outerAlias}.*`,
      `FROM ${outerTable} ${outerAlias}`,
      `LEFT JOIN ${innerTable} _x ON ${outerAlias}.${innerCol} = _x.${innerCol}`,
      `WHERE _x.${innerCol} IS NULL;`,
      ``,
      `-- ── Original query (for reference) ──`,
      sql,
    ].join('\n');
  }

  // ── R2 — NOT EXISTS → LEFT JOIN anti-join ────────────────────────────────
  if (id === 'R2') {
    const fromMatch  = sql.match(/\bFROM\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/i);
    const outerTable = fromMatch?.[1] ?? 'a';
    const outerAlias = fromMatch?.[2] ?? outerTable;
    const innerMatch = sql.match(/NOT\s+EXISTS\s*\(\s*SELECT\s+[\s\S]*?\bFROM\s+(\w+)/i);
    const innerTable = innerMatch?.[1] ?? 'b';

    return [
      `-- ⚡ REWRITE [R2]: Replace correlated NOT EXISTS with LEFT JOIN anti-join`,
      `-- Fill in the correct join column names:`,
      `SELECT ${outerAlias}.*`,
      `FROM ${outerTable} ${outerAlias}`,
      `LEFT JOIN ${innerTable} _x ON ${outerAlias}.id = _x.${outerTable}_id`,
      `WHERE _x.${outerTable}_id IS NULL;`,
      ``,
      `-- ── Original query (for reference) ──`,
      sql,
    ].join('\n');
  }

  // ── R3 — SELECT * in subquery: annotate ──────────────────────────────────
  if (id === 'R3') {
    const fixed = sql.replace(
      /\(\s*(SELECT\s+\*)/gi,
      '(/* ⚠ R3: list only needed columns */ $1',
    );
    return `-- ⚡ ANNOTATED [R3]: Mark SELECT * in subqueries — replace * with specific columns\n${fixed}`;
  }

  // ── R5 — SELECT DISTINCT + JOIN → GROUP BY ───────────────────────────────
  if (id === 'R5') {
    const selectMatch = sql.match(/SELECT\s+DISTINCT\s+([\s\S]*?)\s+FROM\b/i);
    if (selectMatch) {
      const rawCols = selectMatch[1];
      const cols = rawCols.split(',')
        .map(c => c.trim().replace(/\s+AS\s+\w+/i, '').trim())
        .filter(Boolean);

      let fixed = sql.replace(/\bSELECT\s+DISTINCT\b/i, 'SELECT');
      if (!/\bGROUP\s+BY\b/i.test(fixed)) {
        fixed = fixed.replace(
          /(\bORDER\s+BY\b|\bLIMIT\b|;?\s*$)/i,
          `GROUP BY ${cols.join(', ')}\n$1`,
        );
      }
      return [
        `-- ⚡ FIXED [R5]: Replaced SELECT DISTINCT with explicit GROUP BY`,
        `-- ⚠  Audit your JOIN condition — DISTINCT often masks a missing join predicate`,
        fixed,
      ].join('\n');
    }
    return `-- TODO [R5]: Check JOIN condition; consider GROUP BY instead of SELECT DISTINCT\n${sql}`;
  }

  // ── R10 — correlated subquery in SELECT list → LEFT JOIN ─────────────────
  if (id === 'R10') {
    const fromMatch  = sql.match(/\bFROM\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/i);
    const mainTable  = fromMatch?.[1] ?? 'main_table';
    const mainAlias  = fromMatch?.[2] ?? mainTable;

    return [
      `-- ⚡ REWRITE [R10]: Lift correlated subquery from SELECT list to LEFT JOIN`,
      `-- Template (fill in your aggregate and join columns):`,
      `SELECT ${mainAlias}.*, sub.agg_value`,
      `FROM ${mainTable} ${mainAlias}`,
      `LEFT JOIN (`,
      `    SELECT group_col, aggregate_fn(col) AS agg_value`,
      `    FROM sub_table`,
      `    GROUP BY group_col`,
      `) sub ON ${mainAlias}.id = sub.group_col;`,
      ``,
      `-- ── Original query (for reference) ──`,
      sql,
    ].join('\n');
  }

  // ── Fallback for any unhandled id ────────────────────────────────────────
  return `-- TODO [${id}]: ${finding.suggestion}\n${sql}`;
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function AnalyzePage() {
  const textareaRef = useRef(null);

  // Editor state
  const [sql, setSql]               = useState('');
  const [databases, setDatabases]   = useState([]);
  const [selectedDb, setSelectedDb] = useState('');
  const [hw, setHw]                 = useState(DEFAULTS);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Analysis state
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState(null);

  // Optimization state
  const [optimizing, setOptimizing]         = useState(false);
  const [optimizeResult, setOptimizeResult] = useState(null);
  const [optError, setOptError]             = useState(null);

  // Panel tabs: 'results' | 'optimization'
  const [activeTab, setActiveTab] = useState('results');

  // Optimization findings filter
  const [filterSev, setFilterSev] = useState('all');

  // Toast
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  // ── Boot ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const copiedQuery = sessionStorage.getItem('queryToCopy');
    if (copiedQuery) {
      setSql(copiedQuery);
      sessionStorage.removeItem('queryToCopy');
    }

    getDatabases().then(d => {
      setDatabases(d.databases || []);
      if (d.databases?.length > 0) setSelectedDb(d.databases[0].name);
    }).catch(() => {});

    getHardwareConfig().then(cfg => {
      setHw(prev => ({
        ...prev,
        cpuCores:      cfg.cpuCores      || prev.cpuCores,
        powerPerCore:  cfg.powerPerCore  || prev.powerPerCore,
        cpuUtilization:cfg.cpuUtilization|| prev.cpuUtilization,
        ramGb:         cfg.ramGb         || prev.ramGb,
        pue:           cfg.pue           || prev.pue,
        gridIntensity: cfg.gridIntensity || prev.gridIntensity,
        te:            cfg.te            || prev.te,
        el:            cfg.el            || prev.el,
        rr:            cfg.rr            || prev.rr,
        tor:           cfg.tor           || prev.tor,
      }));
    }).catch(() => {});
  }, []);

  // ── Analyze + auto-optimize ───────────────────────────────────────────────

  const handleAnalyze = async () => {
    if (!sql.trim()) { setError('Please enter a SQL query.'); return; }
    if (!selectedDb) { setError('Please select a database.'); return; }

    setLoading(true);
    setError(null);
    setResult(null);
    setOptimizeResult(null);
    setOptError(null);
    setActiveTab('results');
    setFilterSev('all');

    try {
      const res = await analyzeQuery({ sql, database: selectedDb, ...hw });
      setResult(res);

      // ── Auto-fire optimization in background ──────────────────────────────
      setOptimizing(true);
      try {
        const optRes = await optimizeQuery(res.query_id);
        setOptimizeResult(optRes);
        // Auto-switch to Optimization tab if there are findings
        if (optRes.total_findings > 0) setActiveTab('optimization');
      } catch (oe) {
        setOptError(oe.response?.data?.detail || oe.response?.data?.error || oe.message);
      } finally {
        setOptimizing(false);
      }
      // ─────────────────────────────────────────────────────────────────────

    } catch (e) {
      setError(e.response?.data?.detail || e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Apply suggestion to editor ────────────────────────────────────────────

  const handleApply = useCallback((finding) => {
    setSql(prev => applyFindingToSql(prev, finding));
    // Reset results so the user knows they need to re-analyze
    setResult(null);
    setOptimizeResult(null);
    setOptError(null);
    setActiveTab('results');
    const id = finding.rule_id || finding.pattern_id || '';
    const isIndex = finding.track === 'explain_analysis' && finding.index_ddl;
    showToast(
      isIndex
        ? `CREATE INDEX loaded — run it against your DB, then Re-Analyze`
        : `[${id}] fix applied — click Re-Analyze to verify`
    );
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.scrollTop = 0;
    });
  }, [showToast]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const updateHw = (key, val) => setHw(prev => ({ ...prev, [key]: val }));

  const lineCount = sql.split('\n').length;

  const cls = result?.classification;
  const badgeCls = !cls ? '' :
    cls === 'EXCELLENT' ? 'badge-excellent' :
    cls === 'GOOD'      ? 'badge-good'      :
    cls === 'MODERATE'  ? 'badge-moderate'  :
    cls === 'POOR'      ? 'badge-poor'      : 'badge-critical';
  const clsColor = !cls ? 'var(--text-primary)' :
    (cls === 'EXCELLENT' || cls === 'GOOD') ? 'var(--green)' :
    cls === 'MODERATE' ? 'var(--amber)' : 'var(--red)';

  const queryMeta = (() => {
    if (!sql.trim()) return null;
    const lines   = sql.split('\n').filter(l => l.trim()).length;
    const hasJoin = /\bJOIN\b/i.test(sql);
    return { lines, hasJoin };
  })();

  const optFindings = optimizeResult?.findings || [];
  const filteredFindings = filterSev === 'all'
    ? optFindings
    : optFindings.filter(f => f.severity === filterSev);

  const findingCount = optFindings.length;
  const tabBadgeCls  = optimizing ? 'scanning' : findingCount === 0 && optimizeResult ? 'safe' : '';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Page header */}
      <div className="page-header">
        <div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>QueryCarbon › </span>
          <span className="page-title" style={{ fontSize: 15 }}>Analyze Query</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {result ? `QID-${result.query_id}` : 'New Analysis'}
        </div>
      </div>

      <div className="analyze-layout">

        {/* ── Left: SQL editor + hardware ─────────────────────────────────── */}
        <div className="editor-panel">

          {/* Editor card */}
          <div className="editor-wrapper">
            <div className="editor-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>SQL Query Editor</span>
                <span className="tag">SQL</span>
                {result && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    · last run QID-{result.query_id}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Ctrl+Enter to run</span>
            </div>

            {/* Database selector */}
            <div style={{
              padding: '8px 16px',
              background: 'var(--bg-secondary)',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex', gap: 10, alignItems: 'center',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Database:</span>
              <select
                className="form-control"
                style={{ width: 220, height: 30, padding: '4px 32px 4px 10px', fontSize: 12 }}
                value={selectedDb}
                onChange={e => setSelectedDb(e.target.value)}
              >
                {databases.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                {databases.length === 0 && <option>Loading…</option>}
              </select>
            </div>

            {/* Code area */}
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
                placeholder="-- Write your SQL query here…"
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

            {/* Footer */}
            <div className="editor-footer">
              <div className="editor-actions">
                <button
                  className="btn btn-primary"
                  onClick={handleAnalyze}
                  disabled={loading || optimizing}
                  title="Run query (Ctrl+Enter)"
                >
                  {loading
                    ? <><span className="spinner" /> Analyzing…</>
                    : result
                      ? <>↺ Re-Analyze</>
                      : <>⚡ Analyze Query</>}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => { setSql(''); setResult(null); setOptimizeResult(null); setError(null); setOptError(null); setActiveTab('results'); }}
                  title="Clear editor"
                >
                  ◎ Clear
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setSql(SAMPLE_QUERY)}
                  title="Load example query"
                >
                  ⊡ Sample
                </button>
              </div>
              {queryMeta && (
                <div style={{ display: 'flex', gap: 12, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                  <span>{queryMeta.lines} lines</span>
                  {result?.tables_involved?.length > 0 && <span>· {result.tables_involved.length} tables</span>}
                  {queryMeta.hasJoin && <span>· JOIN</span>}
                </div>
              )}
            </div>
          </div>

          {/* Hardware config */}
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
                <span className="form-hint">India 442 · US 386 · EU 233</span>
              </div>

              {showAdvanced && (
                <>
                  <div className="form-group hw-full" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, marginTop: 4 }}>
                    <label className="form-label">
                      CPU Utilization — <span style={{ color: 'var(--green)' }}>{Math.round(hw.cpuUtilization * 100)}%</span>
                    </label>
                    <div className="slider-container">
                      <input type="range" className="slider" min="0" max="1" step="0.01"
                        value={hw.cpuUtilization} onChange={e => updateHw('cpuUtilization', +e.target.value)} />
                    </div>
                    <span className="form-hint">query resource intensity</span>
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

        {/* ── Right: Results + Optimization panel ─────────────────────────── */}
        <div className="results-panel" style={{ padding: 0, gap: 0, display: 'flex', flexDirection: 'column' }}>

          {/* Hardware snapshot strip */}
          <div className="hw-panel" style={{ padding: '10px 16px', borderRadius: 0, borderLeft: 'none', borderRight: 'none', borderTop: 'none', flexShrink: 0 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 5 }}>⊟ Hardware snapshot</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
              <span>CPU {hw.cpuCores}c · {Math.round(hw.cpuUtilization * 100)}%</span>
              <span>RAM {hw.ramGb} GB</span>
              <span>PUE {hw.pue}</span>
              <span>Grid {hw.gridIntensity} gCO₂/kWh</span>
            </div>
          </div>

          {/* ── Error ── */}
          {error && (
            <div style={{ margin: '10px 14px', background: 'rgba(255,77,77,0.08)', border: '1px solid rgba(255,77,77,0.2)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 12, color: 'var(--red)', flexShrink: 0 }}>
              ⚠ {error}
            </div>
          )}

          {/* ── Carbon analysis loading ── */}
          {loading && !result && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)', flexShrink: 0 }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              <div style={{ fontSize: 12 }}>Executing query &amp; calculating emissions…</div>
            </div>
          )}

          {/* ── Empty state ── */}
          {!result && !loading && !error && (
            <div className="empty-state" style={{ flex: 1 }}>
              <div className="empty-state-icon">⚡</div>
              <div className="empty-state-text">
                Enter a SQL query and click <strong>Analyze Query</strong> to measure
                the carbon footprint and get optimization suggestions.
                <br /><span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, display: 'block' }}>Ctrl+Enter to run</span>
              </div>
            </div>
          )}

          {/* ── Tab bar (shown after first analysis) ── */}
          {result && !loading && (
            <>
              <div className="panel-tabs" style={{ flexShrink: 0 }}>
                <button
                  className={`panel-tab${activeTab === 'results' ? ' active' : ''}`}
                  onClick={() => setActiveTab('results')}
                >
                  Results
                </button>
                <button
                  className={`panel-tab${activeTab === 'optimization' ? ' active' : ''}`}
                  onClick={() => setActiveTab('optimization')}
                >
                  Optimization
                  {optimizing && (
                    <span className="panel-tab-badge scanning">…</span>
                  )}
                  {!optimizing && optimizeResult && (
                    <span className={`panel-tab-badge${findingCount === 0 ? ' safe' : ''}`}>
                      {findingCount === 0 ? '✓' : findingCount}
                    </span>
                  )}
                </button>
              </div>

              {/* ═══════════ RESULTS TAB ═══════════ */}
              {activeTab === 'results' && (
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: '14px' }}>

                  {/* Classification header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      Analysis Results · QID-{result.query_id}
                    </span>
                    <span className={`badge ${badgeCls}`}>{cls}</span>
                  </div>

                  {/* Gauge + legend */}
                  <div className="card" style={{ padding: '14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'center' }}>
                    <SustainabilityGauge score={result.sustainability_score} />
                    <div>
                      {[
                        { label: 'Excellent', color: '#00ff88', range: '90–100' },
                        { label: 'Good',      color: '#4dc9ff', range: '70–89'  },
                        { label: 'Moderate',  color: '#f5a623', range: '50–69'  },
                        { label: 'Poor',      color: '#ff8844', range: '25–49'  },
                        { label: 'Critical',  color: '#ff4d4d', range: '0–24'   },
                      ].map(d => (
                        <div key={d.label} className="legend-item">
                          <div className="legend-label"><div className="legend-dot" style={{ background: d.color }} />{d.label}</div>
                          <span className="legend-range">{d.range}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <ResultMetric label="Energy Consumption"    value={result.energy_kwh.toFixed(8)}                    unit="kWh"   />
                  <ResultMetric label="Operational Emissions" value={fmtGco2(result.operational_emissions_gco2)}       unit="gCO₂"  />
                  <ResultMetric label="Embodied Emissions"    value={fmtGco2(result.embodied_emissions_gco2)}          unit="gCO₂"  />

                  <div className="sci-box">
                    <div className="sci-label">Total SCI · Software Carbon Intensity</div>
                    <div className="sci-value" style={{ color: clsColor }}>{fmtGco2(result.sci)}</div>
                    <div className="sci-unit">gCO₂ / query</div>
                  </div>

                  {/* Query results preview */}
                  {result.results_preview?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                        Query Results: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{result.row_count} row{result.row_count !== 1 ? 's' : ''}</span>
                        {' '}(showing first {Math.min(result.results_preview.length, 10)})
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

                  {/* Runtime footer */}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
                    {result.actual_runtime_ms.toFixed(3)} ms actual
                    {result.tables_involved?.length > 0 && ` · ${result.tables_involved.length} table${result.tables_involved.length > 1 ? 's' : ''}`}
                    {optimizeResult && (
                      <span style={{ color: findingCount > 0 ? 'var(--amber)' : 'var(--green)', marginLeft: 8 }}>
                        · {findingCount > 0 ? `${findingCount} suggestion${findingCount > 1 ? 's' : ''} found` : '✓ No issues'}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* ═══════════ OPTIMIZATION TAB ═══════════ */}
              {activeTab === 'optimization' && (
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

                  {/* Scanning indicator */}
                  {optimizing && (
                    <div className="opt-scanning">
                      <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                      Scanning EXPLAIN plan, simulating indexes, checking SQL patterns…
                    </div>
                  )}

                  {/* Opt error */}
                  {optError && !optimizing && (
                    <div style={{ margin: '10px 14px', background: 'rgba(255,77,77,0.08)', border: '1px solid rgba(255,77,77,0.2)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 12, color: 'var(--red)' }}>
                      ⚠ Optimization scan failed: {optError}
                    </div>
                  )}

                  {/* Summary strip */}
                  {optimizeResult && !optimizing && findingCount > 0 && (
                    <SeveritySummary findings={optFindings} />
                  )}

                  {/* SCI delta + hypopg banner */}
                  {optimizeResult && !optimizing && (
                    <div style={{ display: 'flex', gap: 16, padding: '8px 14px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)', fontSize: 11, fontFamily: 'var(--font-mono)', flexShrink: 0, flexWrap: 'wrap' }}>
                      {optimizeResult.total_sci_delta_estimated != null && (
                        <span style={{ color: optimizeResult.total_sci_delta_estimated < 0 ? 'var(--green)' : 'var(--red)' }}>
                          Est. SCI Δ {optimizeResult.total_sci_delta_estimated < 0 ? '−' : '+'}
                          {Math.abs(optimizeResult.total_sci_delta_estimated).toExponential(2)} gCO₂
                        </span>
                      )}
                      <span style={{ color: 'var(--text-muted)' }}>
                        Cost {(optimizeResult.explain_root_cost ?? 0).toFixed(1)}
                      </span>
                      <span style={{ color: optimizeResult.hypopg_available ? 'var(--green)' : 'var(--text-muted)' }}>
                        hypopg {optimizeResult.hypopg_available ? '✓' : '✗'}
                      </span>
                    </div>
                  )}

                  {/* Severity filter chips */}
                  {optimizeResult && !optimizing && findingCount > 0 && (
                    <div className="sev-filter-strip">
                      {['all', 'high', 'medium', 'low'].map(s => {
                        const count = s === 'all' ? findingCount : optFindings.filter(f => f.severity === s).length;
                        const isActive = filterSev === s;
                        return (
                          <button
                            key={s}
                            className={`sev-chip${isActive ? ` active-${s}` : ''}`}
                            onClick={() => setFilterSev(s)}
                          >
                            {s.charAt(0).toUpperCase() + s.slice(1)}
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.8 }}>({count})</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Findings list */}
                  <div style={{ flex: 1, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {optimizing && !optimizeResult && (
                      <div style={{ textAlign: 'center', paddingTop: 32, color: 'var(--text-muted)', fontSize: 12 }}>
                        Running analysis…
                      </div>
                    )}

                    {!optimizing && !optimizeResult && (
                      <div className="empty-state" style={{ paddingTop: 32 }}>
                        <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.4 }}>⚡</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          Run an analysis to see optimization suggestions.
                        </div>
                      </div>
                    )}

                    {!optimizing && optimizeResult && findingCount === 0 && (
                      <div className="empty-state" style={{ paddingTop: 32 }}>
                        <div style={{ fontSize: 32, marginBottom: 10 }}>✓</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          No issues detected — this query looks well-optimised.
                        </div>
                      </div>
                    )}

                    {!optimizing && filteredFindings.length > 0 && filteredFindings.map((finding, i) => (
                      <FindingCard
                        key={`${finding.pattern_id || finding.rule_id}-${i}`}
                        finding={finding}
                        onApply={handleApply}
                      />
                    ))}

                    {!optimizing && optimizeResult && findingCount > 0 && filteredFindings.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '24px 0', fontSize: 12, color: 'var(--text-muted)' }}>
                        No {filterSev} severity findings.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Toast notification ── */}
      {toast && (
        <div className="toast" style={{ borderColor: 'rgba(0,255,136,0.3)', color: 'var(--green)' }}>
          ✓ {toast}
        </div>
      )}
    </>
  );
}
