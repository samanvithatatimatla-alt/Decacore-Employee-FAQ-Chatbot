import { Clock, Headset, Mail, Phone } from 'lucide-react';
import panel from '../components/common/panel.module.css';
import styles from './ContactPage.module.css';

export default function ContactPage() {
  return (
    <div className={panel.panel} style={{ maxWidth: 900, flex: 1 }}>
      <h1 className={panel.title}>Connect to HR</h1>
      <p className={panel.sub}>Reach the HR team directly for anything the assistant couldn't answer, or for anything urgent.</p>

      <div className={styles.wrap} style={{ padding: 0 }}>
        <div className={styles.card}>
          <div className={styles.iconBadge}>
            <Headset size={21} />
          </div>
          <p className={styles.title}>Need HR urgently?</p>
          <p className={styles.desc}>Reach the team directly.</p>
          <div className={styles.actions}>
            <a className={styles.primary} href="mailto:hr@hrbot.com?subject=HR%20question&body=Hi%20HR%20team%2C%0A%0A">
              Email HR
            </a>
            <a className={styles.secondary} href="https://teams.microsoft.com/l/chat/0/0?users=hr@hrbot.com" target="_blank" rel="noopener noreferrer">
              Message on Teams
            </a>
          </div>
          <div className={styles.stripDivider}>
            <span className={styles.stripItem}>
              <Mail size={14} />
              hr@hrbot.com
            </span>
            <span className={styles.stripItem}>
              <Phone size={14} />
              (555) 019-2200
            </span>
            <span className={styles.stripItem}>
              <Clock size={14} />
              Mon–Fri, 9am–6pm
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
