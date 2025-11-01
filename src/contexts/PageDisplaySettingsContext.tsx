import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type FontSize = 'small' | 'medium' | 'large' | 'xl';
export type MarginSize = 'narrow' | 'normal' | 'wide';

interface PageDisplaySettings {
  fontSize: FontSize;
  marginSize: MarginSize;
}

interface PageDisplaySettingsContextType {
  settings: PageDisplaySettings;
  setFontSize: (size: FontSize) => void;
  setMarginSize: (size: MarginSize) => void;
  resetSettings: () => void;
}

const defaultSettings: PageDisplaySettings = {
  fontSize: 'medium',
  marginSize: 'normal',
};

const PageDisplaySettingsContext = createContext<PageDisplaySettingsContextType | undefined>(undefined);

const STORAGE_KEY = 'pensive-page-display-settings';

export function PageDisplaySettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PageDisplaySettings>(() => {
    // Load from localStorage on mount
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          return { ...defaultSettings, ...JSON.parse(stored) };
        } catch {
          return defaultSettings;
        }
      }
    }
    return defaultSettings;
  });

  // Save to localStorage whenever settings change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const setFontSize = (size: FontSize) => {
    setSettings(prev => ({ ...prev, fontSize: size }));
  };

  const setMarginSize = (size: MarginSize) => {
    setSettings(prev => ({ ...prev, marginSize: size }));
  };

  const resetSettings = () => {
    setSettings(defaultSettings);
  };

  return (
    <PageDisplaySettingsContext.Provider
      value={{
        settings,
        setFontSize,
        setMarginSize,
        resetSettings,
      }}
    >
      {children}
    </PageDisplaySettingsContext.Provider>
  );
}

export function usePageDisplaySettings() {
  const context = useContext(PageDisplaySettingsContext);
  if (context === undefined) {
    throw new Error('usePageDisplaySettings must be used within a PageDisplaySettingsProvider');
  }
  return context;
}

