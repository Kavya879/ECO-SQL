import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getHistoryById, optimizeQuery } from '../api/api.js';
import { fmtGco2, fmtEnergy, fmtRuntime, fmtTimeAgo } from '../utils/format.js';
import FindingCard from '../components/FindingCard.jsx';
import ExplainPlanTree from '../components/ExplainPlanTree.jsx';
import SciBeforeAfterBarChart from '../components/SciBeforeAfterBarChart.jsx';
import ScaleContextPanel from '../components/ScaleContextPanel.jsx';
import ScaledEmissionsCard from '../components/ScaledEmissionsCard.jsx';
import RealLifeEquivalentsCard from '../components/RealLifeEquivalentsCard.jsx';
import { useScaleMultiplier } from '../context/ScaleMultiplierContext.jsx';

function tierInfo(cls) {
  const c = String(cls || '').toUpperCase();
  if (c === 'EXCELLENT' || c === 'SUSTAINABLE') return { pillCls: 'tier-excellent', icon: 'verified' };
  if (c === 'GOOD')     return { pillCls: 'tier-good',     icon: 'thumb_up' };
  if (c === 'MODERATE') return { pillCls: 'tier-moderate', icon: 'warning' };
  if (c === 'POOR')     return { pillCls: 'tier-poor',     icon: 'error' };
  return                       { pillCls: 'tier-critical', icon: 'dangerous' };
}

function QueryScaledStrip({ sciBefore, totalSciDeltaEstimated }) {
  const { effectiveMultiplier } = useScaleMultiplier();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
      <ScaledEmissionsCard
        sciBefore={sciBefore}
        totalSciDeltaEstimated={totalSciDeltaEstimated}
        effectiveMultiplier={effectiveMultiplier}
      />
      <RealLifeEquivalentsCard
        sciBefore={sciBefore}
        totalSciDeltaEstimated={totalSciDeltaEstimated}
      />
    </div>
  );
}

export default function QueryDetail() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const [row, setRow]             = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [findings, setFindings]   = useState([]);
  const [optLoading, setOptLoading] = useState(false);
  const [optError, setOptError]   = useState(null);
  const [activeTab, setTab]       = useState('details');
  const [optMeta, setOptMeta]     = useState({
    hypopg_available: null,
    pg_hint_plan_available: null,
    total_sci_delta_estimated: null,
    note: null,
  });
  const [optimizeComplete, setOptimizeComplete] = useState(false);
  const [explainPlan, setExplainPlan] = useState(null);

  /* Fetch stored query record */
  useEffect(() => {
    setLoading(true);
    setFindings([]);
    setOptimizeComplete(false);
    setExplainPlan(null);
    setOptMeta({
      hypopg_available: null,
      pg_hint_plan_available: null,
      total_sci_delta_estimated: null,
      note: null,
    });
    getHistoryById(id)
      .then(data => {
        setRow(data.row || data);
        setLoading(false);
      })
      .catch(e => {
        setError(e.response?.data?.error || e.message);
        setLoading(false);
      });
  }, [id]);

  const runOptimize = useCallback(async (queryId) => {
    setOptLoading(true); setOptError(null);
    try {
      const res = await optimizeQuery(queryId);
      const f = res.findings || [];
      setFindings(f);
      setExplainPlan(res.explain_plan ?? null);
      setOptMeta({
        hypopg_available: res.hypopg_available ?? null,
        pg_hint_plan_available: res.pg_hint_plan_available ?? null,
        total_sci_delta_estimated: res.total_sci_delta_estimated ?? null,
        note: res.note ?? null,
      });
      setOptimizeComplete(true);
      if (f.length > 0) setTab('optimization');
    } catch (e) {
      setOptimizeComplete(false);
      setExplainPlan(null);
      setOptError(e.response?.data?.error || e.message);
    } finally { setOptLoading(false); }
  }, []);

  const openInEditor = (sql) => {
    sessionStorage.setItem('queryToCopy', sql || '');
    navigate('/analyze');
  };

  if (loading) return (
    <div className="page-container">
      <div className="empty-state">
        <span className="spinner" style={{ display: 'block', margin: '0 auto 12px' }} />
        <div className="empty-text">Loading query record…</div>
      </div>
    </div>
  );

  if (error) return (
    <div className="page-container">
      <div className="error-box">
        <span className="material-symbols-outlined sz-16">error</span>
        {error}
      </div>
    </div>
  );

  const tc = tierInfo(row?.classification);

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-head">
        <div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/reports')}
            style={{ marginBottom: 8 }}>
            <span className="material-symbols-outlined sz-16">arrow_back</span>
            Back to Reports
          </button>
          <div className="page-title">Query #{row?.id}</div>
          <div className="page-desc">
            {row?.database_name} · {fmtTimeAgo(row?.created_at)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span className={`tier-pill ${tc.pillCls}`} style={{ fontSize: 12, padding: '5px 14px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{tc.icon}</span>
            {row?.classification || 'UNKNOWN'}
          </span>
          <button
            className="btn btn-outline btn-sm"
            disabled={optLoading || !row?.id}
            onClick={() => row?.id && runOptimize(row.id)}
          >
            <span className="material-symbols-outlined sz-16">tips_and_updates</span>
            {optLoading ? 'Optimizing…' : 'Run optimization'}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => openInEditor(row?.query_text)}
          >
            <span className="material-symbols-outlined sz-16">edit</span>
            Open in Editor
          </button>
        </div>
      </div>

      {/* Metrics strip */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12, marginBottom: 20,
      }}>
        {[
          { label: 'Sustainability Score', value: row?.sustainability_score, unit: '/ 100', icon: 'eco', color: 'var(--green)' },
          { label: 'Energy Est.',          value: fmtEnergy(row?.energy_kwh), unit: '',     icon: 'bolt', color: 'var(--cyan)' },
          { label: 'Total CO₂',            value: fmtGco2(row?.total_emissions_gco2), unit: 'gCO₂eq', icon: 'public', color: 'var(--text)' },
          { label: 'Runtime',              value: fmtRuntime(row?.runtime_s), unit: '',     icon: 'timer', color: 'var(--text)' },
        ].map(m => (
          <div key={m.label} className="metric-tile">
            <div className="metric-tile-top">
              <span className="material-symbols-outlined metric-tile-icon" style={{ color: m.color }}>{m.icon}</span>
              <span className="metric-tile-label">{m.label}</span>
            </div>
            <div>
              <div className="metric-tile-value" style={{ color: m.color }}>{m.value ?? '—'}</div>
              {m.unit && <div className="metric-tile-unit">{m.unit}</div>}
            </div>
          </div>
        ))}
      </div>

      {row && optimizeComplete && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <span className="card-title">
              <span className="material-symbols-outlined sz-16">account_tree</span>
              Query plan (EXPLAIN)
            </span>
          </div>
          <div style={{ padding: '12px 16px' }}>
            <ExplainPlanTree explainPlan={explainPlan} findings={findings} />
          </div>
        </div>
      )}

      {row && optimizeComplete && (
        <ScaleContextPanel>
          <QueryScaledStrip
            sciBefore={row.sci}
            totalSciDeltaEstimated={optMeta.total_sci_delta_estimated ?? null}
          />
        </ScaleContextPanel>
      )}

      {/* SQL + Optimization tabs */}
      <div className="card">
        <div className="panel-tabs">
          <button
            className={`panel-tab${activeTab === 'details' ? ' active' : ''}`}
            onClick={() => setTab('details')}
          >
            <span className="material-symbols-outlined sz-16">code</span>
            SQL Query
          </button>
          <button
            className={`panel-tab${activeTab === 'optimization' ? ' active' : ''}`}
            onClick={() => setTab('optimization')}
          >
            <span className="material-symbols-outlined sz-16">tips_and_updates</span>
            Optimization
            {optLoading && <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />}
            {!optLoading && findings.length > 0 && (
              <span className="panel-tab-badge amber">{findings.length}</span>
            )}
          </button>
        </div>

        {activeTab === 'details' && (
          <div>
            <pre style={{
              padding: '16px',
              background: 'var(--bg-code)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'var(--text-muted)',
              lineHeight: 1.7,
              overflow: 'auto',
              maxHeight: 360,
              whiteSpace: 'pre-wrap',
            }}>
              {row?.query_text}
            </pre>
          </div>
        )}

        {activeTab === 'optimization' && (
          <div style={{ padding: 16 }}>
            {!optLoading && optimizeComplete && (
              <SciBeforeAfterBarChart
                sciBefore={row?.sci}
                totalSciDeltaEstimated={optMeta.total_sci_delta_estimated ?? null}
              />
            )}
            {!optLoading && optMeta.hypopg_available != null && (
              <div className="extension-status-bar">
                <span className={`extension-pill${optMeta.hypopg_available ? ' ok' : ' off'}`}>
                  <span className="material-symbols-outlined sz-16">database</span>
                  hypopg {optMeta.hypopg_available ? 'on target DB' : 'not installed'}
                </span>
                <span className={`extension-pill${optMeta.pg_hint_plan_available ? ' ok' : ' off'}`}>
                  <span className="material-symbols-outlined sz-16">psychology</span>
                  pg_hint_plan {optMeta.pg_hint_plan_available ? 'on target DB' : 'not installed'}
                </span>
                {optMeta.total_sci_delta_estimated != null && (
                  <span className="extension-pill ok">
                    <span className="material-symbols-outlined sz-16">eco</span>
                    Est. ΔSCI (sim.) {fmtGco2(optMeta.total_sci_delta_estimated)} gCO₂eq
                  </span>
                )}
              </div>
            )}
            {optMeta.note && !optLoading && (
              <div className="empty-text" style={{ marginBottom: 12, textAlign: 'left' }}>
                {optMeta.note}
              </div>
            )}
            {findings.length === 0 && !optLoading && !optError && !optimizeComplete && (
              <div className="empty-text" style={{ marginBottom: 16 }}>
                Click <strong>Run optimization</strong> above to analyze EXPLAIN patterns, optional hypopg / pg_hint_plan simulations, and SQL rewrite rules.
              </div>
            )}
            {optLoading && (
              <div className="opt-scanning">
                <span className="spinner" />
                Scanning for optimization opportunities…
              </div>
            )}
            {optError && !optLoading && (
              <div className="error-box">
                <span className="material-symbols-outlined sz-16">error</span>
                {optError}
              </div>
            )}
            {!optLoading && !optError && optimizeComplete && findings.length === 0 && (
              <div className="empty-state" style={{ padding: '24px 0' }}>
                <span className="material-symbols-outlined empty-icon" style={{ color: 'var(--green)' }}>verified</span>
                <div className="empty-text"><strong>No optimization issues found.</strong></div>
              </div>
            )}
            {!optLoading && findings.map((f, i) => (
              <FindingCard key={i} finding={f} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
