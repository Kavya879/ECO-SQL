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

function formatIntText(value) {
  const n = Number(String(value || '').replace(/,/g, ''));
  if (Number.isNaN(n)) return value;
  return n.toLocaleString();
}

function splitDescription(description = '') {
  const text = String(description || '').trim();
  if (!text) return { rationale: '', recommendation: '' };

  const parts = text.split(' · ').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { rationale: parts[0], recommendation: parts.slice(1).join(' · ') };
  }

  return { rationale: text, recommendation: '' };
}

function looksLikeSql(text = '') {
  return /^(create|select|with|alter|drop|insert|update|delete|analyze|explain)\b/i.test(
    String(text || '').trim()
  );
}

function humanizeRationale(rawText, finding) {
  const raw = String(rawText || '').trim();
  if (!raw) return '';

  if (String(finding.pattern_id || '') === 'SEQ_SCAN_FILTER') {
    const table = finding.table || 'this table';
    const examined = raw.match(/examined\s+([\d,]+)\s+rows/i)?.[1];
    const removed = raw.match(/removed\s+([\d,]+)\s+rows/i)?.[1];

    if (examined && removed) {
      const examinedTxt = formatIntText(examined);
      const removedCount = Number(String(removed).replace(/,/g, ''));
      if (!Number.isNaN(removedCount) && removedCount === 0) {
        return `The database read all ${examinedTxt} rows from ${table}. Since almost nothing was filtered out, this is usually a low-value optimization.`;
      }
      return `The database read all ${examinedTxt} rows from ${table} and filtered out ${formatIntText(removed)} rows while processing.`;
    }
  }

  return raw;
}

function humanizeRecommendation(rawText) {
  const raw = String(rawText || '').trim();
  if (!raw) return '';

  const idx = raw.match(/^Add a B-tree index on\s+([^\s(]+)\(([^)]+)\)$/i);
  if (idx) {
    const table = idx[1];
    const column = idx[2];
    return `If this query runs frequently, add an index on ${table}.${column} to reduce full-table scans.`;
  }

  return raw;
}

export default function FindingCard({ finding }) {
  const [expanded, setExpanded] = useState(false);
  const [hintCopied, setHintCopied] = useState(false);

  const sev = normalizeSev(finding.severity);
  const cfg = SEVERITY_CONFIG[sev];
  const id  = finding.rule_id || finding.pattern_id || finding.track || '';
  const described = splitDescription(finding.description);

  const titleText  = finding.title       || finding.pattern || finding.type || id;
  const rationaleText = humanizeRationale(
    finding.laymanReason || finding.rationale || finding.reason || described.rationale,
    finding
  );
  const recommendationText = humanizeRecommendation(
    finding.whatToDo || finding.suggestion || described.recommendation
  );
  const ddlText    = finding.index_ddl   || null;
  const beforeCode = finding.before      || null;
  const afterCode  = finding.after       || null;

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

          {rationaleText && (
            <div className="finding-detail-block">
              <div className="finding-detail-label">Why this matters</div>
              <div className="finding-body">{rationaleText}</div>
            </div>
          )}

          {recommendationText && (
            <div className="finding-detail-block">
              <div className="finding-detail-label">Recommended action</div>
              {looksLikeSql(recommendationText) ? (
                <pre className="finding-code-inline">{recommendationText}</pre>
              ) : (
                <div className="finding-body">{recommendationText}</div>
              )}
            </div>
          )}

          {finding.example?.before && finding.example?.after && (
            <div className="finding-example-grid">
              <div className="finding-example-card before">
                <div className="finding-example-label">Before</div>
                <pre>{finding.example.before}</pre>
              </div>
              <div className="finding-example-card after">
                <div className="finding-example-label">After</div>
                <pre>{finding.example.after}</pre>
              </div>
            </div>
          )}
        </div>
        <div className={`finding-impact ${sev}`}>
          <span className="material-symbols-outlined sz-16">{cfg.icon}</span>
          {cfg.label}
        </div>
      </div>

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
