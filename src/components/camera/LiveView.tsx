// Live view, over Media Source Extensions.
//
// A recorded clip is a complete file and plays from a `<video src>`. A live
// stream is not: the body is an init segment followed by fragments, with no
// length and no end, which is exactly what a SourceBuffer takes and exactly what
// a plain element cannot.
//
// # It is not live, and this component says so
//
// The hub captures a window at a time, so a viewer is about one window behind.
// The delay comes from the response header rather than being hard-coded here —
// a number the server states is one fewer place for the two to drift — and it is
// shown to the person watching. Someone looking at a gate should not have to
// discover the lag by waving at it.

import { useCallback, useEffect, useRef, useState } from 'react';

type Props = { url: string };

type Status =
  | { kind: 'starting' }
  | { kind: 'playing'; delaySeconds: number | null }
  | { kind: 'unsupported' }
  | { kind: 'ended'; reason: string };

/** The codec the hub's muxer writes. Baseline profile, level 3.0. */
const MIME = 'video/mp4; codecs="avc1.42001E"';

export function LiveView({ url }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'starting' });

  const start = useCallback(
    async (video: HTMLVideoElement, signal: AbortSignal) => {
      if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(MIME)) {
        setStatus({ kind: 'unsupported' });
        return;
      }
      const ms = new MediaSource();
      video.src = URL.createObjectURL(ms);
      await new Promise<void>((resolve) =>
        ms.addEventListener('sourceopen', () => resolve(), { once: true }),
      );
      if (signal.aborted) return;

      const sb = ms.addSourceBuffer(MIME);
      // Appends are serialised: a SourceBuffer throws if a second append starts
      // while one is in flight, and fragments arrive faster than they drain on
      // a slow machine.
      const queue: Uint8Array[] = [];
      let appending = false;
      const pump = () => {
        if (appending || queue.length === 0 || sb.updating) return;
        appending = true;
        const next = queue.shift() as Uint8Array;
        try {
          sb.appendBuffer(next as unknown as BufferSource);
        } catch {
          appending = false;
        }
      };
      sb.addEventListener('updateend', () => {
        appending = false;
        pump();
      });

      let res: Response;
      try {
        res = await fetch(url, { credentials: 'include', signal });
      } catch {
        setStatus({ kind: 'ended', reason: 'The connection to this camera closed.' });
        return;
      }
      if (!res.ok || !res.body) {
        setStatus({
          kind: 'ended',
          reason:
            res.status === 403
              ? 'You do not have permission to watch this camera.'
              : 'This camera is not streaming.',
        });
        return;
      }
      const header = res.headers.get('X-Aql-Live-Delay-Seconds');
      const delaySeconds = header ? Number(header) : null;
      setStatus({ kind: 'playing', delaySeconds: Number.isFinite(delaySeconds) ? delaySeconds : null });

      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done || signal.aborted) break;
        if (value) {
          queue.push(value);
          pump();
        }
      }
      setStatus({ kind: 'ended', reason: 'The stream ended. Reopen to watch the current moment.' });
    },
    [url],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const ac = new AbortController();
    void start(video, ac.signal);
    // Aborting the fetch is what tells the hub to drop this viewer — without it
    // the server keeps a subscriber alive for a tab that has moved on.
    return () => ac.abort();
  }, [start]);

  return (
    <div className="space-y-2">
      <video ref={videoRef} autoPlay muted playsInline className="w-full rounded-lg bg-ink" />
      {status.kind === 'playing' && (
        <p className="text-xs text-ink/55">
          {status.delaySeconds
            ? `About ${status.delaySeconds} seconds behind — the hub records a window at a time, so this is recent rather than live.`
            : 'Recent rather than live — the hub records a window at a time.'}
        </p>
      )}
      {status.kind === 'starting' && <p className="text-xs text-ink/55">Connecting…</p>}
      {status.kind === 'unsupported' && (
        <p className="text-xs text-terracotta-deep">
          This browser cannot play H.264 through Media Source Extensions, so live view is
          unavailable here. Recorded clips still play.
        </p>
      )}
      {status.kind === 'ended' && <p className="text-xs text-ink/55">{status.reason}</p>}
    </div>
  );
}
