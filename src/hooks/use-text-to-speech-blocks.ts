import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface AudioBlockData {
  blockIndex: number;
  blockType: string;
  textContent: string;
  audioUrl: string;
  duration: number;
  startTime: number;
  endTime: number;
}

interface UseTextToSpeechBlocksProps {
  pageId: number;
  content?: any; // TipTap JSON content
}

interface UseTextToSpeechBlocksReturn {
  isGenerating: boolean;
  isPlaying: boolean;
  error: string | null;
  duration: number;
  currentTime: number;
  playbackRate: number;
  currentBlockIndex: number | null;
  blocks: AudioBlockData[];
  generateAudio: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setPlaybackRate: (rate: number) => void;
  playBlockByIndex: (blockIndex: number) => Promise<void>;
}

export const useTextToSpeechBlocks = ({
  pageId,
  content
}: UseTextToSpeechBlocksProps): UseTextToSpeechBlocksReturn => {
  const [blocks, setBlocks] = useState<AudioBlockData[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [currentBlockIndex, setCurrentBlockIndex] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentBlockIndexRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);

  // Initialize audio element
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    const handleEnded = () => {
      // Play next block
      const nextIndex = currentBlockIndexRef.current + 1;
      if (nextIndex < blocks.length) {
        playBlockAtIndex(nextIndex);
      } else {
        // End of playback
        setIsPlaying(false);
        isPlayingRef.current = false;
        setCurrentTime(duration);
        setCurrentBlockIndex(null);
      }
    };

    const handleTimeUpdate = () => {
      const currentBlock = blocks[currentBlockIndexRef.current];
      if (currentBlock && audioRef.current) {
        const blockProgress = audioRef.current.currentTime;
        const totalProgress = currentBlock.startTime + blockProgress;
        setCurrentTime(totalProgress);
      }
    };

    const handlePlay = () => {
      setIsPlaying(true);
      isPlayingRef.current = true;
    };

    const handlePause = () => {
      setIsPlaying(false);
      isPlayingRef.current = false;
    };

    const handleError = () => {
      setError('Failed to load audio');
      setIsPlaying(false);
      isPlayingRef.current = false;
    };

    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('error', handleError);
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, [blocks, duration]);

  // Calculate total duration from blocks
  useEffect(() => {
    if (blocks.length > 0) {
      const lastBlock = blocks[blocks.length - 1];
      setDuration(lastBlock.endTime);
    }
  }, [blocks]);

  // Fetch existing blocks from database
  const fetchBlocks = useCallback(async () => {
    if (!pageId) return;

    try {
      const { data, error: fetchError } = await supabase
        .from('page_audio_blocks')
        .select('*')
        .eq('page_id', pageId)
        .order('block_index', { ascending: true });

      if (fetchError) {
        throw fetchError;
      }

      if (data && data.length > 0) {
        const audioBlocks: AudioBlockData[] = data.map((block: any) => ({
          blockIndex: block.block_index,
          blockType: block.block_type,
          textContent: block.text_content,
          audioUrl: block.audio_url,
          duration: block.duration,
          startTime: block.start_time,
          endTime: block.end_time,
        }));
        setBlocks(audioBlocks);
      }
    } catch (err) {
      console.error('Error fetching audio blocks:', err);
    }
  }, [pageId]);

  // Load blocks on mount
  useEffect(() => {
    fetchBlocks();
  }, [fetchBlocks]);

  // Play block at specific index
  const playBlockAtIndex = useCallback(async (index: number) => {
    if (!audioRef.current || index >= blocks.length) return;

    const block = blocks[index];
    currentBlockIndexRef.current = index;
    setCurrentBlockIndex(index);

    try {
      audioRef.current.src = block.audioUrl;
      audioRef.current.playbackRate = playbackRate;
      await audioRef.current.play();
    } catch (err) {
      console.error('Error playing block:', err);
      setError('Failed to play audio');
    }
  }, [blocks, playbackRate]);

  // Generate audio blocks
  const generateAudio = useCallback(async () => {
    if (!pageId) return;

    try {
      setIsGenerating(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User must be authenticated to generate audio');
      }

      // Call the edge function to generate all blocks
      const { data, error } = await supabase.functions.invoke('generate-page-audio-blocks', {
        body: { pageId },
      });

      if (error) {
        throw new Error(error.message || 'Failed to generate audio');
      }

      if (!data || !data.blocks) {
        throw new Error('No blocks returned from function');
      }

      // Update blocks state
      setBlocks(data.blocks);
      setDuration(data.totalDuration);
    } catch (err) {
      console.error('Error generating audio:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate audio');
    } finally {
      setIsGenerating(false);
    }
  }, [pageId]);

  // Play from current position or start
  const play = useCallback(async () => {
    if (!audioRef.current) return;

    try {
      if (blocks.length === 0) {
        // Generate audio first
        await generateAudio();
        return;
      }

      // Determine which block to play based on currentTime
      let targetBlockIndex = 0;
      for (let i = 0; i < blocks.length; i++) {
        if (currentTime >= blocks[i].startTime && currentTime < blocks[i].endTime) {
          targetBlockIndex = i;
          break;
        } else if (currentTime >= blocks[blocks.length - 1].endTime) {
          // If at the end, restart from beginning
          targetBlockIndex = 0;
          setCurrentTime(0);
          break;
        }
      }

      await playBlockAtIndex(targetBlockIndex);
    } catch (err) {
      console.error('Error playing audio:', err);
      setError('Failed to play audio');
    }
  }, [blocks, currentTime, generateAudio, playBlockAtIndex]);

  // Pause playback
  const pause = useCallback(() => {
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
    }
  }, []);

  // Stop playback and reset
  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
      setCurrentBlockIndex(null);
      currentBlockIndexRef.current = 0;
    }
  }, []);

  // Seek to specific time
  const seek = useCallback((time: number) => {
    if (!audioRef.current || blocks.length === 0) return;

    // Find the block that contains this time
    let targetBlockIndex = 0;
    for (let i = 0; i < blocks.length; i++) {
      if (time >= blocks[i].startTime && time < blocks[i].endTime) {
        targetBlockIndex = i;
        break;
      }
    }

    const block = blocks[targetBlockIndex];
    const blockOffset = time - block.startTime;

    currentBlockIndexRef.current = targetBlockIndex;
    setCurrentBlockIndex(targetBlockIndex);
    setCurrentTime(time);

    if (audioRef.current.src !== block.audioUrl) {
      audioRef.current.src = block.audioUrl;
    }
    audioRef.current.currentTime = blockOffset;

    if (isPlayingRef.current) {
      audioRef.current.play().catch(err => {
        console.error('Error seeking:', err);
      });
    }
  }, [blocks]);

  // Set playback rate
  const setPlaybackRate = useCallback((rate: number) => {
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
      setPlaybackRateState(rate);
    }
  }, []);

  // Play specific block by index (for click-to-play feature)
  const playBlockByIndex = useCallback(async (blockIndex: number) => {
    if (!audioRef.current || blocks.length === 0) {
      // If no blocks loaded yet, try to generate first
      if (blocks.length === 0) {
        await generateAudio();
      }
      return;
    }

    // Find the block with matching index
    const targetBlock = blocks.find(b => b.blockIndex === blockIndex);
    if (!targetBlock) {
      console.warn(`Block with index ${blockIndex} not found`);
      return;
    }

    // Find the position in the blocks array
    const arrayIndex = blocks.indexOf(targetBlock);
    if (arrayIndex === -1) return;

    // Start playing from this block
    await playBlockAtIndex(arrayIndex);
  }, [blocks, generateAudio, playBlockAtIndex]);

  return {
    isGenerating,
    isPlaying,
    error,
    duration,
    currentTime,
    playbackRate,
    currentBlockIndex,
    blocks,
    generateAudio,
    play,
    pause,
    stop,
    seek,
    setPlaybackRate,
    playBlockByIndex,
  };
};

