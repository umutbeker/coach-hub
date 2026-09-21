// lib/store.ts
// Redis access for the coaching tools. Each collection is one Redis hash
// (field = record id), so a collection is read in one round trip and a record
// is written without rewriting its siblings. A single JSON array per
// collection would hit Upstash's value size limit after a season of scrims.
//
// Server-only: import from API routes, never from pages.

import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export const KEYS = {
  scrims: 'scrims:v1',
  vods: 'vods-lib:v1',
  notes: (vodId: string) => `vodnotes:v1:${vodId}`,
  pool: 'pool:v1',
  prep: 'prep:v1',
  reports: 'oppreport:v1',
  calendar: 'calendar:v1',
  draftSaves: 'drafts:saved:v1',
} as const;

export async function all<T>(key: string): Promise<T[]> {
  const h = await redis.hgetall<Record<string, T>>(key);
  return h ? Object.values(h) : [];
}

export async function allMap<T>(key: string): Promise<Record<string, T>> {
  return (await redis.hgetall<Record<string, T>>(key)) ?? {};
}

export async function get<T>(key: string, id: string): Promise<T | null> {
  return (await redis.hget<T>(key, id)) ?? null;
}

export async function put<T>(key: string, id: string, value: T) {
  await redis.hset(key, { [id]: value });
}

export async function putMany<T>(key: string, values: Record<string, T>) {
  if (Object.keys(values).length) await redis.hset(key, values);
}

export async function remove(key: string, id: string) {
  await redis.hdel(key, id);
}

export async function drop(key: string) {
  await redis.del(key);
}

/** Reads many hashes in one pipeline — used to gather notes across VODs. */
export async function allAcross<T>(keys: string[]): Promise<T[]> {
  if (!keys.length) return [];
  const p = redis.pipeline();
  keys.forEach(k => p.hgetall(k));
  const res = (await p.exec()) as (Record<string, T> | null)[];
  return res.flatMap(h => (h ? Object.values(h) : []));
}
