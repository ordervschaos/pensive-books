import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const useBookPermissions = (bookId: string | undefined) => {
  const [canEdit, setCanEdit] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  // True when the user is the owner OR an explicit collaborator (any access level).
  // Distinguishes legitimate authed access from "can only see it because it's public" —
  // the page view uses this to keep non-collaborators out of the editor.
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkPermissions = async () => {
      if (!bookId) {
        setCanEdit(false);
        setIsOwner(false);
        setHasAccess(false);
        setLoading(false);
        return;
      }

      try {
        // First get the current session
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          setCanEdit(false);
          setIsOwner(false);
          setHasAccess(false);
          setLoading(false);
          return;
        }

        // Check if user is owner
        const { data: book } = await supabase
          .from("books")
          .select("owner_id")
          .eq("id", parseInt(bookId))
          .single();

        if (book?.owner_id === session.user.id) {
          setCanEdit(true);
          setIsOwner(true);
          setHasAccess(true);
          setLoading(false);
          return;
        }

        // If not owner and user is authenticated, check for a collaborator row.
        const { data: access } = await supabase
          .from("book_access")
          .select("access_level")
          .eq("book_id", parseInt(bookId))
          .eq("invited_email", session.user.email)
          .maybeSingle();

        setCanEdit(access?.access_level === 'edit');
        setHasAccess(!!access);
        setIsOwner(false);
      } catch (error) {
        console.error("Error checking permissions:", error);
        setCanEdit(false);
        setIsOwner(false);
        setHasAccess(false);
      } finally {
        setLoading(false);
      }
    };

    checkPermissions();
  }, [bookId]);

  return { canEdit, isOwner, hasAccess, loading };
};