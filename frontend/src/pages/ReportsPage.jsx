import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getHistory, clearHistory } from '../api/api.js';
import { fmtGco2, fmtRuntime, fmtTimeAgo } from '../utils/format.js';

const DAYS = [7, 30, 90, 365];
const LIMIT = 15;

/* ─── SQL keyword highlighter ───────────────────────────────── */
const KW_RE = /\b(SELECT|FROM|WHERE|JOIN|LEFT|INNER|OUTER|ON|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|UNION|INSERT|UPDATE|DELETE|WITH|AS|AND|OR|NOT|IN|LIKE|COUNT|SUM|AVG|DISTINCT|CROSS)\b/gi;

function SqlCell({ sql = '' }) {
  const parts = sql.split(KW_RE);
  return (
    <div className="sql-snippet">
      {parts.map((p, i) =>
        KW_RE.test(p)
          ? <span key={i} className="sql-kw">{p}</span>
          : p
      )}
    </div>
  );
}

/* ─── Score badge ────────────────────────────────────────────── */
function ScoreBadge({ cls }) {
  const c = String(cls || '').toUpperCase();
  const map = {
    EXCELLENT:   { letter: 'A', color: '#00FF88',  bg: 'rgba(0,255,136,0.15)'  },
    SUSTAINABLE: { letter: 'A', color: '#00FF88',  bg: 'rgba(0,255,136,0.15)'  },
    GOOD:        { letter: 'B', color: '#a5eeff',  bg: 'rgba(165,238,255,0.1)' },
    MODERATE:    { letter: 'C', color: '#e5c364',  bg: 'rgba(229,195,100,0.1)' },
    POOR:        { letter: 'D', color: '#ffb4ab',  bg: 'rgba(255,180,171,0.1)' },
    CRITICAL:    { letter: 'F', color: '#ffb4ab',  bg: 'rgba(147,0,10,0.3)'    },
    'HIGH IMPACT':{ letter: 'F', color: '#ffb4ab', bg: 'rgba(147,0,10,0.3)'    },
  };
  const cfg = map[c] || { letter: '?', color: 'var(--text-muted)', bg: 'var(--bg-surface)' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      padding: '2px 8px', borderRadius: 4,
      background: cfg.bg, color: cfg.color,
      fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700,
    }}>
      {cfg.letter}
    </span>
  );
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const [data, setData]         = useState({ rows: [], total: 0 });
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [cls, setCls]           = useState('');
  const [days, setDays]         = useState(30);
  const [page, setPage]         = useState(0);
  const [copiedId, setCopiedId] = useState(null);

  const totalPages = Math.ceil(data.total / LIMIT);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getHistory({ search, classification: cls, days, limit: LIMIT, offset: page * LIMIT });
      setData(res);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [search, cls, days, page]);

  useEffect(() => { load(); }, [load]);

  const handleClear = async () => {
    if (!window.confirm('Clear ALL query history? This cannot be undone.')) return;
    try {
      await clearHistory();
      setData({ rows: [], total: 0 });
      setPage(0);
    } catch (e) { alert('Failed: ' + (e.response?.data?.error || e.message)); }
  };

  const exportCsv = () => { window.location.href = `/api/history/export?days=${days}`; };

  const copyToEditor = (queryText, id) => {
    sessionStorage.setItem('queryToCopy', queryText);
    setCopiedId(id);
    setTimeout(() => { setCopiedId(null); navigate('/analyze'); }, 400);
  };

  /* Pagination pages to display */
  const pageNums = (() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i);
    if (page < 4) return [0, 1, 2, 3, '...', totalPages - 1];
    if (page > totalPages - 5) return [0, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1];
    return [0, '...', page - 1, page, page + 1, '...', totalPages - 1];
  })();

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-head">
        <div>
          <div className="page-title">Reports &amp; History</div>
          <div className="page-desc">Analyze past query executions and their carbon footprint. Click a row to open full details and optimization.</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-outline btn-sm" onClick={handleClear}>
            <span className="material-symbols-outlined sz-16">delete</span>
            Clear History
          </button>
          <button className="btn btn-primary btn-sm" onClick={exportCsv}>
            <span className="material-symbols-outlined sz-16">download</span>
            Export CSV
          </button>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="filter-card">
        {/* Search */}
        <div className="filter-group" style={{ flex: 2, minWidth: 220 }}>
          <label className="field-label">Search Queries</label>
          <div className="search-wrap">
            <span className="material-symbols-outlined search-icon">search</span>
            <input
              className="input search-input"
              placeholder="SELECT * FROM..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
            />
          </div>
        </div>

        {/* Date range */}
        <div className="filter-group" style={{ minWidth: 160 }}>
          <label className="field-label">Date Range</label>
          <div style={{ position: 'relative' }}>
            <select
              className="select"
              value={days}
              onChange={e => { setDays(parseInt(e.target.value)); setPage(0); }}
            >
              {DAYS.map(d => <option key={d} value={d}>Last {d} Days</option>)}
            </select>
          </div>
        </div>

        {/* Tier filter */}
        <div className="filter-group" style={{ minWidth: 160 }}>
          <label className="field-label">Tier Filter</label>
          <select
            className="select"
            value={cls}
            onChange={e => { setCls(e.target.value); setPage(0); }}
          >
            <option value="">All Tiers</option>
            <option value="EXCELLENT">Excellent</option>
            <option value="GOOD">Good</option>
            <option value="MODERATE">Moderate</option>
            <option value="POOR">Poor</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </div>

        <button className="btn btn-outline btn-sm" onClick={load} style={{ alignSelf: 'flex-end' }}>
          <span className="material-symbols-outlined sz-16">filter_list</span>
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="card">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 80 }}>ID</th>
                <th style={{ minWidth: 320 }}>SQL</th>
                <th style={{ width: 120 }}>Database</th>
                <th style={{ width: 110, textAlign: 'right' }}>Runtime (ms)</th>
                <th style={{ width: 80, textAlign: 'center' }}>Score</th>
                <th style={{ width: 110, textAlign: 'right' }}>Total CO₂ (g)</th>
                <th style={{ width: 150 }}>Timestamp</th>
                <th style={{ width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 36 }}>
                  <span className="spinner" style={{ display: 'inline-block' }} />
                </td></tr>
              ) : data.rows.length === 0 ? (
                <tr><td colSpan={8}>
                  <div className="empty-state">
                    <span className="material-symbols-outlined empty-icon">history</span>
                    <div className="empty-text">No records found. Try adjusting filters or analyze some queries.</div>
                  </div>
                </td></tr>
              ) : data.rows.map(row => {
                const co2 = parseFloat(row.total_emissions_gco2 || 0);
                const co2Color = co2 < 1 ? 'var(--green)' : co2 < 5 ? 'var(--amber)' : 'var(--red)';
                const isCopied = copiedId === row.id;
                const runtimeMs = row.runtime_s ? (parseFloat(row.runtime_s) * 1000).toFixed(0) : '—';
                return (
                  <tr
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    title="View query details & optimization"
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/query/${row.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/query/${row.id}`);
                      }
                    }}
                  >
                    <td className="mono dim" style={{ fontSize: 11 }}>#{row.id}</td>
                    <td className="col-code">
                      <SqlCell sql={row.query_text || ''} />
                    </td>
                    <td className="mono dim" style={{ fontSize: 11 }}>{row.database_name || '—'}</td>
                    <td className="mono" style={{ textAlign: 'right', fontSize: 11 }}>{runtimeMs}</td>
                    <td style={{ textAlign: 'center' }}>
                      <ScoreBadge cls={row.classification} />
                    </td>
                    <td className="mono" style={{ textAlign: 'right', fontSize: 11, color: co2Color }}>
                      {fmtGco2(co2)}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {fmtTimeAgo(row.created_at)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="topbar-btn"
                        title="Open in editor"
                        style={{ color: isCopied ? 'var(--green)' : undefined }}
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToEditor(row.query_text, row.id);
                        }}
                      >
                        <span className="material-symbols-outlined sz-16">
                          {isCopied ? 'check' : 'edit'}
                        </span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="pagination">
          <span>
            Showing {data.total === 0 ? 0 : page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, data.total)} of {data.total.toLocaleString()} queries
          </span>
          {totalPages > 1 && (
            <div className="pagination-pages">
              <button
                className="page-btn"
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
              >
                <span className="material-symbols-outlined sz-16">chevron_left</span>
              </button>
              {pageNums.map((p, i) =>
                p === '...'
                  ? <span key={`e${i}`} style={{ padding: '0 4px', alignSelf: 'center', color: 'var(--text-dim)' }}>…</span>
                  : (
                    <button
                      key={p}
                      className={`page-btn${p === page ? ' active' : ''}`}
                      onClick={() => setPage(p)}
                    >
                      {p + 1}
                    </button>
                  )
              )}
              <button
                className="page-btn"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
              >
                <span className="material-symbols-outlined sz-16">chevron_right</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
