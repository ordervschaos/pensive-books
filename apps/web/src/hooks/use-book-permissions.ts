import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const useBookPermissions = (bookId: string | undefined) => {
  const [canEdit, setCanEdit] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!bookId) {
      setCanEdit(false);
      setIsOwner(false);
      setHasAccess(false);
      setLoading(false);
      return;
    }

    const numericId = parseInt(bookId.match(/^(\d+)/)?.[1] ?? "0", 10);
    if (!numericId) {
      setCanEdit(false);
      setIsOwner(false);
      setHasAccess(false);
      setLoading(false);
      return;
    }

    supabase
      .rpc("check_book_access", { p_book_id: numericId })
      .then(({ data, error }) => {
        if (error || !data) {
          setCanEdit(false);
          setIsOwner(false);
          setHasAccess(false);
        } else {
          setCanEdit(Boolean(data.can_edit));
          setIsOwner(Boolean(data.is_owner));
          setHasAccess(Boolean(data.has_access));
        }
        setLoading(false);
      });
  }, [bookId]);

  return { canEdit, isOwner, hasAccess, loading };
};
