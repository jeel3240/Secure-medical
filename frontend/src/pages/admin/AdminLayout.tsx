import { NavLink, Outlet } from 'react-router-dom';

const UPCOMING = ['Overview', 'Scoring', 'Messages', 'DNC list', 'Settings'];

const LIVE = [
  { to: '/admin/overview', label: 'Overview' },
  { to: '/admin/leads', label: 'Leads' },
  { to: '/admin/agents', label: 'Agents' },
  { to: '/admin/config', label: 'Configuration' },
  { to: '/admin/dnc', label: 'DNC list' },
];

export function AdminLayout() {
  return (
    <div className="admin">
      <nav className="admin__nav" aria-label="Admin">
        <div className="admin__nav-heading">Admin</div>
        {LIVE.map((item) => (
          <NavLink key={item.to} to={item.to} className="admin__nav-link">
            {item.label}
          </NavLink>
        ))}
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
