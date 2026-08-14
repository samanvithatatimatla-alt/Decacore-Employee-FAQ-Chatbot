import { forwardRef, useState } from 'react';
import styles from './Composer.module.css';

interface ComposerProps {
  onSend: (text: string) => void;
  autoFocus?: boolean;
}

const Composer = forwardRef<HTMLInputElement, ComposerProps>(function Composer({ onSend, autoFocus }, ref) {
  const [value, setValue] = useState('');

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
  };

  return (
    <div className={styles.composer}>
      <input
        ref={ref}
        className={styles.input}
        placeholder="Ask about vacation, expenses, leave…"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button className={styles.send} onClick={submit}>
        Send
      </button>
    </div>
  );
});

export default Composer;
