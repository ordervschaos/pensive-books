import { useState } from "react";
import {
  Settings,
  Search,
  Palette,
  Type,
  AlignLeft,
  Sun,
  Moon,
  Coffee,
  Package,
  BookOpen
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { usePageDisplaySettings, FontSize, MarginSize, FontFamily, FontStyle } from "@/contexts/PageDisplaySettingsContext";
import { useTheme } from "@/components/theme/ThemeProvider";

interface PageSettingsDrawerProps {
  onSearchOpen?: () => void;
}

export function PageSettingsDrawer({ onSearchOpen }: PageSettingsDrawerProps) {
  const [open, setOpen] = useState(false);
  const { settings, setFontSize, setMarginSize, setFontFamily, setFontStyle } = usePageDisplaySettings();
  const { themeName, themeMode, setThemeName, setThemeMode } = useTheme();

  const fontSizeLabels: Record<FontSize, string> = {
    small: 'Small',
    medium: 'Medium',
    large: 'Large',
    xl: 'Extra Large',
  };

  const marginLabels: Record<MarginSize, string> = {
    narrow: 'Narrow',
    normal: 'Normal',
    wide: 'Wide',
  };

  const fontFamilyLabels: Record<FontFamily, string> = {
    default: 'Default',
    // Serif fonts
    merriweather: 'Merriweather',
    lora: 'Lora',
    crimson: 'Crimson Pro',
    'libre-baskerville': 'Libre Baskerville',
    'eb-garamond': 'EB Garamond',
    literata: 'Literata',
    'source-serif': 'Source Serif Pro',
    georgia: 'Georgia',
    // Sans-serif fonts
    inter: 'Inter',
    'open-sans': 'Open Sans',
    'source-sans': 'Source Sans Pro',
    roboto: 'Roboto',
    lato: 'Lato',
    // Slab serif
    'roboto-slab': 'Roboto Slab',
  };

  const fontStyleLabels: Record<FontStyle, string> = {
    normal: 'Normal',
    italic: 'Italic',
  };

  // Helper to get font preview style
  const getFontPreviewStyle = (family: FontFamily): React.CSSProperties | undefined => {
    if (family === 'default' || family === 'georgia') return undefined;

    const fontMap: Record<FontFamily, string> = {
      default: '',
      merriweather: '"Merriweather", serif',
      lora: '"Lora", serif',
      crimson: '"Crimson Pro", serif',
      'libre-baskerville': '"Libre Baskerville", serif',
      'eb-garamond': '"EB Garamond", serif',
      literata: '"Literata", serif',
      'source-serif': '"Source Serif Pro", serif',
      georgia: 'Georgia, serif',
      inter: '"Inter", sans-serif',
      'open-sans': '"Open Sans", sans-serif',
      'source-sans': '"Source Sans Pro", sans-serif',
      roboto: '"Roboto", sans-serif',
      lato: '"Lato", sans-serif',
      'roboto-slab': '"Roboto Slab", serif',
    };

    return fontMap[family] ? { fontFamily: fontMap[family] } : undefined;
  };

  const themes = [
    { name: "paper" as const, label: "Paper", icon: BookOpen },
    { name: "default" as const, label: "Default", icon: Palette },
    { name: "coffee" as const, label: "Coffee", icon: Coffee },
    { name: "mujiyish" as const, label: "Mujiyish", icon: Package },
  ];

  const handleSearchClick = () => {
    setOpen(false);
    if (onSearchOpen) {
      onSearchOpen();
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 hover:bg-accent/50 fixed top-2 right-2 z-50"
        >
          <Settings className="h-4 w-4 opacity-60 hover:opacity-100 transition-opacity" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[400px] sm:w-[440px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Page Settings</SheetTitle>
          <SheetDescription>
            Customize your reading experience
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="fonts" className="mt-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="search">
              <Search className="h-4 w-4 mr-2" />
              Search
            </TabsTrigger>
            <TabsTrigger value="themes">
              <Palette className="h-4 w-4 mr-2" />
              Themes
            </TabsTrigger>
            <TabsTrigger value="fonts">
              <Type className="h-4 w-4 mr-2" />
              Fonts
            </TabsTrigger>
          </TabsList>

          {/* Search Tab */}
          <TabsContent value="search" className="space-y-4 mt-4">
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Search this book</Label>
                <p className="text-sm text-muted-foreground mt-1 mb-3">
                  Search across all pages in this book
                </p>
                <Button
                  onClick={handleSearchClick}
                  className="w-full"
                  variant="default"
                >
                  <Search className="h-4 w-4 mr-2" />
                  Open Search
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* Themes Tab */}
          <TabsContent value="themes" className="space-y-4 mt-4">
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium mb-3 block">Theme Style</Label>
                <div className="space-y-2">
                  {themes.map((theme) => {
                    const Icon = theme.icon;
                    return (
                      <Button
                        key={theme.name}
                        variant={themeName === theme.name ? "default" : "outline"}
                        className="w-full justify-start"
                        onClick={() => setThemeName(theme.name)}
                      >
                        <Icon className="h-4 w-4 mr-2" />
                        {theme.label}
                        {themeName === theme.name && (
                          <span className="ml-auto text-xs">✓</span>
                        )}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <div>
                <Label className="text-sm font-medium mb-3 block">Theme Mode</Label>
                <div className="space-y-2">
                  <Button
                    variant={themeMode === "light" ? "default" : "outline"}
                    className="w-full justify-start"
                    onClick={() => setThemeMode("light")}
                  >
                    <Sun className="h-4 w-4 mr-2" />
                    Light
                    {themeMode === "light" && (
                      <span className="ml-auto text-xs">✓</span>
                    )}
                  </Button>
                  <Button
                    variant={themeMode === "dark" ? "default" : "outline"}
                    className="w-full justify-start"
                    onClick={() => setThemeMode("dark")}
                  >
                    <Moon className="h-4 w-4 mr-2" />
                    Dark
                    {themeMode === "dark" && (
                      <span className="ml-auto text-xs">✓</span>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Fonts Tab */}
          <TabsContent value="fonts" className="space-y-4 mt-4">
            <div className="space-y-6">
              {/* Font Size */}
              <div>
                <Label className="text-sm font-medium mb-3 block">Font Size</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(fontSizeLabels) as FontSize[]).map((size) => (
                    <Button
                      key={size}
                      variant={settings.fontSize === size ? "default" : "outline"}
                      className="justify-start"
                      onClick={() => setFontSize(size)}
                    >
                      <Type className="h-4 w-4 mr-2" />
                      {fontSizeLabels[size]}
                      {settings.fontSize === size && (
                        <span className="ml-auto text-xs">✓</span>
                      )}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Font Family */}
              <div>
                <Label className="text-sm font-medium mb-3 block">Font Family</Label>
                <div className="space-y-2">
                  <Button
                    variant={settings.fontFamily === 'default' ? "default" : "outline"}
                    className="w-full justify-start"
                    onClick={() => setFontFamily('default')}
                  >
                    <Palette className="h-4 w-4 mr-2" />
                    {fontFamilyLabels.default}
                    {settings.fontFamily === 'default' && (
                      <span className="ml-auto text-xs">✓</span>
                    )}
                  </Button>

                  <div className="text-xs text-muted-foreground font-medium mt-4 mb-2">Serif Fonts</div>
                  <div className="grid grid-cols-2 gap-2">
                    {(['merriweather', 'lora', 'crimson', 'libre-baskerville', 'eb-garamond', 'literata', 'source-serif', 'georgia'] as FontFamily[]).map((family) => (
                      <Button
                        key={family}
                        variant={settings.fontFamily === family ? "default" : "outline"}
                        className="justify-start text-xs"
                        style={getFontPreviewStyle(family)}
                        onClick={() => setFontFamily(family)}
                      >
                        <span className="truncate">{fontFamilyLabels[family]}</span>
                        {settings.fontFamily === family && (
                          <span className="ml-auto text-xs">✓</span>
                        )}
                      </Button>
                    ))}
                  </div>

                  <div className="text-xs text-muted-foreground font-medium mt-4 mb-2">Sans-Serif Fonts</div>
                  <div className="grid grid-cols-2 gap-2">
                    {(['inter', 'open-sans', 'source-sans', 'roboto', 'lato'] as FontFamily[]).map((family) => (
                      <Button
                        key={family}
                        variant={settings.fontFamily === family ? "default" : "outline"}
                        className="justify-start text-xs"
                        style={getFontPreviewStyle(family)}
                        onClick={() => setFontFamily(family)}
                      >
                        <span className="truncate">{fontFamilyLabels[family]}</span>
                        {settings.fontFamily === family && (
                          <span className="ml-auto text-xs">✓</span>
                        )}
                      </Button>
                    ))}
                  </div>

                  <div className="text-xs text-muted-foreground font-medium mt-4 mb-2">Slab Serif</div>
                  <Button
                    variant={settings.fontFamily === 'roboto-slab' ? "default" : "outline"}
                    className="w-full justify-start text-xs"
                    style={getFontPreviewStyle('roboto-slab')}
                    onClick={() => setFontFamily('roboto-slab')}
                  >
                    <span className="truncate">{fontFamilyLabels['roboto-slab']}</span>
                    {settings.fontFamily === 'roboto-slab' && (
                      <span className="ml-auto text-xs">✓</span>
                    )}
                  </Button>
                </div>
              </div>

              {/* Font Style */}
              <div>
                <Label className="text-sm font-medium mb-3 block">Font Style</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(fontStyleLabels) as FontStyle[]).map((style) => (
                    <Button
                      key={style}
                      variant={settings.fontStyle === style ? "default" : "outline"}
                      className="justify-start"
                      style={style === 'italic' ? { fontStyle: 'italic' } : undefined}
                      onClick={() => setFontStyle(style)}
                    >
                      <Type className="h-4 w-4 mr-2" />
                      {fontStyleLabels[style]}
                      {settings.fontStyle === style && (
                        <span className="ml-auto text-xs">✓</span>
                      )}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Margins */}
              <div>
                <Label className="text-sm font-medium mb-3 block">Margins</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(marginLabels) as MarginSize[]).map((size) => (
                    <Button
                      key={size}
                      variant={settings.marginSize === size ? "default" : "outline"}
                      className="justify-start"
                      onClick={() => setMarginSize(size)}
                    >
                      <AlignLeft className="h-4 w-4 mr-2" />
                      {marginLabels[size]}
                      {settings.marginSize === size && (
                        <span className="ml-auto text-xs">✓</span>
                      )}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
