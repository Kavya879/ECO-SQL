export const fmtEnergy = (kwh) => {
  if (kwh === null || kwh === undefined) return '—';
  if (kwh < 0.001) return (kwh * 1000000).toFixed(3) + ' µWh';
  if (kwh < 1) return (kwh * 1000).toFixed(4) + ' Wh';
  return kwh.toFixed(6) + ' kWh';
};

export const fmtGco2 = (g) => {
  if (g === null || g === undefined) return '—';
  return parseFloat(g).toFixed(4);
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
  if (!cls) return 'badge-sustainable';
  const c = cls.toUpperCase();
  if (c === 'SUSTAINABLE') return 'badge-sustainable';
  if (c === 'MODERATE') return 'badge-moderate';
  return 'badge-high';
};

export const classificationShort = (cls) => {
  if (!cls) return 'S';
  const c = cls.toUpperCase();
  if (c === 'SUSTAINABLE') return 'S';
  if (c === 'MODERATE') return 'M';
  return 'H';
};
