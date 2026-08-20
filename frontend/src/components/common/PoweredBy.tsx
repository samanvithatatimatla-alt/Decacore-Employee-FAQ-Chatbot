import styles from './PoweredBy.module.css';

/**
 * Build attribution for the two pre-auth screens.
 *
 * Only shown before sign-in: once someone is in the app the chrome is theirs, and a
 * build credit on every screen is noise. Shared rather than written into both pages so
 * the wording and spacing cannot drift apart.
 */
export default function PoweredBy({ className }: { className?: string }) {
  return (
    <p className={className ? `${styles.root} ${className}` : styles.root}>
      Powered by <span className={styles.name}>DecaCore</span>
    </p>
  );
}
