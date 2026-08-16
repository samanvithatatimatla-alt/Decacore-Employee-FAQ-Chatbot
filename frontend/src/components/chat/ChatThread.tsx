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

  // The reply bubble is appended the moment the message is sent, so until the first
  // token lands it is an empty card sitting next to the typing dots. Treat that
  // placeholder as "still thinking": hide it, show the dots, and swap the moment
  // there is text — which is what makes the answer look like it starts typing.
  const last = messages[messages.length - 1];
  const streaming = isTyping && last?.role === 'bot' && !!last.body;
  const awaitingFirstToken = isTyping && !streaming;

  const lastBodyLength = last?.role === 'bot' ? (last.body?.length ?? 0) : 0;

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // lastBodyLength keeps the view pinned to the bottom as the answer grows, not
    // just when a whole message is added.
  }, [messages.length, isTyping, lastBodyLength]);

  return (
    <div className={styles.wrap}>
      <div className={styles.thread} ref={threadRef}>
        <div className={styles.threadInner}>
          {messages.map((m) => {
            if (m.role === 'user') return <MessageBubbleUser key={m.id} text={m.text ?? ''} />;
            if (awaitingFirstToken && m.id === last?.id && !m.body) return null;
            return <MessageCardBot key={m.id} message={m} onFollowUp={sendMessage} streaming={streaming && m.id === last?.id} />;
          })}
          {awaitingFirstToken && <TypingCard />}
        </div>
      </div>
      <div className={styles.composerBar}>
        <Composer onSend={sendMessage} autoFocus />
      </div>
      <p className={styles.disclaimer}>AI responses may be inaccurate. Please verify with official policy documents.</p>
    </div>
  );
}
