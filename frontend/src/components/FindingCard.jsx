import React, { useState } from 'react';

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

export default function FindingCard({ finding }) {
  const [expanded, setExpanded] = useState(false);

  const sev = normalizeSev(finding.severity);
  const cfg = SEVERITY_CONFIG[sev];
  const id  = finding.rule_id || finding.pattern_id || finding.track || '';

  const titleText  = finding.title       || finding.pattern || finding.type || id;
  const bodyText   = finding.description || finding.suggestion || finding.reason || '';
  const ddlText    = finding.index_ddl   || null;
  const beforeCode = finding.before      || null;
  const afterCode  = finding.after       || null;

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
        {ddlText ? (
          <span className="finding-ddl" title={ddlText}>
            <span className="material-symbols-outlined sz-16">add_circle</span>
            {ddlText.length > 60 ? ddlText.slice(0, 60) + '…' : ddlText}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            {id}
          </span>
        )}
      </div>
    </div>
  );
}
