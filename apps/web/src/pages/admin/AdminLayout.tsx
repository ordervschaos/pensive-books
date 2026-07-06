import { NavLink, Outlet } from "react-router-dom";
import { Shield, LayoutDashboard, Activity, Settings, GitBranch } from "lucide-react";

const NAV_ITEMS = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/ai-calls", label: "AI Calls", icon: Activity, end: false },
  { to: "/admin/node-types", label: "Node Types", icon: GitBranch, end: false },
  { to: "/admin/settings", label: "Settings", icon: Settings, end: false },
];

export default function AdminLayout() {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <nav className="w-52 shrink-0 border-r bg-muted/30 flex flex-col pt-6 pb-4 px-3 gap-1">
        <div className="flex items-center gap-2 px-3 pb-5">
          <Shield className="h-4 w-4 text-amber-600" />
          <span className="text-sm font-semibold text-amber-600 tracking-wide">Admin</span>
        </div>
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? "bg-foreground text-background font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Page content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
