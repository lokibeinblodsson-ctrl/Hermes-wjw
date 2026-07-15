import { useState } from 'react';
import { login, signup, type AuthUser } from '../api';

interface Props {
  onAuth: (user: AuthUser, token: string) => void;
}

export function Login({ onAuth }: Props) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      const data =
        mode === 'login'
          ? await login(username, password)
          : await signup(username, password, displayName);
      onAuth(data.user, data.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper p-4">
      <div className="w-full max-w-sm rounded-2xl bg-paper-2 p-6 shadow-xl">
        <h1 className="text-lg font-semibold text-charcoal">Wild Jazmine Wellness</h1>
        <p className="mb-4 text-[11px] text-charcoal-soft">
          Content · Training · Community planner
        </p>

        <div className="mb-4 flex gap-2 text-sm">
          <button
            className={`flex-1 rounded-md py-1.5 ${mode === 'login' ? 'bg-dusty-deep text-white' : 'bg-white text-charcoal-soft'}`}
            onClick={() => setMode('login')}
          >
            Log in
          </button>
          <button
            className={`flex-1 rounded-md py-1.5 ${mode === 'signup' ? 'bg-dusty-deep text-white' : 'bg-white text-charcoal-soft'}`}
            onClick={() => setMode('signup')}
          >
            Sign up
          </button>
        </div>

        {mode === 'signup' && (
          <input
            className="mb-2 w-full rounded-md border border-beige-deep bg-white px-3 py-2 text-sm outline-none focus:border-dusty-deep"
            placeholder="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        )}
        <input
          className="mb-2 w-full rounded-md border border-beige-deep bg-white px-3 py-2 text-sm outline-none focus:border-dusty-deep"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className="mb-3 w-full rounded-md border border-beige-deep bg-white px-3 py-2 text-sm outline-none focus:border-dusty-deep"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="mb-2 text-xs text-red-700">{error}</p>}

        <button
          onClick={submit}
          disabled={busy}
          className="w-full rounded-md bg-dusty-deep py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? '…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>

        {mode === 'signup' && (
          <p className="mt-3 text-[10px] text-charcoal-soft/70">
            First account created becomes the team admin.
          </p>
        )}
      </div>
    </div>
  );
}
