import { useState, useEffect, useCallback, useRef } from 'react';
// import './App.css'; // FIX: Комментарий для исправления ошибки компиляции: файл App.css не найден.

// ================================================
// ========== CONFIG: Replace via .env =============
// API URL: Поскольку использование 'import.meta.env' или 'process.env' вызывает
// ошибки/предупреждения в целевой среде 'es2015', мы упрощаем конфигурацию.
// Пожалуйста, вручную замените 'https://REPLACE_WITH_NGROK_URL' на ваш актуальный URL API.
// =================================================
const API_BASE_URL = 'https://coeducational-unconstrained-roxanne.ngrok-free.dev';
// =================================================

/**
 * Мы используем window.Telegram.WebApp напрямую (no SDK).
 * При запуске вне Telegram WebApp, TWA будет null.
 */
const getTwa = () => {
  const w = window as any;
  return w?.Telegram ? w.Telegram.WebApp : null;
};

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

interface ThemeColors {
  bg: string;
  secondaryBg: string;
  text: string;
  hint: string;
}

// FIX TS2503: Убрана явная аннотация JSX.Element из функции
function App() {
  // TWA references and dynamic theme colors
  // FIX TS6133: Убрана неиспользуемая переменная twaReady
  const [initData, setInitData] = useState<string>('');
  const twaRef = useRef<any>(null);
  const mainButtonRef = useRef<any>(null);
  const [themeColors, setThemeColors] = useState<ThemeColors>({
    bg: '#0f172a',
    secondaryBg: '#1e293b',
    text: '#ffffff',
    hint: '#94a3b8',
  });

  // App state
  const [status, setStatus] = useState<MinerStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [claimMessage, setClaimMessage] = useState<string | null>(null);

  // Internal refs for fetch control and handler
  const fetchInFlightRef = useRef(false);
  const handlerRef = useRef<(() => void) | null>(null); // Type updated to remove | null from return
  const lastFetchTimeRef = useRef<number>(0);

  // Helper to set fatal error
  const setFatalError = (msg: string) => {
    console.error('[App] Fatal:', msg);
    setError(msg);
    setLoading(false);
    setStatus(null);
  };

  // --- 1. ИНИЦИАЛИЗАЦИЯ TWA и ТЕМА ---
  useEffect(() => {
    const twa = getTwa();
    if (!twa) {
      twaRef.current = null;
      setLoading(false);
      setError('Telegram WebApp не найден. Откройте эту страницу в Telegram.');
      return;
    }

    twaRef.current = twa;
    try {
      twa.ready?.();
      twa.expand?.();
      const id = twa.initData || '';
      setInitData(id);
      setError(null);

      // Функция обновления темы
      const onTheme = () => {
        const params = twa.themeParams;
        const newColors: ThemeColors = {
          bg: params?.bg_color || '#0f172a',
          secondaryBg: params?.secondary_bg_color || '#1e293b',
          text: params?.text_color || '#ffffff',
          hint: params?.hint_color || '#94a3b8',
        };
        setThemeColors(newColors);
        document.body.style.backgroundColor = newColors.bg;
      };

      onTheme();
      twa.onEvent?.('themeChanged', onTheme);
      
      // Синхронный cleanup (FIXED)
      return () => {
        try {
          twa.offEvent?.('themeChanged', onTheme);
        } catch {}
      };
    } catch (e) {
      console.error('[App] Error initializing TWA:', e);
      setError('Ошибка инициализации Telegram WebApp.');
    }
    
    // FIX TS2322: УДАЛЕНИЕ СТАРОГО ASYNC CLEANUP ИЗ СТАРЫХ ВЕРСИЙ КОДА.
    // Заменяем на пустой cleanup, так как вся логика темы уже в верхнем useEffect.
    return () => {};
  }, []);

  // --- 2. ФЕТЧИНГ СТАТУСА ---
  const fetchStatus = useCallback(async (force = false) => {
    const twa = twaRef.current;
    
    // Throttling: пропускаем слишком частые запросы (минимум 1.2 сек)
    const now = Date.now();
    if (!force && now - lastFetchTimeRef.current < 1200) {
      console.debug('[fetchStatus] throttled');
      return;
    }
    lastFetchTimeRef.current = now;

    if (fetchInFlightRef.current) {
      console.debug('[fetchStatus] already in flight — skipping');
      return;
    }

    const curInit = initData;
    // Если в TWA, но нет initData — это ошибка безопасности/запуска
    if (twa && !curInit) {
      setLoading(false);
      setError('ОШИБКА: Telegram WebApp Init Data отсутствует. Запустите во внутреннем браузере Telegram.');
      return;
    }

    fetchInFlightRef.current = true;
    setError(null);
    if (!status) setLoading(true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (curInit) headers['X-Telegram-Init-Data'] = curInit;

      const resp = await fetch(`${API_BASE_URL}/api/status`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        let msg = text || `HTTP ${resp.status}`;
        try {
          const j = JSON.parse(text);
          msg = j.detail || JSON.stringify(j);
        } catch {}
        throw new Error(`Ошибка HTTP ${resp.status}: ${msg}`);
      }

      const text = await resp.text();
      let data: MinerStatus;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(`Ошибка парсинга JSON: "${text.substring(0, 200)}"`);
      }

      if (!data || !data.user_id || typeof data.current_base_balance === 'undefined') {
        throw new Error('Сервер вернул неполные или неверные данные.');
      }

      setStatus(data);
      setError(null);
      console.log("[Status] Status fetched:", data);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setFatalError('Ошибка сети: Превышено время ожидания (8 сек). Проверьте Ngrok/FastAPI.');
      } else if (err instanceof Error) {
        setFatalError(`Ошибка сети/API: ${err.message}`);
      } else {
        setFatalError('Неизвестная ошибка при загрузке данных.');
      }
    } finally {
      fetchInFlightRef.current = false;
      setLoading(false);
    }
  }, [initData, status]); // status в зависимостях нужен, чтобы useCallback не кэшировал старое значение status при вызове fetchStatus внутри handleClaim

  // --- 3. ХЕНДЛЕР КЛЕЙМА ---
  const handleClaim = useCallback(async () => {
    if (!initData || !status) return;

    const mainBtn = mainButtonRef.current;
    try { mainBtn?.disable?.(); mainBtn?.showProgress?.(true); } catch {}

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData };
      const resp = await fetch(`${API_BASE_URL}/api/claim`, {
        method: 'POST',
        headers,
      });

      if (!resp.ok) {
        let text = await resp.text().catch(() => '');
        try {
          const j = JSON.parse(text);
          text = j.detail || text;
        } catch {}
        throw new Error(`Ошибка HTTP при клейме: ${resp.status} - ${text}`);
      }

      const result = await resp.json().catch(() => ({ message: 'OK' }));
      setClaimMessage(result?.message || 'Claim processed');
      console.log("[Claim] Success:", result?.message);

      await fetchStatus(true);
    } catch (err: any) {
      console.error('[handleClaim] claim error:', err);
      setClaimMessage(err instanceof Error ? `Ошибка клейма: ${err.message}` : 'Неизвестная ошибка при клейме.');
    } finally {
      try { mainBtn?.showProgress?.(false); } catch {}
      setTimeout(() => setClaimMessage(null), 5000);
    }
  }, [initData, status, fetchStatus]);

  // --- 4. АВТОЗАГРУЗКА И ИНТЕРВАЛ ---
  useEffect(() => {
    // initial fetch: запускаем fetchStatus. Он сам проверит initData
    fetchStatus(); 
    // refresh every 60s
    const interval = setInterval(() => fetchStatus(), 60_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // --- 5. ЛОГИКА MAIN BUTTON ---
  useEffect(() => {
    const twa = twaRef.current;
    if (!twa) return;
    
    // Ensure mainButton ref is current
    try {
      mainButtonRef.current = twa.MainButton;
    } catch {}

    const mainBtn = mainButtonRef.current;
    if (!mainBtn || loading || error || !status) {
      try { mainBtn.hide?.(); } catch {}
      return;
    }

    // Set text & show
    const earned = status.earned_now ?? 0;
    try {
      mainBtn.setText?.(`КЛЕЙМ (${formatEarned(earned)} USDT)`);
      mainBtn.show?.();
    } catch (e) {
      console.warn('[MainButton] setText/show failed', e);
    }

    if (earned > 0.0001) {
      mainBtn.enable?.();
    } else {
      mainBtn.disable?.();
      mainBtn.setText?.(`МАЙНИНГ АКТИВЕН (${status.daily_rate.toFixed(1)}%)`);
    }

    // Handler management: удаляем предыдущий, добавляем новый
    // FIX TS2322: Оборачиваем асинхронный handleClaim в синхронную функцию,
    // чтобы соответствовать ожидаемому типу () => void для MainButton и handlerRef.
    const handler = () => {
      handleClaim();
    };
    
    // Удаляем предыдущий, если он был
    if (handlerRef.current && mainBtn?.offClick) {
      try {
        mainBtn.offClick(handlerRef.current);
      } catch {}
    }
    // Сохраняем новый и добавляем
    handlerRef.current = handler;
    try {
      mainBtn.onClick(handler);
    } catch (e) {
      console.warn('[MainButton] onClick failed', e);
    }

    // Синхронный cleanup (FIXED)
    return () => {
      try {
        if (handlerRef.current && mainBtn?.offClick) mainBtn.offClick(handlerRef.current);
      } catch {}
    };
  }, [loading, error, status, handleClaim]);

  // --- 6. UI HELPERS ---
  const openTelegramLink = (url: string) => {
    const twa = twaRef.current;
    // Используем openTelegramLink TWA, с fallback на window.open
    if (twa?.openTelegramLink) {
      try {
        twa.openTelegramLink(url);
        return;
      } catch {}
    }
    window.open(url, '_blank');
  };

  // --- 7. РЕНДЕР ---
  const { bg, secondaryBg, text, hint } = themeColors;

  if (loading && !error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: bg, color: hint }}>
        Загрузка данных "Майнера"...
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="min-h-screen p-6 flex items-center justify-center" style={{ backgroundColor: bg, color: text }}>
        <div className="max-w-xl w-full rounded-xl p-6 border shadow-lg" style={{ backgroundColor: secondaryBg, borderColor: hint }}>
          <h2 className="text-2xl font-bold mb-3 text-red-500">Ошибка подключения</h2>
          <p className="mb-2" style={{ color: text }}>Приложение не может получить данные от бэкенда.</p>
          <p className="text-sm break-words mb-3" style={{ color: hint }}>
            <strong>Причина:</strong> <span className="text-yellow-300">{error || 'Нет данных от сервера.'}</span>
          </p>
          <ol className="text-sm list-decimal list-inside mb-4" style={{ color: hint }}>
            <li>Проверьте <code className="px-1 rounded" style={{ backgroundColor: hint + '20' }}>API_BASE_URL</code> / Ngrok URL.</li>
            <li>Проверьте логи Uvicorn / FastAPI.</li>
            <li>Убедитесь, что бот-токен в `.env` корректен.</li>
          </ol>
          <div className="flex gap-3 mt-4">
            <button 
              onClick={() => fetchStatus(true)} 
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold transition shadow-md shadow-blue-500/50"
            >
              Повторить
            </button>
            <button 
              onClick={() => openTelegramLink('https://t.me/telegram')} 
              className="px-4 py-2 rounded-xl border font-semibold transition" 
              style={{ borderColor: hint, color: text }}
            >
              Поддержка
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Main UI
  return (
    <div className="min-h-screen p-4 md:p-6" style={{ backgroundColor: bg, color: text }}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="p-4 rounded-2xl shadow-md border" style={{ backgroundColor: secondaryBg, borderColor: hint + '50' }}>
          <h1 className="text-xl md:text-2xl font-extrabold text-center" style={{ color: text }}>💎 Crypto Miner — TMA</h1>
          <p className="text-xs text-center mt-1" style={{ color: hint }}>User ID: <span className="font-mono text-yellow-300">{status.user_id}</span></p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Баланс */}
          <div className="p-4 rounded-xl shadow-lg border-2 border-yellow-500/50" style={{ backgroundColor: secondaryBg }}>
            <p className="text-sm font-semibold" style={{ color: hint }}>Базовый Инвестиционный Баланс</p>
            <div className="text-4xl font-black mt-2" style={{ color: text }}>
              💰 {formatBalance(status.current_base_balance)} USDT
            </div>
            <p className="text-xs mt-2" style={{ color: hint }}>Общий Баланс: <span className="font-semibold">{formatBalance(status.miner_balance)} USDT</span></p>
          </div>

          {/* Начислено */}
          <div className="p-4 rounded-xl shadow-lg" style={{ backgroundColor: secondaryBg }}>
            <p className="text-sm font-semibold" style={{ color: hint }}>Начислено (Клейм)</p>
            <div className="text-3xl font-extrabold mt-2 flex items-center gap-2 text-green-400">
              ✨ {formatEarned(status.earned_now)} USDT
            </div>
            <p className="text-sm mt-2" style={{ color: hint }}>
              Скорость: <span className="font-semibold text-cyan-400">{status.daily_rate.toFixed(1)}%</span> в день
            </p>
          </div>
        </div>

        {/* Статус */}
        <div className="p-3 rounded-xl border text-center" style={{ backgroundColor: secondaryBg, borderColor: hint + '50' }}>
          <span className={`font-semibold ${status.mining_started ? 'text-green-400' : 'text-yellow-300'}`}>
            Статус: {status.mining_started ? 'Майнинг активен' : 'Ожидает пополнения'}
          </span>
        </div>

        {/* Сообщение о клейме */}
        {claimMessage && (
          <div className={`p-4 rounded-xl text-center font-semibold transition-all ${claimMessage.startsWith('Ошибка') ? 'bg-red-900/70 text-red-200' : 'bg-green-900/70 text-green-200'}`}>
            {claimMessage}
          </div>
        )}

        {/* Кнопки */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => openTelegramLink('https://t.me/telegram')}
            className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold transition shadow-lg shadow-purple-500/50"
          >
            Как пополнить баланс?
          </button>

          <button
            onClick={() => fetchStatus(true)}
            className="w-full py-3 rounded-xl border font-semibold transition"
            style={{ borderColor: hint, color: text, backgroundColor: secondaryBg }}
          >
            Обновить статус
          </button>
        </div>

        <div className="text-xs text-center mt-6" style={{ color: hint }}>
          API: <span className="font-mono break-all">{API_BASE_URL}</span>
        </div>
      </div>
      {/* Обеспечиваем отступ для MainButton */}
      <div className="h-20"></div> 
    </div>
  );
}

export default App;