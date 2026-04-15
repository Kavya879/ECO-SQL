import React from 'react';

export function ResultMetric({ label, value, unit, color }) {
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

export function MetricTile({ label, value, unit, accent, sublabel }) {
  return (
    <div className="metric-tile">
      <div className="metric-tile-label">{label}</div>
      <div className="metric-tile-value-row">
        <div className="metric-tile-value" style={accent ? { color: accent } : undefined}>{value}</div>
        {unit && <div className="metric-tile-unit">{unit}</div>}
      </div>
      {sublabel && <div className="metric-tile-sub">{sublabel}</div>}
    </div>
  );
}

export function SustainabilityGauge({ score }) {
  const r = 44;
  const cx = 56, cy = 56;
  const pct = Math.min(score / 100, 1);
  const circumference = 2 * Math.PI * r * 0.75;
  const offset = circumference * (1 - pct);
  const color = score >= 70 ? '#00ff88' : score >= 40 ? '#f5a623' : '#ff4d4d';

  return (
    <div className="gauge-wrap">
      <svg width="128" height="96" viewBox="0 0 112 80">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e2832" strokeWidth="7"
          strokeDasharray={circumference} strokeDashoffset={0}
          strokeLinecap="round" transform={`rotate(135 ${cx} ${cy})`} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="7"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform={`rotate(135 ${cx} ${cy})`}
          className="gauge-arc" />
        <text x={cx} y={cy - 2} textAnchor="middle" fill={color} fontSize="18" fontWeight="700" fontFamily="JetBrains Mono">{score}</text>
        <text x={cx} y={cx + 14} textAnchor="middle" fill="#4a5568" fontSize="8">/100</text>
      </svg>
      <div className="gauge-label-bottom">Sustainability Rating</div>
    </div>
  );
}

export function SectionCard({ eyebrow, title, rightLabel, children, className = '' }) {
  return (
    <section className={`section-card ${className}`.trim()}>
      <div className="section-card-header">
        <div>
          {eyebrow && <div className="section-card-eyebrow">{eyebrow}</div>}
          <div className="section-card-title">{title}</div>
        </div>
        {rightLabel && <div className="section-card-chip">{rightLabel}</div>}
      </div>
      <div className="section-card-body">{children}</div>
    </section>
  );
}

export function InlinePill({ children, color = 'var(--text-secondary)' }) {
  return (
    <span className="inline-pill" style={{ color }}>
      {children}
    </span>
  );
}

export function SummaryMetric({ label, value, sublabel, accent }) {
  return (
    <div className="summary-metric">
      <div className="summary-metric-label">{label}</div>
      <div className="summary-metric-value" style={accent ? { color: accent } : undefined}>{value}</div>
      {sublabel && <div className="summary-metric-sub">{sublabel}</div>}
    </div>
  );
}

export function ReportBlock({ title, items, accent, emptyText = 'No issues detected' }) {
  return (
    <div className="report-block" style={accent ? { borderColor: `${accent}22` } : undefined}>
      <div className="report-block-title" style={accent ? { color: accent } : undefined}>{title}</div>
      <div className="report-block-list">
        {items && items.length > 0 ? items.map((item, index) => (
          <div key={index} className="report-item">
            <div className="report-item-title">{item.title}</div>
            <div className="report-item-body">
              {item.body.map((line, lineIndex) => <div key={lineIndex}>{line}</div>)}
            </div>
          </div>
        )) : (
          <div className="report-empty">{emptyText}</div>
        )}
      </div>
    </div>
  );
}

export function QueryComparison({ originalSql, suggestedSql, changed, summary = [], originalLabel = 'Original SQL', suggestedLabel = 'Suggested SQL' }) {
  return (
    <SectionCard eyebrow="Comparison" title="Before vs Suggested Rewrite" rightLabel={changed ? 'different' : 'unchanged'}>
      <div className="query-compare-summary">
        {summary && summary.length > 0 ? summary.map((item, index) => (
          <div key={index} className="query-compare-summary-item">
            <div className="query-compare-summary-label">{item.label}</div>
            <div className="query-compare-summary-value">{item.value}</div>
          </div>
        )) : null}
      </div>

      <div className="query-compare-stack">
        <div className="query-compare-pane">
          <div className="query-compare-pane-label">{originalLabel}</div>
          <pre className="query-compare-code">{originalSql}</pre>
        </div>
        <div className="query-compare-pane query-compare-pane-highlight">
          <div className="query-compare-pane-label">{suggestedLabel}</div>
          <pre className="query-compare-code">{suggestedSql}</pre>
        </div>
      </div>
    </SectionCard>
  );
}
