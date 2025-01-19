import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusCircle, Globe, Lock } from "lucide-react";
import { TopNav } from "@/components/TopNav";
import { Badge } from "@/components/ui/badge";

const Index = () => {
  const [notebooks, setNotebooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    checkUser();
    fetchNotebooks();
  }, []);

  const checkUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
    }
  };

  const fetchNotebooks = async () => {
    try {
      const { data, error } = await supabase
        .from("books")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      setNotebooks(data || []);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error fetching notebooks",
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const createNotebook = async () => {
    try {
      const { data, error } = await supabase
        .from("books")
        .insert([{ name: "Untitled Notebook" }])
        .select()
        .single();

      if (error) throw error;

      setNotebooks([data, ...notebooks]);
      toast({
        title: "Notebook created",
        description: "Your new notebook is ready"
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error creating notebook",
        description: error.message
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <TopNav />
        <div className="container mx-auto p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold">My Notebooks</h1>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[280px] w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <div className="container mx-auto p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">My Notebooks</h1>
          <Button onClick={createNotebook}>
            <PlusCircle className="mr-2 h-4 w-4" />
            New Notebook
          </Button>
        </div>

        {notebooks.length === 0 ? (
          <div className="text-center py-12">
            <h2 className="text-xl font-semibold text-gray-600">No notebooks yet</h2>
            <p className="text-gray-500 mt-2">Create your first notebook to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {notebooks.map((notebook) => (
              <div key={notebook.id} className="flex flex-col">
                <Card 
                  className="hover:shadow-lg transition-shadow cursor-pointer overflow-hidden"
                  onClick={() => navigate(`/book/${notebook.id}`)}
                >
                  <div className="aspect-[3/4]">
                    {notebook.cover_url ? (
                      <img 
                        src={notebook.cover_url} 
                        alt={notebook.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-muted">
                        <h3 className="text-xl font-semibold text-center break-words px-4">
                          {notebook.name}
                        </h3>
                      </div>
                    )}
                  </div>
                  {notebook.cover_url && (
                    <CardContent className="pt-4">
                      <h3 className="font-semibold truncate mb-2">
                        {notebook.name}
                      </h3>
                      <Badge 
                        variant={notebook.is_public ? "default" : "secondary"}
                        className="inline-flex items-center"
                      >
                        {notebook.is_public ? (
                          <Globe className="w-3 h-3 mr-1" />
                        ) : (
                          <Lock className="w-3 h-3 mr-1" />
                        )}
                        {notebook.is_public ? "Published" : "Private"}
                      </Badge>
                    </CardContent>
                  )}
                  {!notebook.cover_url && (
                    <CardContent className="pt-4">
                      <Badge 
                        variant={notebook.is_public ? "default" : "secondary"}
                        className="inline-flex items-center"
                      >
                        {notebook.is_public ? (
                          <Globe className="w-3 h-3 mr-1" />
                        ) : (
                          <Lock className="w-3 h-3 mr-1" />
                        )}
                        {notebook.is_public ? "Published" : "Private"}
                      </Badge>
                    </CardContent>
                  )}
                </Card>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;