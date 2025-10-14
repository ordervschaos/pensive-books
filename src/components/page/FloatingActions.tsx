import { Button } from "@/components/ui/button";
import { Pencil, Check, MessageSquare, Volume2, VolumeX, Loader2 } from "lucide-react";
import { FloatingAudioPlayer } from "./FloatingAudioPlayer";

interface FloatingActionsProps {
  // Edit/Preview props
  isEditing: boolean;
  onToggleEdit?: () => void;
  canEdit: boolean;
  
  // Chat props
  onToggleChat?: () => void;
  hasActiveChat?: boolean;
  
  // Audio props
  pageId?: string;
  content: string;
  audioState?: any; // Audio state from parent
}

export const FloatingActions = ({
  isEditing,
  onToggleEdit,
  canEdit,
  onToggleChat,
  hasActiveChat,
  pageId,
  content,
  audioState
}: FloatingActionsProps) => {
  const isBetaEnabled = localStorage.getItem('is_beta') === 'true';
  
  // Use provided audio state if available
  const {
    audioUrl,
    isGenerating,
    isPlaying,
    duration,
    currentTime,
    playbackRate,
    play,
    pause,
    seek,
    setPlaybackRate,
  } = audioState || {};

  const handleAudioToggle = async () => {
    if (!play || !pause) return;
    
    if (isPlaying) {
      pause();
    } else {
      await play();
    }
  };

  return (
    <>
      <div className="fixed bottom-12 z-50 flex flex-col gap-3 items-center" style={{ left: 'calc(50% + min(48rem, 100vw) / 2 - 1rem)' }}>
        {/* Audio button - only in beta */}
        {isBetaEnabled && pageId && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleAudioToggle}
            disabled={isGenerating}
            className={`rounded-full h-10 w-10 p-0 shadow-lg bg-background hover:bg-muted transition-all duration-200 ${isPlaying ? 'bg-muted' : ''}`}
            title={isGenerating ? "Generating audio..." : isPlaying ? "Pause audio" : audioUrl ? "Play audio" : "Generate audio"}
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isPlaying ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </Button>
        )}

        {/* Chat button - only in beta */}
        {onToggleChat && isBetaEnabled && (
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleChat}
            className={`rounded-full h-10 w-10 p-0 shadow-lg bg-background hover:bg-muted transition-all duration-200 ${hasActiveChat ? 'bg-muted' : ''}`}
            title="Toggle chat"
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
        )}

        {/* Edit/Preview button - always visible when editable */}
        {canEdit && (
          <Button
            variant="default"
            size="sm"
            onClick={onToggleEdit}
            className="rounded-full h-10 w-10 p-0 shadow-lg hover:bg-primary/90 transition-all duration-200"
            title={isEditing ? "Preview" : "Edit"}
          >
            {isEditing ? (
              <Check className="h-4 w-4" />
            ) : (
              <Pencil className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>

      {/* Floating Audio Player - only in beta */}
      {isBetaEnabled && pageId && (
        <FloatingAudioPlayer 
          isGenerating={isGenerating}
          isPlaying={isPlaying}
          duration={duration}
          currentTime={currentTime}
          playbackRate={playbackRate}
          play={play}
          pause={pause}
          seek={seek}
          setPlaybackRate={setPlaybackRate}
        />
      )}
    </>
  );
};

