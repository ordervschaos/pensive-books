import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { TipTapEditor } from "@/components/editor/TipTapEditor";

interface PageVersion {
  id: string;
  created_at: string;
  html_content: string;
}

export default function PageHistoryView() {
  const { pageId } = useParams<{ pageId: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);

  const { data: pageVersions, isLoading, isError, error } = useQuery({
    queryKey: ["page-history", pageId],
    queryFn: async () => {
      if (!pageId) throw new Error("Page ID is required");

      const { data, error } = await supabase
        .from("page_history")
        .select("*")
        .eq("page_id", pageId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as PageVersion[];
    },
  });

  const { data: currentPage, refetch } = useQuery({
    queryKey: ["page", pageId],
    queryFn: async () => {
      if (!pageId) throw new Error("Page ID is required");

      const { data, error } = await supabase
        .from("pages")
        .select("*")
        .eq("id", pageId)
        .single();

      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    refetch();
  }, [pageId, refetch]);

  const handleRestoreVersion = async (version: any) => {
    if (!pageId) {
      toast({
        title: "Missing Page ID",
        description: "The page ID is not available. Please try again.",
        variant: "destructive",
      });
      return;
    }

    setIsRestoring(true);
    setRestoringVersionId(version.id);

    try {
      const { error } = await supabase
        .from("pages")
        .update({ html_content: version.html_content, updated_at: new Date().toISOString() })
        .eq("id", pageId);

      if (error) throw error;

      // Update the invalidateQueries calls to use the correct type
      queryClient.invalidateQueries({ queryKey: ["page", pageId] });
      queryClient.invalidateQueries({ queryKey: ["page-history", pageId] });

      toast({
        title: "Page version restored",
        description: "The selected version has been successfully restored.",
      });
    } catch (error: any) {
      toast({
        title: "Error restoring version",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsRestoring(false);
      setRestoringVersionId(null);
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (isError) {
    return <div>Error: {error.message}</div>;
  }

  return (
    <div className="container mx-auto py-8">
      <Card>
        <CardHeader>
          <CardTitle>Page History</CardTitle>
        </CardHeader>
        <CardContent>
          {pageVersions && pageVersions.length > 0 ? (
            <Table>
              <TableCaption>A history of all edits made to this page.</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Date</TableHead>
                  <TableHead>Preview</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageVersions.map((version) => (
                  <TableRow key={version.id}>
                    <TableCell className="font-medium">{new Date(version.created_at).toLocaleString()}</TableCell>
                    <TableCell>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="link">
                            View Content
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>Version Preview</DialogTitle>
                            <DialogDescription>
                              Preview of the page content at this version.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="border rounded-md">
                            <TipTapEditor
                              content={version.html_content}
                              onChange={() => {}}
                              editable={false}
                            />
                          </div>
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        onClick={() => handleRestoreVersion(version)}
                        disabled={isRestoring && restoringVersionId === version.id}
                      >
                        {isRestoring && restoringVersionId === version.id ? "Restoring..." : "Restore"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p>No history available for this page.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
