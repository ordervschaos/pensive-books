import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { useState, useEffect } from "react";
import { TipTapEditor } from "@/components/editor/TipTapEditor";
import { useToast } from "@/hooks/use-toast";

interface PageVersion {
  id: number;
  page_id: number;
  html_content: string;
  content?: any;
  created_at: string;
}

export default function PageHistoryView() {
  const { pageId, bookId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedVersion, setSelectedVersion] = useState<PageVersion | null>(null);

  // First fetch the current page
  const { data: currentPage, isLoading: isLoadingPage } = useQuery({
    queryKey: ['page', pageId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pages')
        .select('*, owner_id')
        .eq('id', parseInt(pageId || '0'))
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    staleTime: 0 // Always fetch fresh data
  });

  // Then fetch versions only after we have the current page
  const { data: versions, isLoading: isLoadingVersions } = useQuery({
    queryKey: ['page-history', pageId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('page_history')
        .select('*')
        .eq('page_id', parseInt(pageId || '0'))
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as PageVersion[];
    },
    enabled: !!currentPage,
    staleTime: 0 // Always fetch fresh data
  });

  const isLoading = isLoadingPage || isLoadingVersions;

  // Compute the current display content based on selection
  const displayContent = selectedVersion 
    ? selectedVersion.html_content || ''
    : currentPage?.html_content || '';

  // Handle version selection
  const handleVersionSelect = (version: PageVersion | null) => {
    setSelectedVersion(version);
  };

  const handleRestore = async () => {
    if (!selectedVersion || !pageId || !currentPage?.owner_id) return;

    try {
      // Save current version to history before restoring
      const { error: historyError } = await supabase
        .from('page_history')
        .upsert(
          {
            page_id: parseInt(pageId),
            html_content: currentPage?.html_content,
            created_by: currentPage.owner_id,
            created_at: new Date().toISOString()
          },
          {
            onConflict: 'page_id,created_at_minute'
          }
        );

      if (historyError) throw historyError;

      // Then update the current page with the selected version
      const { error } = await supabase
        .from('pages')
        .update({ 
          html_content: selectedVersion.html_content,
          updated_at: new Date().toISOString()
        })
        .eq('id', parseInt(pageId));

      if (error) throw error;

      // Invalidate queries to ensure fresh data
      await Promise.all([
        queryClient.invalidateQueries(['page', pageId]),
        queryClient.invalidateQueries(['page-history', pageId])
      ]);

      toast({
        title: "Version restored",
        description: "The page has been reverted to the selected version."
      });

      navigate(`/book/${bookId}/page/${pageId}`);
    } catch (error) {
      console.error('Error restoring version:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to restore the selected version."
      });
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Sidebar with versions */}
      <div className="w-80 border-r bg-muted/30">
        <div className="p-4 border-b">
          <Button 
            variant="ghost" 
            className="mb-2"
            onClick={() => navigate(`/book/${bookId}/page/${pageId}`)}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to page
          </Button>
          <h2 className="text-lg font-semibold">Page History</h2>
        </div>
        <ScrollArea className="h-[calc(100vh-8rem)]">
          <div className="p-4 space-y-4">
            {isLoading ? (
              <div className="p-4 text-muted-foreground">Loading...</div>
            ) : (
              <>
                <div 
                  className={`p-4 border rounded-lg cursor-pointer transition-colors hover:bg-accent ${!selectedVersion ? 'bg-accent' : ''}`}
                  onClick={() => handleVersionSelect(null)}
                >
                  <div className="font-medium">Current Version</div>
                  <div className="text-sm text-muted-foreground">
                    {currentPage?.updated_at ? format(new Date(currentPage.updated_at), 'PPpp') : 'Unknown date'}
                  </div>
                </div>
                {versions?.map((version) => (
                  <div
                    key={version.id}
                    className={`p-4 border rounded-lg cursor-pointer transition-colors hover:bg-accent ${selectedVersion?.id === version.id ? 'bg-accent' : ''}`}
                    onClick={() => handleVersionSelect(version)}
                  >
                    <div className="text-sm text-muted-foreground">
                      {format(new Date(version.created_at), 'PPpp')}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Content preview */}
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              {selectedVersion ? 'Previewing past version' : 'Current version'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {selectedVersion 
                ? `From ${format(new Date(selectedVersion.created_at), 'PPpp')}` 
                : `Last updated ${currentPage?.updated_at ? format(new Date(currentPage.updated_at), 'PPpp') : 'Unknown'}`
              }
            </p>
          </div>
          {selectedVersion && (
            <Button onClick={handleRestore}>
              Restore this version
            </Button>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="p-8 text-muted-foreground">Loading...</div>
          ) : (
            displayContent && (
              <TipTapEditor
                key={`${selectedVersion?.id || 'current'}-${displayContent.length}`}
                content={displayContent}
                onChange={() => {}}
                editable={false}
                isEditing={false}
                hideToolbar
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}
