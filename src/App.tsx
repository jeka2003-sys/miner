import { useState, useEffect, useCallback } from 'react';

// !!! ВАЖНО: ЗАМЕНИТЕ ЭТО НА АКТУАЛЬНУЮ ССЫЛКУ, КОТОРУЮ ВЫДАЛ NGROK !!!
const API_BASE_URL = "http://placeholder-api-test.com"; 

// --- 1. ИНТЕГРИРОВАННАЯ ЛОГИКА useTelegramInit ---

// Глобальное объявление для доступа к объекту Telegram
declare global {
  interface Window {
    Telegram: {
      WebApp: any;
    };
  }
}

// Интерфейс для данных, получаемых с бэкенда
interface MinerData {
  user_id: string;
  miner_balance: number; // Текущий общий баланс (base + earned)
  current_base_balance: number; // Баланс, на который идет майнинг (сохраненный)
  daily_rate: number; // Дневная ставка в %
  earned_now: number; // Начислено с последнего клейма
  mining_started: boolean;
}

function App() {
  // Локальные стейты, заменяющие useTelegramInit
  const [tg, setTg] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [inited, setInited] = useState(false);

  // Дополнительные стейты приложения
  const [data, setData] = useState<MinerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false); // Для отслеживания POST-запроса
  const [claimMessage, setClaimMessage] = useState(''); // Сообщение о клейме

  // Инициализация Telegram Web App
  useEffect(() => {
    function initializeTelegram() {
      if (window.Telegram && window.Telegram.WebApp) {
        const webApp = window.Telegram.WebApp;
        webApp.ready();
        
        setTg(webApp);

        try {
          if (webApp.initDataUnsafe && webApp.initDataUnsafe.user) {
            setUser(webApp.initDataUnsafe.user);
          }
        } catch (e) {
          console.error("Failed to parse Telegram user data:", e);
        }
        
        setInited(true);
      }
    }

    if (!window.Telegram || !window.Telegram.WebApp) {
      const script = document.createElement('script');
      script.src = 'https://telegram.org/js/telegram-web-app.js';
      script.onload = () => initializeTelegram();
      document.head.appendChild(script);
    } else {
      initializeTelegram();
    }
  }, []);
  
  // --- 2. ЛОГИКА API ---
  
  // Асинхронная функция для загрузки статуса
  const fetchStatus = useCallback(async () => {
    if (!inited || !tg || !tg.initData) return;
    
    setLoading(true);
    setError(null);
    setClaimMessage('');
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/status`, {
        method: 'GET',
        headers: {
          'X-Telegram-Init-Data': tg.initData,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Ошибка авторизации API');
      }

      const result: MinerData = await response.json();
      setData(result);
      
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [inited, tg]);

  // Функция для обработки забора (Claim)
  const handleClaim = useCallback(async () => {
    if (!data || isClaiming || data.earned_now <= 0.0001 || !tg || !tg.initData) return;

    setIsClaiming(true);
    setClaimMessage('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/claim`, {
        method: 'POST',
        headers: {
          'X-Telegram-Init-Data': tg.initData,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Ошибка при заборе средств');
      }

      const result = await response.json();
      setClaimMessage(result.message);
      
      // Обновляем данные после успешного клейма
      await fetchStatus(); 

    } catch (err: any) {
      const errorMessage = err.message || 'Произошла непредвиденная ошибка';
      setClaimMessage(`Ошибка клейма: ${errorMessage}`);
      await fetchStatus(); 
    } finally {
      setIsClaiming(false);
    }
  }, [data, isClaiming, tg, fetchStatus]);


  // Хук для первоначальной загрузки данных
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);
  
  // Хук для управления Главной кнопкой (MainButton) Telegram
  useEffect(() => {
    if (tg && data) {
      // Кнопка Claim активна, только если что-то начислено
      const canClaim = data.earned_now > 0.0001;
      
      tg.MainButton.setText(canClaim ? `✨ Забрать ${data.earned_now.toFixed(4)} USDT` : `Пополнить (Баланс: ${data.current_base_balance.toFixed(2)} USDT)`);
      tg.MainButton.show();
      tg.MainButton.disable(); // Отключаем по умолчанию

      if (canClaim) {
        tg.MainButton.setParams({
          color: tg.themeParams.button_color || '#33a3e3',
          text_color: tg.themeParams.button_text_color || '#ffffff',
          is_active: !isClaiming,
          is_visible: true,
        });
        tg.MainButton.onClick(handleClaim);
      } else {
        // Если клеймить нечего, кнопка ведет на пополнение
         tg.MainButton.setParams({
          color: tg.themeParams.button_color || '#2481cc',
          text_color: tg.themeParams.button_text_color || '#ffffff',
          is_active: true, // Всегда активна для пополнения
          is_visible: true,
        });
        tg.MainButton.onClick(() => {
          // Здесь будет логика для оплаты/пополнения
          // Замените alert на использование Telegram Web App methods (например, showPopup)
          tg.showAlert(`Сейчас у вас ${data.current_base_balance.toFixed(2)} USDT. Здесь будет логика оплаты TON.`);
        });
      }
    }
    
    // Очистка при размонтировании
    return () => {
        if (tg) {
            tg.MainButton.offClick(handleClaim);
            // Сбрасываем onClick, чтобы избежать дублирования обработчиков
            tg.MainButton.onClick(() => {});
            tg.MainButton.hide();
        }
    };
    
  }, [tg, data, isClaiming, handleClaim]);


  if (!inited || loading) {
    return <div>Загрузка данных "Майнера"...</div>;
  }
  
  if (error) {
    return <div style={{ color: 'red', padding: '20px' }}>Ошибка: {error}</div>;
  }
  
  const baseBalanceDisplay = data?.current_base_balance?.toFixed(2) || '0.00';
  const earnedNowDisplay = data?.earned_now?.toFixed(4) || '0.0000';
  const totalBalanceDisplay = data?.miner_balance?.toFixed(2) || '0.00';
  
  return (
    <div className="App" style={{ 
        padding: '20px', 
        color: tg?.themeParams.text_color || 'black', 
        minHeight: '100vh', 
        backgroundColor: tg?.themeParams.bg_color || '#f0f0f0',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    }}>
      <h1 style={{ color: tg?.themeParams.accent_text_color || '#2481cc', textAlign: 'center' }}>Miner App (TON Invest)</h1>
      
      {claimMessage && (
        <div style={{ padding: '10px', backgroundColor: tg?.themeParams.hint_color + '40' || 'rgba(255, 255, 0, 0.2)', color: tg?.themeParams.text_color || 'black', borderRadius: '8px', marginBottom: '15px' }}>
          {claimMessage}
        </div>
      )}

      {data && (
        <div style={{ 
          background: tg?.themeParams.secondary_bg_color || '#ffffff', 
          padding: '15px', 
          borderRadius: '12px', 
          marginTop: '15px', 
          boxShadow: '0 4px 12px rgba(0,0,0,0.05)' 
        }}>
          <p style={{ margin: '0 0 10px 0', fontSize: '0.9em', color: tg?.themeParams.hint_color || '#888888' }}>
            <span style={{ fontWeight: 'bold', color: tg?.themeParams.link_color || '#33a3e3' }}>User ID: </span>
            {data.user_id}
          </p>
          <hr style={{ borderTop: `1px solid ${tg?.themeParams.hint_color + '30' || '#e0e0e0'}`, margin: '10px 0' }} />
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '15px 0' }}>
            <span style={{ fontSize: '1.1em', fontWeight: '500' }}>💰 Инвестиционный Баланс:</span>
            <strong style={{ fontSize: '1.6em', color: data.mining_started ? tg?.themeParams.button_color || '#00cc00' : tg?.themeParams.text_color }}>
              {baseBalanceDisplay} USDT
            </strong>
          </div>
          
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            margin: '20px 0 10px 0', 
            padding: '12px', 
            backgroundColor: tg?.themeParams.button_color + '20' || '#e0e0e0', 
            borderRadius: '8px' 
          }}>
            <span style={{ fontSize: '1.1em' }}>✨ Начислено сейчас:</span>
            <strong style={{ fontSize: '1.4em', color: tg?.themeParams.link_color || '#ff9900' }}>
              {earnedNowDisplay} USDT
            </strong>
          </div>
          
          <p style={{ margin: '5px 0', textAlign: 'center', color: tg?.themeParams.hint_color || '#888888' }}>
            Ежедневный доход: <strong>{data.daily_rate}%</strong>
          </p>
          
          {/* Индикатор майнинга */}
          <div style={{ marginTop: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9em' }}>
            <div style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              backgroundColor: data.mining_started ? '#00cc00' : '#ff3333', 
              marginRight: '8px' 
            }} />
            <span style={{ fontWeight: '500', color: data.mining_started ? '#00cc00' : '#ff3333' }}>
              Статус: {data.mining_started ? 'Майнинг активен' : 'Ожидает пополнения'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;