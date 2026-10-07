import { randomUUID } from 'node:crypto';
import { badRequest } from '../src/lib/errors.ts';

export type Row = Record<string, any>;
export type Obj = Record<string, unknown>;
export const newId = () => randomUUID();
export const iso = (d: Date) => d.toISOString();

export function obj(v: unknown): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest('A JSON object body is required');
  return v as Obj;
}
export function reqStr(o: Obj, k: string, min = 1, max = 1000): string {
  const v = o[k];
  if (typeof v !== 'string') throw badRequest(`${k} must be a string`);
  const t = v.trim();
  if (t.length < min || t.length > max) throw badRequest(`${k} must be ${min}-${max} characters`);
  return t;
}
export function optStr(o: Obj, k: string, max = 5000): string | undefined {
  if (o[k] === undefined || o[k] === null) return undefined;
  return reqStr(o, k, 0, max);
}
export function reqInt(o: Obj, k: string, min: number, max: number): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw badRequest(`${k} must be an integer ${min}-${max}`);
  return v;
}
export function optInt(o: Obj, k: string, min: number, max: number): number | undefined {
  return o[k] === undefined || o[k] === null ? undefined : reqInt(o, k, min, max);
}
export function optBool(o: Obj, k: string): boolean | undefined {
  if (o[k] === undefined) return undefined;
  if (typeof o[k] !== 'boolean') throw badRequest(`${k} must be true or false`);
  return o[k] as boolean;
}
export function oneOf<T extends string>(o: Obj, k: string, list: readonly T[]): T {
  const v = o[k];
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw badRequest(`${k} must be one of: ${list.join(', ')}`);
  return v as T;
}
export function optOneOf<T extends string>(o: Obj, k: string, list: readonly T[]): T | undefined {
  return o[k] === undefined ? undefined : oneOf(o, k, list);
}
export function reqArr(o: Obj, k: string, min: number, max: number): unknown[] {
  const v = o[k];
  if (!Array.isArray(v) || v.length < min || v.length > max) throw badRequest(`${k} must be a list of ${min}-${max} items`);
  return v;
}
export function reqDate(o: Obj, k: string): Date {
  const v = o[k];
  const d = typeof v === 'string' ? new Date(v) : new Date(NaN);
  if (Number.isNaN(d.getTime())) throw badRequest(`${k} must be an ISO date-time`);
  return d;
}
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'course';
