// src/App.tsx

// ВАЖНО: Убедитесь, что хук useTelegramInit существует в src/hooks/useTelegramInit.ts
import { useTelegramInit } from './hooks/useTelegramInit'; 
import { useState, useEffect } from 'react';
import './App.css';

// !!! ВАЖНО: ЗАМЕНИТЕ ЭТО НА ССЫЛКУ, КОТОРУЮ ВЫДАЛ NGROK !!!
const API_BASE_URL = "https://coeducational-unconstrained-roxanne.ngrok-free.dev"; // Пример: "https://abcd1234.ngrok-free.app";

function App() {
  const { tg, user, inited } = useTelegramInit();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (inited && tg && tg.initData) {
      // Функция для загрузки данных с бэкенда
      const fetchStatus = async () => {
        setLoading(true);
        setError(null);
        try {
          const response = await fetch(`${API_BASE_URL}/api/status`, {
            method: 'GET',
            headers: {
              // *** ПЕРЕДАЧА СЕКРЕТНОГО АВТОРИЗАЦИОННОГО ЗАГОЛОВКА ***
              'X-Telegram-Init-Data': tg.initData,
            },
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Ошибка авторизации API');
          }

          const result = await response.json();
          setData(result);
          
        } catch (err: any) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      };
      
      fetchStatus();
    }
  }, [inited, tg]);

  if (!inited || loading) {
    return <div>Загрузка данных "Майнера"...</div>;
  }
  
  if (error) {
    // В случае ошибки авторизации (например, подделка данных)
    return <div style={{ color: 'red', padding: '20px' }}>Ошибка: {error}</div>;
  }

  // Настройка основной кнопки Telegram 
  if (tg) {
    tg.MainButton.setText(`💰 Пополнить: ${data.miner_balance} USDT`);
    tg.MainButton.show();
    tg.MainButton.onClick(() => {
      alert(`API-баланс: ${data.miner_balance}. Здесь будет логика оплаты TON.`);
    });
  }

  return (
    <div className="App" style={{ padding: '20px', color: tg?.themeParams.text_color || 'black', minHeight: '100vh' }}>
      <h1>Miner App (TON Invest)</h1>
      <p>Статус API: ✅ Подключено и авторизовано</p>
      
      {data && (
        <div style={{ background: tg?.themeParams.secondary_bg_color || '#f0f0f0', padding: '15px', borderRadius: '8px', marginTop: '15px' }}>
          <h2>Привет, {user?.first_name || 'Пользователь'}!</h2>
          <p>Ваш ID: <strong>{data.user_id}</strong> (Получен с бэкенда)</p>
          <p>Баланс (тест): <strong>{data.miner_balance} USDT</strong></p>
          <p>Дневная ставка: {data.daily_rate}%</p>
        </div>
      )}
      
      {/*... здесь будет больше интерфейса ...*/}
    </div>
  );
}

export default App;