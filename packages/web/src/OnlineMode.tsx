import { useEffect, useRef, useState } from 'react';
import {
  enqueue,
  leaveQueue,
  listWarbands,
  login,
  logout,
  me,
  queueStatus,
  register,
  saveWarband,
  type User,
  type WarbandListItem,
} from './api-client.js';
import { interpretEnqueueResult, interpretQueueStatus, type PlaybackProps, type QueueAction } from './online-flow.js';
import { loadWarband } from './persistence.js';
import { MatchPlayback } from './MatchPlayback.js';

const POLL_INTERVAL_MS = 2000;

type QueueState =
  | { readonly status: 'idle' }
  | { readonly status: 'waiting' }
  | { readonly status: 'matched'; readonly matchId: string; readonly playback: PlaybackProps }
  | { readonly status: 'error'; readonly message: string };

/**
 * Thin online-mode panel: auth, warband save/select, and matchmaking queue
 * (see the sub-plan on issue #59). All interpretation logic lives in the
 * tested pure modules (api-client.ts, online-flow.ts); this component only
 * wires DOM events to them and owns the setTimeout poll loop — never rAF
 * (per CLAUDE.md, requestAnimationFrame drives rendering only). On a
 * matched result it renders the SAME `MatchPlayback` component the offline
 * viewer uses, keyed by matchId. Never calls runMatch/runClientMatch: every
 * online match is resolved server-side.
 */
export function OnlineMode() {
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [warbands, setWarbands] = useState<WarbandListItem[]>([]);
  const [selectedWarbandId, setSelectedWarbandId] = useState<string | null>(null);
  const [warbandError, setWarbandError] = useState<string | null>(null);

  const [queueState, setQueueState] = useState<QueueState>({ status: 'idle' });
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearPoll(): void {
    if (pollTimeoutRef.current !== null) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }

  // Cleans up any in-flight poll on unmount, so leaving online mode (or the
  // page) never leaves a dangling setTimeout.
  useEffect(() => clearPoll, []);

  async function refreshWarbands(): Promise<void> {
    const result = await listWarbands();
    if (result.ok) {
      setWarbands(result.value);
      setWarbandError(null);
    } else {
      setWarbandError(result.error);
    }
  }

  // Resumes an existing session (and loads its warbands) on mount, so a
  // page reload while authenticated doesn't force a re-login.
  useEffect(() => {
    void (async () => {
      const result = await me();
      if (result.ok) {
        setUser(result.value);
        await refreshWarbands();
      }
    })();
  }, []);

  function schedulePoll(): void {
    clearPoll();
    pollTimeoutRef.current = setTimeout(() => {
      void (async () => {
        const result = await queueStatus();
        applyQueueAction(interpretQueueStatus(result));
      })();
    }, POLL_INTERVAL_MS);
  }

  function applyQueueAction(action: QueueAction): void {
    switch (action.type) {
      case 'wait':
        setQueueState({ status: 'waiting' });
        schedulePoll();
        return;
      case 'idle':
        clearPoll();
        setQueueState({ status: 'idle' });
        return;
      case 'matched':
        clearPoll();
        setQueueState({ status: 'matched', matchId: action.matchId, playback: action.playback });
        return;
      case 'error':
        clearPoll();
        setQueueState({ status: 'error', message: action.message });
        return;
    }
  }

  async function handleRegister(): Promise<void> {
    const result = await register(email, password);
    if (result.ok) {
      setUser(result.value);
      setAuthError(null);
      await refreshWarbands();
    } else {
      setAuthError(result.error);
    }
  }

  async function handleLogin(): Promise<void> {
    const result = await login(email, password);
    if (result.ok) {
      setUser(result.value);
      setAuthError(null);
      await refreshWarbands();
    } else {
      setAuthError(result.error);
    }
  }

  async function handleLogout(): Promise<void> {
    clearPoll();
    await logout();
    setUser(null);
    setWarbands([]);
    setSelectedWarbandId(null);
    setQueueState({ status: 'idle' });
  }

  async function handleSaveDraft(): Promise<void> {
    const draft = loadWarband();
    if (!draft) {
      setWarbandError('No builder draft saved locally yet. Build one in the offline tab first.');
      return;
    }
    const result = await saveWarband(draft);
    if (result.ok) {
      setWarbandError(null);
      setSelectedWarbandId(result.value.id);
      await refreshWarbands();
    } else {
      setWarbandError(result.error);
    }
  }

  async function handleJoin(): Promise<void> {
    if (!selectedWarbandId) {
      setQueueState({ status: 'error', message: 'Select a saved warband before joining the queue.' });
      return;
    }
    const result = await enqueue(selectedWarbandId);
    applyQueueAction(interpretEnqueueResult(result));
  }

  async function handleLeave(): Promise<void> {
    clearPoll();
    await leaveQueue();
    setQueueState({ status: 'idle' });
  }

  if (queueState.status === 'matched') {
    return (
      <section>
        <h2>Online Match</h2>
        <button type="button" onClick={handleLeave}>
          Back to queue
        </button>
        <MatchPlayback
          key={queueState.matchId}
          log={queueState.playback.log}
          lastTick={queueState.playback.lastTick}
          buildAName={queueState.playback.buildAName}
          buildBName={queueState.playback.buildBName}
        />
      </section>
    );
  }

  return (
    <section>
      <h2>Online</h2>

      {user ? (
        <div>
          <p>Signed in as {user.email}</p>
          <button type="button" onClick={() => void handleLogout()}>
            Log out
          </button>
        </div>
      ) : (
        <fieldset>
          <legend>Account</legend>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button type="button" onClick={() => void handleLogin()}>
            Log in
          </button>
          <button type="button" onClick={() => void handleRegister()}>
            Register
          </button>
          {authError !== null && <p role="alert">{authError}</p>}
        </fieldset>
      )}

      {user && (
        <fieldset>
          <legend>Warbands</legend>
          <button type="button" onClick={() => void handleSaveDraft()}>
            Save builder draft
          </button>
          <label>
            Selected warband
            <select
              value={selectedWarbandId ?? ''}
              onChange={(event) => setSelectedWarbandId(event.target.value || null)}
            >
              <option value="">Select a warband</option>
              {warbands.map((warband) => (
                <option key={warband.id} value={warband.id}>
                  {warband.name}
                </option>
              ))}
            </select>
          </label>
          {warbandError !== null && <p role="alert">{warbandError}</p>}
        </fieldset>
      )}

      {user && (
        <fieldset>
          <legend>Queue</legend>
          {queueState.status === 'waiting' ? (
            <>
              <p>Waiting for an opponent…</p>
              <button type="button" onClick={() => void handleLeave()}>
                Leave queue
              </button>
            </>
          ) : (
            <button type="button" onClick={() => void handleJoin()} disabled={!selectedWarbandId}>
              Join queue
            </button>
          )}
          {queueState.status === 'error' && <p role="alert">{queueState.message}</p>}
        </fieldset>
      )}
    </section>
  );
}
