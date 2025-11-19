import { Message } from '../../types';
import { MessageList } from './MessageList';

/**
 * チャットパネルコンポーネント
 * @param messages - 表示するメッセージの配列
 */
interface ChatPanelProps {
  messages: Message[];
}

export function ChatPanel({ messages }: ChatPanelProps) {
  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <MessageList messages={messages} />
      </div>
    </div>
  );
}

