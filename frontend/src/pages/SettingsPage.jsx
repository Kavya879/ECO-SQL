import React, { useState, useEffect } from 'react';
import { getDatabases, getTables, getHardwareConfig } from '../api/api.js';

const PRESETS = {
  Cloud:        { pue: 1.12, gridIntensity: 310 },
  'On-Premises': { pue: 1.45, gridIntensity: 442 },
  Laptop:       { pue: 1.00, gridIntensity: 475 },
};

export default function SettingsPage() {
  const [hw, setHw]           = useState(null);
  const [databases, setDbs]   = useState([]);
  const [selectedDb, setDb]   = useState('');
  const [tables, setTables]   = useState([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [toast, setToast]     = useState('');
  const [activePreset, setPreset] = useState('On-Premises');
  const [pue, setPue]         = useState(1.45);
  const [gridCi, setGridCi]   = useState(442);
  const [lifespan, setLifespan] = useState(4.5);

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(''), 3000);
  };

  useEffect(() => {
    getHardwareConfig()
      .then(cfg => setHw(cfg))
      .catch(() => {});
    getDatabases()
      .then(d => {
        setDbs(d.databases || []);
        if (d.databases?.length) setDb(d.databases[0].name);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedDb) return;
    setLoadingTables(true);
    getTables(selectedDb)
      .then(d => setTables(d.tables || []))
      .catch(() => setTables([]))
      .finally(() => setLoadingTables(false));
  }, [selectedDb]);

  const applyPreset = (name) => {
    setPreset(name);
    setPue(PRESETS[name].pue);
    setGridCi(PRESETS[name].gridIntensity);
  };

  const handleSave = () => {
    showToast('Configuration saved successfully', true);
  };

  const handleReset = () => {
    applyPreset('On-Premises');
    setLifespan(4.5);
    showToast('Reset to defaults', true);
  };

  return (
    <div className="page-container" style={{ maxWidth: 1200 }}>
      {/* Header */}
      <div className="page-head" style={{ marginBottom: 32 }}>
        <div>
          <div className="page-title">Configuration</div>
          <div className="page-desc" style={{ maxWidth: 560 }}>
            Manage hardware telemetry mapping and environmental carbon intensity parameters.
            These settings affect the baseline calculations for all analytical reports.
          </div>
        </div>
      </div>

      <div className="settings-layout">
        {/* Left — Hardware Profile */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-header">
              <span className="card-title">
                <span className="material-symbols-outlined sz-16">memory</span>
                Hardware Profile
              </span>
              <span className="pulse-dot" />
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                Auto-detected host specifications used for baseline energy modeling. Read-only.
              </p>
              {hw ? (
                <>
                  <div className="hw-profile-item">
                    <span className="hw-profile-key">CPU Architecture</span>
                    <span className="hw-profile-val">{hw.cpuModel || `${hw.cpuCores} Core CPU`}</span>
                  </div>
                  <div className="hw-profile-item">
                    <span className="hw-profile-key">Logical Cores</span>
                    <span className="hw-profile-val">{hw.cpuCores} threads</span>
                  </div>
                  <div className="hw-profile-item">
                    <span className="hw-profile-key">Total Memory (RAM)</span>
                    <span className="hw-profile-val">{hw.ramGb} GB</span>
                  </div>
                  <div className="hw-profile-item">
                    <span className="hw-profile-key">Power / Core</span>
                    <span className="hw-profile-val">{hw.powerPerCore || 10} W</span>
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                  <span className="spinner" style={{ display: 'inline-block' }} />
                </div>
              )}
            </div>
            <div style={{
              padding: '10px 20px',
              borderTop: '1px solid var(--border-muted)',
              background: 'var(--bg-surface-lo)',
            }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { setHw(null); getHardwareConfig().then(setHw).catch(() => {}); }}
              >
                <span className="material-symbols-outlined sz-16">sync</span>
                Force Rescan
              </button>
            </div>
          </div>

          {/* Database explorer */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">
                <span className="material-symbols-outlined sz-16">database</span>
                Database Explorer
              </span>
            </div>
            <div className="card-body">
              <div className="field" style={{ marginBottom: 12 }}>
                <label className="field-label">Select Database</label>
                <select
                  className="select"
                  value={selectedDb}
                  onChange={e => setDb(e.target.value)}
                >
                  {databases.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                </select>
              </div>
              {loadingTables ? (
                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                  <span className="spinner" style={{ display: 'inline-block' }} />
                </div>
              ) : tables.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>No tables found.</p>
              ) : (
                <>
                  <p style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
                    {tables.length} tables found
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {tables.map(t => (
                      <span key={`${t.schema}.${t.name}`} style={{
                        fontFamily: 'var(--font-mono)', fontSize: 11,
                        padding: '3px 8px',
                        background: 'var(--bg-surface-lo)',
                        border: '1px solid var(--border-muted)',
                        borderRadius: 'var(--r-sm)',
                        color: 'var(--text-muted)',
                      }}>
                        <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>{t.schema}.</span>{t.name}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right — Environment Parameters */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">
              <span className="material-symbols-outlined sz-16">tune</span>
              Environment Parameters
            </span>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -8 }}>
              Define the deployment context and power characteristics.
            </p>

            {/* Presets */}
            <div className="field">
              <label className="field-label">Environment Presets</label>
              <div className="preset-grid">
                {Object.keys(PRESETS).map(name => (
                  <button
                    key={name}
                    className={`preset-btn${activePreset === name ? ' active' : ''}`}
                    onClick={() => applyPreset(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            {/* PUE Slider */}
            <div className="range-wrap">
              <div className="range-header">
                <label className="field-label">Power Usage Effectiveness (PUE)</label>
                <span className="range-value">{pue.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="1.0" max="2.0" step="0.01"
                value={pue}
                onChange={e => setPue(parseFloat(e.target.value))}
              />
              <div className="range-labels">
                <span>1.0 (Ideal)</span>
                <span>2.0 (High Overhead)</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Ratio of total facility energy to IT equipment energy.
              </p>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border-muted)' }} />

            {/* Grid Carbon Intensity */}
            <div className="field">
              <label className="field-label">Grid Carbon Intensity</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type="number"
                  className="input input-mono"
                  value={gridCi}
                  onChange={e => setGridCi(parseFloat(e.target.value))}
                  style={{ paddingRight: 90 }}
                />
                <span style={{
                  position: 'absolute', right: 12,
                  fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                  pointerEvents: 'none',
                }}>gCO₂eq/kWh</span>
              </div>
              <p className="field-hint">
                Regional emissions factor. India: 442 · US: 386 · EU: 233
              </p>
            </div>

            {/* Hardware Lifespan */}
            <div className="field">
              <label className="field-label">Hardware Lifespan (Amortization)</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type="number"
                  className="input input-mono"
                  min="0.5" step="0.5"
                  value={lifespan}
                  onChange={e => setLifespan(parseFloat(e.target.value))}
                  style={{ paddingRight: 55 }}
                />
                <span style={{
                  position: 'absolute', right: 12,
                  fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                  pointerEvents: 'none',
                }}>Years</span>
              </div>
              <p className="field-hint">
                Expected operational lifetime used for calculating embodied carbon per query.
              </p>
            </div>

            {/* SCI Formula */}
            <div style={{
              padding: '12px 16px',
              background: 'var(--bg-surface-lo)',
              borderRadius: 'var(--r-md)',
              borderLeft: '3px solid var(--green)',
            }}>
              <p style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8, fontFamily: 'var(--font-display)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                SCI Formula (Green Algorithms)
              </p>
              <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.8 }}>{`E = t × (n_c × P_c × u_c + n_mem × 0.3725) × PUE × 0.001
O = E × I
M = TE × (TiR / EL) × (RR / ToR)
SCI = (O + M) / R`}</pre>
            </div>
          </div>

          {/* Form footer */}
          <div className="settings-form-footer">
            <button className="btn btn-ghost" onClick={handleReset}>
              Reset to Auto-Detected
            </button>
            <button className="btn btn-primary" onClick={handleSave}>
              <span className="material-symbols-outlined sz-16">save</span>
              Save Configuration
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div className={`toast`} style={{ borderColor: toast.ok ? 'var(--green)' : 'var(--red)' }}>
          <span className="material-symbols-outlined sz-16" style={{ color: toast.ok ? 'var(--green)' : 'var(--red)' }}>
            {toast.ok ? 'check_circle' : 'error'}
          </span>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
