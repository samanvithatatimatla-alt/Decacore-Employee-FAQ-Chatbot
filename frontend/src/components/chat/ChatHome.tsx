import Avatar from '../common/Avatar';
import Composer from './Composer';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import styles from './ChatHome.module.css';

export default function ChatHome() {
  const { user } = useAuth();
  const { sendMessage, state } = useAppState();
  // Real top questions once people have asked some; otherwise starters, because an
  // empty suggestion row makes the landing screen look broken.
  const suggestions = state.topQuestions.length
    ? state.topQuestions.slice(0, 3).map((q) => q.text)
    : [
        'How much parental leave do employees get?',
        'What is the remote work policy?',
        'How do I claim travel expenses?',
      ];
  if (!user) return null;

  return (
    <div className={styles.chatHome}>
      <Avatar size={80} borderWidth={3} />
      <h2 className={styles.greeting}>Welcome, {user.firstName}. How can I help you today?</h2>
      <p className={styles.note}>Answers and resources are personalized for your role — {user.title}.</p>
      <div className={styles.composerWrap}>
        <Composer onSend={sendMessage} />
      </div>
      <div className={styles.faqBlock}>
        <div>
          <p className={styles.faqLabel}>Top 3 Frequently Asked Questions</p>
          <div className={styles.suggestions}>
            {suggestions.map((q) => (
              <button className={styles.chip} key={q} onClick={() => sendMessage(q)}>
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
