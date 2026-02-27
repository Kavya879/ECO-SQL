import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

export default function Reports() {
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ totalCo2: 0, sustainable: 0, highImpact: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [classification, setClassification] = useState('');
  const [dateRange, setDateRange] = useState('30');
  const [sortBy, setSortBy] = useState('analyzed_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [detailModal, setDetailModal] = useState(null);

  const limit = 12;

  useEffect(() => {
    async function fetchHistory() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(limit),
          dateRange,
          sortBy,
          sortOrder,
        });
        if (search.trim()) params.set('search', search.trim());
        if (classification) params.set('classification', classification);

        const res = await fetch(`/api/query-history?${params}`);
        const data = await res.json();
        if (res.ok) {
          setItems(data.items || []);
          setTotal(data.total ?? 0);
          setSummary(data.summary || { totalCo2: 0, sustainable: 0, highImpact: 0 });
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchHistory();
  }, [page, search, classification, dateRange, sortBy, sortOrder]);

  const { totalCo2, sustainable, highImpact } = summary;

  const handleExportCsv = () => {
    const params = new URLSearchParams({ dateRange, limit: '5000' });
    if (classification) params.set('classification', classification);
    window.open(`/api/export-csv?${params}`, '_blank');
  };

  const fetchDetails = async (queryId) => {
    try {
      const res = await fetch(`/api/query-details/${queryId}`);
      const data = await res.json();
      if (res.ok) setDetailModal(data);
    } catch (e) {
      console.error(e);
    }
  };

  const toggleSort = (col) => {
    if (sortBy === col) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    else setSortBy(col);
  };

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0 }}>Reports</h1>
          <p style={{ margin: '4px 0 0 0', color: '#8b949e', fontSize: 14 }}>Historical query emission records</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: '1px solid #30363d',
              color: '#c9d1d9',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Filter
          </button>
          <button
            onClick={handleExportCsv}
            style={{
              padding: '8px 16px',
              background: '#3fb950',
              color: '#0d1117',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Export CSV
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <SummaryCard title="Total Queries" value={total} />
        <SummaryCard title="Total CO2 Emitted" value={`${((totalCo2 || 0) / 1000).toFixed(2)} kg`} />
        <SummaryCard title="High Impact Queries" value={highImpact} color="#d29922" />
        <SummaryCard title="Sustainable Queries" value={sustainable} color="#3fb950" />
      </div>

      <div style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="search"
          placeholder="Q SELECT..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '8px 12px',
            width: 200,
            background: '#0d1117',
            border: '1px solid #30363d',
            borderRadius: 6,
            color: '#c9d1d9',
          }}
        />
        <select
          value={classification}
          onChange={(e) => setClassification(e.target.value)}
          style={{
            padding: '8px 12px',
            background: '#21262d',
            border: '1px solid #30363d',
            borderRadius: 6,
            color: '#c9d1d9',
          }}
        >
          <option value="">All Classifications</option>
          <option value="SUSTAINABLE">Sustainable</option>
          <option value="MODERATE">Moderate</option>
          <option value="HIGH IMPACT">High Impact</option>
        </select>
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          style={{
            padding: '8px 12px',
            background: '#21262d',
            border: '1px solid #30363d',
            borderRadius: 6,
            color: '#c9d1d9',
          }}
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="all">All time</option>
        </select>
        <span style={{ color: '#8b949e', fontSize: 13, marginLeft: 'auto' }}>
          Showing {(page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total}
        </span>
      </div>

      <div
        style={{
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#0d1117' }}>
              <Th label="QUERY ID" sortKey="query_id" current={sortBy} order={sortOrder} onSort={toggleSort} />
              <Th label="SQL SNIPPET" sortKey="query_string" current={sortBy} order={sortOrder} onSort={toggleSort} />
              <Th label="RUNTIME (S)" sortKey="runtime_ms" current={sortBy} order={sortOrder} onSort={toggleSort} />
              <Th label="ENERGY (KWH)" sortKey="energy_kwh" current={sortBy} order={sortOrder} onSort={toggleSort} />
              <Th label="gCO2eq" sortKey="sci_gco2eq_per_query" current={sortBy} order={sortOrder} onSort={toggleSort} />
              <Th label="TABLES" current={sortBy} />
              <Th label="CLASSIFICATION" sortKey="classification" current={sortBy} order={sortOrder} onSort={toggleSort} />
              <Th label="TIMESTAMP" sortKey="analyzed_at" current={sortBy} order={sortOrder} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#8b949e' }}>
                  Loading...
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr
                  key={row.queryId}
                  onClick={() => fetchDetails(row.queryId)}
                  style={{
                    cursor: 'pointer',
                    background: highlightId === row.queryId ? 'rgba(63,185,80,0.1)' : undefined,
                  }}
                >
                  <td style={{ padding: 12, fontSize: 13 }}>#{String(row.queryId).slice(0, 8)}...</td>
                  <td style={{ padding: 12, fontSize: 12, fontFamily: 'monospace' }}>{row.queryPreview}</td>
                  <td style={{ padding: 12 }}>{row.runtimeMs != null ? (row.runtimeMs / 1000).toFixed(2) : '-'}</td>
                  <td style={{ padding: 12 }}>{row.energyKwh != null ? row.energyKwh.toExponential(4) : '-'}</td>
                  <td
                    style={{
                      padding: 12,
                      color:
                        row.classification === 'SUSTAINABLE'
                          ? '#3fb950'
                          : row.classification === 'MODERATE'
                          ? '#d29922'
                          : '#f85149',
                    }}
                  >
                    {row.gco2eq != null ? row.gco2eq.toFixed(2) : '-'}
                  </td>
                  <td style={{ padding: 12, fontSize: 12 }}>{row.tablesInvolved?.join(', ') || '-'}</td>
                  <td style={{ padding: 12 }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        background:
                          row.classification === 'SUSTAINABLE'
                            ? 'rgba(63,185,80,0.2)'
                            : row.classification === 'MODERATE'
                            ? 'rgba(210,153,34,0.2)'
                            : 'rgba(248,81,73,0.2)',
                        color:
                          row.classification === 'SUSTAINABLE'
                            ? '#3fb950'
                            : row.classification === 'MODERATE'
                            ? '#d29922'
                            : '#f85149',
                      }}
                    >
                      • {row.classification}
                    </span>
                  </td>
                  <td style={{ padding: 12, fontSize: 12, color: '#8b949e' }}>
                    {row.analyzedAt ? formatRelative(row.analyzedAt) : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div style={{ padding: 12, display: 'flex', justifyContent: 'center', gap: 8 }}>
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              style={{
                padding: '6px 12px',
                background: page <= 1 ? '#21262d' : '#30363d',
                border: 'none',
                borderRadius: 4,
                color: '#c9d1d9',
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
              }}
            >
              Previous
            </button>
            <span style={{ padding: '6px 12px', color: '#8b949e' }}>
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              style={{
                padding: '6px 12px',
                background: page >= totalPages ? '#21262d' : '#30363d',
                border: 'none',
                borderRadius: 4,
                color: '#c9d1d9',
                cursor: page >= totalPages ? 'not-allowed' : 'pointer',
              }}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {detailModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setDetailModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#161b22',
              borderRadius: 12,
              padding: 24,
              maxWidth: 560,
              width: '90%',
              border: '1px solid #30363d',
            }}
          >
            <h3 style={{ margin: '0 0 16px 0' }}>Query Details</h3>
            <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
              <div>Energy: {detailModal.energyKwh?.toExponential(4)} kWh</div>
              <div>Operational CO2: {detailModal.operationalCo2?.toFixed(2)} g</div>
              <div>Embodied CO2: {detailModal.embodiedCo2?.toFixed(2)} g</div>
              <div>SCI: {detailModal.sciPerQuery?.toFixed(2)} gCO2eq/query</div>
              <div>Score: {detailModal.sustainabilityRating}/100 ({detailModal.tier})</div>
            </div>
            <button
              onClick={() => setDetailModal(null)}
              style={{
                marginTop: 16,
                padding: '8px 16px',
                background: '#30363d',
                border: 'none',
                borderRadius: 6,
                color: '#c9d1d9',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ title, value, color }) {
  return (
    <div
      style={{
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || '#c9d1d9' }}>{value}</div>
    </div>
  );
}

function Th({ label, sortKey, current, order, onSort }) {
  const active = sortKey && current === sortKey;
  return (
    <th
      style={{ padding: 12, textAlign: 'left', fontSize: 11, color: '#8b949e', textTransform: 'uppercase' }}
      onClick={sortKey ? () => onSort(sortKey) : undefined}
    >
      {label}
      {sortKey && <span style={{ marginLeft: 4 }}>{active ? (order === 'asc' ? '↑' : '↓') : '↕'}</span>}
    </th>
  );
}

function formatRelative(d) {
  const date = new Date(d);
  const now = new Date();
  const diffMs = now - date;
  const diffM = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);
  if (diffM < 1) return 'Just now';
  if (diffM < 60) return `${diffM} min ago`;
  if (diffH < 24) return `${diffH} hr ago`;
  if (diffD < 2) return 'Yesterday';
  return date.toLocaleDateString();
}
