import React, { useState } from 'react';
import IndexDDLBadge from './IndexDDLBadge.jsx';

const SEVERITY_CONFIG = {
  high:   { label: 'High Impact',   cls: 'high',   icon: 'warning' },
  medium: { label: 'Medium Impact', cls: 'medium',  icon: 'info' },
  low:    { label: 'Low Impact',    cls: 'low',     icon: 'lightbulb' },
};

function normalizeSev(sev = '') {
  const s = String(sev).toLowerCase();
  if (s === 'high' || s === 'critical') return 'high';
  if (s === 'medium' || s === 'moderate') return 'medium';
  return 'low';
}

function formatDelta(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  const rounded = Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(4);
  return v > 0 ? `+${rounded}` : rounded;
}

export default function FindingCard({ finding }) {
  const [expanded, setExpanded] = useState(false);
  const [hintCopied, setHintCopied] = useState(false);

  const sev = normalizeSev(finding.severity);
  const cfg = SEVERITY_CONFIG[sev];
  const id  = finding.rule_id || finding.pattern_id || finding.track || '';

  const titleText  = finding.title       || finding.pattern || finding.type || id;
  const bodyText   = finding.description || finding.suggestion || finding.reason || '';
  const ddlText    = finding.index_ddl   || null;
  const beforeCode = finding.before      || null;
  const afterCode  = finding.after       || null;

  const trackLabel = finding.track === 'sql_pattern'
    ? 'SQL pattern'
    : finding.track === 'explain_analysis'
      ? 'EXPLAIN'
      : finding.track || '';

  const copyHint = async () => {
    if (!finding.hinted_query) return;
    try {
      await navigator.clipboard.writeText(finding.hinted_query);
      setHintCopied(true);
      setTimeout(() => setHintCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className={`finding-card ${sev} fade-in`}>
      <div className="finding-head">
        <div style={{ flex: 1 }}>
          <div className="finding-title">{titleText}</div>
          <div className="finding-body">{bodyText}</div>
        </div>
        <div className={`finding-impact ${sev}`}>
          <span className="material-symbols-outlined sz-16">{cfg.icon}</span>
          {cfg.label}
        </div>
      </div>

      {(trackLabel || finding.simulation || finding.hint_simulation) && (
        <div className="finding-meta-row">
          {trackLabel && <span className="finding-meta-pill">{trackLabel}</span>}
          {finding.simulation && (
            <span className="finding-meta-pill">index sim: {finding.simulation}</span>
          )}
          {finding.hint_simulation && (
            <span className="finding-meta-pill">hint sim: {finding.hint_simulation}</span>
          )}
          {(finding.cost_delta != null || finding.hint_cost_delta != null) && (
            <span className="finding-meta-pill">
              Δcost{' '}
              {finding.cost_delta != null
                ? formatDelta(finding.cost_delta)
                : formatDelta(finding.hint_cost_delta)}
            </span>
          )}
          {(finding.sci_delta != null || finding.hint_sci_delta != null) && (
            <span className="finding-meta-pill">
              ΔSCI{' '}
              {finding.sci_delta != null
                ? `${formatDelta(finding.sci_delta)} gCO₂eq`
                : `${formatDelta(finding.hint_sci_delta)} gCO₂eq`}
            </span>
          )}
        </div>
      )}

      {ddlText && (
        <IndexDDLBadge ddl={ddlText} simulation={finding.simulation} />
      )}

      {finding.hinted_query && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            className="ddl-copy-chip ddl-chip-evidence"
            onClick={copyHint}
            title="Copy hinted query"
          >
            <span className="material-symbols-outlined sz-16">
              {hintCopied ? 'check' : 'psychology'}
            </span>
            <span className="ddl-chip-ddl" style={{ whiteSpace: 'pre-wrap' }}>
              {finding.hinted_query.length > 120
                ? `${finding.hinted_query.slice(0, 120)}…`
                : finding.hinted_query}
            </span>
            <span className="ddl-chip-badge">{hintCopied ? 'Copied' : 'Hint query'}</span>
          </button>
        </div>
      )}

      {(beforeCode || afterCode) && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: 11,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginBottom: 6,
            }}
          >
            <span className={`material-symbols-outlined sz-16 collapsible-icon${expanded ? ' open' : ''}`}>
              expand_more
            </span>
            {expanded ? 'Hide' : 'Show'} code diff
          </button>
          {expanded && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{
                background: 'var(--bg-code)',
                border: '1px solid rgba(255,180,171,0.3)',
                borderRadius: 'var(--r-sm)',
                padding: 10,
                position: 'relative',
              }}>
                <span style={{
                  position: 'absolute', top: 0, right: 0,
                  background: 'rgba(147,0,10,0.3)', color: 'var(--red)',
                  fontSize: 9, fontFamily: 'var(--font-display)', fontWeight: 700,
                  padding: '1px 6px', borderRadius: '0 var(--r-sm) 0 var(--r-sm)',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>Current</span>
                <pre style={{
                  margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11,
                  color: 'var(--red)', whiteSpace: 'pre-wrap', lineHeight: 1.6,
                }}>{beforeCode}</pre>
              </div>
              <div style={{
                background: 'var(--bg-code)',
                border: '1px solid rgba(0,255,136,0.2)',
                borderRadius: 'var(--r-sm)',
                padding: 10,
                position: 'relative',
              }}>
                <span style={{
                  position: 'absolute', top: 0, right: 0,
                  background: 'rgba(0,255,136,0.15)', color: 'var(--green)',
                  fontSize: 9, fontFamily: 'var(--font-display)', fontWeight: 700,
                  padding: '1px 6px', borderRadius: '0 var(--r-sm) 0 var(--r-sm)',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>Suggested</span>
                <pre style={{
                  margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11,
                  color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.6,
                }}>{afterCode}</pre>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="finding-footer">
        {!ddlText && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            {id}
          </span>
        )}
      </div>
    </div>
  );
}
