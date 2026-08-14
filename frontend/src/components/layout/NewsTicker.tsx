import { useAppState } from '../../context/AppStateContext';
import styles from './NewsTicker.module.css';

export default function NewsTicker() {
  const { state } = useAppState();
  const { items } = state.announcements;
  const loopItems = [...items, ...items];

  return (
    <div className={styles.ticker}>
      <span className={styles.tag}>
        <span className={styles.dot} />
        BluePeak News
      </span>
      <div className={styles.viewport}>
        <div className={styles.track}>
          {loopItems.map((t, i) => (
            <span className={styles.item} key={`${t.id}-${i}`}>
              <span className={styles.itemDate}>{t.date}</span>
              <strong>{t.headline}</strong>
              {t.detail}
              <span className={styles.bullet} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
