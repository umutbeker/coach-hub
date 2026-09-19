'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { youtubeId, isDirectVideo } from '../../lib/vod';

export type PlayerHandle = {
  /** Current playback position in seconds (0 before the player is ready). */
  time: () => number;
  /** Jump to a position and start playing. */
  seek: (sec: number) => void;
};

// Minimal slice of the YouTube IFrame API we use.
type YTPlayer = { getCurrentTime: () => number; seekTo: (s: number, allowSeekAhead: boolean) => void; playVideo: () => void; destroy: () => void };
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: object) => YTPlayer; PlayerState?: unknown };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApi: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (!ytApi) {
    ytApi = new Promise(resolve => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
  }
  return ytApi;
}

/**
 * Plays a VOD and exposes time()/seek() so notes can jump to a timestamp.
 * YouTube links go through the IFrame API (a plain embed can't be seeked from
 * outside); direct video files use <video>. Anything else — Twitch, Drive —
 * can't be controlled from the page, so it's offered as an outside link.
 */
const VideoPlayer = forwardRef<PlayerHandle, { url: string; start?: number; onReady?: () => void }>(
  function VideoPlayer({ url, start = 0, onReady }, ref) {
    const host = useRef<HTMLDivElement>(null);
    const yt = useRef<YTPlayer | null>(null);
    const video = useRef<HTMLVideoElement>(null);
    const [failed, setFailed] = useState(false);
    const ytId = youtubeId(url);
    const direct = !ytId && isDirectVideo(url);

    useImperativeHandle(ref, () => ({
      time: () => {
        if (yt.current) { try { return yt.current.getCurrentTime() || 0; } catch { return 0; } }
        return video.current?.currentTime ?? 0;
      },
      seek: (sec: number) => {
        if (yt.current) { yt.current.seekTo(sec, true); yt.current.playVideo(); return; }
        if (video.current) { video.current.currentTime = sec; void video.current.play().catch(() => {}); }
      },
    }), []);

    useEffect(() => {
      if (!ytId || !host.current) return;
      let cancelled = false;
      const mount = document.createElement('div');
      host.current.appendChild(mount);
      loadYouTubeApi().then(() => {
        if (cancelled || !window.YT) return;
        yt.current = new window.YT.Player(mount, {
          videoId: ytId,
          width: '100%',
          height: '100%',
          playerVars: { start: Math.floor(start), rel: 0, modestbranding: 1 },
          events: {
            onReady: () => onReady?.(),
            onError: () => setFailed(true),
          },
        });
      }).catch(() => setFailed(true));
      return () => {
        cancelled = true;
        try { yt.current?.destroy(); } catch { /* already gone */ }
        yt.current = null;
        mount.remove();
      };
      // start/onReady are read once at mount; a new url remounts the player.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ytId]);

    const frame: React.CSSProperties = { position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000', borderRadius: 'var(--r-card)', overflow: 'hidden', border: '1px solid var(--border)' };

    if (ytId) {
      return (
        <div style={frame}>
          <div ref={host} style={{ position: 'absolute', inset: 0 }} className="yt-host" />
          {failed ? <div className="empty" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>This video can’t be played here. It may be private or removed.</div> : null}
          <style>{`.yt-host iframe{width:100%;height:100%;display:block;border:0;}`}</style>
        </div>
      );
    }
    if (direct) {
      return (
        <div style={frame}>
          <video ref={video} src={url} controls preload="metadata" style={{ width: '100%', height: '100%', display: 'block' }}
            onLoadedMetadata={() => { if (start && video.current) video.current.currentTime = start; onReady?.(); }}
            onError={() => setFailed(true)} />
          {failed ? <div className="empty" style={{ position: 'absolute', inset: 0 }}>This video file could not be loaded.</div> : null}
        </div>
      );
    }
    return (
      <div style={{ ...frame, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center' }}>
        <div style={{ fontWeight: 500 }}>This link can’t be embedded</div>
        <div className="t2" style={{ fontSize: 14, maxWidth: 420 }}>
          Timestamps only jump inside the page for YouTube links and direct video files. Notes still work — open the video alongside.
        </div>
        <a className="btn" href={url} target="_blank" rel="noreferrer">Open video</a>
      </div>
    );
  },
);

export default VideoPlayer;
