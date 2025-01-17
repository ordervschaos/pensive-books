import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusCircle } from "lucide-react";
import { TopNav } from "@/components/TopNav";

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
        .from("notebooks")
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
        .from("notebooks")
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[120px] w-full" />
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {notebooks.map((notebook) => (
              <Card key={notebook.id} className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardHeader>
                  <CardTitle>{notebook.name}</CardTitle>
                  <CardDescription>
                    Created {new Date(notebook.created_at).toLocaleDateString()}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;