import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Custom hook to manage edit mode state
 * Auto-enters edit mode if URL contains ?edit=true
 */
export const useEditMode = (canEdit: boolean) => {
  const [searchParams] = useSearchParams();
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (searchParams.get('edit') === 'true' && canEdit) {
      setIsEditing(true);
    }
  }, [searchParams, canEdit]);

  return [isEditing, setIsEditing] as const;
};
