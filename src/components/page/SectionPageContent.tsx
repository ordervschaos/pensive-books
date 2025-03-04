import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const SectionPageContent = () => {
  const { pageId } = useParams();
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [editable, setEditable] = useState(false);

  useEffect(() => {
    const fetchPageContent = async () => {
      try {
        const { data, error } = await supabase
          .from("pages")
          .select("html_content")
          .eq("id", pageId)
          .single();

        if (error) throw error;
        if (data) {
          setContent(data.html_content);
        }
      } catch (error) {
        console.error("Error fetching page content:", error);
        toast({
          variant: "destructive",
          title: "Error fetching content",
          description: error instanceof Error ? error.message : "An error occurred",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchPageContent();
  }, [pageId, toast]);

  const handleSave = async () => {
    try {
      setLoading(true);
      const { error } = await supabase
        .from("pages")
        .update({ html_content: content })
        .eq("id", pageId);

      if (error) throw error;

      toast({
        title: "Content saved",
        description: "Your changes have been saved successfully.",
      });
    } catch (error) {
      console.error("Error saving content:", error);
      toast({
        variant: "destructive",
        title: "Error saving content",
        description: error instanceof Error ? error.message : "An error occurred",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-background shadow-sm w-full">
      <CardHeader>
        <h2 className="text-lg font-semibold">Section Content</h2>
        <Button onClick={() => setEditable(!editable)} variant="outline">
          {editable ? "Cancel" : "Edit"}
        </Button>
        {editable && (
          <Button onClick={handleSave} variant="outline" disabled={loading}>
            Save
          </Button>
        )}
      </CardHeader>
      <div className="p-4">
        {loading ? (
          <p>Loading...</p>
        ) : (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={!editable}
            rows={10}
            className="resize-none"
          />
        )}
      </div>
    </Card>
  );
};

export default SectionPageContent;
