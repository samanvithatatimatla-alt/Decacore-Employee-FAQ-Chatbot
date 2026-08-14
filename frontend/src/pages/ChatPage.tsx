import ChatHome from '../components/chat/ChatHome';
import ChatThread from '../components/chat/ChatThread';
import { useAppState } from '../context/AppStateContext';

export default function ChatPage() {
  const { state } = useAppState();
  return state.chat.chatStarted ? <ChatThread /> : <ChatHome />;
}
