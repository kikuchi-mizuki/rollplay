import { Message } from '../../types';
import { MessageList } from './MessageList';
import { memo } from 'react';

/**
 * チャットパネルコンポーネント
 * @param messages - 表示するメッセージの配列
 * @param scenarioId - 現在のシナリオID
 */
interface ChatPanelProps {
  messages: Message[];
  scenarioId?: string;
}

const ChatPanelComponent: React.FC<ChatPanelProps> = ({ messages, scenarioId }) => {
  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <MessageList messages={messages} scenarioId={scenarioId} />
      </div>
    </div>
  );
};

// React.memoでラップして不要な再レンダリングを防止
export const ChatPanel = memo(ChatPanelComponent);

