import { useEffect, useRef } from 'react';

const ARENA_BACKGROUND = '#101820';

/**
 * Draws an empty arena background. requestAnimationFrame drives rendering
 * only; it never reads or advances sim state.
 */
export function ArenaCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    let frameId: number;
    const draw = (): void => {
      context.fillStyle = ARENA_BACKGROUND;
      context.fillRect(0, 0, canvas.width, canvas.height);
      frameId = requestAnimationFrame(draw);
    };
    frameId = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(frameId);
  }, []);

  return <canvas ref={canvasRef} width={960} height={540} />;
}
