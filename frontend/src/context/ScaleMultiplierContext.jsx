import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';

const ScaleMultiplierContext = createContext(null);

const MAX_N = 1e12;

function clampHits(n) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x) || x < 1) return 1;
  return Math.min(x, MAX_N);
}

/** @typedef {'single' | 'k1' | 'k100k' | 'm1' | 'custom'} PresetId */

export function ScaleMultiplierProvider({ children }) {
  const [preset, setPreset] = useState(/** @type {PresetId} */ ('single'));
  const [customCount, setCustomCount] = useState('');

  const effectiveMultiplier = useMemo(() => {
    if (preset === 'single') return 1;
    if (preset === 'k1') return 1000;
    if (preset === 'k100k') return 100000;
    if (preset === 'm1') return 1000000;
    const parsed = parseInt(String(customCount).replace(/[, ]+/g, ''), 10);
    return clampHits(parsed || 1);
  }, [preset, customCount]);

  const updateFromControl = useCallback((payload) => {
    if (payload.preset !== undefined) setPreset(payload.preset);
    if (payload.customCount !== undefined) setCustomCount(payload.customCount);
  }, []);

  const value = useMemo(
    () => ({
      effectiveMultiplier,
      preset,
      customCount,
      updateFromControl,
    }),
    [effectiveMultiplier, preset, customCount, updateFromControl]
  );

  return <ScaleMultiplierContext.Provider value={value}>{children}</ScaleMultiplierContext.Provider>;
}

export function useScaleMultiplier() {
  const ctx = useContext(ScaleMultiplierContext);
  if (!ctx) throw new Error('useScaleMultiplier must be used within ScaleMultiplierProvider');
  return ctx;
}
