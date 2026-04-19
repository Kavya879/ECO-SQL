import React, { useState, useEffect } from 'react';
import { getDatabases, getTables } from '../api/api.js';

export default function SettingsPage() {
  const [databases, setDatabases] = useState([]);
  const [selectedDb, setSelectedDb] = useState('');
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    getDatabases().then(d => {
      setDatabases(d.databases || []);
      if (d.databases?.length) setSelectedDb(d.databases[0].name);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedDb) return;
    setLoading(true);
    getTables(selectedDb).then(d => setTables(d.tables || [])).catch(() => setTables([])).finally(() => setLoading(false));
  }, [selectedDb]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  return (
    <>
      <div className="page-header">
        <div className="page-title">Settings</div>
      </div>
      <div className="page-body" style={{ maxWidth: 720 }}>
        <div className="settings-section">
          <div className="settings-title">Database Connection</div>
          <div className="card">
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
              Connection parameters are set via <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--blue)' }}>.env</span> file in the backend directory.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { label: 'DB_HOST', hint: 'e.g. localhost' },
                { label: 'DB_PORT', hint: 'e.g. 5432' },
                { label: 'DB_USER', hint: 'e.g. postgres' },
                { label: 'DB_PASSWORD', hint: '••••••••' },
                { label: 'DB_NAME', hint: 'e.g. postgres' },
                { label: 'PORT', hint: 'e.g. 3001' },
              ].map(f => (
                <div key={f.label} className="form-group">
                  <label className="form-label">{f.label}</label>
                  <input className="form-control form-control-mono" placeholder={f.hint} readOnly
                    style={{ cursor: 'default', opacity: 0.6 }} />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Edit backend/.env to configure connection settings, then restart the server.
            </div>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-title">Database Explorer</div>
          <div className="card">
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Select Database</label>
              <select className="form-control" style={{ maxWidth: 280 }} value={selectedDb} onChange={e => setSelectedDb(e.target.value)}>
                {databases.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
              </select>
            </div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}><span className="spinner" /></div>
            ) : tables.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No tables found in this database.</div>
            ) : (
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{tables.length} tables found</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {tables.map(t => (
                    <div key={t.name + t.schema} style={{
                      fontFamily: 'var(--font-mono)', fontSize: 11.5,
                      padding: '4px 10px', background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 6, color: 'var(--text-secondary)',
                    }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{t.schema}.</span>{t.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-title">About QueryCarbon</div>
          <div className="card">
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <p>QueryCarbon estimates the carbon footprint of SQL queries using the <strong style={{ color: 'var(--text-primary)' }}>Green Algorithms framework</strong> (Lannelongue et al., 2021).</p>
              <br />
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '10px 14px', borderRadius: 8, borderLeft: '3px solid var(--green)' }}>
                E = t × (n_c × P_c × u_c + n_mem × 0.3725) × PUE × 0.001<br />
                O = E × I<br />
                M = TE × (TiR / EL) × (RR / ToR)<br />
                SCI = (O + M) / R
              </p>
              <br />
              <p style={{ fontSize: 12 }}>Phase 1 · React + Node.js + PostgreSQL · No authentication required</p>
            </div>
          </div>
        </div>
      </div>
      {toast && <div className="toast">✓ {toast}</div>}
    </>
  );
}
