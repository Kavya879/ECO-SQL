import React from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import AnalyzePage from './pages/AnalyzePage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import QueryDetail from './pages/QueryDetail.jsx';

const NAV_MAIN = [
  { to: '/',        icon: 'dashboard',    label: 'Dashboard', end: true },
  { to: '/analyze', icon: 'query_stats',  label: 'Analyze' },
  { to: '/reports', icon: 'description',  label: 'Reports' },
  { to: '/settings', icon: 'settings',   label: 'Settings' },
];

const NAV_BOTTOM = [
  { icon: 'menu_book',    label: 'Docs' },
  { icon: 'help_outline', label: 'Support' },
];

function Sidebar() {
  return (
    <nav className="sidebar">
      <div className="sidebar-top">
        {/* Logo */}
        <div className="sidebar-logo">
          <span className="material-symbols-outlined sidebar-logo-icon fill sz-24">database</span>
          <div>
            <div className="sidebar-brand">QueryCarbon</div>
            <div className="sidebar-version">Phase 3 · v1.0.0</div>
          </div>
        </div>

        {/* Main nav */}
        <ul className="sidebar-nav">
          {NAV_MAIN.map(({ to, icon, label, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              >
                {({ isActive }) => (
                  <>
                    <span className={`material-symbols-outlined${isActive ? ' fill' : ''}`}>{icon}</span>
                    <span>{label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>

      {/* Bottom links */}
      <div className="sidebar-bottom">
        <hr className="sidebar-divider" />
        <ul className="sidebar-nav">
          {NAV_BOTTOM.map(({ icon, label }) => (
            <li key={label}>
              <a href="#" className="nav-item">
                <span className="material-symbols-outlined">{icon}</span>
                <span>{label}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

function TopBar() {
  return (
    <header className="topbar">
      <div className="topbar-search">
        <span className="material-symbols-outlined topbar-search-icon">search</span>
        <input
          type="text"
          placeholder="Search queries, databases..."
          className="topbar-search-input"
        />
      </div>
      <div className="topbar-actions">
        <button className="topbar-btn" title="Notifications">
          <span className="material-symbols-outlined">notifications</span>
        </button>
        <button className="topbar-btn" title="Terminal">
          <span className="material-symbols-outlined">terminal</span>
        </button>
        <button className="topbar-btn" title="Account">
          <span className="material-symbols-outlined">account_circle</span>
        </button>
      </div>
    </header>
  );
}

function Layout() {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <TopBar />
        <main className="app-content">
          <Routes>
            <Route path="/"         element={<Dashboard />} />
            <Route path="/analyze"  element={<AnalyzePage />} />
            <Route path="/reports"  element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/query/:id" element={<QueryDetail />} />
          </Routes>
        </main>
      </div>
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
