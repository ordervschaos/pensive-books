import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

const CONTENT_TAGS = [
  { value: 'mature', label: '18+ Mature', description: 'Adult or explicit content' },
  { value: 'violence', label: 'Violence', description: 'Graphic or intense violence' },
  { value: 'language', label: 'Strong Language', description: 'Explicit language' },
  { value: 'sensitive', label: 'Sensitive Topics', description: 'Deals with sensitive real-world subjects' },
];

interface AdminTagPanelProps {
  bookId: number;
  initialTags: string[];
  onTagsChange?: (tags: string[]) => void;
}

export function AdminTagPanel({ bookId, initialTags, onTagsChange }: AdminTagPanelProps) {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const toggleTag = async (tag: string) => {
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    setSaving(true);

    const { error } = await supabase
      .from('books')
      .update({ content_tags: next })
      .eq('id', bookId);

    if (error) {
      toast({ variant: 'destructive', title: 'Failed to save tag', description: error.message });
    } else {
      setTags(next);
      onTagsChange?.(next);
    }
    setSaving(false);
  };

  return (
    <div className="rounded-lg border border-amber-200/70 bg-amber-50/60 p-4 dark:border-amber-800/50 dark:bg-amber-950/20">
      <div className="mb-3 flex items-center gap-2">
        <Shield className="h-3.5 w-3.5 text-amber-600 dark:text-amber-500" />
        <span className="pv-mono text-[11px] uppercase tracking-[0.12em] text-amber-700 dark:text-amber-500">
          Admin · Content Tags
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {CONTENT_TAGS.map((tag) => {
          const active = tags.includes(tag.value);
          return (
            <button
              key={tag.value}
              onClick={() => toggleTag(tag.value)}
              disabled={saving}
              title={tag.description}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-amber-600 bg-amber-600 text-white dark:border-amber-500 dark:bg-amber-500'
                  : 'border-amber-300 bg-white text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-transparent dark:text-amber-400 dark:hover:bg-amber-900/40',
              )}
            >
              {tag.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
