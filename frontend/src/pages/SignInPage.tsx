import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Avatar from '../components/common/Avatar';
import { useAuth } from '../context/AuthContext';
import styles from './SignInPage.module.css';

export default function SignInPage() {
  const navigate = useNavigate();
  const { signIn, signingIn, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const completeSignIn = async (value: string) => {
    const role = /admin|maya|hr/i.test(value) ? 'hr_admin' : 'employee';
    try {
      // Await before navigating: the app shell loads data as soon as it mounts, and
      // it needs an identity to load anything role-scoped.
      await signIn(role);
      navigate('/chat');
    } catch {
      // Message is surfaced from context below.
    }
  };

  const handleMicrosoftSignIn = () => {
    void completeSignIn('sam@bluepeak.com');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void completeSignIn(email || password ? email : 'sam@bluepeak.com');
  };

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <Avatar size={52} />
        <h2 className={styles.title}>Sign in to QBot</h2>
        <p className={styles.sub}>Use your company account to continue</p>

        <button className={styles.msBtn} onClick={handleMicrosoftSignIn} type="button" disabled={signingIn}>
          <span className={styles.msLogo}>
            <span />
            <span />
            <span />
            <span />
          </span>
          Sign in with Microsoft
        </button>
        <p className={styles.msCaption}>Secure sign-in with Microsoft Entra ID</p>

        <div className={styles.dividerRow}>
          <div className={styles.line} />
          <span>OR</span>
          <div className={styles.line} />
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.fieldLabel}>
            Email
            <input type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className={styles.fieldLabel}>
            Password
            <input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className={styles.submit} type="submit" disabled={signingIn}>
            {signingIn ? 'Signing in…' : 'Sign in'}
          </button>
          {error && (
            <p className={styles.hint} style={{ color: '#b42318' }} role="alert">
              {error}
            </p>
          )}
          <p className={styles.hint}>Demo: use an email containing "admin" to preview the HR admin experience.</p>
        </form>

        <button className={styles.backLink} onClick={() => navigate('/')}>
          ← Back to welcome
        </button>
      </div>
    </div>
  );
}
