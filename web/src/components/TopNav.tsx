import { Link, NavLink } from "react-router-dom";

// The single, shared top navigation. Identical on every public page so the
// tabs never shift around: the brand goes home, and there are exactly two
// tabs — Dashboard and Team. The active tab is highlighted. An optional
// sign-out affordance sits on the right when a page passes `onSignOut`.
export function TopNav({ onSignOut }: { onSignOut?: () => void }) {
  return (
    <nav className="topnav">
      <Link to="/" className="brand">MAC Hackathon</Link>
      <div className="flex items-center gap-1 sm:gap-2">
        <Tab to="/dashboard">Dashboard</Tab>
        <Tab to="/find-team">Team</Tab>
        {onSignOut && (
          <button className="secondary ml-1 sm:ml-2" onClick={onSignOut}>Sign out</button>
        )}
      </div>
    </nav>
  );
}

function Tab({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `navlink ${isActive ? "navlink-active" : ""}`}
    >
      {children}
    </NavLink>
  );
}
