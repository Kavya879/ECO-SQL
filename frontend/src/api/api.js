import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

export const analyzeQuery = (payload) => api.post('/analyze', payload).then(r => r.data);
export const getDatabases = () => api.get('/databases').then(r => r.data);
export const getTables = (dbName) => api.get(`/databases/${encodeURIComponent(dbName)}/tables`).then(r => r.data);
export const getHardwareConfig = () => api.get('/hardware-config').then(r => r.data);
export const getHistory = (params) => api.get('/history', { params }).then(r => r.data);
export const getDashboard = (params) => api.get('/dashboard', { params }).then(r => r.data);
export const exportHistoryCsv = () => `${api.defaults.baseURL}/history/export`;
export const clearHistory = () => api.delete('/history').then(r => r.data);

export const optimizeQuery = (queryId) =>
  api.post('/optimize-query', { query_id: queryId }).then(r => r.data);

export const getHistoryById = (id) =>
  api.get(`/history/${id}`).then(r => r.data);

export default api;
