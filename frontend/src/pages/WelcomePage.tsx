import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import SplineHero from '../components/layout/SplineHero';
import { POWERED_BY } from '../components/common/PoweredBy';
import '@phosphor-icons/web/regular';
import { useTheme } from '../context/ThemeContext';
import styles from './WelcomePage.module.css';

export default function WelcomePage() {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const pageRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = pageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    el.style.setProperty('--my', `${e.clientY - rect.top}px`);
  };

  return (
    <div className={styles.page} ref={pageRef} onMouseMove={handleMouseMove}>
      <div className={styles.bgDots} />
      <div className={styles.bgGlow} />

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.brandGroup}>
            <span className={styles.wordmark}>QBot</span>
            <span className={styles.tagline}>Employee FAQ Assistant</span>
          </div>
          <button
            className={styles.themeBtn}
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <i className={theme === 'dark' ? 'ph ph-sun' : 'ph ph-moon'} aria-hidden />
          </button>
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroLeft}>
          <span className={styles.pill}>
            <i className="ph ph-sparkle" aria-hidden />
            Grounded in your handbook
          </span>
          <h1 className={styles.h1}>
            Ask anything about
            <br />
            working here.
          </h1>
          <p className={styles.sub}>
            Vacation, expenses, leave, and every other policy — answered instantly, with a citation back to the source
            document.
          </p>
          <button className={styles.cta} onClick={() => navigate('/signin')}>
            Get started
            <i className="ph ph-arrow-right" aria-hidden />
          </button>
        </div>

        <div className={styles.heroRight}>
          <div className={styles.orbWrap}>
            <div className={styles.ringOuter}>
              <span className={styles.ringDot} />
            </div>
            <div className={styles.ringInner} />
            <div className={styles.glow} />
            <div className={styles.slot} data-spline-slot="hero">
              <SplineHero />
            </div>
            <span className={styles.floatDot1} />
            <span className={styles.floatDot2} />
            <span className={styles.floatDot3} />
          </div>
        </div>
      </section>

      <section className={styles.features}>
        <div className={styles.card}>
          <i className={`ph ph-quotes ${styles.cardIcon}`} aria-hidden />
          <h3 className={styles.cardTitle}>Sourced answers</h3>
        </div>
        <div className={styles.card}>
          <i className={`ph ph-file-text ${styles.cardIcon}`} aria-hidden />
          <h3 className={styles.cardTitle}>Policy citations</h3>
        </div>
        <div className={styles.card}>
          <i className={`ph ph-clock-counter-clockwise ${styles.cardIcon}`} aria-hidden />
          <h3 className={styles.cardTitle}>Available 24/7</h3>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          Powered by <span className={styles.footerName}>{POWERED_BY}</span>
        </div>
      </footer>
    </div>
  );
}
