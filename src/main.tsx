import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// 環境変数デバッグ
console.log('=== main.tsx 環境変数デバッグ ===')
console.log('VITE_SUPABASE_URL:', import.meta.env.VITE_SUPABASE_URL)
console.log('VITE_SUPABASE_ANON_KEY:', import.meta.env.VITE_SUPABASE_ANON_KEY ? '設定済み (長さ: ' + import.meta.env.VITE_SUPABASE_ANON_KEY.length + ')' : '❌ 未設定')
console.log('import.meta.env:', import.meta.env)
console.log('================================')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

