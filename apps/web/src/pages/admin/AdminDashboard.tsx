import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BookOpen, FileText, Users, Shield, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

interface BookRow {
  id: number;
  name: string;
  slug: string | null;
  owner_email: string | null;
  owner_username: string | null;
  page_count: number;
  created_at: string;
  is_public: boolean;
  published_at: string | null;
}

interface AdminStats {
  total_books: number;
  total_pages: number;
  total_users: number;
  books: BookRow[];
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .rpc("get_admin_stats")
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
        } else {
          setStats(data as AdminStats);
        }
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-destructive">
        {error}
      </div>
    );
  }

  if (!stats) return null;

  const avgPages =
    stats.total_books > 0
      ? (stats.total_pages / stats.total_books).toFixed(1)
      : "0";

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-amber-600" />
        <h1 className="text-xl font-semibold">Admin Dashboard</h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon={BookOpen} label="Books" value={stats.total_books} />
        <StatCard icon={FileText} label="Pages" value={stats.total_pages} />
        <StatCard icon={Users} label="Users" value={stats.total_users} />
        <StatCard icon={FileText} label="Avg pages / book" value={avgPages} />
      </div>

      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">
          All Books
        </h2>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Book</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Pages</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.books.map((book) => (
                <TableRow key={book.id}>
                  <TableCell className="font-medium max-w-[200px] truncate">
                    <Link
                      to={`/books/${book.id}${book.slug ? `-${book.slug}` : ""}`}
                      className="hover:underline flex items-center gap-1.5"
                    >
                      {book.name || "Untitled"}
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {book.owner_username ?? book.owner_email ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {book.page_count}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {book.published_at && (
                        <Badge variant="secondary" className="text-xs">
                          Published
                        </Badge>
                      )}
                      {book.is_public && (
                        <Badge variant="outline" className="text-xs">
                          Public
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm tabular-nums">
                    {new Date(book.created_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
              {stats.books.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No books yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
