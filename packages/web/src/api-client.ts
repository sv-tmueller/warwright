import { parseWarband, type MatchEvent, type Warband } from '@warwright/core';
import { z } from 'zod';
import { findUnknownContentIds } from './warband-io.js';

// Pure DI HTTP boundary for the server's /auth, /warbands, /queue routes
// (see the sub-plan on issue #59). Imports only bare `@warwright/core` (the
// no-sim-internals guard enforces this mechanically). Every function takes
// an injectable fetch-typed function, defaulting to `globalThis.fetch`, and
// NEVER monkeypatches any global. Every result is a discriminated
// `{ok:true,value}|{ok:false,error}`; nothing here ever throws, so callers
// (thin components) render errors instead of catching exceptions.

export type FetchFn = typeof fetch;

export type ApiResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function ok<T>(value: T): ApiResult<T> {
  return { ok: true, value };
}

function err<T>(error: string): ApiResult<T> {
  return { ok: false, error };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Server-side literal string for a 409 on POST /queue (see
// packages/server/src/queue/routes.ts's GENERIC_ALREADY_QUEUED). Exported so
// online-flow.ts can recognize it without duplicating the literal.
export const ALREADY_QUEUED_ERROR = 'Already queued';

const ErrorEnvelopeSchema = z.object({ error: z.string() });

// Reads a response body as JSON, tolerating an empty body (204s) by
// resolving to `undefined` instead of throwing on `JSON.parse('')`. Never
// throws: a malformed body becomes an `{ok:false}` read result instead of an
// unhandled rejection, keeping the "components render errors, never catch
// throws" contract (see the sub-plan on issue #59).
async function safeReadJson(
  response: Response,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  try {
    const text = await response.text();
    return { ok: true, value: text.length > 0 ? JSON.parse(text) : undefined };
  } catch (error) {
    return { ok: false, error: `Malformed response body: ${describeError(error)}` };
  }
}

async function extractErrorMessage(response: Response): Promise<string> {
  const read = await safeReadJson(response);
  if (!read.ok) {
    return `Request failed with status ${response.status}`;
  }
  const parsed = ErrorEnvelopeSchema.safeParse(read.value);
  return parsed.success ? parsed.data.error : `Request failed with status ${response.status}`;
}

async function parseResponse<Z, T>(
  response: Response,
  schema: z.ZodType<Z>,
  transform: (parsed: Z) => T,
): Promise<ApiResult<T>> {
  const read = await safeReadJson(response);
  if (!read.ok) {
    return err(read.error);
  }
  const parsed = schema.safeParse(read.value);
  if (!parsed.success) {
    return err(`Malformed response: ${parsed.error.message}`);
  }
  return ok(transform(parsed.data));
}

function identity<T>(value: T): T {
  return value;
}

/**
 * Fetches a CSRF token immediately before every mutating request, never
 * cached: login/register rotate the session id and destroy the old one
 * (see server's src/auth/routes.ts rotateSession), which discards the prior
 * CSRF secret along with it, so a token fetched before that rotation 403s
 * afterward. Fetching fresh on every mutation removes the whole class of
 * bug (see the sub-plan's CSRF risk note on issue #59).
 */
async function fetchCsrfToken(fetchFn: FetchFn): Promise<ApiResult<string>> {
  const response = await fetchFn('/auth/csrf', { credentials: 'include' });
  if (!response.ok) {
    return err(await extractErrorMessage(response));
  }
  return parseResponse(response, z.object({ csrfToken: z.string() }), (parsed) => parsed.csrfToken);
}

async function mutate<Z, T = Z>(
  fetchFn: FetchFn,
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body: unknown,
  schema: z.ZodType<Z>,
  transform: (parsed: Z) => T = identity as unknown as (parsed: Z) => T,
): Promise<ApiResult<T>> {
  try {
    const csrf = await fetchCsrfToken(fetchFn);
    if (!csrf.ok) {
      return csrf;
    }

    const headers: Record<string, string> = { 'csrf-token': csrf.value };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    const response = await fetchFn(path, {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      return err(await extractErrorMessage(response));
    }

    return parseResponse(response, schema, transform);
  } catch (error) {
    return err(`Network error: ${describeError(error)}`);
  }
}

async function query<Z, T = Z>(
  fetchFn: FetchFn,
  path: string,
  schema: z.ZodType<Z>,
  transform: (parsed: Z) => T = identity as unknown as (parsed: Z) => T,
): Promise<ApiResult<T>> {
  try {
    const response = await fetchFn(path, { credentials: 'include' });
    if (!response.ok) {
      return err(await extractErrorMessage(response));
    }
    return parseResponse(response, schema, transform);
  } catch (error) {
    return err(`Network error: ${describeError(error)}`);
  }
}

// --- auth -------------------------------------------------------------

const UserSchema = z.object({ id: z.string(), email: z.string() });
export type User = z.infer<typeof UserSchema>;

export async function register(
  email: string,
  password: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<ApiResult<User>> {
  return mutate(fetchFn, '/auth/register', 'POST', { email, password }, UserSchema);
}

export async function login(
  email: string,
  password: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<ApiResult<User>> {
  return mutate(fetchFn, '/auth/login', 'POST', { email, password }, UserSchema);
}

export async function logout(fetchFn: FetchFn = globalThis.fetch): Promise<ApiResult<{ ok: true }>> {
  return mutate(fetchFn, '/auth/logout', 'POST', undefined, z.object({ ok: z.literal(true) }));
}

export async function me(fetchFn: FetchFn = globalThis.fetch): Promise<ApiResult<User>> {
  return query(fetchFn, '/auth/me', UserSchema);
}

// --- warbands -----------------------------------------------------------

const WarbandListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WarbandListItem = z.infer<typeof WarbandListItemSchema>;

const WarbandDetailSchema = WarbandListItemSchema.extend({ data: z.unknown() });
export type WarbandDetail = z.infer<typeof WarbandDetailSchema>;

export async function listWarbands(
  fetchFn: FetchFn = globalThis.fetch,
): Promise<ApiResult<WarbandListItem[]>> {
  return query(fetchFn, '/warbands', z.array(WarbandListItemSchema));
}

/**
 * Validates the build with core's own `parseWarband` (`WarbandSchema`) plus
 * the existing `findUnknownContentIds` cross-check (the same two checks the
 * server's POST /warbands route performs) BEFORE calling fetch: an invalid
 * build never reaches the network (see the sub-plan on issue #59).
 */
export async function saveWarband(
  data: unknown,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<ApiResult<WarbandDetail>> {
  let warband: Warband;
  try {
    warband = parseWarband(data);
  } catch (error) {
    return err(`Invalid warband: ${describeError(error)}`);
  }

  const unknownIds = findUnknownContentIds(warband);
  if (unknownIds.length > 0) {
    return err(`Unknown content id(s) in warband: ${unknownIds.join('; ')}`);
  }

  return mutate(fetchFn, '/warbands', 'POST', warband, WarbandDetailSchema);
}

// --- queue ----------------------------------------------------------------

// Shallow local mirror of the server's MatchResultResponseSchema (see
// packages/server/src/matches/schemas.ts's own doc comment on this
// decision): eventLog entries are validated only as passthrough objects
// (their exact shape is core's MatchEvent union, an implementation detail
// this boundary intentionally doesn't duplicate) and cast to MatchEvent[]
// here, at the trust boundary, mirroring the server's documented decision.
const MatchResultEnvelopeSchema = z.object({
  version: z.number().int(),
  seed: z.number().int(),
  hash: z.number().int(),
  winner: z.enum(['A', 'B', 'draw']),
  eventLog: z.array(z.looseObject({})),
});

export type MatchResultEnvelope = {
  readonly version: number;
  readonly seed: number;
  readonly hash: number;
  readonly winner: 'A' | 'B' | 'draw';
  readonly eventLog: readonly MatchEvent[];
};

function toMatchResultEnvelope(parsed: z.infer<typeof MatchResultEnvelopeSchema>): MatchResultEnvelope {
  return { ...parsed, eventLog: parsed.eventLog as MatchEvent[] };
}

const WaitingSchema = z.object({ status: z.literal('waiting') });
const IdleSchema = z.object({ status: z.literal('idle') });
const MatchedSchema = z.object({
  status: z.literal('matched'),
  matchId: z.string(),
  result: MatchResultEnvelopeSchema,
});

export type EnqueueOutcome =
  | { readonly status: 'waiting' }
  | { readonly status: 'matched'; readonly matchId: string; readonly result: MatchResultEnvelope };

export type QueueStatus =
  | { readonly status: 'idle' }
  | { readonly status: 'waiting' }
  | { readonly status: 'matched'; readonly matchId: string; readonly result: MatchResultEnvelope };

const EnqueueResponseSchema = z.union([MatchedSchema, WaitingSchema]);
const QueueStatusResponseSchema = z.union([MatchedSchema, WaitingSchema, IdleSchema]);

function toEnqueueOutcome(parsed: z.infer<typeof EnqueueResponseSchema>): EnqueueOutcome {
  return parsed.status === 'matched'
    ? { status: 'matched', matchId: parsed.matchId, result: toMatchResultEnvelope(parsed.result) }
    : parsed;
}

function toQueueStatus(parsed: z.infer<typeof QueueStatusResponseSchema>): QueueStatus {
  return parsed.status === 'matched'
    ? { status: 'matched', matchId: parsed.matchId, result: toMatchResultEnvelope(parsed.result) }
    : parsed;
}

export async function enqueue(
  warbandId: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<ApiResult<EnqueueOutcome>> {
  return mutate(fetchFn, '/queue', 'POST', { warbandId }, EnqueueResponseSchema, toEnqueueOutcome);
}

export async function queueStatus(fetchFn: FetchFn = globalThis.fetch): Promise<ApiResult<QueueStatus>> {
  return query(fetchFn, '/queue', QueueStatusResponseSchema, toQueueStatus);
}

export async function leaveQueue(fetchFn: FetchFn = globalThis.fetch): Promise<ApiResult<void>> {
  return mutate(fetchFn, '/queue', 'DELETE', undefined, z.void());
}
