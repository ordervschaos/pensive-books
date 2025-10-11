
import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface PageVersion {
  id: number;
  page_id: number;
  html_content: string;
  created_at: string;
  created_by: string;
  batch_id: string;
  created_at_minute: string;
}

export default function PageHistoryView() {
  const { bookId, pageId } = useParams<{ bookId: string; pageId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [currentPageContent, setCurrentPageContent] = useState("");
  
  const numericBookId = bookId ? parseInt(bookId, 10) : 0;
  const numericPageId = pageId ? parseInt(pageId, 10) : 0;

  useEffect(() => {
    const fetchHistory = async () => {
      if (!numericBookId || !numericPageId) return;
      
      try {
        setLoading(true);
        
        // Get current page content
        const { data: pageData } = await supabase
          .from("pages")
          .select("html_content")
          .eq("id", numericPageId)
          .single();
          
        if (pageData) {
          setCurrentPageContent(pageData.html_content);
        }
        
        // Get page history
        const { data, error } = await supabase
          .from("page_history")
          .select("*")
          .eq("page_id", numericPageId)
          .order("created_at", { ascending: false });
          
        if (error) throw error;
        
        if (data) {
          setVersions(data as PageVersion[]);
        }
      } catch (error) {
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
    
    fetchHistory();
  }, [numericBookId, numericPageId, toast]);
  
  const handleRestoreVersion = async (versionId: number) => {
    if (!numericBookId || !numericPageId) return;
    
    try {
      setRestoring(true);
      
      // Get the version content
      const { data: versionData, error: versionError } = await supabase
        .from("page_history")
        .select("html_content")
        .eq("id", versionId)
        .single();
        
      if (versionError) throw versionError;
      
      if (!versionData) {
        throw new Error("Version not found");
      }
      
      // Update the page with the version content
      const { error: updateError } = await supabase
        .from("pages")
        .update({ html_content: versionData.html_content })
        .eq("id", numericPageId);
        
      if (updateError) throw updateError;
      
      toast({
        title: "Success",
        description: "Page version restored successfully.",
      });
      
      // Navigate back to the page
      navigate(`/book/${bookId}/page/${pageId}`);
    } catch (error: any) {
      console.error("Error restoring version:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to restore version.",
        variant: "destructive",
      });
    } finally {
      setRestoring(false);
    }
  };
  
  return (
    <div className="container mx-auto py-8 px-4">
      <Card>
        <CardHeader>
          <CardTitle>Page History</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center p-4">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : versions.length === 0 ? (
            <p>No history available for this page.</p>
          ) : (
            <div className="space-y-4">
              {versions.map((version) => (
                <Card key={version.id} className="p-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm text-gray-500">
                        {format(new Date(version.created_at), "PPpp")}
                      </p>
                    </div>
                    <Button
                      onClick={() => handleRestoreVersion(version.id)}
                      disabled={restoring}
                      variant="outline"
                      size="sm"
                    >
                      {restoring ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Restoring...
                        </>
                      ) : (
                        "Restore this version"
                      )}
                    </Button>
                  </div>
                  <div 
                    className="mt-4 p-4 border rounded-md bg-muted/50"
                    dangerouslySetInnerHTML={{ __html: version.html_content }}
                  />
                </Card>
              ))}
            </div>
          )}
          <div className="mt-6">
            <Button
              onClick={() => navigate(`/book/${bookId}/page/${pageId}`)}
              variant="outline"
            >
              Back to Page
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
