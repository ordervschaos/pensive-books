import { Type, AlignLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePageDisplaySettings, FontSize, MarginSize } from "@/contexts/PageDisplaySettingsContext";
import { cn } from "@/lib/utils";

interface PageDisplayControlsProps {
  isPageRoute?: boolean;
  mobile?: boolean;
}

export const PageDisplayControls = ({ isPageRoute = false, mobile = false }: PageDisplayControlsProps) => {
  const { settings, setFontSize, setMarginSize } = usePageDisplaySettings();

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
      <DropdownMenuContent align="end" className="w-56">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

