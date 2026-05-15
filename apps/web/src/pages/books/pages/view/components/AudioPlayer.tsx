import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  VolumeX,
  Pause,
  Play,
  Volume2,
  Loader2,
  AlertCircle,
  RefreshCw,
  RotateCcw
} from "lucide-react";
import { useTextToSpeech } from "@/hooks/use-text-to-speech";
import { cn } from "@/lib/utils";

interface AudioPlayerProps {
  pageId: number;
  content?: string;
  compact?: boolean;
  className?: string;
}

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const AudioPlayer = ({
  pageId,
  content,
  compact = false,
  className
}: AudioPlayerProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const {
    audioUrl,
    isGenerating,
    isPlaying,
    error,
    duration,
    currentTime,
    play,
    pause,
    stop,
    seek,
    generateAudio,
    regenerateAudio
  } = useTextToSpeech({ pageId, content });

  const handlePlayPause = useCallback(async () => {
    if (isPlaying) {
      pause();
    } else {
      await play();
    }
  }, [isPlaying, pause, play]);

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * duration;

    seek(newTime);
  }, [duration, seek]);

  const handleToggleExpanded = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  // Memoize formatted time strings to avoid recalculation on every render
  const formattedCurrentTime = useMemo(() => formatTime(currentTime), [currentTime]);
  const formattedDuration = useMemo(() => formatTime(duration), [duration]);
  const progressPercentage = useMemo(
    () => (duration ? (currentTime / duration) * 100 : 0),
    [currentTime, duration]
  );

  if (error) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Button
          variant="ghost"
          size="sm"
          onClick={generateAudio}
          className="text-destructive hover:text-destructive"
        >
          <AlertCircle className="h-4 w-4 mr-1" />
          {!compact && "Retry"}
        </Button>
      </div>
    );
  }

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <Button
          variant="ghost"
          size="sm"
          onClick={handlePlayPause}
          disabled={isGenerating}
          className="h-8 w-8 p-0"
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isPlaying ? (
            <Volume2 className="h-4 w-4" />
          ) : (
            <VolumeX className="h-4 w-4" />
          )}
        </Button>
        
        {audioUrl && (
          <Button
            variant="ghost"
            size="sm"
            onClick={regenerateAudio}
            disabled={isGenerating}
            className="h-8 w-8 p-0"
            title="Regenerate audio"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}

        {isPlaying && (
          <div className="text-xs text-muted-foreground">
            {formattedCurrentTime} / {formattedDuration}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={handlePlayPause}
        disabled={isGenerating}
        className="flex items-center gap-2"
      >
        {isGenerating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating...
          </>
        ) : isPlaying ? (
          <>
            <Volume2 className="h-4 w-4" />
            Playing
          </>
        ) : audioUrl ? (
          <>
            <Play className="h-4 w-4" />
            Play
          </>
        ) : (
          <>
            <VolumeX className="h-4 w-4" />
            Generate Audio
          </>
        )}
      </Button>

      {audioUrl && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {formattedCurrentTime} / {formattedDuration}
          </span>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleExpanded}
            className="h-8 w-8 p-0"
          >
            <Volume2 className="h-4 w-4" />
          </Button>
        </div>
      )}

      {isExpanded && audioUrl && (
        <div className="flex items-center gap-2">
          <div
            className="w-32 cursor-pointer"
            onClick={handleProgressClick}
          >
            <Progress
              value={progressPercentage}
              className="h-2"
            />
          </div>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={stop}
            className="h-8 w-8 p-0"
            title="Stop"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={regenerateAudio}
            disabled={isGenerating}
            className="h-8 w-8 p-0"
            title="Regenerate audio"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
};
