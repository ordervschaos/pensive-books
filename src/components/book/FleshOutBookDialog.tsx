
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Wand2 } from "lucide-react";

interface FleshOutBookDialogProps {
  bookId: number;
  onComplete?: () => void;
}

export function FleshOutBookDialog({ bookId, onComplete }: FleshOutBookDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState("Expand on each section with more detailed content, adding depth and examples while maintaining a consistent tone and style.");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleFleshOut = async () => {
    if (!prompt.trim()) {
      toast({
        variant: "destructive",
        title: "Please enter a prompt",
        description: "The prompt is required to expand the book content."
      });
      return;
    }

    try {
      setIsLoading(true);
      
      const { data, error } = await supabase.functions.invoke('flesh-out-book', {
        body: { bookId, prompt: prompt.trim() }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Book content has been expanded successfully with Deepseek AI."
      });

      setIsOpen(false);
      if (onComplete) {
        onComplete();
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error expanding content",
        description: error.message
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 w-full md:w-auto">
          <Wand2 className="h-4 w-4" />
          Expand Content with AI
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Expand Book Content with Deepseek AI</DialogTitle>
          <DialogDescription>
            Enter a prompt to guide the AI in expanding your book's content. The AI will analyze each page and add relevant content while maintaining the original style and tone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          <Textarea
            placeholder="E.g., 'Add more descriptive details and examples' or 'Elaborate on technical concepts'"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
          />

          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => setIsOpen(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleFleshOut}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Expanding...
                </>
              ) : (
                <>
                  <Wand2 className="mr-2 h-4 w-4" />
                  Expand Content
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
