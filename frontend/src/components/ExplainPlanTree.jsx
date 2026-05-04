import React, { useMemo, useState } from 'react';

function extractRootPlan(explainPlan) {
  if (!explainPlan) return null;
  let data = explainPlan;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (Array.isArray(data) && data[0]) return data[0].Plan ?? data[0];
  if (data && data.Plan) return data.Plan;
  return data;
}

/** @typedef {{ severity: string }} FindingLike */

/** @param {FindingLike[]} findings */
function severityByPath(findings) {
  const order = { high: 3, critical: 3, medium: 2, moderate: 2, low: 1 };
  const map = new Map();
  for (const f of findings || []) {
    if (f.track !== 'explain_analysis' || !f.node_path) continue;
    const sev = String(f.severity || 'low').toLowerCase();
    const prev = map.get(f.node_path);
    const sc = order[sev] || 1;
    if (!prev || sc > prev.score) map.set(f.node_path, { severity: sev, score: sc });
  }
  return map;
}

function severityColor(sev) {
  const s = String(sev || '').toLowerCase();
  if (s === 'high' || s === 'critical') return 'var(--red)';
  if (s === 'medium' || s === 'moderate') return 'var(--amber)';
  return '#849585';
}

function PlanNodeBranch({ node, path, findingsMap, depth, defaultExpandedDepth }) {
  const [open, setOpen] = useState(depth < defaultExpandedDepth);
  if (!node || typeof node !== 'object') return null;

  const nodeType = node['Node Type'] || '?';
  const relation = node['Relation Name'];
  const cost = node['Total Cost'];
  const matched = findingsMap.get(path);
  const borderLeft = matched ? `3px solid ${severityColor(matched.severity)}` : '3px solid transparent';
  const hasKids = Array.isArray(node.Plans) && node.Plans.length > 0;

  return (
    <li style={{ listStyle: 'none', margin: 0 }}>
      <div
        role="heading"
        aria-level={Math.min(depth + 3, 6)}
        style={{
          padding: '6px 8px',
          marginBottom: 4,
          borderRadius: 'var(--r-sm)',
          background: 'var(--bg-surface-lo)',
          borderLeft,
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        {hasKids && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--cyan)',
              cursor: 'pointer',
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
            }}
            title={open ? 'Collapse' : 'Expand'}
          >
            <span className={`material-symbols-outlined sz-16 collapsible-icon${open ? ' open' : ''}`}>
              expand_more
            </span>
          </button>
        )}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}>
          <strong>{nodeType}</strong>
          {relation && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
              ({relation})
            </span>
          )}
          {matched && (
            <span style={{ marginLeft: 8, fontSize: 10, color: severityColor(matched.severity), textTransform: 'uppercase' }}>
              Finding · {matched.severity}
            </span>
          )}
        </span>
        {cost != null && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            cost≈ {Number(cost).toFixed(1)}
          </span>
        )}
      </div>
      {hasKids && open && (
        <ul style={{ paddingLeft: 18, margin: '0 0 8px' }}>
          {node.Plans.map((child, i) => (
            <PlanNodeBranch
              key={i}
              node={child}
              path={`${path}->${child['Node Type'] || `child${i}`}`}
              findingsMap={findingsMap}
              depth={depth + 1}
              defaultExpandedDepth={defaultExpandedDepth}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function ExplainPlanTree({ explainPlan, findings = [], defaultExpandedDepth = 2 }) {
  const root = extractRootPlan(explainPlan);
  const findingsMap = useMemo(() => severityByPath(findings), [findings]);

  if (!root) {
    return (
      <div className="empty-state" style={{ padding: '20px', textAlign: 'center' }}>
        <span className="material-symbols-outlined empty-icon">account_tree</span>
        <div className="empty-text">
          Run optimisation with a connected database to see the interactive EXPLAIN tree.
        </div>
      </div>
    );
  }

  const topPath = root['Node Type'] || 'Plan';

  return (
    <div style={{ overflow: 'auto', maxHeight: 420 }}>
      <ul style={{ padding: 0, margin: 0 }}>
        <PlanNodeBranch
          node={root}
          path={topPath}
          findingsMap={findingsMap}
          depth={0}
          defaultExpandedDepth={defaultExpandedDepth}
        />
      </ul>
    </div>
  );
}
