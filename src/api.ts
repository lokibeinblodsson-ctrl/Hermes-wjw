// Frontend API client for the WJW backend.
// Auth token is kept in localStorage; all board + chat calls go through it.

const TOKEN_KEY = 'wjw-token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'member';
}

async function req(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  };
  const tok = getToken();
  if (tok) headers['Authorization'] = `Bearer ${tok}`;
  const res = await fetch(`/api${path}`, { ...opts, headers });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).error || '';
    } catch {
      /* ignore */
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return res;
}

export async function signup(username: string, password: string, displayName: string) {
  const res = await req('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ username, password, displayName }),
  });
  return res.json();
}

export async function login(username: string, password: string) {
  const res = await req('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return res.json();
}

export async function me(): Promise<{ user: AuthUser }> {
  const res = await req('/auth/me');
  return res.json();
}

export async function loadBoard(): Promise<unknown[]> {
  const res = await req('/board');
  return res.json();
}

export async function saveBoard(cards: unknown[]): Promise<void> {
  await req('/board', { method: 'POST', body: JSON.stringify(cards) });
}

// Streamed Hermes chat. Returns the full assistant text (accumulated).
export async function streamChat(
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  onDelta: (delta: string) => void,
): Promise<string> {
  const res = await req('/hermes/chat', {
    method: 'POST',
    body: JSON.stringify({ messages, stream: true }),
  });
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content || '';
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        /* ignore partial */
      }
    }
  }
  return full;
}
