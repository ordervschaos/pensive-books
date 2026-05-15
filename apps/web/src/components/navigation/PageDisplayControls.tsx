import { Type, AlignLeft, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePageDisplaySettings, FontSize, MarginSize, FontFamily, FontStyle } from "@/contexts/PageDisplaySettingsContext";
import { cn } from "@/lib/utils";

interface PageDisplayControlsProps {
  isPageRoute?: boolean;
  mobile?: boolean;
}

export const PageDisplayControls = ({ isPageRoute = false, mobile = false }: PageDisplayControlsProps) => {
  const { settings, setFontSize, setMarginSize, setFontFamily, setFontStyle } = usePageDisplaySettings();

  if (!isPageRoute) {
    return null;
  }

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

  // Mobile mode: render menu items directly (for nested dropdown)
  if (mobile) {
    return (
      <>
        <DropdownMenuLabel>Font Size</DropdownMenuLabel>
        {(Object.keys(fontSizeLabels) as FontSize[]).map((size) => (
          <DropdownMenuItem
            key={size}
            onClick={() => setFontSize(size)}
            className={cn(settings.fontSize === size && "bg-accent")}
          >
            <Type className="h-4 w-4 mr-2" />
            <span>{fontSizeLabels[size]}</span>
            {settings.fontSize === size && (
              <span className="ml-auto text-xs">✓</span>
            )}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Font Family</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => setFontFamily('default')}
          className={cn(settings.fontFamily === 'default' && "bg-accent")}
        >
          <Palette className="h-4 w-4 mr-2" />
          <span>{fontFamilyLabels.default}</span>
          {settings.fontFamily === 'default' && (
            <span className="ml-auto text-xs">✓</span>
          )}
        </DropdownMenuItem>
        
        <DropdownMenuLabel className="text-xs text-muted-foreground mt-2">Serif Fonts</DropdownMenuLabel>
        {(['merriweather', 'lora', 'crimson', 'libre-baskerville', 'eb-garamond', 'literata', 'source-serif', 'georgia'] as FontFamily[]).map((family) => (
          <DropdownMenuItem
            key={family}
            onClick={() => setFontFamily(family)}
            className={cn(settings.fontFamily === family && "bg-accent")}
            style={getFontPreviewStyle(family)}
          >
            <Palette className="h-4 w-4 mr-2" />
            <span>{fontFamilyLabels[family]}</span>
            {settings.fontFamily === family && (
              <span className="ml-auto text-xs">✓</span>
            )}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-xs text-muted-foreground">Sans-Serif Fonts</DropdownMenuLabel>
        {(['inter', 'open-sans', 'source-sans', 'roboto', 'lato'] as FontFamily[]).map((family) => (
          <DropdownMenuItem
            key={family}
            onClick={() => setFontFamily(family)}
            className={cn(settings.fontFamily === family && "bg-accent")}
            style={getFontPreviewStyle(family)}
          >
            <Palette className="h-4 w-4 mr-2" />
            <span>{fontFamilyLabels[family]}</span>
            {settings.fontFamily === family && (
              <span className="ml-auto text-xs">✓</span>
            )}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-xs text-muted-foreground">Slab Serif</DropdownMenuLabel>
        {(['roboto-slab'] as FontFamily[]).map((family) => (
          <DropdownMenuItem
            key={family}
            onClick={() => setFontFamily(family)}
            className={cn(settings.fontFamily === family && "bg-accent")}
            style={getFontPreviewStyle(family)}
          >
            <Palette className="h-4 w-4 mr-2" />
            <span>{fontFamilyLabels[family]}</span>
            {settings.fontFamily === family && (
              <span className="ml-auto text-xs">✓</span>
            )}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Font Style</DropdownMenuLabel>
        {(Object.keys(fontStyleLabels) as FontStyle[]).map((style) => (
          <DropdownMenuItem
            key={style}
            onClick={() => setFontStyle(style)}
            className={cn(settings.fontStyle === style && "bg-accent")}
            style={style === 'italic' ? { fontStyle: 'italic' } : undefined}
          >
            <Type className="h-4 w-4 mr-2" />
            <span>{fontStyleLabels[style]}</span>
            {settings.fontStyle === style && (
              <span className="ml-auto text-xs">✓</span>
            )}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Margins</DropdownMenuLabel>
        {(Object.keys(marginLabels) as MarginSize[]).map((size) => (
          <DropdownMenuItem
            key={size}
            onClick={() => setMarginSize(size)}
            className={cn(settings.marginSize === size && "bg-accent")}
          >
            <AlignLeft className="h-4 w-4 mr-2" />
            <span>{marginLabels[size]}</span>
            {settings.marginSize === size && (
              <span className="ml-auto text-xs">✓</span>
            )}
          </DropdownMenuItem>
        ))}
      </>
    );
  }

  // Desktop mode: render as dropdown button
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" title="Display settings">
          <Type className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96">
        <DropdownMenuLabel>Font Size</DropdownMenuLabel>
        <div className="grid grid-cols-2 gap-0">
          {(Object.keys(fontSizeLabels) as FontSize[]).map((size) => (
            <DropdownMenuItem
              key={size}
              onClick={() => setFontSize(size)}
              className={cn(settings.fontSize === size && "bg-accent")}
            >
              <Type className="h-4 w-4 mr-2" />
              <span>{fontSizeLabels[size]}</span>
              {settings.fontSize === size && (
                <span className="ml-auto text-xs">✓</span>
              )}
            </DropdownMenuItem>
          ))}
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Font Family</DropdownMenuLabel>
        <div className="grid grid-cols-2 gap-0">
          <DropdownMenuItem
            onClick={() => setFontFamily('default')}
            className={cn(settings.fontFamily === 'default' && "bg-accent")}
          >
            <Palette className="h-4 w-4 mr-2" />
            <span>{fontFamilyLabels.default}</span>
            {settings.fontFamily === 'default' && (
              <span className="ml-auto text-xs">✓</span>
            )}
          </DropdownMenuItem>
          
          
          <div className="col-span-2">
            <DropdownMenuLabel className="text-xs text-muted-foreground mt-2 px-2">Serif Fonts</DropdownMenuLabel>
          </div>
          {(['merriweather', 'lora', 'crimson', 'libre-baskerville', 'eb-garamond', 'literata', 'source-serif', 'georgia'] as FontFamily[]).map((family) => (
            <DropdownMenuItem
              key={family}
              onClick={() => setFontFamily(family)}
              className={cn(settings.fontFamily === family && "bg-accent")}
              style={getFontPreviewStyle(family)}
            >
              <Palette className="h-4 w-4 mr-2" />
              <span className="truncate">{fontFamilyLabels[family]}</span>
              {settings.fontFamily === family && (
                <span className="ml-auto text-xs">✓</span>
              )}
            </DropdownMenuItem>
          ))}

          <div className="col-span-2">
            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuLabel className="text-xs text-muted-foreground px-2">Sans-Serif Fonts</DropdownMenuLabel>
          </div>
          {(['inter', 'open-sans', 'source-sans', 'roboto', 'lato'] as FontFamily[]).map((family) => (
            <DropdownMenuItem
              key={family}
              onClick={() => setFontFamily(family)}
              className={cn(settings.fontFamily === family && "bg-accent")}
              style={getFontPreviewStyle(family)}
            >
              <Palette className="h-4 w-4 mr-2" />
              <span className="truncate">{fontFamilyLabels[family]}</span>
              {settings.fontFamily === family && (
                <span className="ml-auto text-xs">✓</span>
              )}
            </DropdownMenuItem>
          ))}

          <div className="col-span-2">
            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuLabel className="text-xs text-muted-foreground px-2">Slab Serif</DropdownMenuLabel>
          </div>
          {(['roboto-slab'] as FontFamily[]).map((family) => (
            <DropdownMenuItem
              key={family}
              onClick={() => setFontFamily(family)}
              className={cn(settings.fontFamily === family && "bg-accent")}
              style={getFontPreviewStyle(family)}
            >
              <Palette className="h-4 w-4 mr-2" />
              <span className="truncate">{fontFamilyLabels[family]}</span>
              {settings.fontFamily === family && (
                <span className="ml-auto text-xs">✓</span>
              )}
            </DropdownMenuItem>
          ))}
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Font Style</DropdownMenuLabel>
        <div className="grid grid-cols-2 gap-0">
          {(Object.keys(fontStyleLabels) as FontStyle[]).map((style) => (
            <DropdownMenuItem
              key={style}
              onClick={() => setFontStyle(style)}
              className={cn(settings.fontStyle === style && "bg-accent")}
              style={style === 'italic' ? { fontStyle: 'italic' } : undefined}
            >
              <Type className="h-4 w-4 mr-2" />
              <span>{fontStyleLabels[style]}</span>
              {settings.fontStyle === style && (
                <span className="ml-auto text-xs">✓</span>
              )}
            </DropdownMenuItem>
          ))}
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Margins</DropdownMenuLabel>
        <div className="grid grid-cols-2 gap-0">
          {(Object.keys(marginLabels) as MarginSize[]).map((size) => (
            <DropdownMenuItem
              key={size}
              onClick={() => setMarginSize(size)}
              className={cn(settings.marginSize === size && "bg-accent")}
            >
              <AlignLeft className="h-4 w-4 mr-2" />
              <span>{marginLabels[size]}</span>
              {settings.marginSize === size && (
                <span className="ml-auto text-xs">✓</span>
              )}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

