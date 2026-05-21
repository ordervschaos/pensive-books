import { EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMatureContent } from '@/hooks/use-mature-content';

interface MatureContentGateProps {
  onUnlock: () => void;
}

export function MatureContentGate({ onUnlock }: MatureContentGateProps) {
  const { toggle } = useMatureContent();

  const handleConfirm = async () => {
    await toggle(true);
    onUnlock();
  };

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full border border-border bg-muted">
        <EyeOff className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="pv-serif text-2xl font-normal italic text-foreground">
        Mature content
      </h2>
      <p className="pv-serif mt-3 max-w-sm text-[15px] italic leading-relaxed text-muted-foreground">
        This book has been marked as containing mature content and is intended for readers 18 and older.
      </p>
      <div className="mt-8 flex flex-col items-center gap-3">
        <Button
          onClick={handleConfirm}
          className="rounded-full px-8"
        >
          I am 18 or older — continue
        </Button>
        <p className="max-w-xs text-xs text-muted-foreground">
          This enables mature content across the platform. You can change this in your settings.
        </p>
      </div>
    </div>
  );
}
