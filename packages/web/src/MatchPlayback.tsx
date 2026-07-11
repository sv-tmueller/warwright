import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { ChangeEvent } from 'react';
import type { MatchEvent } from '@warwright/core';
import { deriveFrame } from './frame-state.js';
import { drawFrame, type Transform } from './frame-renderer.js';
import { createInitialPlaybackState, playback } from './playback.js';
import { buildFeed } from './event-feed.js';
import { EventFeed } from './EventFeed.js';
import { Hud } from './Hud.js';

const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 540;
const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4];

const TRANSFORM: Transform = {
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  toCanvas: (pos) => pos,
};

export type MatchPlaybackProps = {
  readonly log: readonly MatchEvent[];
  readonly lastTick: number;
  readonly buildAName: string;
  readonly buildBName: string;
};

/**
 * Drives playback of one already-resolved match through the pure `playback`
 * reducer, and draws the derived frame at the current tick.
 * `requestAnimationFrame` only dispatches `advance` with an elapsed-time
 * delta while playing - it never reads or writes the event log itself, so
 * frame timing cannot mutate any engine value (see CLAUDE.md's determinism
 * contract and the sub-plan on issue #77). Absorbs the former ArenaCanvas,
 * whose only job (the background fill) `drawFrame` already does.
 *
 * Extracted verbatim out of MatchViewer (see the sub-plan on issue #93) so
 * MatchViewer can remount a fresh instance, keyed by run, whenever a new
 * match is resolved - giving exact playback from tick 0 with zero reducer
 * changes.
 */
export function MatchPlayback({ log, lastTick, buildAName, buildBName }: MatchPlaybackProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [state, dispatch] = useReducer(playback, lastTick, createInitialPlaybackState);

  // Behavior-preserving refactor: the draw effect below used to derive the
  // frame inline; hoisting it lets the Hud consume the same FrameState
  // without a second derivation (see the sub-plan on issue #52).
  const frame = useMemo(() => deriveFrame(log, state.tick), [log, state.tick]);
  const feed = useMemo(() => buildFeed(log), [log]);

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
    drawFrame(context, frame, TRANSFORM);
  }, [frame]);

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
      <Hud
        frame={frame}
        speed={state.speed}
        lastTick={lastTick}
        buildAName={buildAName}
        buildBName={buildBName}
      />
      <EventFeed entries={feed} currentTick={state.tick} />
    </section>
  );
}
