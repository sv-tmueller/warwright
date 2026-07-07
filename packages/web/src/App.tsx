import { RULESET_VERSION } from '@warwright/core';
import { MatchViewer } from './MatchViewer.js';
import { WarbandBuilder } from './WarbandBuilder.js';

export function App() {
  return (
    <div>
      <h1>Warwright</h1>
      <p>Ruleset version: {RULESET_VERSION}</p>
      <MatchViewer />
      <WarbandBuilder />
    </div>
  );
}
