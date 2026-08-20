import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAppState } from '../../context/AppStateContext';
import styles from './NewsTicker.module.css';

/**
 * How fast the headlines travel, in CSS pixels per second.
 *
 * Reading speed is a property of the reader, not of how much news there happens to be,
 * so this is the constant and the duration is derived from it. The animation used to
 * be a fixed 70s for one pass of the track, which is the same thing only while the
 * track never changes width — going from three seeded items to nine tripled the
 * distance, and therefore tripled the speed, leaving the bar unreadable.
 *
 * 24px/s reproduces the pace the fixed 70s gave the original three items.
 */
const SCROLL_PX_PER_SECOND = 24;

/**
 * Items ingested from the company news feed carry a link to the original post; HR's
 * own banners do not, and stay plain text. The marquee duplicates its items to loop
 * seamlessly, so the copies are hidden from assistive tech and taken out of the tab
 * order — otherwise every headline is announced and tabbed through twice.
 */
export default function NewsTicker() {
  const { state } = useAppState();
  const { items } = state.announcements;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [duration, setDuration] = useState<number | null>(null);

  // The track holds two copies and the keyframe translates -50%, so one pass covers
  // half the rendered width. Measured rather than counted: headlines vary from a few
  // words to a full sentence, so items-per-second would still drift with the content.
  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const onePass = track.scrollWidth / 2;
    if (onePass > 0) setDuration(onePass / SCROLL_PX_PER_SECOND);
  }, []);

  useEffect(() => {
    measure();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return;
    // Fonts landing after first paint change the width, and so does a resize. Both
    // would otherwise leave the speed set from a stale measurement.
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [measure, items]);

  // Nothing to scroll: an empty track still animates, which reads as a broken bar.
  if (items.length === 0) return null;

  const renderItem = (t: (typeof items)[number], key: string, isClone: boolean): ReactNode => {
    const body: ReactNode = (
      <>
        <span className={styles.itemDate}>{t.date}</span>
        <strong>{t.headline}</strong>
        {t.detail}
      </>
    );

    if (t.url) {
      return (
        <a
          className={`${styles.item} ${styles.linked}`}
          key={key}
          href={t.url}
          target="_blank"
          // noopener defeats the new tab reaching back through window.opener.
          rel="noopener noreferrer"
          // The clones exist only so the marquee can loop; announcing and focusing
          // them would repeat every headline.
          aria-hidden={isClone || undefined}
          tabIndex={isClone ? -1 : undefined}
        >
          {body}
          <span className={styles.bullet} />
        </a>
      );
    }

    return (
      <span className={styles.item} key={key} aria-hidden={isClone || undefined}>
        {body}
        <span className={styles.bullet} />
      </span>
    );
  };

  return (
    <div className={styles.ticker}>
      <span className={styles.tag}>
        <span className={styles.dot} />
        Company News
      </span>
      <div className={styles.viewport}>
        <div
          className={styles.track}
          ref={trackRef}
          // Hold the animation until the first measurement lands, so the bar never
          // flashes past at the CSS fallback speed before settling.
          style={duration ? { animationDuration: `${duration}s` } : { animationPlayState: 'paused' }}
        >
          {items.map((t) => renderItem(t, `${t.id}`, false))}
          {items.map((t) => renderItem(t, `${t.id}-clone`, true))}
        </div>
      </div>
    </div>
  );
}
