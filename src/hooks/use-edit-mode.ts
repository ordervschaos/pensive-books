import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

const EDIT_MODE_STORAGE_KEY = 'pensive_edit_mode';

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
    // Silently fail if localStorage is not available
    console.warn('Failed to save edit mode to localStorage:', error);
  }
};

/**
 * Custom hook to manage edit mode state
 * Persists edit mode preference globally in localStorage
 * Auto-enters edit mode if URL contains ?edit=true (takes priority)
 */
export const useEditMode = (canEdit: boolean) => {
  const [searchParams] = useSearchParams();
  
  // Initialize from localStorage as default
  const [isEditing, setIsEditing] = useState(() => getStoredEditMode());

  // Handle URL param (takes priority over localStorage)
  useEffect(() => {
    const urlEditParam = searchParams.get('edit');
    if (urlEditParam === 'true' && canEdit) {
      setIsEditing(true);
      saveEditMode(true); // Also persist URL param changes
    } else if (urlEditParam === 'false') {
      setIsEditing(false);
      saveEditMode(false); // Also persist URL param changes
    }
    // If no URL param, localStorage value is already set as initial state
  }, [searchParams, canEdit]);

  // Wrapper to save to localStorage when edit mode changes
  const setEditMode = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setIsEditing(prev => {
      const newValue = typeof value === 'function' ? value(prev) : value;
      saveEditMode(newValue);
      return newValue;
    });
  }, []);

  return [isEditing, setEditMode] as const;
};
