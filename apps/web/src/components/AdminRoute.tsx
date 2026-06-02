import { useAdmin } from "@/hooks/use-admin";
import { Navigate } from "react-router-dom";

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useAdmin();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!isAdmin) return <Navigate to="/books" replace />;

  return <>{children}</>;
}
