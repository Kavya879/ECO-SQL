import React, { useState } from 'react';
import IndexDDLBadge from './IndexDDLBadge.jsx';

const SEVERITY_STYLE = {
  high:   { color: 'var(--red)',   bg: 'rgba(255,77,77,0.08)',   border: 'rgba(255,77,77,0.2)',   label: 'HIGH'   },
  medium: { color: 'var(--amber)', bg: 'rgba(245,166,35,0.08)',  border: 'rgba(245,166,35,0.2)', label: 'MEDIUM' },
  low:    { color: 'var(--blue)',  bg: 'rgba(77,201,255,0.08)',  border: 'rgba(77,201,255,0.2)', label: 'LOW'    },
};

const TRACK_LABEL = {
  explain_analysis: 'EXPLAIN',
  index_simulation: 'SIMULATION',
  sql_pattern:      'SQL PATTERN',
};

const SIM_LABEL = {
  simulated:      { text: 'Simulated',      color: 'var(--green)' },
  heuristic:      { text: 'Heuristic',      color: 'var(--amber)' },
  no_improvement: { text: 'No improvement', color: 'var(--text-muted)' },
  not_applicable: { text: null,              color: null },
};

function fmtCost(n) {
  if (n == null) return '—';
  return n.toFixed(2);
}

function fmtSciDelta(n) {
  if (n == null) return null;
  const sign = n < 0 ? '−' : '+';
  return `${sign}${Math.abs(n).toExponential(2)} gCO₂`;
}

/**
 * Renders a single optimisation finding.
 *
 * Props:
 *   finding   — the finding object from /api/optimize-query
 *   onApply   — optional callback(finding) called when "Apply to Editor" is clicked
 *               (only rendered for sql_pattern findings)
 */
export default function FindingCard({ finding, onApply }) {
  const [expanded, setExpanded]   = useState(false);
  const [applied, setApplied]     = useState(false);
  const [ddlCopied, setDdlCopied] = useState(false);

  const sev        = SEVERITY_STYLE[finding.severity] || SEVERITY_STYLE.low;
  const sim        = SIM_LABEL[finding.simulation] || {};
  const trackLabel = TRACK_LABEL[finding.track] || finding.track;
  const patternId  = finding.pattern_id || finding.rule_id;

  const sciDeltaStr = fmtSciDelta(finding.sci_delta);
  const improved    = finding.sci_delta != null && finding.sci_delta < 0;

  const isSqlPattern  = finding.track === 'sql_pattern';
  const hasIndexDdl   = !!finding.index_ddl;
  const canApply      = typeof onApply === 'function';
  // Show apply button for SQL-pattern findings OR for index findings (loads DDL into editor)
  const showApplyBtn  = canApply && (isSqlPattern || hasIndexDdl);
  const applyLabel    = hasIndexDdl && !isSqlPattern ? 'Load DDL in Editor' : 'Apply Fix';
  // Always show the copy badge when there's DDL (independent of apply button)
  const showCopyDdl   = hasIndexDdl;

  function handleApply() {
    if (!onApply) return;
    onApply(finding);
    setApplied(true);
    setTimeout(() => setApplied(false), 1500);
  }

  function handleCopyDdl() {
    if (!finding.index_ddl) return;
    navigator.clipboard.writeText(finding.index_ddl).then(() => {
      setDdlCopied(true);
      setTimeout(() => setDdlCopied(false), 1500);
    });
  }

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${sev.border}`,
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        transition: 'border-color 0.15s',
      }}
    >
      {/* ── Header row (always visible, click to expand) ── */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {/* Severity badge */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 7px',
            borderRadius: 20,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.5px',
            background: sev.bg,
            color: sev.color,
            border: `1px solid ${sev.border}`,
            flexShrink: 0,
          }}
        >
          {sev.label}
        </span>

        {/* Pattern / rule ID */}
        {patternId && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
            {patternId}
          </span>
        )}

        {/* Table name */}
        {finding.table && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--blue)', flexShrink: 0 }}>
            {finding.table}
          </span>
        )}

        {/* Suggestion preview — truncated */}
        <span
          style={{
            flex: 1,
            fontSize: 12,
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {finding.suggestion}
        </span>

        {/* SCI delta chip */}
        {sciDeltaStr && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 600,
              color: improved ? 'var(--green)' : 'var(--text-muted)',
              flexShrink: 0,
            }}
          >
            {sciDeltaStr}
          </span>
        )}

        {/* Expand chevron */}
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s',
            flexShrink: 0,
          }}
        >
          ▾
        </span>
      </button>

      {/* ── Expanded body ── */}
      {expanded && (
        <div
          style={{
            borderTop: `1px solid ${sev.border}`,
            padding: '14px 14px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {/* Track + simulation chips */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
                padding: '2px 8px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.04)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {trackLabel}
            </span>
            {sim.text && (
              <span
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  padding: '2px 8px',
                  borderRadius: 4,
                  color: sim.color,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {sim.text}
              </span>
            )}
          </div>

          {/* Full suggestion */}
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Suggestion
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.7 }}>
              {finding.suggestion}
            </div>
          </div>

          {/* Rationale */}
          {finding.rationale && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Why it was flagged
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.65 }}>
                {finding.rationale}
              </div>
            </div>
          )}

          {/* Index DDL badge (for explain findings) */}
          {hasIndexDdl && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Index DDL
              </div>
              <IndexDDLBadge ddl={finding.index_ddl} />
            </div>
          )}

          {/* Cost simulation grid */}
          {finding.cost_after != null && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 6,
                background: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
              }}
            >
              <div>
                <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Cost before</div>
                <div style={{ color: 'var(--text-primary)' }}>{fmtCost(finding.cost_before)}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Cost after</div>
                <div style={{ color: 'var(--text-primary)' }}>{fmtCost(finding.cost_after)}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Delta</div>
                <div style={{ color: improved ? 'var(--green)' : 'var(--red)' }}>
                  {finding.cost_delta < 0 ? '' : '+'}{fmtCost(finding.cost_delta)}
                </div>
              </div>
            </div>
          )}

          {/* Action buttons row */}
          {(showApplyBtn || showCopyDdl) && (
            <div style={{ display: 'flex', gap: 8, paddingTop: 2 }}>
              {showApplyBtn && (
                <button
                  className={`apply-btn${applied ? ' applied' : ''}`}
                  onClick={handleApply}
                >
                  {applied ? '✓ Applied' : `← ${applyLabel}`}
                </button>
              )}
              {showCopyDdl && (
                <button
                  className="apply-btn"
                  onClick={handleCopyDdl}
                  style={ddlCopied ? { color: 'var(--green)', borderColor: 'rgba(0,255,136,0.5)' } : {}}
                >
                  {ddlCopied ? '✓ DDL Copied' : '⊡ Copy DDL'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
