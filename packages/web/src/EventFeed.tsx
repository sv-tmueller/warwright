import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { feedIndexForTick, type FeedEntry } from './event-feed.js';

export type EventFeedProps = {
  readonly entries: readonly FeedEntry[];
  readonly currentTick: number;
};

const LIST_STYLE: CSSProperties = {
  maxHeight: 320,
  overflowY: 'auto',
  listStyle: 'none',
  margin: 0,
  padding: 0,
  fontFamily: 'monospace',
  fontSize: 13,
};

/**
 * Thin, untested-by-convention component (see the sub-plan on issue #52,
 * mirroring MatchViewer's own untested-component pattern): all logic lives
 * in event-feed.ts. The highlighted entry is a pure function of
 * (entries, currentTick) via feedIndexForTick, so seek/step sync falls out
 * of the playback reducer's already-tested exactness. The scroll effect
 * keys off React state only - no rAF, no timers.
 */
export function EventFeed({ entries, currentTick }: EventFeedProps) {
  const highlightIndex = useMemo(
    () => feedIndexForTick(entries, currentTick),
    [entries, currentTick],
  );
  const highlightRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex]);

  return (
    <section>
      <h3>Event Feed</h3>
      <ul style={LIST_STYLE}>
        {entries.map((entry) => {
          const isHighlighted = entry.index === highlightIndex;
          const isFuture = entry.index > highlightIndex;
          return (
            <li
              key={entry.index}
              ref={isHighlighted ? highlightRef : undefined}
              style={{
                fontWeight: isHighlighted ? 'bold' : 'normal',
                opacity: isFuture ? 0.5 : 1,
              }}
            >
              t{entry.tick} · {entry.text}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
