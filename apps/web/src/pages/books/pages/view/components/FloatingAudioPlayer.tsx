import { useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Play, Pause, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FloatingAudioPlayerProps {
  isGenerating: boolean;
  isPlaying: boolean;
  duration: number;
  currentTime: number;
  playbackRate: number;
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  setPlaybackRate: (rate: number) => void;
}

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export const FloatingAudioPlayer = ({
  isGenerating,
  isPlaying,
  duration,
  currentTime,
  playbackRate,
  play,
  pause,
  seek,
  setPlaybackRate,
}: FloatingAudioPlayerProps) => {
  const handlePlayPause = useCallback(async () => {
    if (isPlaying) {
      pause();
    } else {
      await play();
    }
  }, [isPlaying, pause, play]);

  const handleSeek = useCallback((value: number[]) => {
    seek(value[0]);
  }, [seek]);

  const handleSpeedChange = useCallback((value: string) => {
    setPlaybackRate(parseFloat(value));
  }, [setPlaybackRate]);

  // Memoize formatted time strings to avoid recalculation on every render
  const formattedCurrentTime = useMemo(() => formatTime(currentTime), [currentTime]);
  const formattedDuration = useMemo(() => formatTime(duration), [duration]);
  const progressPercentage = useMemo(
    () => (duration ? (currentTime / duration) * 100 : 0),
    [currentTime, duration]
  );

  // Only render when audio is playing or generating
  if (!isPlaying && !isGenerating) {
    return null;
  }

  return (
    <div 
      className={cn(
        "fixed bottom-6 left-1/2 -translate-x-1/2 z-40",
        "w-full max-w-2xl px-4"
      )}
    >
      <div 
        className={cn(
          "bg-background/95 backdrop-blur-md",
          "border border-border rounded-2xl shadow-2xl",
          "px-6 py-4",
          "flex items-center gap-4",
          "animate-in slide-in-from-bottom-5 duration-300"
        )}
      >
        {/* Play/Pause Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handlePlayPause}
          disabled={isGenerating}
          className="h-10 w-10 rounded-full hover:bg-muted shrink-0"
        >
          {isGenerating ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5" />
          )}
        </Button>

        {/* Time Display - Current */}
        <span className="text-sm font-medium text-muted-foreground min-w-[40px] shrink-0">
          {formattedCurrentTime}
        </span>

        {/* Progress Slider */}
        <div className="flex-1 min-w-0">
          <Slider
            value={[currentTime]}
            max={duration || 100}
            step={0.1}
            onValueChange={handleSeek}
            className="cursor-pointer"
            disabled={!duration}
          />
        </div>

        {/* Time Display - Duration */}
        <span className="text-sm font-medium text-muted-foreground min-w-[40px] shrink-0">
          {formattedDuration}
        </span>

        {/* Playback Speed Selector */}
        <Select
          value={playbackRate.toString()}
          onValueChange={handleSpeedChange}
        >
          <SelectTrigger className="w-[80px] h-9 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLAYBACK_SPEEDS.map((speed) => (
              <SelectItem key={speed} value={speed.toString()}>
                {speed}x
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

