
import React, { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Check, X, Loader2 } from "lucide-react";

interface AiSuggestionPopoverProps {
  selectedText: string;
  onApplySuggestion: (suggestion: string) => void;
}

export const AiSuggestionPopover = ({ selectedText, onApplySuggestion }: AiSuggestionPopoverProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const { toast } = useToast();

  const getSuggestion = async () => {
    if (!selectedText || selectedText.trim() === '') {
      toast({
        title: "No text selected",
        description: "Please select some text to get suggestions.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsLoading(true);
      setSuggestion(null);

      const { data, error } = await supabase.functions.invoke('suggest-text-correction', {
        body: { text: selectedText }
      });

      if (error) throw error;

      if (data.suggestion) {
        // Extract the actual suggestion text from the format
        let extractedSuggestion = data.suggestion;
        const match = data.suggestion.match(/Suggested correction: (.*)/i);
        if (match && match[1]) {
          extractedSuggestion = match[1].trim();
        }
        
        setSuggestion(extractedSuggestion);
      } else {
        throw new Error('No suggestion returned');
      }
    } catch (error: any) {
      console.error('Error getting suggestion:', error);
      toast({
        title: "Error getting suggestion",
        description: error.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpen = (open: boolean) => {
    setIsOpen(open);
    if (open && !suggestion && !isLoading) {
      getSuggestion();
    }
  };

  const applySuggestion = () => {
    if (suggestion) {
      onApplySuggestion(suggestion);
      setIsOpen(false);
      toast({
        title: "Suggestion applied",
        description: "The AI suggestion has been applied to your text.",
      });
    }
  };

  const cleanSuggestion = suggestion?.replace(/^["']|["']$/g, '');

  return (
    <Popover open={isOpen} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className="flex items-center gap-1"
          title="Get AI suggestions for selected text (Ctrl+Space)"
          data-suggestion-trigger="true"
        >
          <Sparkles className="h-4 w-4" />
          <span className="hidden md:inline">Suggest</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4">
        <div className="space-y-4">
          <h4 className="font-medium text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> 
            AI Suggestion
          </h4>
          
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Generating suggestion...</span>
            </div>
          ) : suggestion ? (
            <>
              <div className="text-sm border-l-2 border-primary pl-3 py-1">
                {cleanSuggestion}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => setIsOpen(false)}
                >
                  <X className="h-4 w-4 mr-1" /> Dismiss
                </Button>
                <Button 
                  variant="default" 
                  size="sm"
                  onClick={applySuggestion}
                >
                  <Check className="h-4 w-4 mr-1" /> Apply
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No suggestion available. Try selecting different text.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
