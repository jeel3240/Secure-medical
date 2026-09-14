import { NavLink, Outlet } from 'react-router-dom';

const UPCOMING = ['Overview', 'Scoring', 'Messages', 'DNC list', 'Settings'];

export function AdminLayout() {
  return (
    <div className="admin">
      <nav className="admin__nav" aria-label="Admin">
        <div className="admin__nav-heading">Admin</div>
        <NavLink to="/admin/agents" className="admin__nav-link">
          Agents
        </NavLink>
        {UPCOMING.map((label) => (
          <span key={label} className="admin__nav-link admin__nav-link--disabled" aria-disabled="true">
            {label}
            <span className="admin__soon">Soon</span>
          </span>
        ))}
      </nav>
      <div>
        <Outlet />
      </div>
    </div>
  );
}
