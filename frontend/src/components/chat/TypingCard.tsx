import Avatar from '../common/Avatar';
import styles from './TypingCard.module.css';

export default function TypingCard() {
  return (
    <div className={styles.botRow}>
      <Avatar size={36} />
      <div className={styles.typingCard}>
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
      </div>
    </div>
  );
}
