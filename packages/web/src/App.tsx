import { useState } from 'react';
import { RULESET_VERSION } from '@warwright/core';
import { MatchViewer } from './MatchViewer.js';
import { WarbandBuilder } from './WarbandBuilder.js';
import { OnlineMode } from './OnlineMode.js';

type Mode = 'offline' | 'online';

export function App() {
  const [mode, setMode] = useState<Mode>('offline');

  return (
    <div>
      <h1>Warwright</h1>
      <p>Ruleset version: {RULESET_VERSION}</p>
      <nav>
        <button type="button" onClick={() => setMode('offline')} disabled={mode === 'offline'}>
          Offline
        </button>
        <button type="button" onClick={() => setMode('online')} disabled={mode === 'online'}>
          Online
        </button>
      </nav>
      {mode === 'offline' ? (
        <>
          <MatchViewer />
          <WarbandBuilder />
        </>
      ) : (
        <OnlineMode />
      )}
    </div>
  );
}
