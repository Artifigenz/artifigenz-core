'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  audioCacheKey,
  getCachedAudio,
  setCachedAudio,
} from '../../lib/audio-cache';
import { markdownToSpeech } from '../../lib/markdown-to-speech';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export type ReadAloudStatus =
  | 'idle'
  | 'generating'
  | 'playing'
  | 'paused'
  | 'error';

export interface ReadAloudController {
  activeId: string | null;
  status: ReadAloudStatus;
  currentTime: number;
  /** Known duration once stream completes; 0 while streaming. */
  duration: number;
  /** End of the buffered range — how far the user can skip forward right now. */
  bufferedEnd: number;
  /** True when the full file has arrived (no more bytes coming). */
  streamComplete: boolean;
  rate: number;
  voice: string;
  start: (messageId: string, text: string) => Promise<void>;
  toggle: () => void;
  /** Skip by delta seconds (negative = back). Forward skips clamp to buffered. */
  skip: (deltaSec: number) => void;
  setRate: (r: number) => void;
  /** Change voice. If a message is currently active, the player stays open
   *  and re-streams the same text with the new voice. */
  setVoice: (v: string) => void;
  stop: () => void;
}

const DEFAULT_VOICE = 'jon_hamm';
const MIME = 'audio/mpeg';

function supportsMediaSource(): boolean {
  if (typeof window === 'undefined') return false;
  const MS = (
    window as unknown as {
      MediaSource?: typeof MediaSource & {
        isTypeSupported: (mime: string) => boolean;
      };
    }
  ).MediaSource;
  return Boolean(
    MS && typeof MS.isTypeSupported === 'function' && MS.isTypeSupported(MIME),
  );
}

export function useReadAloudPlayer(): ReadAloudController {
  const { getToken } = useAuth();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<ReadAloudStatus>('idle');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [streamComplete, setStreamComplete] = useState(false);
  const [rate, setRateState] = useState(1);
  const [voice, setVoiceState] = useState(DEFAULT_VOICE);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  // Incremented on every new start() / stop() — lets in-flight streams know
  // they've been cancelled.
  const requestTokenRef = useRef(0);
  // Remember the cleaned text for the active message so voice-swap can
  // re-stream without the caller passing text again.
  const activeTextRef = useRef<string>('');

  const teardownAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    audioRef.current = null;

    const ms = mediaSourceRef.current;
    if (ms) {
      try {
        if (ms.readyState === 'open') ms.endOfStream();
      } catch {
        /* already ended */
      }
      mediaSourceRef.current = null;
    }

    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    requestTokenRef.current += 1;
    teardownAudio();
    setActiveId(null);
    setStatus('idle');
    setCurrentTime(0);
    setDuration(0);
    setBufferedEnd(0);
    setStreamComplete(false);
    activeTextRef.current = '';
  }, [teardownAudio]);

  useEffect(() => {
    return () => {
      requestTokenRef.current += 1;
      teardownAudio();
    };
  }, [teardownAudio]);

  const attachListeners = useCallback(
    (audio: HTMLAudioElement, initialRate: number) => {
      audio.playbackRate = initialRate;
      audio.preload = 'auto';

      const onTime = () => {
        setCurrentTime(audio.currentTime);
        if (audio.buffered.length > 0) {
          setBufferedEnd(audio.buffered.end(audio.buffered.length - 1));
        }
      };
      const onLoadedMeta = () => {
        if (isFinite(audio.duration) && audio.duration > 0) {
          setDuration(audio.duration);
        }
      };
      const onDurationChange = () => {
        if (isFinite(audio.duration) && audio.duration > 0) {
          setDuration(audio.duration);
        }
      };
      const onProgress = () => {
        if (audio.buffered.length > 0) {
          setBufferedEnd(audio.buffered.end(audio.buffered.length - 1));
        }
      };
      const onPlay = () => setStatus('playing');
      const onPause = () => {
        if (
          audio.currentTime > 0 &&
          audio.currentTime < (audio.duration || Infinity)
        ) {
          setStatus('paused');
        }
      };
      const onEnded = () => {
        setStatus('paused');
        setCurrentTime(audio.duration);
      };
      const onError = () => setStatus('error');

      audio.addEventListener('timeupdate', onTime);
      audio.addEventListener('loadedmetadata', onLoadedMeta);
      audio.addEventListener('durationchange', onDurationChange);
      audio.addEventListener('progress', onProgress);
      audio.addEventListener('play', onPlay);
      audio.addEventListener('pause', onPause);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
    },
    [],
  );

  // Core: open the player for (messageId, text, voice). Always tears down
  // any previous playback first.
  const playFor = useCallback(
    async (messageId: string, text: string, voiceToUse: string) => {
      const token = ++requestTokenRef.current;
      teardownAudio();
      setActiveId(messageId);
      setStatus('generating');
      setCurrentTime(0);
      setDuration(0);
      setBufferedEnd(0);
      setStreamComplete(false);
      activeTextRef.current = text;

      try {
        // Fast path: cached blob → instant playback.
        const key = await audioCacheKey(text, voiceToUse);
        const cached = await getCachedAudio(key);
        if (token !== requestTokenRef.current) return;

        if (cached) {
          const url = URL.createObjectURL(cached);
          urlRef.current = url;
          const audio = new Audio(url);
          attachListeners(audio, rate);
          audioRef.current = audio;
          setStreamComplete(true);
          await audio.play();
          return;
        }

        // Cold path: fetch from the API.
        const jwt = await getToken();
        const res = await fetch(`${API_URL}/api/me/tts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
          },
          body: JSON.stringify({ text, voice: voiceToUse }),
        });
        if (token !== requestTokenRef.current) return;
        if (!res.ok || !res.body) throw new Error(`tts ${res.status}`);

        const reader = res.body.getReader();
        const collected: BlobPart[] = [];

        if (!supportsMediaSource()) {
          // Fallback (Safari etc.): buffer the full file then play.
          while (true) {
            const { done, value } = await reader.read();
            if (token !== requestTokenRef.current) return;
            if (done) break;
            if (value) collected.push(value);
          }
          const blob = new Blob(collected, { type: MIME });
          void setCachedAudio(key, blob);
          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          const audio = new Audio(url);
          attachListeners(audio, rate);
          audioRef.current = audio;
          setStreamComplete(true);
          await audio.play();
          return;
        }

        // MSE streaming path: play as bytes arrive.
        const mediaSource = new MediaSource();
        mediaSourceRef.current = mediaSource;
        const url = URL.createObjectURL(mediaSource);
        urlRef.current = url;
        const audio = new Audio(url);
        attachListeners(audio, rate);
        audioRef.current = audio;

        await new Promise<void>((resolve, reject) => {
          mediaSource.addEventListener('sourceopen', () => resolve(), {
            once: true,
          });
          mediaSource.addEventListener('error', reject, { once: true });
        });
        if (token !== requestTokenRef.current) return;

        const sourceBuffer = mediaSource.addSourceBuffer(MIME);

        const appendChunk = (chunk: Uint8Array) =>
          new Promise<void>((resolve, reject) => {
            const onDone = () => {
              sourceBuffer.removeEventListener('updateend', onDone);
              sourceBuffer.removeEventListener('error', onErr);
              resolve();
            };
            const onErr = (e: Event) => {
              sourceBuffer.removeEventListener('updateend', onDone);
              sourceBuffer.removeEventListener('error', onErr);
              reject(e);
            };
            sourceBuffer.addEventListener('updateend', onDone);
            sourceBuffer.addEventListener('error', onErr);
            sourceBuffer.appendBuffer(chunk as BufferSource);
          });

        let started = false;
        while (true) {
          const { done, value } = await reader.read();
          if (token !== requestTokenRef.current) return;
          if (done) break;
          if (!value) continue;
          collected.push(value);
          await appendChunk(value);
          if (token !== requestTokenRef.current) return;
          if (!started) {
            started = true;
            // Kick off playback as soon as the first chunk lands.
            void audio.play().catch(() => setStatus('error'));
          }
        }

        if (token !== requestTokenRef.current) return;
        if (mediaSource.readyState === 'open') {
          try {
            mediaSource.endOfStream();
          } catch {
            /* race with teardown */
          }
        }
        setStreamComplete(true);

        // Cache the assembled file for next time.
        const blob = new Blob(collected, { type: MIME });
        void setCachedAudio(key, blob);
      } catch (err) {
        if (token !== requestTokenRef.current) return;
        console.error('[readAloud] failed:', err);
        setStatus('error');
      }
    },
    [attachListeners, getToken, rate, teardownAudio],
  );

  const start = useCallback(
    async (messageId: string, rawText: string) => {
      const text = markdownToSpeech(rawText);
      if (!text) return;
      // Same message already loaded → just resume.
      if (activeId === messageId && audioRef.current) {
        try {
          await audioRef.current.play();
        } catch {
          setStatus('error');
        }
        return;
      }
      await playFor(messageId, text, voice);
    },
    [activeId, playFor, voice],
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setStatus('error'));
    } else {
      audio.pause();
    }
  }, []);

  const skip = useCallback((deltaSec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const maxAvailable =
      audio.buffered.length > 0
        ? audio.buffered.end(audio.buffered.length - 1)
        : audio.duration || 0;
    const next = Math.max(
      0,
      Math.min(maxAvailable, audio.currentTime + deltaSec),
    );
    audio.currentTime = next;
    setCurrentTime(next);
  }, []);

  const setRate = useCallback((r: number) => {
    setRateState(r);
    if (audioRef.current) audioRef.current.playbackRate = r;
  }, []);

  const setVoice = useCallback(
    (v: string) => {
      if (v === voice) return;
      setVoiceState(v);
      // Keep the player open; re-stream the same text with the new voice.
      if (activeId && activeTextRef.current) {
        void playFor(activeId, activeTextRef.current, v);
      }
    },
    [activeId, playFor, voice],
  );

  return {
    activeId,
    status,
    currentTime,
    duration,
    bufferedEnd,
    streamComplete,
    rate,
    voice,
    start,
    toggle,
    skip,
    setRate,
    setVoice,
    stop,
  };
}
