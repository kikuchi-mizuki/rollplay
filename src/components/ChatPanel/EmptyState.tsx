interface EmptyStateProps {
  scenarioId?: string;
}

/**
 * 空状態コンポーネント（初回表示時のヘルプCTA）
 */
export function EmptyState({ scenarioId = '' }: EmptyStateProps) {
  // シナリオIDに基づいてロールを判定
  const isDirector = scenarioId.startsWith('director_');

  const emoji = isDirector ? '🎬' : '💼';
  const title = isDirector ? 'ディレクターロープレを開始' : '営業ロープレを開始';
  const roleDescription = isDirector
    ? 'あなたはディレクター役です。'
    : 'あなたは営業役です。';
  const situationDescription = isDirector
    ? 'クライアント役のAIが制作の相談に来ました。'
    : '顧客役のAIが「30分無料相談」に来ました。';

  return (
    <div className="flex flex-col justify-center items-center h-full min-h-[480px] px-6 text-center animate-floatIn">
      <div className="flex flex-col items-center gap-4">
        <div className="text-5xl">{emoji}</div>
        <h1 className="text-xl font-semibold text-white">{title}</h1>
        <p className="text-slate-300 leading-relaxed max-w-md">
          {roleDescription}<br />
          {situationDescription}
        </p>
        <p className="text-sm text-slate-400 mt-2">
          マイクボタン🎤またはテキスト入力で話しかけてください
        </p>
      </div>
    </div>
  );
}
