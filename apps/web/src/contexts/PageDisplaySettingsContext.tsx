import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type FontSize = 'small' | 'medium' | 'large' | 'xl';
export type MarginSize = 'narrow' | 'normal' | 'wide';
export type FontFamily = 'default' | 'merriweather' | 'lora' | 'crimson' | 'libre-baskerville' | 'eb-garamond' | 'literata' | 'source-serif' | 'georgia' | 'inter' | 'open-sans' | 'source-sans' | 'roboto' | 'lato' | 'roboto-slab';
export type FontStyle = 'normal' | 'italic';

interface PageDisplaySettings {
  fontSize: FontSize;
  marginSize: MarginSize;
  fontFamily: FontFamily;
  fontStyle: FontStyle;
}

interface PageDisplaySettingsContextType {
  settings: PageDisplaySettings;
  setFontSize: (size: FontSize) => void;
  setMarginSize: (size: MarginSize) => void;
  setFontFamily: (family: FontFamily) => void;
  setFontStyle: (style: FontStyle) => void;
  resetSettings: () => void;
}

const defaultSettings: PageDisplaySettings = {
  fontSize: 'medium',
  marginSize: 'normal',
  fontFamily: 'default',
  fontStyle: 'normal',
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

  const setFontFamily = (family: FontFamily) => {
    setSettings(prev => ({ ...prev, fontFamily: family }));
  };

  const setFontStyle = (style: FontStyle) => {
    setSettings(prev => ({ ...prev, fontStyle: style }));
  };

  const resetSettings = () => {
    setSettings(defaultSettings);
  };

  // Load Google Fonts when font family changes
  useEffect(() => {
    const fontMap: Record<FontFamily, string | null> = {
      default: null,
      // Serif fonts (excellent for reading)
      merriweather: 'family=Merriweather:ital,wght@0,400;0,700;1,400;1,700&display=swap',
      lora: 'family=Lora:ital,wght@0,400;0,700;1,400;1,700&display=swap',
      crimson: 'family=Crimson+Pro:ital,wght@0,400;0,600;1,400&display=swap',
      'libre-baskerville': 'family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap',
      'eb-garamond': 'family=EB+Garamond:ital,wght@0,400;0,600;1,400&display=swap',
      literata: 'family=Literata:ital,wght@0,400;0,700;1,400;1,700&display=swap',
      'source-serif': 'family=Source+Serif+Pro:ital,wght@0,400;0,600;1,400;1,600&display=swap',
      georgia: null, // System font
      // Sans-serif fonts (clean and readable)
      inter: 'family=Inter:ital,wght@0,400;0,600;1,400&display=swap',
      'open-sans': 'family=Open+Sans:ital,wght@0,400;0,600;1,400;1,600&display=swap',
      'source-sans': 'family=Source+Sans+Pro:ital,wght@0,400;0,600;1,400;1,600&display=swap',
      roboto: 'family=Roboto:ital,wght@0,400;0,500;1,400&display=swap',
      lato: 'family=Lato:ital,wght@0,400;0,700;1,400;1,700&display=swap',
      // Slab serif
      'roboto-slab': 'family=Roboto+Slab:wght@400;600;700&display=swap',
    };

    const fontFamily = settings.fontFamily;
    const fontUrl = fontMap[fontFamily];

    if (fontUrl && typeof window !== 'undefined') {
      // Check if font is already loaded
      const linkId = `google-font-${fontFamily}`;
      const existingLink = document.getElementById(linkId);
      
      if (!existingLink) {
        const link = document.createElement('link');
        link.id = linkId;
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?${fontUrl}`;
        document.head.appendChild(link);
      }
    }

    // Cleanup: Remove unused font links
    return () => {
      Object.keys(fontMap).forEach((family) => {
        if (family !== fontFamily && fontMap[family as FontFamily]) {
          const linkId = `google-font-${family}`;
          const link = document.getElementById(linkId);
          if (link) {
            // Don't remove immediately, keep fonts loaded for better UX
            // link.remove();
          }
        }
      });
    };
  }, [settings.fontFamily]);

  return (
    <PageDisplaySettingsContext.Provider
      value={{
        settings,
        setFontSize,
        setMarginSize,
        setFontFamily,
        setFontStyle,
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

