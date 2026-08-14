import styles from './MessageBubbleUser.module.css';

export default function MessageBubbleUser({ text }: { text: string }) {
  return (
    <div className={styles.row}>
      <div className={styles.bubble}>{text}</div>
    </div>
  );
}
