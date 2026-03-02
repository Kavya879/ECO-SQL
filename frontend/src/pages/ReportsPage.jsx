import React, { useEffect, useState, useCallback } from 'react';
import { getHistory, clearHistory } from '../api/api.js';
import { fmtGco2, fmtRuntime, fmtTimeAgo, classificationBadge } from '../utils/format.js';

const DAYS = [7, 30, 90, 365];

export default function ReportsPage() {
  const [data, setData] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [classification, setClassification] = useState('');
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(0);
  const [copiedId, setCopiedId] = useState(null);
  const limit = 12;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getHistory({ search, classification, days, limit, offset: page * limit });
      setData(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search, classification, days, page]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = () => {
    window.location.href = `/api/history/export?days=${days}`;
  };

  const copyQueryToEditor = (queryText, queryId) => {
    // Store in sessionStorage for cross-page communication
    sessionStorage.setItem('queryToCopy', queryText);
    // Navigate to analyze page
    window.location.href = '/analyze';
    setCopiedId(queryId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleClearHistory = async () => {
    if (!window.confirm('Are you sure you want to clear all query history? This cannot be undone.')) {
      return;
    }
    try {
      await clearHistory();
      setData({ rows: [], total: 0 });
      setPage(0);
      alert('History cleared successfully');
    } catch (e) {
      alert('Failed to clear history: ' + (e.response?.data?.error || e.message));
    }
  };

  const totalPages = Math.ceil(data.total / limit);
  const stats = {
    total: data.total,
    totalCo2Kg: data.rows.reduce((s, r) => s + parseFloat(r.total_emissions_gco2 || 0), 0) / 1000,
    highImpact: data.rows.filter(r => r.classification === 'HIGH IMPACT').length,
    sustainable: data.rows.filter(r => r.classification === 'SUSTAINABLE').length,
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Reports <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 13 }}>· Historical query emission records</span></div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary btn-sm" onClick={load}>↺ Refresh</button>
          <button className="btn btn-primary btn-sm" onClick={exportCsv}>↓ Export CSV</button>
          <button className="btn btn-secondary btn-sm" onClick={handleClearHistory} style={{ color: 'var(--red)' }}>🗑 Clear History</button>
        </div>
      </div>

      <div className="page-body">
        {/* Summary cards */}
        <div className="stat-cards" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 20 }}>
          {[
            { label: 'Total Queries', value: data.total.toLocaleString(), icon: '⚡', color: 'var(--green)' },
            { label: 'Total CO₂ Emitted', value: `${stats.totalCo2Kg.toFixed(2)} kg`, icon: '☁', color: 'var(--text-primary)' },
            { label: 'High Impact Queries', value: data.rows.filter(r => r.classification === 'HIGH IMPACT').length, icon: '⚠', color: 'var(--red)' },
            { label: 'Sustainable Queries', value: data.rows.filter(r => r.classification === 'SUSTAINABLE').length, icon: '✓', color: 'var(--green)' },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div className="stat-info">
                <div className="stat-label">{s.label}</div>
                <div className="stat-value" style={{ color: s.color, fontSize: 22 }}>{s.value}</div>
              </div>
              <div className="stat-icon" style={{ background: 'var(--bg-secondary)', fontSize: 20 }}>{s.icon}</div>
            </div>
          ))}
        </div>

        {/* Filter bar */}
        <div className="filter-bar">
          <div className="search-input-wrap">
            <span className="search-icon">⌕</span>
            <input
              className="form-control search-input"
              placeholder="Search SQL queries..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
            />
          </div>
          <select className="form-control" style={{ width: 170, height: 36, padding: '6px 32px 6px 10px' }}
            value={classification} onChange={e => { setClassification(e.target.value); setPage(0); }}>
            <option value="">All Classifications</option>
            <option value="SUSTAINABLE">Sustainable</option>
            <option value="MODERATE">Moderate</option>
            <option value="HIGH IMPACT">High Impact</option>
          </select>
          <select className="form-control" style={{ width: 140, height: 36, padding: '6px 32px 6px 10px' }}
            value={days} onChange={e => { setDays(parseInt(e.target.value)); setPage(0); }}>
            {DAYS.map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
            Showing {page * limit + 1}–{Math.min((page + 1) * limit, data.total)} of {data.total.toLocaleString()}
          </span>
        </div>

        {/* Table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead>
                <tr>
                  <th>Query ID</th>
                  <th>SQL Snippet</th>
                  <th>Database</th>
                  <th>Runtime (s)</th>
                  <th>Energy (kWh)</th>
                  <th>gCO₂ ↑</th>
                  <th>Tables</th>
                  <th>Classification</th>
                  <th>Timestamp</th>
                  <th style={{ width: 60 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                    <span className="spinner" style={{ display: 'inline-block' }} />
                  </td></tr>
                ) : data.rows.length === 0 ? (
                  <tr><td colSpan={10}>
                    <div className="empty-state">
                      <div className="empty-state-icon">📋</div>
                      <div className="empty-state-text">No records found. Try adjusting filters.</div>
                    </div>
                  </td></tr>
                ) : data.rows.map(row => {
                  const cls = row.classification || 'SUSTAINABLE';
                  const valColor = cls === 'SUSTAINABLE' ? 'var(--green)' : cls === 'MODERATE' ? 'var(--amber)' : 'var(--red)';
                  const isCopied = copiedId === row.id;
                  return (
                    <tr key={row.id}>
                      <td className="mono" style={{ color: 'var(--text-muted)' }}>#{row.id}</td>
                      <td><div className="query-snippet">{row.query_text}</div></td>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--blue)' }}>{row.database_name}</td>
                      <td className="mono">{fmtRuntime(row.runtime_s)}</td>
                      <td className="mono" style={{ color: 'var(--text-secondary)' }}>{row.energy_kwh?.toFixed(7)}</td>
                      <td className="mono" style={{ color: valColor, fontWeight: 600 }}>{fmtGco2(row.total_emissions_gco2)}</td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {(row.tables_involved || []).join(', ') || '—'}
                      </td>
                      <td><span className={`badge ${classificationBadge(cls)}`}>{cls}</span></td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtTimeAgo(row.created_at)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => copyQueryToEditor(row.query_text, row.id)}
                          title="Copy query to editor"
                          style={{
                            fontSize: 11,
                            padding: '4px 6px',
                            color: isCopied ? 'var(--green)' : 'var(--text-secondary)',
                          }}
                        >
                          {isCopied ? '✓' : '→'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border-subtle)' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>← Prev</button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {page + 1} / {totalPages}
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>Next →</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
