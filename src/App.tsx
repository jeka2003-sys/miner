import React, { useState, useEffect, useCallback, useRef } from 'react';

// =================================================================
// === ВНИМАНИЕ: КРИТИЧЕСКИ ВАЖНАЯ КОНФИГУРАЦИЯ БЭКЕНДА! ===
// ПОЖАЛУЙСТА, ПРОВЕРЬТЕ, ЧТО ЭТОТ URL АКТУАЛЕН!
const API_BASE_URL = "https://coeducational-unconstrained-roxanne.ngrok-free.dev";
// =================================================================

// Проверка, что Ngrok URL обновлен
if (API_BASE_URL.includes("your-actual-ngrok-url-here")) {
  // Используем window.alert, так как TWA.showAlert может быть недоступен на этом этапе
  window.alert("НЕОБХОДИМО ОБНОВИТЬ API_BASE_URL в App.jsx!");
}


// Вспомогательные функции для доступа к WebApp API (без импортов SDK)
const TWA = window.Telegram ? window.Telegram.WebApp : null;
const initData = TWA ? TWA.initData : ''; 
const mainButton = TWA ? TWA.MainButton : null;
const utils = TWA;

const formatBalance = (value) => value.toFixed(2);
const formatEarned = (value) => value.toFixed(8); // Увеличим точность для майнинга

function App() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [claimMessage, setClaimMessage] = useState(null);
  
  // Ref для отслеживания инициализации TWA
  const twaInitRef = useRef(false);

  // --- ФУНКЦИИ ЗАПРОСОВ ---

  const fetchStatus = useCallback(async () => {
    if (!initData) {
      setLoading(false); 
      setError("ОШИБКА: Telegram WebApp Init Data отсутствует. Приложение должно запускаться из бота.");
      return;
    }

    try {
      setError(null); 
      setLoading(true);
      
      const response = await fetch(`${API_BASE_URL}/api/status`, {
        method: 'GET',
        headers: {
          // X-Telegram-Init-Data отправляется, но бэкенд его сейчас игнорирует
          'X-Telegram-Init-Data': initData, 
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        let errorText = await response.text();
        const status = response.status;
        
        try {
          const errorJson = JSON.parse(errorText);
          errorText = errorJson.detail || errorText;
        } catch {}

        if (errorText.startsWith("<!DOCTYPE")) {
             errorText = "Получен HTML вместо JSON. Проблема с Ngrok/URL/Прокси Vercel. Проверьте актуальность URL!"
        }
        
        throw new Error(`Ошибка HTTP ${status}: ${errorText}`);
      }

      const data = await response.json();
      setStatus(data);

    } catch (err) {
      console.error("Ошибка при получении статуса майнера:", err);
      
      const errorMessage = err instanceof TypeError && (err.message.includes('fetch') || err.message.includes('network')) ? 
          `Failed to fetch. Проверьте Ngrok/FastAPI. URL: ${API_BASE_URL}` :
          (err instanceof Error ? err.message : "Неизвестная ошибка при загрузке данных.");

      setError(`Ошибка сети/API: ${errorMessage}`);
      setStatus(null); 
    } finally {
      setLoading(false); 
    }
  }, [initData]); 

  const handleClaim = useCallback(async () => {
    if (!initData || !status || !mainButton || status.earned_now < 0.0001) return;
    
    // 1. Блокируем кнопку и показываем лоадер
    mainButton.disable();
    mainButton.showLoader();

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
      
      // 2. Успешный клейм: немедленно запрашиваем новый статус для обновления UI
      await fetchStatus();
      // MainButton будет обновлен в useEffect ниже после получения нового статуса
      
    } catch (err) {
      console.error("Ошибка при клейме:", err);
      if (err instanceof Error) {
        setClaimMessage(`Ошибка клейма: ${err.message}`);
      } else {
        setClaimMessage("Неизвестная ошибка при клейме.");
      }
    } finally {
      // 3. Прячем лоадер. Кнопка будет либо активирована, либо деактивирована
      // на основе данных в useEffect после fetchStatus.
      mainButton.hideLoader(); 
      setTimeout(() => setClaimMessage(null), 5000);
    }
  }, [status, fetchStatus, initData, mainButton]);

  // --- ЭФФЕКТЫ ---

  // Эффект инициализации TWA и установки интервала
  useEffect(() => {
    if (TWA && !twaInitRef.current) {
      // КРИТИЧЕСКИ ВАЖНО: Уведомить Telegram, что приложение готово
      TWA.ready();
      TWA.expand();
      twaInitRef.current = true; // Отмечаем, что инициализация прошла
    }
    
    // Запускаем первый запрос статуса
    fetchStatus();
    
    // Установка интервала для обновления статуса
    const interval = setInterval(fetchStatus, 5000); // Ускорим для быстрой проверки

    // Очистка интервала
    return () => clearInterval(interval);
  }, [fetchStatus]); 

  // Эффект настройки MainButton
  useEffect(() => {
    if (!mainButton || !TWA || !status) return; 
    
    // Установка обработчика
    mainButton.offClick(handleClaim);
    mainButton.onClick(handleClaim);

    // Настройка цвета кнопки
    mainButton.setParams({ color: TWA.themeParams.button_color || '#27AE60', text_color: TWA.themeParams.button_color ? TWA.themeParams.button_text_color : '#FFFFFF' });
    
    // Логика отображения/скрытия кнопки и текста
    const earned = status.earned_now;
    mainButton.show();
    
    if (earned > 0.0001) {
      mainButton.setText(`КЛЕЙМ (${formatEarned(earned)} USDT)`);
      mainButton.enable();
    } else {
      // После клейма earned_now станет 0, и кнопка будет деактивирована
      mainButton.setText(`МАЙНИНГ АКТИВЕН (${status.daily_rate.toFixed(1)}%)`);
      mainButton.disable();
    }

    return () => {
      mainButton.offClick(handleClaim);
    };
  }, [loading, error, status, handleClaim, mainButton, TWA]);

  // Установка цвета фона
  useEffect(() => {
    document.body.style.backgroundColor = TWA?.themeParams.bg_color || '#1e1e1e'; 
  }, []);

  // --- РЕНДЕРИНГ ИНТЕРФЕЙСА ---

  if (loading && !error) {
    return <div className="text-center p-8 text-xl text-gray-400" style={{ color: TWA?.themeParams.hint_color }}>Загрузка данных Майнера...</div>;
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
            **1. Ngrok/URL:** Проверьте актуальность URL: <span className="font-mono text-red-300">{API_BASE_URL}</span>.
            <br/>**2. Кэш:** Выполните полный сброс кэша Telegram.
          </p>
          <button 
            onClick={fetchStatus} 
            className="mt-6 w-full py-3 text-white font-bold rounded-xl bg-red-700 hover:bg-red-600 transition shadow-lg shadow-red-500/50"
          >
            Повторить попытку
          </button>
        </div>
      );
  }

  // Здесь status уже не null
  return (
    <div className="p-4 md:p-8 space-y-6" style={{ color: TWA?.themeParams.text_color || '#FFFFFF' }}>
      <div className="bg-gray-800 p-4 rounded-xl shadow-lg" style={{ backgroundColor: TWA?.themeParams.secondary_bg_color }}>
        <h1 className="text-xl font-bold text-center text-white mb-2">💎 Крипто-Майнер TMA</h1>
        <p className="text-sm text-gray-400 text-center break-all">
          User ID (Debug): <span className="font-mono text-yellow-300">{status.user_id}</span>
        </p>
      </div>

      <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-yellow-500/30" style={{ backgroundColor: TWA?.themeParams.secondary_bg_color }}>
        <p className="text-sm text-gray-400">Базовый Инвестиционный Баланс</p>
        <div className="text-4xl font-extrabold text-white mt-1">
          💰 {formatBalance(status.current_base_balance)} USDT
        </div>
        <div className="mt-4 pt-4 border-t border-gray-700">
          <p className="text-sm text-gray-400">Начислено с последнего клейма:</p>
          <div className="text-3xl font-bold text-green-400 flex items-center mt-1">
            ✨ {formatEarned(status.earned_now)} USDT 
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Скорость: <span className="font-semibold text-cyan-400">{status.daily_rate.toFixed(1)}%</span> в день
          </p>
        </div>
      </div>
      
      <div className="text-center p-3 rounded-lg" style={{ backgroundColor: TWA?.themeParams.secondary_bg_color }}>
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
        Как пополнить баланс? (Кнопка-заглушка)
      </button>
      {/* Дополнительный отступ для главной кнопки Telegram */}
      <div className="h-10"></div>
    </div>
  );
}

export default App;