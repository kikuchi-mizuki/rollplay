import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface EvaluationData {
  id: string;
  created_at: string;
  scores: {
    questioning_skill: number;
    listening_skill: number;
    proposal_skill: number;
    closing_skill: number;
  };
  average_score: number;
}

interface ScoreChartProps {
  evaluations: EvaluationData[];
}

export function ScoreChart({ evaluations }: ScoreChartProps) {
  // 日付順にソート（古い順）
  const sortedEvaluations = [...evaluations].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  // グラフ用のデータを整形
  const chartData = sortedEvaluations.map((evaluation, index) => {
    const date = new Date(evaluation.created_at);
    const formattedDate = `${date.getMonth() + 1}/${date.getDate()}`;

    return {
      name: formattedDate,
      練習回: index + 1,
      質問力: evaluation.scores.questioning_skill,
      傾聴力: evaluation.scores.listening_skill,
      提案力: evaluation.scores.proposal_skill,
      クロージング力: evaluation.scores.closing_skill,
      平均: Number(evaluation.average_score.toFixed(1)),
    };
  });

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        まだデータがありません
      </div>
    );
  }

  return (
    <div className="w-full h-96">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="name"
            stroke="#9CA3AF"
            style={{ fontSize: '12px' }}
          />
          <YAxis
            domain={[0, 5]}
            ticks={[0, 1, 2, 3, 4, 5]}
            stroke="#9CA3AF"
            style={{ fontSize: '12px' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(17, 24, 39, 0.95)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              color: '#fff',
            }}
            labelStyle={{ color: '#9CA3AF' }}
          />
          <Legend
            wrapperStyle={{
              paddingTop: '20px',
              fontSize: '12px',
            }}
          />
          <Line
            type="monotone"
            dataKey="質問力"
            stroke="#EF4444"
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
          />
          <Line
            type="monotone"
            dataKey="傾聴力"
            stroke="#F59E0B"
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
          />
          <Line
            type="monotone"
            dataKey="提案力"
            stroke="#10B981"
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
          />
          <Line
            type="monotone"
            dataKey="クロージング力"
            stroke="#3B82F6"
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
          />
          <Line
            type="monotone"
            dataKey="平均"
            stroke="#A78BFA"
            strokeWidth={3}
            dot={{ r: 5 }}
            activeDot={{ r: 7 }}
            strokeDasharray="5 5"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
