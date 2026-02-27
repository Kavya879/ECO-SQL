import { useState, useEffect } from 'react';

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    w1: 0.4,
    w2: 0.25,
    w3: 0.2,
    w4: 0.15,
    excellent: 90,
    good: 70,
    moderate: 50,
    poor: 25,
    strictMode: false,
  });

  useEffect(() => {
    async function fetchSettings() {
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (res.ok) {
          setSettings(data);
          setForm({
            w1: data.weights?.w1 ?? 0.4,
            w2: data.weights?.w2 ?? 0.25,
            w3: data.weights?.w3 ?? 0.2,
            w4: data.weights?.w4 ?? 0.15,
            excellent: data.tierThresholds?.excellent ?? 90,
            good: data.tierThresholds?.good ?? 70,
            moderate: data.tierThresholds?.moderate ?? 50,
            poor: data.tierThresholds?.poor ?? 25,
            strictMode: data.strictMode ?? false,
          });
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  const weightSum = form.w1 + form.w2 + form.w3 + form.w4;
  const weightValid = Math.abs(weightSum - 1) < 0.001;

  const handleSave = async () => {
    if (!weightValid) {
      setError('Weights must sum to 1.0');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weights: { w1: form.w1, w2: form.w2, w3: form.w3, w4: form.w4 },
          tierThresholds: {
            excellent: form.excellent,
            good: form.good,
            moderate: form.moderate,
            poor: form.poor,
          },
          strictMode: form.strictMode,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSettings(data);
      } else {
        setError(data.error || 'Failed to save');
      }
    } catch (e) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h1 style={{ margin: '0 0 24px 0' }}>Settings</h1>

      {error && (
        <div
          style={{
            padding: 12,
            marginBottom: 16,
            background: 'rgba(248,81,73,0.15)',
            border: '1px solid #f85149',
            borderRadius: 6,
            color: '#f85149',
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 8,
          padding: 24,
          marginBottom: 24,
        }}
      >
        <h3 style={{ margin: '0 0 16px 0', fontSize: 14 }}>Sustainability Score Weights</h3>
        <p style={{ color: '#8b949e', fontSize: 13, marginBottom: 16 }}>
          Weights must sum to 1.0. w1=emissions, w2=cost, w3=duration, w4=rows.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
          {['w1', 'w2', 'w3', 'w4'].map((k) => (
            <label key={k} style={{ fontSize: 13 }}>
              {k}
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={form[k]}
                onChange={(e) => setForm((p) => ({ ...p, [k]: parseFloat(e.target.value) || 0 }))}
                style={{
                  display: 'block',
                  marginTop: 4,
                  width: '100%',
                  padding: 8,
                  background: '#0d1117',
                  border: '1px solid #30363d',
                  borderRadius: 4,
                  color: '#c9d1d9',
                }}
              />
            </label>
          ))}
        </div>
        <div style={{ fontSize: 12, color: weightValid ? '#3fb950' : '#f85149' }}>
          Sum: {weightSum.toFixed(2)} {weightValid ? '✓' : '(must be 1.0)'}
        </div>
      </div>

      <div
        style={{
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 8,
          padding: 24,
          marginBottom: 24,
        }}
      >
        <h3 style={{ margin: '0 0 16px 0', fontSize: 14 }}>Classification Tier Thresholds</h3>
        <p style={{ color: '#8b949e', fontSize: 13, marginBottom: 16 }}>
          Score ranges: Excellent ≥ excellent, Good ≥ good, Moderate ≥ moderate, Poor ≥ poor, Critical &lt; poor.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {[
            ['excellent', 90],
            ['good', 70],
            ['moderate', 50],
            ['poor', 25],
          ].map(([k, def]) => (
            <label key={k} style={{ fontSize: 13 }}>
              {k}
              <input
                type="number"
                min="0"
                max="100"
                value={form[k]}
                onChange={(e) => setForm((p) => ({ ...p, [k]: parseInt(e.target.value, 10) || def }))}
                style={{
                  display: 'block',
                  marginTop: 4,
                  width: '100%',
                  padding: 8,
                  background: '#0d1117',
                  border: '1px solid #30363d',
                  borderRadius: 4,
                  color: '#c9d1d9',
                }}
              />
            </label>
          ))}
        </div>
      </div>

      <div
        style={{
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 8,
          padding: 24,
          marginBottom: 24,
        }}
      >
        <h3 style={{ margin: '0 0 16px 0', fontSize: 14 }}>Strict Mode</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={form.strictMode}
            onChange={(e) => setForm((p) => ({ ...p, strictMode: e.target.checked }))}
          />
          <span>Block Critical queries (infeasible)</span>
        </label>
      </div>

      <button
        onClick={handleSave}
        disabled={saving || !weightValid}
        style={{
          padding: '10px 24px',
          background: weightValid ? '#3fb950' : '#21262d',
          color: weightValid ? '#0d1117' : '#8b949e',
          border: 'none',
          borderRadius: 6,
          cursor: saving || !weightValid ? 'not-allowed' : 'pointer',
          fontWeight: 600,
        }}
      >
        {saving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  );
}
