import { useNavigate } from 'react-router-dom';
import Spline from '@splinetool/react-spline';
import PoweredBy from '../components/common/PoweredBy';
import ThemeToggle from '../components/common/ThemeToggle';
import styles from './WelcomePage.module.css';

export default function WelcomePage() {
  const navigate = useNavigate();
  return (
    <div className={styles.screen}>
      <ThemeToggle className={styles.themeToggle} />
      <div className={styles.sceneWrap}>
        <Spline scene="https://prod.spline.design/bxW7UuZg2uVmhcJd/scene.splinecode" />
      </div>
      <div className={styles.overlay}>
        <button className={styles.cta} onClick={() => navigate('/signin')}>
          Continue
        </button>
        <PoweredBy className={styles.poweredBy} />
      </div>
    </div>
  );
}
