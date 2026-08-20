import { useNavigate } from 'react-router-dom';
import Avatar from '../components/common/Avatar';
import PoweredBy from '../components/common/PoweredBy';
import ThemeToggle from '../components/common/ThemeToggle';
import styles from './WelcomePage.module.css';

export default function WelcomePage() {
  const navigate = useNavigate();
  return (
    <div className={styles.screen}>
      <ThemeToggle className={styles.themeToggle} />
      <div className={styles.heroAvatar}>
        <Avatar size={96} borderWidth={3} className="ring" />
      </div>
      <h1 className={styles.brand}>QBot</h1>
      <p className={styles.tagline}>Employee FAQ Assistant</p>
      <p className={styles.desc}>
        Ask about vacation, expenses, leave, and other policies — get instant answers with citations to the source document.
      </p>
      <div className={styles.badges}>
        <span className={styles.badge}>Sourced answers</span>
        <span className={styles.badge}>Policy citations</span>
        <span className={styles.badge}>Available 24/7</span>
      </div>
      <button className={styles.cta} onClick={() => navigate('/signin')}>
        Sign in to continue
      </button>
      <PoweredBy className={styles.poweredBy} />
    </div>
  );
}
