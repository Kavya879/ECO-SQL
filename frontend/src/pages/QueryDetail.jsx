import React, { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { getHistoryById, optimizeQuery } from '../api/api.js';
import FindingCard from '../components/FindingCard.jsx';

// Shared rewrite logic (mirrors AnalyzePage — kept here to avoid a circular import)
function applyFindingToSqlSimple(sql, finding) {
  const id = finding.rule_id || finding.pattern_id || '';
  if (finding.track === 'explain_analysis' && finding.index_ddl) {
    return [
      `-- ⚡ INDEX SUGGESTION [${id}] — run this, then re-analyze:`,
      `${finding.index_ddl};`,
      ``,
      `-- Original query:`,
      sql,
    ].join('\n');
  }
  return `-- ⚡ SUGGESTION [${id}]: ${finding.suggestion}\n${sql}`;
}

const SEV_COLOR = { high: 'var(--red)', medium: 'var(--amber)', low: 'var(--blue)' };

function SeverityBar({ findings }) {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of findings) if (counts[f.severity] != null) counts[f.severity]++;
  return (
    <div style={{ display: 'flex', gap: 14 }}>
      {Object.entries(counts).map(([sev, n]) => (
        <div key={sev} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: SEV_COLOR[sev] }} />
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: SEV_COLOR[sev] }}>
            {n} {sev}
          </span>
        </div>
      ))}
    </div>
  );
}

function ClassBadge({ cls }) {
  if (!cls) return null;
  const c = cls.toLowerCase();
  const bCls = c === 'excellent' ? 'badge-excellent'
    : c === 'good'     ? 'badge-good'
    : c === 'moderate' ? 'badge-moderate'
    : c === 'poor'     ? 'badge-poor'
    : 'badge-critical';
  return <span className={`badge ${bCls}`}>{cls}</span>;
}

export default function QueryDetail() {
  const { id }       = useParams();
  const location     = useLocation();
  const navigate     = useNavigate();
  const navState     = location.state; // may carry full analyze result from AnalyzePage

  const [record, setRecord]           = useState(navState || null);
  const [loadingRecord, setLoading]   = useState(!navState);
  const [optimizing, setOptimizing]   = useState(false);
  const [optimizeResult, setOptimize] = useState(null);
  const [error, setError]             = useState(null);
  const [filterSev, setFilterSev]     = useState('all');

  // ── Load record if not passed via navigation state ────────────────────────
  useEffect(() => {
    if (navState) return;
    setLoading(true);
    getHistoryById(id)
      .then(data => setRecord(data))
      .catch(() => setError('Could not load query details.'))
      .finally(() => setLoading(false));
  }, [id, navState]);

  // ── Auto-trigger optimization once record is ready ────────────────────────
  useEffect(() => {
    if (!record) return;
    runOptimize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id ?? record?.query_id]);

  async function runOptimize() {
    setOptimizing(true);
    setError(null);
    setOptimize(null);
    try {
      const result = await optimizeQuery(id);
      setOptimize(result);
    } catch (e) {
      setError(e.response?.data?.detail || e.response?.data?.error || e.message);
    } finally {
      setOptimizing(false);
    }
  }

  // ── "Open in Editor" — load query into AnalyzePage ───────────────────────
  function openInEditor() {
    const sql = record?.query_text || navState?.sql || '';
    if (sql) sessionStorage.setItem('queryToCopy', sql);
    navigate('/analyze');
  }

  // ── Apply suggestion: store rewritten SQL → open in editor ──────────────
  function handleApply(finding) {
    const baseSql  = record?.query_text || '';
    const modified = applyFindingToSqlSimple(baseSql, finding);
    sessionStorage.setItem('queryToCopy', modified);
    navigate('/analyze');
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loadingRecord) {
    return (
      <div className="page-body" style={{ textAlign: 'center', paddingTop: 60 }}>
        <div className="spinner" style={{ margin: '0 auto 12px' }} />
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading query…</div>
      </div>
    );
  }

  const sql            = record?.query_text || navState?.sql || '';
  const dbName         = record?.database_name || navState?.database || '—';
  const sci            = record?.sci ?? navState?.sci;
  const classification = record?.classification || navState?.classification;
  const findings       = optimizeResult?.findings || [];
  const filtered       = filterSev === 'all' ? findings : findings.filter(f => f.severity === filterSev);

  return (
    <>
      {/* ── Page header ── */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => navigate(-1)}
            style={{ padding: '4px 8px', fontSize: 16 }}
            title="Go back"
          >
            ←
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>QueryCarbon ›</span>
          <span className="page-title" style={{ fontSize: 15 }}>Query #{id} · Optimization</span>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Open in Editor — primary CTA */}
          <button className="btn btn-primary btn-sm" onClick={openInEditor} title="Load this query into the Analyze editor">
            ← Open in Editor
          </button>
          {/* Re-run */}
          <button
            className="btn btn-secondary btn-sm"
            onClick={runOptimize}
            disabled={optimizing}
          >
            {optimizing ? <><span className="spinner" /> Scanning…</> : '↺ Re-scan'}
          </button>
        </div>
      </div>

      <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Query metadata card ── */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Stored Query</span>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                db: {dbName}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {sci != null && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--green)' }}>
                  SCI {sci.toExponential(3)}
                </span>
              )}
              <ClassBadge cls={classification} />
            </div>
          </div>

          <pre
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--text-secondary)',
              background: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 14px',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 200,
              lineHeight: 1.6,
            }}
          >
            {sql || '—'}
          </pre>

          {/* Open in Editor inline shortcut */}
          <button
            className="btn btn-secondary btn-sm"
            onClick={openInEditor}
            style={{ alignSelf: 'flex-start', color: 'var(--green)', borderColor: 'rgba(0,255,136,0.25)' }}
          >
            ← Open in Editor &amp; Re-analyze
          </button>
        </div>

        {/* ── Error ── */}
        {error && (
          <div style={{ background: 'rgba(255,77,77,0.08)', border: '1px solid rgba(255,77,77,0.2)', borderRadius: 'var(--radius-sm)', padding: '12px 16px', fontSize: 12, color: 'var(--red)' }}>
            ⚠ {error}
          </div>
        )}

        {/* ── Scanning spinner ── */}
        {optimizing && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 10px' }} />
            <div style={{ fontSize: 12 }}>Running EXPLAIN analysis, index simulations and SQL pattern checks…</div>
          </div>
        )}

        {/* ── Results ── */}
        {optimizeResult && !optimizing && (
          <>
            {/* Summary bar */}
            <div className="card" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 3 }}>Findings</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700 }}>{optimizeResult.total_findings}</div>
                </div>
                {optimizeResult.total_sci_delta_estimated != null && (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 3 }}>Est. SCI savings</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: optimizeResult.total_sci_delta_estimated < 0 ? 'var(--green)' : 'var(--red)' }}>
                      {optimizeResult.total_sci_delta_estimated < 0 ? '−' : '+'}
                      {Math.abs(optimizeResult.total_sci_delta_estimated).toExponential(2)} gCO₂
                    </div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 3 }}>Planner cost</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700 }}>{(optimizeResult.explain_root_cost ?? 0).toFixed(2)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 3 }}>hypopg</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: optimizeResult.hypopg_available ? 'var(--green)' : 'var(--text-muted)' }}>
                    {optimizeResult.hypopg_available ? '✓ Available' : '✗ Not installed'}
                  </div>
                </div>
              </div>
              {findings.length > 0 && <SeverityBar findings={findings} />}
            </div>

            {/* Severity filter */}
            {findings.length > 0 && (
              <div style={{ display: 'flex', gap: 6 }}>
                {['all', 'high', 'medium', 'low'].map(s => (
                  <button
                    key={s}
                    className={`sev-chip${filterSev === s ? ` active-${s}` : ''}`}
                    onClick={() => setFilterSev(s)}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.8 }}>
                      ({s === 'all' ? findings.length : findings.filter(f => f.severity === s).length})
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Findings list */}
            {filtered.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">{optimizeResult.total_findings === 0 ? '✓' : '—'}</div>
                <div className="empty-state-text">
                  {optimizeResult.total_findings === 0
                    ? 'No issues detected. This query looks well-optimised.'
                    : `No ${filterSev} severity findings.`}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filtered.map((finding, i) => (
                  <FindingCard
                    key={`${finding.pattern_id || finding.rule_id}-${i}`}
                    finding={finding}
                    onApply={handleApply}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Pre-scan empty state ── */}
        {!optimizeResult && !optimizing && !error && (
          <div className="empty-state">
            <div className="empty-state-icon">⚡</div>
            <div className="empty-state-text">
              Optimization scan will start automatically.
            </div>
          </div>
        )}
      </div>
    </>
  );
}
