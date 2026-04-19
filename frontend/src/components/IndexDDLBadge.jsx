import React, { useState } from 'react';

/**
 * A copyable chip that displays an index DDL string.
 * Click to copy to clipboard; shows confirmation tick for 1.5 s.
 */
export default function IndexDDLBadge({ ddl }) {
  const [copied, setCopied] = useState(false);

  if (!ddl) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(ddl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      onClick={handleCopy}
      title="Click to copy DDL"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: 'rgba(77,201,255,0.08)',
        border: '1px solid rgba(77,201,255,0.2)',
        borderRadius: 6,
        padding: '4px 10px',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: 'var(--blue)',
        cursor: 'pointer',
        maxWidth: '100%',
        textAlign: 'left',
        wordBreak: 'break-all',
        transition: 'background 0.15s',
      }}
    >
      <span style={{ flexShrink: 0 }}>{copied ? '✓' : '⊡'}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {ddl}
      </span>
    </button>
  );
}
