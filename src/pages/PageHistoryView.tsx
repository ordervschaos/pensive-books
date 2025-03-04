
import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/page/PageLoading";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, History, RotateCcw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatDistanceToNow } from "date-fns";

interface PageVersion {
  id: number;
  html_content: string;
  created_at: string;
  created_by: string;
  batch_id: string;
}

export default function PageHistoryView() {
  const { bookId, pageId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<any>(null);
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<PageVersion | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    const fetchPageAndVersions = async () => {
      if (!bookId || !pageId) return;

      try {
        setLoading(true);
        
        // Convert string IDs to numbers for database queries
        const bookIdNum = parseInt(bookId, 10);
        const pageIdNum = parseInt(pageId, 10);

        // Fetch the current page
        const { data: pageData, error: pageError } = await supabase
          .from("pages")
          .select("*")
          .eq("id", pageIdNum)
          .eq("book_id", bookIdNum)
          .single();

        if (pageError) throw pageError;
        setPage(pageData);

        // Fetch page history versions
        const { data: versionsData, error: versionsError } = await supabase
          .from("page_history")
          .select("*")
          .eq("page_id", pageIdNum)
          .order("created_at", { ascending: false });

        if (versionsError) throw versionsError;
        setVersions(versionsData || []);
        
        // If there are versions, select the first one by default
        if (versionsData && versionsData.length > 0) {
          setSelectedVersion(versionsData[0]);
        }
      } catch (error: any) {
        console.error("Error fetching page history:", error);
        toast({
          title: "Error",
          description: "Failed to load page history.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchPageAndVersions();
  }, [bookId, pageId, toast]);

  const handleRestore = async () => {
    if (!selectedVersion || !page || !pageId) return;
    
    try {
      setRestoring(true);
      
      // Update the current page with the selected version's content
      const { error } = await supabase
        .from("pages")
        .update({
          html_content: selectedVersion.html_content,
          updated_at: new Date(),
        })
        .eq("id", pageId);
      
      if (error) throw error;
      
      toast({
        title: "Success",
        description: "Page restored to selected version.",
      });
      
      // Navigate back to the page view
      navigate(`/book/${bookId}/page/${pageId}`);
    } catch (error: any) {
      console.error("Error restoring page version:", error);
      toast({
        title: "Error",
        description: "Failed to restore page version.",
        variant: "destructive",
      });
    } finally {
      setRestoring(false);
      setConfirmRestore(false);
    }
  };

  if (loading) {
    return <PageLoading />;
  }

  return (
    <div className="container max-w-7xl mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/book/${bookId}/page/${pageId}`)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Page
          </Button>
          <h1 className="text-2xl font-bold">Page History</h1>
        </div>
        {selectedVersion && (
          <AlertDialog open={confirmRestore} onOpenChange={setConfirmRestore}>
            <AlertDialogTrigger asChild>
              <Button disabled={restoring}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Restore Selected Version
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Restore this version?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will replace the current page content with the selected version.
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleRestore}>Continue</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <History className="mr-2 h-5 w-5" />
                Version History
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-[70vh] overflow-y-auto">
              {versions.length === 0 ? (
                <p className="text-sm text-gray-500">No version history available.</p>
              ) : (
                <div className="space-y-2">
                  {versions.map((version) => (
                    <div
                      key={version.id}
                      className={`p-3 rounded-md cursor-pointer transition-colors ${
                        selectedVersion?.id === version.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-card hover:bg-muted"
                      }`}
                      onClick={() => setSelectedVersion(version)}
                    >
                      <div className="text-sm font-medium">
                        {formatDistanceToNow(new Date(version.created_at), { addSuffix: true })}
                      </div>
                      <div className="text-xs opacity-90">
                        {new Date(version.created_at).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>
                {selectedVersion
                  ? `Version from ${new Date(selectedVersion.created_at).toLocaleString()}`
                  : "Select a version"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {selectedVersion ? (
                <div
                  className="prose dark:prose-invert max-w-none"
                  dangerouslySetInnerHTML={{ __html: selectedVersion.html_content }}
                />
              ) : (
                <p className="text-gray-500">Select a version from the sidebar to preview.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
