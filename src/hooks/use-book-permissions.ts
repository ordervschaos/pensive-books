import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const useBookPermissions = (bookId: string | undefined) => {
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkPermissions = async () => {
      if (!bookId) {
        setCanEdit(false);
        setLoading(false);
        return;
      }

      try {
        // First check if user is owner
        const { data: book } = await supabase
          .from("books")
          .select("owner_id")
          .eq("id", bookId)
          .single();

        const { data: { user } } = await supabase.auth.getUser();
        
        if (book?.owner_id === user?.id) {
          setCanEdit(true);
          setLoading(false);
          return;
        }

        // If not owner, check for edit access
        const { data: access } = await supabase
          .from("book_access")
          .select("access_level")
          .eq("book_id", bookId)
          .eq("invited_email", user?.email)
          .single();

        setCanEdit(access?.access_level === 'edit');
      } catch (error) {
        console.error("Error checking permissions:", error);
        setCanEdit(false);
      } finally {
        setLoading(false);
      }
    };

    checkPermissions();
  }, [bookId]);

  return { canEdit, loading };
};