
import { useState } from "react";
import { format } from "date-fns";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { History, RotateCcw, Loader2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface PageHistoryProps {
  pageId: number;
  currentContent: string;
  onRevert: (content: string) => Promise<void>;
}

interface HistoryEntry {
  id: number;
  html_content: string;
  created_at: string;
  batch_id: string;
}

export function PageHistory({ pageId, currentContent, onRevert }: PageHistoryProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<HistoryEntry | null>(null);
  const [reverting, setReverting] = useState(false);
  const { toast } = useToast();

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('page_history')
        .select('*')
        .eq('page_id', pageId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setHistory(data || []);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error fetching history",
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRevert = async () => {
    if (!selectedVersion) return;

    try {
      setReverting(true);
      await onRevert(selectedVersion.html_content);
      setSelectedVersion(null);
      toast({
        title: "Page reverted",
        description: "The page has been restored to the selected version."
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error reverting page",
        description: error.message
      });
    } finally {
      setReverting(false);
    }
  };

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => {
        setIsOpen(open);
        if (open) fetchHistory();
      }}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="sm">
            <History className="h-4 w-4 mr-2" />
            History
          </Button>
        </SheetTrigger>
        <SheetContent className="w-[400px] sm:w-[540px] sm:max-w-none">
          <SheetHeader>
            <SheetTitle>Page History</SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-8rem)] mt-4">
            {loading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : history.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No history available for this page
              </div>
            ) : (
              <div className="space-y-4">
                {history.map((entry) => (
                  <div 
                    key={entry.id}
                    className="p-4 rounded-lg border bg-card hover:bg-accent/5 transition-colors cursor-pointer"
                    onClick={() => setSelectedVersion(entry)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">
                        {format(new Date(entry.created_at), 'PPpp')}
                      </span>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedVersion(entry);
                        }}
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Revert
                      </Button>
                    </div>
                    <div 
                      className="text-sm text-muted-foreground line-clamp-3 prose prose-sm dark:prose-invert"
                      dangerouslySetInnerHTML={{ 
                        __html: entry.html_content.substring(0, 200) + '...'
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!selectedVersion} onOpenChange={(open) => !open && setSelectedVersion(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revert page version?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace the current content with the version from{' '}
              {selectedVersion && format(new Date(selectedVersion.created_at), 'PPpp')}.
              This action can be undone by using the history feature again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevert}
              disabled={reverting}
            >
              {reverting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Reverting...
                </>
              ) : (
                'Revert'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
