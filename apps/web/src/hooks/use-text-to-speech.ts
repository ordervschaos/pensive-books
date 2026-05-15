import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';

type PageAudio = Database['public']['Tables']['page_audio']['Row'];

interface UseTextToSpeechProps {
  pageId: number;
  content?: string;
}

interface UseTextToSpeechReturn {
  audioUrl: string | null;
  isGenerating: boolean;
  isPlaying: boolean;
  error: string | null;
  duration: number;
  currentTime: number;
  playbackRate: number;
  generateAudio: () => Promise<void>;
  regenerateAudio: () => Promise<void>;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setPlaybackRate: (rate: number) => void;
}

interface GenerateAudioResponse {
  audioUrl: string;
  duration: number;
}

// Separate audio event handlers for cleaner code
const useAudioElement = (
  setDuration: (duration: number) => void,
  setCurrentTime: (time: number) => void,
  setIsPlaying: (playing: boolean) => void,
  setError: (error: string | null) => void
) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const audio = new Audio();
    audioRef.current = audio;

    const handlers = {
      loadedmetadata: () => setDuration(audio.duration),
      timeupdate: () => setCurrentTime(audio.currentTime),
      ended: () => {
        setIsPlaying(false);
        setCurrentTime(0);
      },
      play: () => setIsPlaying(true),
      pause: () => setIsPlaying(false),
      error: () => {
        setError('Failed to load audio');
        setIsPlaying(false);
      }
    };

    // Register all event listeners
    Object.entries(handlers).forEach(([event, handler]) => {
      audio.addEventListener(event, handler);
    });

    return () => {
      // Cleanup all event listeners
      Object.entries(handlers).forEach(([event, handler]) => {
        audio.removeEventListener(event, handler);
      });
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, [setDuration, setCurrentTime, setIsPlaying, setError]);

  return audioRef;
};

export const useTextToSpeech = ({
  pageId,
  content
}: UseTextToSpeechProps): UseTextToSpeechReturn => {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [audioData, setAudioData] = useState<PageAudio | null>(null);

  // Use custom hook for audio element management
  const audioRef = useAudioElement(setDuration, setCurrentTime, setIsPlaying, setError);

  // Fetch existing audio data
  const fetchAudioData = useCallback(async () => {
    if (!pageId) return;

    try {
      setError(null);
      
      const { data, error: fetchError } = await supabase
        .from('page_audio')
        .select('*')
        .eq('page_id', pageId)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        throw fetchError;
      }

      if (data) {
        setAudioData(data);
        setAudioUrl(data.audio_url);
        
        if (audioRef.current) {
          audioRef.current.src = data.audio_url;
        }
      }
    } catch (err) {
      console.error('Error fetching audio data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch audio data');
    }
  }, [pageId]);

  // Shared function to handle audio generation logic
  const generateAudioInternal = useCallback(async (forceRegenerate: boolean = false) => {
    if (!pageId) return;

    try {
      setIsGenerating(true);
      setError(null);

      // Check if user is authenticated
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User must be authenticated to generate audio');
      }

      const { data, error } = await supabase.functions.invoke('generate-page-audio', {
        body: { pageId, forceRegenerate },
      });

      if (error) {
        throw new Error(error.message || 'Failed to generate audio');
      }

      if (!data) {
        throw new Error('No data returned from function');
      }

      setAudioUrl(data.audioUrl);
      setDuration(data.duration);

      if (audioRef.current) {
        audioRef.current.src = data.audioUrl;
      }

      // Refresh audio data
      // await fetchAudioData();
    } catch (err) {
      console.error('Error generating audio:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate audio');
    } finally {
      setIsGenerating(false);
    }
  }, [pageId, audioRef]);

  // Generate new audio
  const generateAudio = useCallback(() => generateAudioInternal(false), [generateAudioInternal]);

  // Regenerate audio (force new generation even if audio exists)
  const regenerateAudio = useCallback(() => generateAudioInternal(true), [generateAudioInternal]);

  // Play audio
  const play = useCallback(async () => {
    if (!audioRef.current) return;

    try {
      if (!audioUrl) {
        // Generate audio first, then play
        await generateAudio();
        // After generation, try to play if audio is available
        if (audioRef.current && audioRef.current.src) {
          await audioRef.current.play();
        }
        return;
      }

      if (audioRef.current.paused) {
        await audioRef.current.play();
      }
    } catch (err) {
      console.error('Error playing audio:', err);
      setError('Failed to play audio');
    }
  }, [audioUrl, generateAudio]);

  // Pause audio
  const pause = useCallback(() => {
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
    }
  }, []);

  // Stop audio
  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
    }
  }, []);

  // Seek to specific time
  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  // Set playback rate
  const setPlaybackRate = useCallback((rate: number) => {
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
      setPlaybackRateState(rate);
    }
  }, []);

  // Load audio data on mount
  // useEffect(() => {
  //   fetchAudioData();
  // }, [fetchAudioData]);

  return {
    audioUrl,
    isGenerating,
    isPlaying,
    error,
    duration,
    currentTime,
    playbackRate,
    generateAudio,
    regenerateAudio,
    play,
    pause,
    stop,
    seek,
    setPlaybackRate,
  };
};
