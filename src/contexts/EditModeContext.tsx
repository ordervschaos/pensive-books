import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

const EDIT_MODE_STORAGE_KEY = 'pensive_edit_mode';

interface EditModeContextType {
  isEditing: boolean;
  setIsEditing: (value: boolean | ((prev: boolean) => boolean)) => void;
  canEdit: boolean;
  setCanEdit: (canEdit: boolean) => void;
}

const EditModeContext = createContext<EditModeContextType | undefined>(undefined);

/**
 * Get edit mode from localStorage
 */
const getStoredEditMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const stored = localStorage.getItem(EDIT_MODE_STORAGE_KEY);
    return stored === 'true';
  } catch {
    return false;
  }
};

/**
 * Save edit mode to localStorage
 */
const saveEditMode = (value: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(EDIT_MODE_STORAGE_KEY, String(value));
  } catch (error) {
    console.warn('Failed to save edit mode to localStorage:', error);
  }
};

interface EditModeProviderProps {
  children: ReactNode;
}

export const EditModeProvider = ({ children }: EditModeProviderProps) => {
  const [searchParams] = useSearchParams();
  const [isEditing, setIsEditingState] = useState(() => getStoredEditMode());
  const [canEdit, setCanEdit] = useState(false);

  // Handle URL param (takes priority over localStorage)
  useEffect(() => {
    const urlEditParam = searchParams.get('edit');
    if (urlEditParam === 'true' && canEdit) {
      setIsEditingState(true);
      saveEditMode(true);
    } else if (urlEditParam === 'false') {
      setIsEditingState(false);
      saveEditMode(false);
    }
  }, [searchParams, canEdit]);

  // Wrapper to save to localStorage when edit mode changes
  const setIsEditing = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setIsEditingState(prev => {
      const newValue = typeof value === 'function' ? value(prev) : value;
      saveEditMode(newValue);
      return newValue;
    });
  }, []);

  // Auto-disable edit mode when user loses edit permission
  useEffect(() => {
    if (!canEdit && isEditing) {
      setIsEditing(false);
    }
  }, [canEdit, isEditing, setIsEditing]);

  return (
    <EditModeContext.Provider value={{ isEditing, setIsEditing, canEdit, setCanEdit }}>
      {children}
    </EditModeContext.Provider>
  );
};

/**
 * Hook to access global edit mode state
 */
export const useGlobalEditMode = () => {
  const context = useContext(EditModeContext);
  if (context === undefined) {
    throw new Error('useGlobalEditMode must be used within an EditModeProvider');
  }
  return context;
};
