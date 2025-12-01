import React, { useState, useEffect, useCallback } from 'react';
// import './App.css'; // УДАЛЕНО: Этот файл не существует в среде
// import { useInitData, useMainButton, useUtils } from '@twa-dev/sdk/react'; // УДАЛЕНО: Использование хуков TWA SDK, которые недоступны

// === КОНФИГУРАЦИЯ БЭКЕНДА ===
// !!! ВСТАВЬТЕ СЮДА АКТУАЛЬНЫЙ NGROK URL !!!
// Актуальный URL для вашего бэкенда FastAPI, запущенного через ngrok.
// Пример: https://a1b2-3c4d-5e6f-7g8h.ngrok-free.app
const API_BASE_URL = "https://coeducational-unconstrained-roxanne.ngrok-free.dev";
// =============================

interface MinerStatus {
  user_id: string;
  miner_balance: number;
  current_base_balance: number;
  daily_rate: number;
  earned_now: number;
  mining_started: boolean;
}

const formatBalance = (value: number) => value.toFixed(2);
const formatEarned = (value: number) => value.toFixed(4);

// Вспомогательные функции для доступа к WebApp API
// Мы используем прямой доступ к глобальному объекту, чтобы избежать ошибки импорта.
const TWA = window.Telegram?.WebApp;
const initData = TWA?.initData || ''; 
const mainButton = TWA?.MainButton;
const utils = TWA;

function App() {
  // Хуки заменены на прямые переменные
  // const initData = useInitData();
  // const mainButton = useMainButton();
  // const utils = useUtils();

  const [status, setStatus] = useState<MinerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimMessage, setClaimMessage] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    // Если нет данных, мы просто останавливаемся
    if (!initData) {
      setLoading(true); 
      return;
    }

    try {
      setError(null); 
      setLoading(true);
      
      const response = await fetch(`${API_BASE_URL}/api/status`, {
        method: 'GET',
        // Заголовок временно не используется на бэкенде, но его лучше оставить.
        headers: {
          'X-Telegram-Init-Data': initData,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        let errorText = await response.text();
        // Пытаемся получить детали ошибки из JSON, если возможно
        try {
          const errorJson = JSON.parse(errorText);
          errorText = errorJson.detail || errorText;
        } catch {}

        throw new Error(`Ошибка HTTP ${response.status}: ${errorText}`);
      }

      const data: MinerStatus = await response.json();
      setStatus(data);
    } catch (err) {
      console.error("Ошибка при получении статуса майнера:", err);
      if (err instanceof Error) {
        // Устанавливаем конкретную ошибку
        setError(`Ошибка сети/API: ${err.message}. Проверьте ngrok и FastAPI.`);
      } else {
        setError("Неизвестная ошибка при загрузке данных.");
      }
      setStatus(null); // Сбрасываем статус, если есть ошибка
    } finally {
      setLoading(false); // Загрузка завершена, независимо от успеха
    }
  }, []); // initData удален из зависимостей, так как он теперь глобальная константа

  const handleClaim = useCallback(async () => {
    if (!initData || !status || !mainButton) return;
    
    // Временно отключим кнопку, чтобы избежать двойного нажатия
    mainButton.disable();

    try {
      // ПРИМЕЧАНИЕ: Этот эндпоинт (/api/claim) ВСЕ ЕЩЕ ТРЕБУЕТ initData, в отличие от /api/status!
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
      
      // Обновляем статус после успешного клейма
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
      // Сбросить сообщение через несколько секунд
      setTimeout(() => setClaimMessage(null), 5000);
    }
  }, [status, fetchStatus]); // initData и mainButton удалены из зависимостей

  // Эффект для автоматической загрузки статуса
  useEffect(() => {
    // Запускаем только если initData доступна
    if (initData) {
      fetchStatus();
      // Обновлять статус каждую минуту
      const interval = setInterval(fetchStatus, 60000); 
      return () => clearInterval(interval);
    }
    // Если нет initData, интервал не запускается и мы остаемся в состоянии loading
  }, [fetchStatus]); // initData удален из зависимостей

  // Эффект для MainButton (Кнопка "Клейм")
  useEffect(() => {
    if (!mainButton) return; // Проверяем, что кнопка доступна
    
    // Кнопка скрыта, пока идет загрузка или есть ошибка
    if (loading || error || !status) {
      mainButton.hide();
      return;
    }

    const earned = status.earned_now;
    
    mainButton.setText(`КЛЕЙМ (${formatEarned(earned)} USDT)`);
    mainButton.show();
    
    if (earned > 0.0001) {
      mainButton.enable();
    } else {
      mainButton.disable();
      mainButton.setText(`МАЙНИНГ АКТИВЕН (${status.daily_rate.toFixed(1)}%)`);
    }

    // Привязка обработчика клейма к кнопке
    mainButton.onClick(handleClaim);

    return () => {
      mainButton.offClick(handleClaim);
    };
  }, [loading, error, status, handleClaim]);

  // Установка цвета темы
  useEffect(() => {
    // Устанавливаем черный фон, чтобы соответствовать стилю Telegram Mini App
    document.body.style.backgroundColor = 'var(--tg-theme-bg-color, #1e1e1e)'; 
  }, []);

  if (loading) {
    // Показываем ошибку только если она есть И initData не null (иначе это просто ожидание)
    if (error) {
       return (
         <div className="p-8 text-center text-red-500">
          <h2 className="text-2xl font-bold mb-4">Ошибка подключения!</h2>
          <p className="mb-2">Приложение не может связаться с вашим бэкендом (FastAPI).</p>
          <p className="text-sm break-all">Причина: {error}</p>
          <p className="text-sm mt-4 text-gray-400">
            Проверьте 1) **Ngrok URL** в `src/App.jsx` (**должен быть актуальным**), 2) запущен ли FastAPI, 3) запущен ли Ngrok.
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
    // Если нет ошибки, просто показываем загрузку
    return <div className="text-center p-8 text-xl text-gray-400">Загрузка данных "Спермы"...</div>;
  }
  
  // Если loading=false, но status=null (из-за ошибки), то показываем ошибку.
  // Это условие нужно для случаев, когда fetchStatus завершился с ошибкой.
  if (error || !status) {
      return (
        <div className="p-8 text-center text-red-500">
          <h2 className="text-2xl font-bold mb-4">Ошибка подключения!</h2>
          <p className="mb-2">Приложение не может связаться с вашим бэкендом (FastAPI).</p>
          <p className="text-sm break-all">Причина: {error || "Статус API не получен."}</p>
          <p className="text-sm mt-4 text-gray-400">
            Проверьте 1) **Ngrok URL** в `src/App.jsx` (**должен быть актуальным**), 2) запущен ли FastAPI, 3) запущен ли Ngrok.
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
        onClick={() => utils?.openTelegramLink("https://t.me/telegram")}
        className="w-full py-3 text-white font-bold rounded-xl bg-blue-600 hover:bg-blue-700 transition duration-200 shadow-lg shadow-blue-500/50"
      >
        Как пополнить баланс?
      </button>

    </div>
  );
}

export default App;