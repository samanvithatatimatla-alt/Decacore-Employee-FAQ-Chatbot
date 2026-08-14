import { useEffect, useRef } from 'react';
import MessageBubbleUser from './MessageBubbleUser';
import MessageCardBot from './MessageCardBot';
import TypingCard from './TypingCard';
import Composer from './Composer';
import { useAppState } from '../../context/AppStateContext';
import styles from './ChatThread.module.css';

export default function ChatThread() {
  const { state, sendMessage } = useAppState();
  const { messages, isTyping } = state.chat;
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, isTyping]);

  return (
    <div className={styles.wrap}>
      <div className={styles.thread} ref={threadRef}>
        <div className={styles.threadInner}>
          {messages.map((m) =>
            m.role === 'user' ? (
              <MessageBubbleUser key={m.id} text={m.text ?? ''} />
            ) : (
              <MessageCardBot key={m.id} message={m} onFollowUp={sendMessage} />
            ),
          )}
          {isTyping && <TypingCard />}
        </div>
      </div>
      <div className={styles.composerBar}>
        <Composer onSend={sendMessage} autoFocus />
      </div>
      <p className={styles.disclaimer}>AI responses may be inaccurate. Please verify with official policy documents.</p>
    </div>
  );
}
