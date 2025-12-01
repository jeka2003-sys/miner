// src/App.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

// ================================================
// ========== CONFIG: Replace via .env =============
// Put your ngrok URL in .env as REACT_APP_API_URL
// e.g. REACT_APP_API_URL=https://coeducational-unconstrained-roxanne.ngrok-free.dev
// =================================================
const API_BASE_URL = process.env.REACT_APP_API_URL || 'https://REPLACE_WITH_NGROK_URL';
// =================================================

/**
 * We use window.Telegram.WebApp directly (no SDK).
 * When running outside Telegram WebApp, TWA will be null.
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

function App(): JSX.Element {
  // TWA references
  const [twaReady, setTwaReady] = useState(false);
  const [initData, setInitData] = useState<string>('');
  const twaRef = useRef<any>(null);
  const mainButtonRef = useRef<any>(null);

  // App state
  const [status, setStatus] = useState<MinerStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [claimMessage, setClaimMessage] = useState<string | null>(null);

  // Internal refs for fetch control and handler
  const fetchInFlightRef = useRef(false);
  const handlerRef = useRef<() => void | null>(null);
  const lastFetchTimeRef = useRef<number>(0);

  // Helper to set fatal error
  const setFatalError = (msg: string) => {
    console.error('[App] Fatal:', msg);
    setError(msg);
    setLoading(false);
    setStatus(null);
  };

  // Initialize TWA (if available)
  useEffect(() => {
    const twa = getTwa();
    if (!twa) {
      console.warn('[App] Telegram WebApp not found (opening in normal browser).');
      twaRef.current = null;
      setTwaReady(false);
      // keep loading true for a moment while we try to fetch? we'll handle below
      setLoading(false);
      setError('Telegram WebApp not found. Open this page inside Telegram to use WebApp features.');
      return;
    }

    twaRef.current = twa;
    try {
      // Ensure ready and pull initData AFTER ready()
      twa.ready?.();
      twa.expand?.();
      const id = twa.initData || '';
      setInitData(id);
      setTwaReady(true);
      setError(null);
      // subscribe to theme changes
      const onTheme = () => {
        try {
          document.body.style.backgroundColor = twa.themeParams?.bg_color || '#0f1724';
        } catch (e) {
          // ignore
        }
      };
      twa.onEvent?.('themeChanged', onTheme);
      onTheme();
    } catch (e) {
      console.error('[App] Error initializing TWA:', e);
      setTwaReady(false);
      setError('Ошибка инициализации Telegram WebApp.');
    }

    return () => {
      try {
        twa.onEvent?.('themeChanged', null);
      } catch {}
    };
  }, []);

  // fetchStatus: robust, with AbortController and prevention of parallel calls
  const fetchStatus = useCallback(async (force = false) => {
    // Prevent too-frequent requests (simple throttle): allow once per 2s unless forced
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

    // require initData when running inside TWA; but if running outside TWA we may still try
    const curInit = initData;
    if (twaRef.current && !curInit) {
      setLoading(false);
      setError('ОШИБКА: Telegram WebApp Init Data отсутствует. Запустите во внутреннем браузере Telegram.');
      return;
    }

    fetchInFlightRef.current = true;
    setError(null);
    // keep loading true only for initial load
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
  }, [initData, status]);

  // Claim handler
  const handleClaim = useCallback(async () => {
    if (!initData || !status) {
      console.warn('[handleClaim] no initData or no status');
      return;
    }
    const mainBtn = mainButtonRef.current;
    try {
      mainBtn?.disable?.();
    } catch {}

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

      // refresh status after claim
      await fetchStatus(true);
    } catch (err: any) {
      console.error('[handleClaim] claim error:', err);
      setClaimMessage(err instanceof Error ? `Ошибка клейма: ${err.message}` : 'Неизвестная ошибка при клейме.');
    } finally {
      // clear message after short time
      setTimeout(() => setClaimMessage(null), 5000);
    }
  }, [initData, status, fetchStatus]);

  // Effect: tie MainButton (create/subscribe/unsubscribe safely)
  useEffect(() => {
    const twa = twaRef.current;
    if (!twa) return;

    // ensure mainButton ref is current
    try {
      mainButtonRef.current = twa.MainButton;
    } catch {}

    const mainBtn = mainButtonRef.current;
    // If no main button or loading/error/no status -> hide
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
      // ignore
    }

    if (earned > 0.0001) {
      mainBtn.enable?.();
    } else {
      mainBtn.disable?.();
      mainBtn.setText?.(`МАЙНИНГ АКТИВЕН (${status.daily_rate.toFixed(1)}%)`);
    }

    // Handler management: remove previous then add new
    const handler = () => handleClaim();
    // store to ref so cleanup can access
    if (handlerRef.current && mainBtn?.offClick) {
      try {
        mainBtn.offClick(handlerRef.current);
      } catch {}
    }
    handlerRef.current = handler;
    try {
      mainBtn.onClick(handler);
    } catch (e) {
      console.warn('[MainButton] onClick failed', e);
    }

    return () => {
      try {
        if (handlerRef.current && mainBtn?.offClick) mainBtn.offClick(handlerRef.current);
      } catch {}
    };
  }, [loading, error, status, handleClaim]);

  // Auto initial fetch once TWA ready (or even if not in TWA we try once)
  useEffect(() => {
    // initial fetch
    fetchStatus();
    // refresh every 60s while app mounted
    const interval = setInterval(() => fetchStatus(), 60_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Theme update on mount (in case twa was available after init)
  useEffect(() => {
    const twa = twaRef.current;
    if (!twa) return;
    try {
      document.body.style.backgroundColor = twa.themeParams?.bg_color || '#0f1724';
    } catch {}
  }, []);

  // UI helpers
  const openTelegramLink = (url: string) => {
    const twa = twaRef.current;
    if (twa?.openTelegramLink) {
      try {
        twa.openTelegramLink(url);
        return;
      } catch (e) {
        console.warn('[openTelegramLink] twa failed, falling back', e);
      }
    }
    window.open(url, '_blank');
  };

  // Render
  if (loading && !error) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-900 text-gray-300">Загрузка данных "Майнера"...</div>;
  }

  if (error || !status) {
    return (
      <div className="min-h-screen p-6 bg-slate-900 text-gray-200 flex items-center justify-center">
        <div className="max-w-xl w-full bg-slate-800/60 rounded-xl p-6 border border-slate-700 shadow-lg">
          <h2 className="text-2xl font-bold mb-3">Ошибка подключения</h2>
          <p className="mb-2">Приложение не может получить данные от бэкенда.</p>
          <p className="text-sm break-words mb-3"><strong>Причина:</strong> <span className="text-yellow-300">{error || 'Нет данных от сервера.'}</span></p>
          <ol className="text-sm list-decimal list-inside text-gray-400 mb-4">
            <li>Проверьте <code className="bg-slate-700 px-1 rounded">REACT_APP_API_URL</code> / Ngrok URL.</li>
            <li>Проверьте логи Uvicorn / FastAPI (401, 500 и т.д.).</li>
            <li>Убедитесь, что бот-токен и переменные окружения корректны.</li>
          </ol>
          <div className="flex gap-3">
            <button onClick={() => fetchStatus(true)} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white">Повторить</button>
            <button onClick={() => openTelegramLink('https://t.me/telegram')} className="px-4 py-2 rounded border border-slate-600 text-slate-200">Открыть Telegram</button>
          </div>
          <div className="mt-4 text-xs text-gray-500">
            Если вы тестируете в браузере — многие WebApp функции (MainButton, initData) будут недоступны.
          </div>
        </div>
      </div>
    );
  }

  // Main UI
  return (
    <div className="min-h-screen p-6 bg-slate-900 text-white">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="bg-gradient-to-r from-slate-800/80 to-slate-700/60 p-4 rounded-2xl shadow-md border border-slate-700">
          <h1 className="text-xl md:text-2xl font-extrabold text-center">💎 Crypto Miner — TMA</h1>
          <p className="text-xs text-center text-gray-400 mt-1">User ID: <span className="font-mono text-yellow-300">{status.user_id}</span></p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-slate-800/70 border border-slate-700 shadow">
            <p className="text-sm text-gray-400">Base Investment Balance</p>
            <div className="text-4xl font-extrabold mt-2">💰 {formatBalance(status.current_base_balance)} USDT</div>
            <p className="text-xs text-gray-500 mt-2">Miner Balance: <span className="font-semibold">{formatBalance(status.miner_balance)} USDT</span></p>
          </div>

          <div className="p-4 rounded-xl bg-slate-800/70 border border-slate-700 shadow">
            <p className="text-sm text-gray-400">Accrued since last claim</p>
            <div className="text-3xl font-bold mt-2 flex items-center gap-2">✨ {formatEarned(status.earned_now)} USDT</div>
            <p className="text-xs text-gray-500 mt-2">Rate: <span className="font-semibold text-cyan-300">{status.daily_rate.toFixed(1)}%</span> / day</p>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-800/60 border border-slate-700 text-center">
          <span className={`font-semibold ${status.mining_started ? 'text-green-400' : 'text-yellow-300'}`}>
            Статус: {status.mining_started ? 'Майнинг активен' : 'Ожидает пополнения'}
          </span>
        </div>

        {claimMessage && (
          <div className={`p-3 rounded-lg text-center font-semibold ${claimMessage.startsWith('Ошибка') ? 'bg-red-900 text-red-200' : 'bg-green-900 text-green-200'}`}>
            {claimMessage}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => openTelegramLink('https://t.me/telegram')}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold"
          >
            Как пополнить баланс?
          </button>

          <button
            onClick={() => fetchStatus(true)}
            className="w-full py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold border border-slate-600"
          >
            Обновить статус
          </button>
        </div>

        <div className="text-xs text-gray-400 text-center">
          API: <span className="font-mono">{API_BASE_URL}</span>
        </div>
      </div>
    </div>
  );
}

export default App;
