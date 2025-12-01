import React, { useState, useEffect, useCallback, useMemo } from 'react';

// =================================================================
// === ВНИМАНИЕ: КРИТИЧЕСКИ ВАЖНАЯ КОНФИГУРАЦИЯ БЭКЕНДА! ===
// !!! АКТУАЛЬНЫЙ NGROK URL ВСТАВЛЕН СЮДА !!!
const API_BASE_URL: string = "https://coeducational-unconstrained-roxanne.ngrok-free.dev";
// =================================================================

// Проверка, что Ngrok URL обновлен
if (API_BASE_URL.includes("your-actual-ngrok-url-here")) {
  alert("НЕОБХОДИМО ОБНОВИТЬ API_BASE_URL в App.tsx!");
  throw new Error("Необходимо обновить API_BASE_URL");
}

// Интерфейс для данных о статусе майнера
interface MinerStatus {
  user_id: string;
  miner_balance: number;
  current_base_balance: number;
  daily_rate: number;
  earned_now: number;
  mining_started: boolean;
}

// Определяем тип для Telegram WebApp, чтобы избежать ошибок TypeScript
interface CustomWebApp extends Window {
  Telegram?: {
    WebApp: {
      initData: string;
      MainButton: {
        text: string;
        isVisible: boolean;
        show: () => void;
        hide: () => void;
        setText: (text: string) => void;
        onClick: (callback: () => void) => void;
        offClick: (callback: () => void) => void;
        enable: () => void;
        disable: () => void;
      };
      openTelegramLink: (url: string) => void;
    };
  };
}

// Приведение глобального объекта Window к нашему кастомному типу
const customWindow = window as unknown as CustomWebApp;
const TWA = customWindow.Telegram?.WebApp;
const initData = TWA?.initData || ''; 
const mainButton = TWA?.MainButton;
const utils = TWA;


// Функции форматирования
const formatBalance = (value: number): string => value.toFixed(2);
const formatEarned = (value: number): string => value.toFixed(4);

function App() {
  const [status, setStatus] = useState<MinerStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [claimMessage, setClaimMessage] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!initData) {
      setLoading(false); 
      setError("ОШИБКА: Telegram WebApp Init Data отсутствует. Приложение должно запускаться из бота.");
      return;
    }

    try {
      setError(null); 
      setLoading(true);
      
      const maxRetries = 3;
      let response: Response | undefined;

      // Логика с экспоненциальным бэкоффом для устойчивости
      for (let i = 0; i < maxRetries; i++) {
        try {
          response = await fetch(`${API_BASE_URL}/api/status`, {
            method: 'GET',
            headers: {
              'X-Telegram-Init-Data': initData,
              'Content-Type': 'application/json',
            },
          });
          if (response.ok) break; // Выход при успешном ответе
        } catch (e) {
            if (i === maxRetries - 1) {
                throw e; // Проброс ошибки, если все попытки исчерпаны
            }
            const delay = Math.pow(2, i) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      if (!response || !response.ok) {
        let errorText = response ? await response.text() : "Ответ не получен";
        try {
          const errorJson = JSON.parse(errorText);
          errorText = errorJson.detail || errorText;
        } catch {}
        
        const status = response ? response.status : 'N/A';
        throw new Error(`Ошибка HTTP ${status}: ${errorText}`);
      }

      const data: MinerStatus = await response.json();
      setStatus(data);

    } catch (err: unknown) {
      console.error("Ошибка при получении статуса майнера:", err);
      
      let errorMessage: string;
      if (err instanceof Error) {
        // Проверка на ошибку сети (Failed to fetch)
        errorMessage = (err.message.includes('fetch') || err.message.includes('network')) ? 
            `Failed to fetch. Проверьте Ngrok/FastAPI. URL: ${API_BASE_URL}` :
            err.message;
      } else {
        errorMessage = "Неизвестная ошибка при загрузке данных.";
      }

      setError(`Ошибка сети/API: ${errorMessage}`);
      setStatus(null); 
    } finally {
      setLoading(false); 
    }
  }, []);

  // Кэшированный обработчик для MainButton
  const handleClaim = useCallback(async () => {
    if (!initData || !status || !mainButton) return;
    
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

      const result: { message: string } = await response.json();
      
      setClaimMessage(result.message);
      
      // Обновляем статус после успешного клейма
      await fetchStatus();

    } catch (err: unknown) {
      console.error("Ошибка при клейме:", err);
      if (err instanceof Error) {
        setClaimMessage(`Ошибка клейма: ${err.message}`);
      } else {
        setClaimMessage("Неизвестная ошибка при клейме.");
      }
    } finally {
      if (mainButton) mainButton.enable();
      setTimeout(() => setClaimMessage(null), 5000);
    }
  }, [status, fetchStatus]);


  // Эффект для первоначальной загрузки и интервала
  useEffect(() => {
    if (initData) {
      fetchStatus();
      const interval = setInterval(fetchStatus, 60000); // Обновление каждую минуту
      return () => clearInterval(interval);
    }
    // Если initData нет, компонент уже установил ошибку в fetchStatus
  }, [fetchStatus]); 

  // Эффект для управления MainButton
  useEffect(() => {
    if (!mainButton) return; 
    
    // Скрываем, если загрузка, ошибка или нет данных
    if (loading || error || !status) {
      mainButton.hide();
      return;
    }

    const earned = status.earned_now;
    
    mainButton.setText(`КЛЕЙМ (${formatEarned(earned)} USDT)`);
    mainButton.show();
    
    // Включаем кнопку, если есть что клеймить
    if (earned > 0.0001) {
      mainButton.enable();
    } else {
      // Иначе показываем статус майнинга и отключаем
      mainButton.disable();
      mainButton.setText(`МАЙНИНГ АКТИВЕН (${status.daily_rate.toFixed(1)}%)`);
    }

    // Устанавливаем обработчик
    mainButton.offClick(handleClaim); // Снимаем старый
    mainButton.onClick(handleClaim);   // Устанавливаем новый
    
    // Очистка при размонтировании/обновлении
    return () => {
      mainButton.offClick(handleClaim);
    };
  }, [loading, error, status, handleClaim]); // Добавили handleClaim в зависимости

  // Установка фона
  useEffect(() => {
    document.body.style.backgroundColor = 'var(--tg-theme-bg-color, #1e1e1e)'; 
  }, []);

  // --- Рендеринг ---

  if (loading) {
    return <div className="text-center p-8 text-xl text-gray-400">Загрузка данных "спермы"...</div>;
  }
  
  if (error || !status) {
      return (
        <div className="p-8 text-center bg-gray-900 rounded-xl shadow-2xl border-2 border-red-500 text-red-100">
          <h2 className="text-2xl font-bold mb-4 text-red-300">ОШИБКА ПОДКЛЮЧЕНИЯ / КЭШ</h2>
          <p className="mb-2 font-semibold text-white">Приложение не может связаться с бэкендом (Ngrok/FastAPI) или отсутствует InitData.</p>
          <div className="mt-4 p-3 bg-red-800 rounded-lg text-left break-all">
            <p className="text-sm font-mono">
                <span className="font-bold text-yellow-300">Причина:</span> {error || "Статус API не получен."}
            </p>
          </div>
          <p className="text-sm mt-4 text-gray-300">
            **1. Init Data:** Если видите ошибку "Init Data отсутствует", запустите приложение **через кнопку в боте**, а не по прямой ссылке.
            <br/>**2. Ngrok/FastAPI:** Убедитесь, что Ngrok и FastAPI запущены.
            <br/>**3. Кэш:** Если проблема не решается, попробуйте **перезапустить Telegram Mini App**.
          </p>
          <button 
            onClick={fetchStatus} 
            className="mt-6 w-full bg-red-700 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-xl transition"
          >
            Повторить попытку
          </button>
        </div>
      );
  }

  // Здесь status уже не null
  return (
    <div className="p-4 md:p-8 space-y-6 min-h-screen" style={{backgroundColor: 'var(--tg-theme-bg-color, #1e1e1e)'}}>
      <div className="bg-gray-800 p-4 rounded-xl shadow-lg border-b-4 border-cyan-500/50">
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
      
      <div className="text-center p-3 rounded-lg border border-gray-700">
        <span className={`font-bold ${status.mining_started ? 'text-green-400' : 'text-yellow-400'}`}>
          Статус: {status.mining_started ? 'Майнинг активен' : 'Ожидает пополнения'}
        </span>
      </div>

      {claimMessage && (
        <div className={`p-3 rounded-lg text-center font-semibold ${claimMessage.startsWith('Ошибка') ? 'bg-red-900 text-red-300' : 'bg-green-900 text-green-300'}`}>
          {claimMessage}
        </div>
      )}

      {/* Кнопка "Как пополнить баланс?" */}
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