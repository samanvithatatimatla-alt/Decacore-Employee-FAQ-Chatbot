import styles from './PoweredBy.module.css';

/**
 * Who the app is attributed to, in one place.
 *
 * The landing page renders its own footer rather than using the component below —
 * different layout, its own max-width and padding — so the string has to be shared
 * or the two drift. They already had: this said "DecaCore" while the landing page
 * said "Decacore".
 */
export const POWERED_BY = 'BluePeak Technologies';

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
      Powered by <span className={styles.name}>{POWERED_BY}</span>
    </p>
  );
}
