import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import { useInitData, useMainButton, useUtils } from '@twa-dev/sdk/react';

// =================================================================
// === КОНФИГУРАЦИЯ БЭКЕНДА ===
// ⚠️ КРИТИЧЕСКИ ВАЖНО: ВСТАВЬТЕ СЮДА АКТУАЛЬНЫЙ NGROK URL, 
// КОТОРЫЙ ВЫ ПОЛУЧИЛИ ПОСЛЕ ПЕРЕЗАПУСКА NGROK!
const API_BASE_URL = "https://coeducational-unconstrained-roxanne.ngrok-free.dev"; // <--- ЗАМЕНИТЕ ЭТУ СТРОКУ!
// =============================

interface MinerStatus {
  user_id: string;
  miner_balance: number;
  current_base_balance: number;
  daily_rate: number;
  earned_now: number;
  mining_started: boolean;
}

// Убедитесь, что форматтеры всегда возвращают числовые строки
const formatBalance = (value: number) => value.toFixed(2);
const formatEarned = (value: number) => value.toFixed(4);

function App() {
  const initData = useInitData();
  const mainButton = useMainButton();
  const utils = useUtils();

  const [status, setStatus] = useState<MinerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimMessage, setClaimMessage] = useState<string | null>(null);
  
  // Создаем функцию для установки состояния "загрузка" и "ошибка"
  const setFatalError = (message: string) => {
    setError(message);
    setLoading(false);
    setStatus(null);
  };
  
  // Ref для отслеживания инициализации TWA
  const twaInitRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    // Используем window.Telegram.WebApp.initData для надежности, если SDK не успел инициализироваться
    const currentInitData = initData || (window as any).Telegram?.WebApp?.initData;
    
    if (!currentInitData) {
      setLoading(false); 
      setError("ОШИБКА: Telegram WebApp Init Data отсутствует."); 
      return;
    }

    const controller = new AbortController();
    // Установим более короткий таймаут для быстрой диагностики
    const timeoutId = setTimeout(() => controller.abort(), 7000); // 7 секунд

    try {
      setError(null); 
      setLoading(true);
      
      const response = await fetch(`${API_BASE_URL}/api/status`, {
        method: 'GET',
        headers: {
          'X-Telegram-Init-Data': currentInitData,
          'Content-Type': 'application/json',
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      // Проверка HTTP-статуса
      if (!response.ok) {
        let errorText = await response.text();
        try {
          const errorJson = JSON.parse(errorText);
          errorText = errorJson.detail || errorText;
        } catch {}

        throw new Error(`Ошибка HTTP ${response.status}: ${errorText}`);
      }

      // ⚠️ КРИТИЧЕСКАЯ ТОЧКА: Парсинг JSON
      const text = await response.text();
      let data: MinerStatus;
      try {
          data = JSON.parse(text);
      } catch(e) {
          // Если ошибка парсинга, то в ответе пришел невалидный JSON
          throw new Error(`Ошибка парсинга JSON: Ответ сервера: "${text.substring(0, 50)}..."`);
      }
      
      // Дополнительная проверка структуры данных
      if (!data.user_id || typeof data.current_base_balance === 'undefined') {
          throw new Error("Сервер вернул неполные или неверные данные.");
      }

      setStatus(data);

    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setFatalError("Ошибка сети: Превышено время ожидания (7 сек). Проверьте Ngrok/FastAPI.");
      } else if (err instanceof Error) {
        setFatalError(`Ошибка сети/API: ${err.message}`);
      } else {
        setFatalError("Неизвестная ошибка при загрузке данных.");
      }
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [initData]);

  const handleClaim = useCallback(async () => {
    if (!initData || !status) return;
    
    mainButton.disable();

    try {
      const response = await fetch(`${API_BASE_URL}/api/claim`, {
        method: 'POST',
        headers: {
          'X-Telegram-Init-Data': initData,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        let errorText = await response.text();
        try {
          const errorJson = JSON.parse(errorText);
          errorText = errorJson.detail || errorText;
        } catch {}
        throw new Error(`Ошибка HTTP при клейме: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      
      setClaimMessage(result.message);
      
      await fetchStatus();

    } catch (err) {
      console.error("Ошибка при клейме:", err);
      if (err instanceof Error) {
        setClaimMessage(`Ошибка клейма: ${err.message}`);
      } else {
        setClaimMessage("Неизвестная ошибка при клейме.");
      }
    } finally {
      mainButton.enable();
      setTimeout(() => setClaimMessage(null), 5000);
    }
  }, [initData, status, fetchStatus, mainButton]);

  // Эффект для автоматической загрузки статуса
  useEffect(() => {
    // TWA.ready() вызывается внутри useMainButton/useUtils
    
    if (initData || (window as any).Telegram?.WebApp?.initData) {
      fetchStatus();
      // Обновлять статус каждую минуту
      const interval = setInterval(fetchStatus, 60000); 
      return () => clearInterval(interval);
    }
  }, [fetchStatus, initData]); 

  // Эффект для MainButton (Кнопка "Клейм")
  useEffect(() => {
    if (loading || error || !status) {
      mainButton.hide();
      return;
    }

    const earned = status.earned_now;
    
    mainButton.setText(`КЛЕЙМ (${formatEarned(earned)} USDT)`);
    mainButton.show();
    
    // Активация кнопки только если что-то намайнено
    if (earned > 0.0001) {
      mainButton.enable();
    } else {
      mainButton.disable();
      mainButton.setText(`МАЙНИНГ АКТИВЕН (${status.daily_rate.toFixed(1)}%)`);
    }

    // Отписка/подписка на обработчик
    const handler = () => handleClaim();
    mainButton.offClick(handler); // Ensure we don't duplicate handlers
    mainButton.onClick(handler);

    return () => {
      mainButton.offClick(handler);
    };
  }, [loading, error, status, mainButton, handleClaim]);


  // Установка цвета темы
  useEffect(() => {
    document.body.style.backgroundColor = 'var(--tg-theme-bg-color, #1e1e1e)'; 
  }, []);

  // Единый компонент для показа ошибки/загрузки
  if (loading && !error) {
    return <div className="text-center p-8 text-xl text-gray-400">Загрузка данных "Майнера"...</div>;
  }
  
  if (error || !status) {
      // В этом блоке мы уверены, что fetchStatus отработал, и произошла ошибка
      return (
        <div className="p-8 text-center text-red-500">
          <h2 className="text-2xl font-bold mb-4">Ошибка подключения!</h2>
          <p className="mb-2">Приложение не может получить данные от бэкенда.</p>
          <p className="text-sm break-all">Причина: <span className="text-yellow-300">{error || "Неизвестная ошибка при получении статуса."}</span></p>
          <p className="text-sm mt-4 text-gray-400">
            1. Проверьте **URL Ngrok** в коде. <br/>
            2. Проверьте **логи Uvicorn** (401 или 500?).<br/>
            3. Убедитесь, что **бот-токен** в `.env` верен.
          </p>
          <button 
            onClick={fetchStatus} 
            className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition"
          >
            Повторить попытку
          </button>
        </div>
      );
  }

  // Основной интерфейс
  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="bg-gray-800 p-4 rounded-xl shadow-lg">
        <h1 className="text-xl font-bold text-center text-white mb-2">💎 Крипто-Майнер TMA</h1>
        <p className="text-sm text-gray-400 text-center break-all">
          User ID: <span className="font-mono text-yellow-300">{status.user_id}</span>
        </p>
      </div>

      <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-yellow-500/30">
        <p className="text-sm text-gray-400">Базовый Инвестиционный Баланс</p>
        <div className="text-4xl font-extrabold text-white mt-1">
          💰 {formatBalance(status.current_base_balance)} USDT
        </div>
        <div className="mt-4 pt-4 border-t border-gray-700">
          <p className="text-sm text-gray-400">Начислено с последнего клейма:</p>
          <div className="text-2xl font-bold text-green-400 flex items-center mt-1">
            ✨ {formatEarned(status.earned_now)} USDT 
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Скорость: <span className="font-semibold text-cyan-400">{status.daily_rate.toFixed(1)}%</span> в день
          </p>
        </div>
      </div>
      
      <div className="text-center p-3 bg-gray-700/50 rounded-lg">
        <span className={`font-bold ${status.mining_started ? 'text-green-400' : 'text-yellow-400'}`}>
          Статус: {status.mining_started ? 'Майнинг активен' : 'Ожидает пополнения'}
        </span>
      </div>

      {claimMessage && (
        <div className={`p-3 rounded-lg text-center font-semibold ${claimMessage.startsWith('Ошибка') ? 'bg-red-900 text-red-300' : 'bg-green-900 text-green-300'}`}>
          {claimMessage}
        </div>
      )}

      <button 
        onClick={() => utils.openTelegramLink("https://t.me/telegram")}
        className="w-full py-3 text-white font-bold rounded-xl bg-blue-600 hover:bg-blue-700 transition duration-200 shadow-lg shadow-blue-500/50"
      >
        Как пополнить баланс?
      </button>

    </div>
  );
}

export default App;