import type { ReactNode } from 'react';
import { useAppState } from '../../context/AppStateContext';
import styles from './NewsTicker.module.css';

/**
 * Items ingested from the company news feed carry a link to the original post; HR's
 * own banners do not, and stay plain text. The marquee duplicates its items to loop
 * seamlessly, so the copies are hidden from assistive tech and taken out of the tab
 * order — otherwise every headline is announced and tabbed through twice.
 */
export default function NewsTicker() {
  const { state } = useAppState();
  const { items } = state.announcements;

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
        <div className={styles.track}>
          {items.map((t) => renderItem(t, `${t.id}`, false))}
          {items.map((t) => renderItem(t, `${t.id}-clone`, true))}
        </div>
      </div>
    </div>
  );
}
