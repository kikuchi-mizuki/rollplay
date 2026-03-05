import { Message } from '../../types';
import { MessageList } from './MessageList';

/**
 * チャットパネルコンポーネント
 * @param messages - 表示するメッセージの配列
 * @param scenarioId - 現在のシナリオID
 */
interface ChatPanelProps {
  messages: Message[];
  scenarioId?: string;
}

export function ChatPanel({ messages, scenarioId }: ChatPanelProps) {
  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <MessageList messages={messages} scenarioId={scenarioId} />
      </div>
    </div>
  );
}

