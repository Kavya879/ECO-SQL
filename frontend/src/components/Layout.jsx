import { Outlet, NavLink } from 'react-router-dom';

export default function Layout({ children }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: 240, background: '#161b22', padding: 16 }}>
        <h2 style={{ color: '#3fb950' }}>QueryCarbon</h2>
        <nav>
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/analyze">Analyze Query</NavLink>
          <NavLink to="/reports">Reports</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div style={{ marginTop: 'auto', paddingTop: 24 }}>
          <small>Arjun Sharma • Pro Plan • India</small>
        </div>
      </aside>
      <main style={{ flex: 1, padding: 24 }}>
        <Outlet />
      </main>
    </div>
  );
}
