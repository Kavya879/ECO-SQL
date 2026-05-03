import React, { useState } from 'react';

function simulationConfidence(sim) {
  if (sim === 'simulated') return { tag: 'evidence', label: 'EXPLAIN-backed', cls: 'ddl-chip-evidence' };
  if (sim === 'no_improvement')
    return { tag: 'measured', label: 'No gain measured', cls: 'ddl-chip-muted' };
  return { tag: 'heuristic', label: 'Heuristic', cls: 'ddl-chip-heuristic' };
}

export default function IndexDDLBadge({ ddl, simulation }) {
  const [copied, setCopied] = useState(false);
  if (!ddl) return null;

  const conf = simulationConfidence(simulation);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ddl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      type="button"
      className={`ddl-copy-chip ${conf.cls}`}
      onClick={copy}
      title="Copy DDL"
    >
      <span className="material-symbols-outlined sz-16">{copied ? 'check' : 'content_copy'}</span>
      <span className="ddl-chip-ddl">{ddl.length > 56 ? `${ddl.slice(0, 56)}…` : ddl}</span>
      <span className="ddl-chip-badge">{copied ? 'Copied' : conf.label}</span>
    </button>
  );
}
