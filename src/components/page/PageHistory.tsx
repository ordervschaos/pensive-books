
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { History } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";

interface PageHistoryProps {
  pageId: number;
  currentContent: string;
  onRevert: (content: string) => Promise<void>;
}

export const PageHistory = ({ pageId, currentContent, onRevert }: PageHistoryProps) => {
  const { data: versions } = useQuery({
    queryKey: ['page-history', pageId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('page_history')
        .select('*')
        .eq('page_id', pageId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    }
  });

  if (!versions?.length) {
    return null;
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <History className="w-4 h-4 mr-2" />
          History
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Page History</SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-[80vh] mt-4">
          <div className="space-y-4">
            {versions.map((version) => (
              <div key={version.id} className="border rounded-lg p-4">
                <div className="flex justify-between items-center mb-2">
                  <div className="text-sm text-muted-foreground">
                    {format(new Date(version.created_at), 'PPpp')}
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => onRevert(version.html_content)}
                  >
                    Restore
                  </Button>
                </div>
                <div 
                  className="prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: version.html_content }}
                />
              </div>
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};
