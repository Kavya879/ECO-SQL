import React from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import AnalyzePage from './pages/AnalyzePage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

function Layout() {
  const location = useLocation();
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <NavLink to="/" className="sidebar-logo">
          <div className="logo-icon">⚡</div>
          <span className="logo-text">Query<span>Carbon</span></span>
        </NavLink>

        <div className="sidebar-section-label">Main</div>
        <nav className="sidebar-nav">
          <NavLink to="/" end className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">◈</span> Dashboard
            {location.pathname === '/' && <span className="nav-dot" />}
          </NavLink>
          <NavLink to="/analyze" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">⚡</span> Analyze Query
            {location.pathname === '/analyze' && <span className="nav-dot" />}
          </NavLink>
          <NavLink to="/reports" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">◉</span> Reports
            {location.pathname === '/reports' && <span className="nav-dot" />}
          </NavLink>
        </nav>

        <div className="sidebar-section-label">System</div>
        <nav className="sidebar-nav">
          <NavLink to="/settings" className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">◎</span> Settings
          </NavLink>
        </nav>

        <div style={{ flex: 1 }} />
        <div className="sidebar-footer">Phase 1 · v1.0.0</div>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/analyze" element={<AnalyzePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  );
}
