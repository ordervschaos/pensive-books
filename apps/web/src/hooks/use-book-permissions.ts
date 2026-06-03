import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const useBookPermissions = (bookId: string | undefined) => {
  const [canEdit, setCanEdit] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);
  // viaAdmin: access granted through the admin override rather than true ownership.
  const [viaAdmin, setViaAdmin] = useState(false);
  const [ownerLabel, setOwnerLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!bookId) {
      setCanEdit(false);
      setIsOwner(false);
      setHasAccess(false);
      setViaAdmin(false);
      setOwnerLabel(null);
      setLoading(false);
      return;
    }

    const numericId = parseInt(bookId.match(/^(\d+)/)?.[1] ?? "0", 10);
    if (!numericId) {
      setCanEdit(false);
      setIsOwner(false);
      setHasAccess(false);
      setViaAdmin(false);
      setOwnerLabel(null);
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
          setViaAdmin(false);
          setOwnerLabel(null);
        } else {
          setCanEdit(Boolean(data.can_edit));
          setIsOwner(Boolean(data.is_owner));
          setHasAccess(Boolean(data.has_access));
          setViaAdmin(Boolean(data.via_admin));
          setOwnerLabel((data.owner_label as string | null) ?? null);
        }
        setLoading(false);
      });
  }, [bookId]);

  return { canEdit, isOwner, hasAccess, viaAdmin, ownerLabel, loading };
};
