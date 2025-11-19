/**
 * 空状態コンポーネント（初回表示時のヘルプCTA）
 */
export function EmptyState() {
  return (
    <div className="flex flex-col justify-center items-center h-full min-h-[480px] px-6 text-center animate-floatIn">
      <div className="flex flex-col items-center gap-4">
        <div className="text-5xl">💼</div>
        <h1 className="text-xl font-semibold text-white">営業ロープレを開始</h1>
        <p className="text-slate-300 leading-relaxed max-w-md">
          あなたは営業役です。<br />
          顧客役のAIが「30分無料相談」に来ました。
        </p>
        <p className="text-sm text-slate-400 mt-2">
          顧客からの最初のメッセージが表示されます...
        </p>
      </div>
    </div>
  );
}
