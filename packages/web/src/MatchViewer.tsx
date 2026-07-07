import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { ChangeEvent } from 'react';
import warbandA from '../../../builds/warband-a.json' with { type: 'json' };
import warbandB from '../../../builds/warband-b.json' with { type: 'json' };
import { runClientMatch } from './match-runner.js';
import { deriveFrame } from './frame-state.js';
import { drawFrame, type Transform } from './frame-renderer.js';
import { createInitialPlaybackState, playback } from './playback.js';

const SEED = 42;
const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 540;
const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4];

const TRANSFORM: Transform = {
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  toCanvas: (pos) => pos,
};

/**
 * The match viewer: runs a fixed sample match once (memoized), drives
 * playback through the pure `playback` reducer, and draws the derived frame
 * at the current tick. `requestAnimationFrame` only dispatches `advance`
 * with an elapsed-time delta while playing - it never reads or writes the
 * event log itself, so frame timing cannot mutate any engine value (see
 * CLAUDE.md's determinism contract and the sub-plan on issue #77). Absorbs
 * the former ArenaCanvas, whose only job (the background fill) `drawFrame`
 * already does.
 */
export function MatchViewer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const log = useMemo(() => runClientMatch(SEED, warbandA, warbandB).eventLog, []);
  const lastTick = useMemo(() => {
    const lastEvent = log[log.length - 1];
    return lastEvent ? lastEvent.tick : 0;
  }, [log]);

  const [state, dispatch] = useReducer(playback, lastTick, createInitialPlaybackState);

  // Redraws whenever the displayed tick (or the log itself) changes,
  // regardless of what triggered the change: a step, a seek, or an
  // rAF-driven advance.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    drawFrame(context, deriveFrame(log, state.tick), TRANSFORM);
  }, [log, state.tick]);

  // Runs only while playing, so it starts/stops with status rather than
  // resetting every tick; that keeps `lastTimestamp` valid across frames so
  // `deltaMs` reflects real elapsed time, not a re-mounted 0.
  useEffect(() => {
    if (state.status !== 'playing') {
      return;
    }

    let frameId: number;
    let lastTimestamp: number | null = null;
    const loop = (timestamp: number): void => {
      if (lastTimestamp !== null) {
        dispatch({ type: 'advance', deltaMs: timestamp - lastTimestamp });
      }
      lastTimestamp = timestamp;
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(frameId);
  }, [state.status]);

  function handleSpeedChange(event: ChangeEvent<HTMLSelectElement>): void {
    dispatch({ type: 'setSpeed', speed: Number(event.target.value) });
  }

  function handleSeek(event: ChangeEvent<HTMLInputElement>): void {
    dispatch({ type: 'seek', tick: Number(event.target.value) });
  }

  return (
    <section>
      <h2>Match Viewer</h2>
      <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
      <div>
        <button type="button" onClick={() => dispatch({ type: 'play' })} disabled={state.status === 'playing'}>
          Play
        </button>
        <button type="button" onClick={() => dispatch({ type: 'pause' })} disabled={state.status === 'paused'}>
          Pause
        </button>
        <button type="button" onClick={() => dispatch({ type: 'step' })}>
          Step
        </button>
        <label>
          Speed
          <select value={state.speed} onChange={handleSpeedChange}>
            {SPEED_OPTIONS.map((speed) => (
              <option key={speed} value={speed}>
                {speed}x
              </option>
            ))}
          </select>
        </label>
        <label>
          Tick {state.tick} / {lastTick}
          <input
            type="range"
            min={0}
            max={lastTick}
            value={state.tick}
            onChange={handleSeek}
          />
        </label>
      </div>
    </section>
  );
}
