export const fmtEnergy = (kwh) => {
  if (kwh === null || kwh === undefined || kwh === 0) return '—';
  if (kwh < 0.000001) return (kwh * 1e9).toFixed(3) + ' nWh';
  if (kwh < 0.001) return (kwh * 1e6).toFixed(3) + ' µWh';
  if (kwh < 1) return (kwh * 1000).toFixed(4) + ' Wh';
  return kwh.toFixed(6) + ' kWh';
};

export const fmtGco2 = (g) => {
  if (g === null || g === undefined) return '—';
  if (g === 0) return '0';
  // For tiny values, show in scientific notation or with more precision
  const val = parseFloat(g);
  if (val < 0.000001) return val.toExponential(3);
  if (val < 0.01) return val.toFixed(6);
  if (val < 100) return val.toFixed(4);
  return val.toFixed(2);
};

export const fmtRuntime = (s) => {
  if (s === null || s === undefined) return '—';
  if (s < 1) return (s * 1000).toFixed(0) + 'ms';
  return parseFloat(s).toFixed(3) + 's';
};

export const fmtTimeAgo = (dateStr) => {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return Math.round(diff) + 's ago';
  if (diff < 3600) return Math.round(diff / 60) + ' min ago';
  if (diff < 86400) return Math.round(diff / 3600) + ' hr ago';
  return Math.round(diff / 86400) + 'd ago';
};

export const classificationBadge = (cls) => {
  if (!cls) return 'badge-excellent';
  const c = cls.toUpperCase();
  if (c === 'EXCELLENT') return 'badge-excellent';
  if (c === 'GOOD') return 'badge-good';
  if (c === 'MODERATE') return 'badge-moderate';
  if (c === 'POOR') return 'badge-poor';
  if (c === 'CRITICAL') return 'badge-critical';
  // Backward compatibility with old values
  if (c === 'SUSTAINABLE') return 'badge-excellent';
  if (c === 'HIGH IMPACT') return 'badge-critical';
  return 'badge-moderate';
};

export const classificationShort = (cls) => {
  if (!cls) return 'E';
  const c = cls.toUpperCase();
  if (c === 'EXCELLENT') return 'E';
  if (c === 'GOOD') return 'G';
  if (c === 'MODERATE') return 'M';
  if (c === 'POOR') return 'P';
  if (c === 'CRITICAL') return 'C';
  // Backward compatibility
  if (c === 'SUSTAINABLE') return 'E';
  if (c === 'HIGH IMPACT') return 'C';
  return 'M';
};
