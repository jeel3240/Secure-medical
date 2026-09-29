import { NavLink, Outlet } from 'react-router-dom';

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
      </nav>
      <div>
        <Outlet />
      </div>
    </div>
  );
}
