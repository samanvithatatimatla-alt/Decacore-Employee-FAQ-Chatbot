/**
 * Paces streamed text onto the screen at a steady rate.
 *
 * The network does not deliver text evenly. Model tokens arrive in bursts of several
 * words, and the scripted replies to greetings arrive as a single chunk, so rendering
 * each frame's arrivals directly produces a mix of stutter and instant paragraphs.
 * This sits between the stream and the reducer: chunks go into a queue, and a fixed
 * number of characters leave it per animation frame.
 *
 * The queue is drained faster the further behind it gets, so a long answer never
 * lags meaningfully behind the network — the pacing shapes how text appears without
 * becoming the thing you are waiting on. `flush` empties it at once, for when the
 * stream has ended and correctness beats appearance.
 */

/** Characters per frame at ~60fps: fast enough to read along with, not a data dump. */
const BASE_CHARS_PER_FRAME = 3;

/** Backlog above which the drain accelerates, in characters. */
const CATCH_UP_THRESHOLD = 120;

export interface Typewriter {
  push(text: string): void;
  /** Render everything still queued, immediately. */
  flush(): void;
  /** Drop what is queued and stop. For aborted or errored streams. */
  cancel(): void;
}

export function createTypewriter(onText: (text: string) => void): Typewriter {
  let queue = '';
  let frame: number | null = null;

  const stop = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };

  const tick = () => {
    frame = null;
    if (!queue) return;
    // A big backlog means the model is ahead of the animation; take proportionally
    // more so the gap closes instead of growing for the rest of the answer.
    const take = queue.length > CATCH_UP_THRESHOLD
      ? Math.ceil(queue.length / 12)
      : BASE_CHARS_PER_FRAME;
    onText(queue.slice(0, take));
    queue = queue.slice(take);
    if (queue) frame = requestAnimationFrame(tick);
  };

  return {
    push(text: string) {
      queue += text;
      if (frame === null) frame = requestAnimationFrame(tick);
    },
    flush() {
      stop();
      if (queue) {
        onText(queue);
        queue = '';
      }
    },
    cancel() {
      stop();
      queue = '';
    },
  };
}
