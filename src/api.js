const pagePath = window.location.pathname.toLowerCase();
const PORTAL_SCOPE = pagePath.includes('support') ? 'support'
  : pagePath.includes('sales') ? 'sales'
    : pagePath.includes('admin') ? 'admin' : 'customer';
const TOKEN_KEY = `aronage_session_${PORTAL_SCOPE}`;
let responseCsrfToken = '';
// Only a non-secret UI marker is kept in browser storage. The authenticated
// session itself lives in a portal-scoped HttpOnly cookie.
export const getToken = () => sessionStorage.getItem(TOKEN_KEY) === 'cookie' ? 'cookie' : null;
export const setToken = value => {
  if (value === null) {
    responseCsrfToken = '';
    sessionStorage.removeItem(TOKEN_KEY);
    return;
  }
  sessionStorage.setItem(TOKEN_KEY, 'cookie');
};
const readCookie = name => document.cookie.split('; ').find(item => item.startsWith(`${name}=`))?.slice(name.length + 1) || '';
const csrfToken = () => responseCsrfToken || decodeURIComponent(readCookie(`aronage_csrf_${PORTAL_SCOPE}`));

export async function api(path, options = {}) {
  const token = getToken();
  const apiBase = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  const isFormData = options.body instanceof FormData;
  const response = await fetch(`${apiBase}/api${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
      // The four portals intentionally use separate cookies on the same host.
      // Tell the API which portal initiated the request so another portal's
      // stale cookie cannot be selected first by the server.
      'X-Aronage-Portal': PORTAL_SCOPE,
      ...(!['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase()) && token ? { 'X-CSRF-Token': csrfToken() } : {}),
      ...(options.headers || {}),
    },
    body: options.body && typeof options.body !== 'string' && !isFormData ? JSON.stringify(options.body) : options.body,
  });
  const data = await response.json().catch(() => ({}));
  // Keep the CSRF value issued for this exact session in memory. The readable
  // cookie remains the refresh fallback, while this avoids browser/platform
  // cookie-visibility races immediately after login and session rotation.
  if (response.ok && typeof data.csrfToken === 'string' && data.csrfToken) {
    responseCsrfToken = data.csrfToken;
  }
  if (!response.ok) {
    if (response.status === 401) setToken(null);
    const error = new Error(data.error || 'ارتباط با سامانه برقرار نشد.');
    error.status = response.status;
    error.fields = data.fields;
    throw error;
  }
  return data;
}

export function subscribeEvents(path, onEvent, onState = () => {}) {
  const controller = new AbortController();
  const apiBase = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  let lastEventId = sessionStorage.getItem(`aronage_last_event:${path}`) || '';
  let retry = 1000;
  let stopped = false;
  const connect = async () => {
    if (stopped) return;
    onState('connecting');
    try {
      const response = await fetch(`${apiBase}/api${path}`, {
        headers: {
          Accept: 'text/event-stream',
          'X-Aronage-Portal': PORTAL_SCOPE,
          ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
        },
        cache: 'no-store',
        credentials: 'include',
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error('اتصال زنده برقرار نشد.');
      onState('connected');
      retry = 1000;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          if (!frame.trim() || frame.startsWith(':')) continue;
          let eventName = 'message';
          let id = '';
          const data = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('id:')) id = line.slice(3).trim();
            else if (line.startsWith('data:')) data.push(line.slice(5).trim());
          }
          if (id) {
            lastEventId = id;
            sessionStorage.setItem(`aronage_last_event:${path}`, id);
          }
          let payload = {};
          try { payload = JSON.parse(data.join('\n') || '{}'); } catch {}
          onEvent({ event: eventName, id, data: payload });
        }
      }
      if (!stopped) throw new Error('اتصال زنده بسته شد.');
    } catch (error) {
      if (stopped || error.name === 'AbortError') return;
      onState('disconnected');
      const wait = retry + Math.floor(Math.random() * 250);
      retry = Math.min(30_000, retry * 2);
      window.setTimeout(connect, wait);
    }
  };
  connect();
  return () => {
    stopped = true;
    controller.abort();
    onState('closed');
  };
}

export async function downloadApiFile(path, filename = 'download') {
  const apiBase = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  const response = await fetch(`${apiBase}/api${path}`, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'دریافت فایل ناموفق بود.');
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function getApiFileObjectUrl(path) {
  const apiBase = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  const response = await fetch(`${apiBase}/api${path}`, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('پیش‌نمایش امن فایل در دسترس نیست.');
  return URL.createObjectURL(await response.blob());
}

const CART_KEY = 'aronage_cart';
export function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
  catch { return []; }
}
export function saveCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent('aronage:cart', { detail: items }));
}
export function addToCart(productId, quantity = 1, variantId = null) {
  const items = getCart();
  const current = items.find(item => item.productId === productId && (item.variantId || null) === variantId);
  if (current) current.quantity = Math.min(20, current.quantity + quantity);
  else items.push({ productId, variantId, quantity });
  saveCart(items);
  return items;
}

export async function syncCart(mode = 'merge', items = getCart()) {
  if (!getToken()) return items;
  const result = await api('/cart', { method: 'PUT', body: { mode, items } });
  saveCart(result.items || []);
  return result.items || [];
}
