import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WarbandSchema } from '@warwright/core';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

// This is a throwaway route, registered only inside this test, proving Zod
// request validation reuses core's own schemas (WarbandSchema) end to end
// through Fastify. It is never registered in buildApp() / the real app, so
// this ships no product endpoint for #55-#58.
function registerThrowawayWarbandRoute(app: ReturnType<typeof buildApp>): void {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/__test/warband',
    { schema: { body: WarbandSchema } },
    async (request) => request.body
  );
}

const sampleWarbandPath = fileURLToPath(
  new URL('../../../builds/warband-a.json', import.meta.url)
);
const sampleWarband: Record<string, unknown> = JSON.parse(
  readFileSync(sampleWarbandPath, 'utf-8')
) as Record<string, unknown>;

describe('Zod validation reuses core schemas', () => {
  it('rejects an illegal build with 400', async () => {
    const app = buildApp();
    registerThrowawayWarbandRoute(app);

    const response = await app.inject({
      method: 'POST',
      url: '/__test/warband',
      payload: { name: 'Broken', units: [] },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('accepts a real warband build with 200', async () => {
    const app = buildApp();
    registerThrowawayWarbandRoute(app);

    const response = await app.inject({
      method: 'POST',
      url: '/__test/warband',
      payload: sampleWarband,
    });

    expect(response.statusCode).toBe(200);
    // The echoed body is the PARSED (Zod-validated) request, not the raw
    // payload: WarbandSchema defaults each unit's augmentIds to [] (see
    // core's UnitBuildSchema), so the response carries that field even
    // though the raw fixture predates it.
    const sampleWarbandUnits = (sampleWarband as { units: Array<Record<string, unknown>> }).units;
    expect(response.json()).toEqual({
      ...sampleWarband,
      units: sampleWarbandUnits.map((unit) => ({ ...unit, augmentIds: [] })),
    });

    await app.close();
  });
});
