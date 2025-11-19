import { useEffect, useRef } from 'react';
import { Message } from '../../types';
import { MessageBubble } from './MessageBubble';
import { EmptyState } from './EmptyState';

/**
 * メッセージリストコンポーネント
 * @param messages - 表示するメッセージの配列
 */
interface MessageListProps {
  messages: Message[];
}

/**
 * 連続発言をグループ化する関数
 */
function groupMessages(messages: Message[]): (Message & { group: 'top' | 'middle' | 'bottom' | false })[] {
  if (messages.length === 0) return [];

  const grouped: (Message & { group: 'top' | 'middle' | 'bottom' | false })[] = [];
  let currentGroup: Message[] = [];

  for (let i = 0; i < messages.length; i++) {
    const current = messages[i];
    const prev = i > 0 ? messages[i - 1] : null;

    // 前のメッセージと同じroleで、5分以内ならグループ化
    const isSameGroup =
      prev &&
      prev.role === current.role &&
      (current.timestamp.getTime() - prev.timestamp.getTime()) / 1000 < 300; // 5分以内

    if (isSameGroup) {
      currentGroup.push(current);
    } else {
      // 現在のグループを処理
      if (currentGroup.length > 0) {
        if (currentGroup.length === 1) {
          grouped.push({ ...currentGroup[0], group: false });
        } else {
          currentGroup.forEach((msg, idx) => {
            let group: 'top' | 'middle' | 'bottom' | false = false;
            if (idx === 0) group = 'top';
            else if (idx === currentGroup.length - 1) group = 'bottom';
            else group = 'middle';
            grouped.push({ ...msg, group });
          });
        }
      }
      currentGroup = [current];
    }
  }

  // 最後のグループを処理
  if (currentGroup.length > 0) {
    if (currentGroup.length === 1) {
      grouped.push({ ...currentGroup[0], group: false });
    } else {
      currentGroup.forEach((msg, idx) => {
        let group: 'top' | 'middle' | 'bottom' | false = false;
        if (idx === 0) group = 'top';
        else if (idx === currentGroup.length - 1) group = 'bottom';
        else group = 'middle';
        grouped.push({ ...msg, group });
      });
    }
  }

  return grouped;
}

export function MessageList({ messages }: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 自動スクロール（フッター余白を考慮）
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({ 
        top: containerRef.current.scrollHeight, 
        behavior: 'smooth' 
      });
    }
  }, [messages]);

  const groupedMessages = groupMessages(messages);

  if (messages.length === 0) {
    return <EmptyState />;
  }

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto p-4 md:p-6 scrollbar-thin"
      role="log"
      aria-label="会話履歴"
    >
      <div className="space-y-1">
        {groupedMessages.map((message) => (
          <MessageBubble
            key={message.id}
            role={message.role}
            text={message.text}
            time={message.timestamp}
            isGrouped={message.group}
          />
        ))}
        {/* フッター分のスペーサー */}
        <div ref={messagesEndRef} aria-hidden="true" className="pb-[calc(var(--footer-h)+env(safe-area-inset-bottom,0px))]" />
      </div>
    </div>
  );
}

