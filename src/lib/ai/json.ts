/**
 * Server and browser safe, no dependencies. Two jobs:
 *
 *   extractJson   pull a JSON value out of model text (code fences, <think> blocks,
 *                 a sentence before or after the object)
 *   validate      check a value against the small JSON Schema subset our tasks use
 *
 * Providers constrain output to a schema, but a free-tier model or a fallback
 * route may not honour it, and a health app must not act on a half-shaped answer.
 */

import type { JsonSchema } from "./types";

/** Removes reasoning blocks some models inline in their answer. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();
}

function balancedSlice(text: string, start: number): string | null {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** The first JSON object or array in the text, or `undefined`. */
export function extractJson(raw: string): unknown {
  const text = stripThinking(raw).replace(/^﻿/, "").trim();
  if (!text) return undefined;
  const direct = tryParse(text);
  if (direct !== undefined) return direct;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) {
    const v = tryParse(fenced[1].trim());
    if (v !== undefined) return v;
  }
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{" && text[i] !== "[") continue;
    const slice = balancedSlice(text, i);
    if (slice) {
      const v = tryParse(slice);
      if (v !== undefined && typeof v === "object" && v !== null) return v;
    }
  }
  return undefined;
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    // Trailing commas are the commonest slip.
    try {
      return JSON.parse(s.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return undefined;
    }
  }
}

type Schema = Record<string, unknown>;

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function matchesType(v: unknown, t: string): boolean {
  const actual = typeOf(v);
  if (t === "number") return actual === "number" || actual === "integer";
  return actual === t;
}

/** Returns a list of problems; empty means the value fits the schema. */
export function validate(schema: JsonSchema, value: unknown, path = "$"): string[] {
  const s = schema as Schema;
  const errors: string[] = [];
  const types = Array.isArray(s.type) ? (s.type as string[]) : typeof s.type === "string" ? [s.type] : [];
  const nullable = s.nullable === true;
  if (value === null && (nullable || types.includes("null"))) return errors;
  if (types.length && !types.some((t) => matchesType(value, t))) {
    errors.push(`${path}: expected ${types.join("|")}, got ${typeOf(value)}`);
    return errors;
  }
  if (Array.isArray(s.enum) && !(s.enum as unknown[]).some((e) => e === value)) errors.push(`${path}: not one of ${JSON.stringify(s.enum)}`);
  if ("const" in s && s.const !== value) errors.push(`${path}: must equal ${JSON.stringify(s.const)}`);
  if (typeof value === "string") {
    if (typeof s.minLength === "number" && value.length < s.minLength) errors.push(`${path}: shorter than ${s.minLength}`);
    if (typeof s.maxLength === "number" && value.length > s.maxLength) errors.push(`${path}: longer than ${s.maxLength}`);
  }
  if (typeof value === "number") {
    if (typeof s.minimum === "number" && value < s.minimum) errors.push(`${path}: below ${s.minimum}`);
    if (typeof s.maximum === "number" && value > s.maximum) errors.push(`${path}: above ${s.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof s.minItems === "number" && value.length < s.minItems) errors.push(`${path}: fewer than ${s.minItems} items`);
    if (typeof s.maxItems === "number" && value.length > s.maxItems) errors.push(`${path}: more than ${s.maxItems} items`);
    if (s.items && typeof s.items === "object") value.forEach((item, i) => errors.push(...validate(s.items as JsonSchema, item, `${path}[${i}]`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = (s.properties ?? {}) as Record<string, JsonSchema>;
    for (const name of (s.required as string[] | undefined) ?? []) {
      if (!(name in obj) || obj[name] === undefined) errors.push(`${path}.${name}: missing`);
    }
    for (const [name, sub] of Object.entries(props)) {
      if (name in obj && obj[name] !== undefined) errors.push(...validate(sub, obj[name], `${path}.${name}`));
    }
    if (s.additionalProperties === false) {
      for (const name of Object.keys(obj)) if (!(name in props)) errors.push(`${path}.${name}: not allowed`);
    }
  }
  return errors;
}

/** Drops JSON Schema meta keys providers reject ($schema, $id, $comment, examples). */
export function cleanSchema<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map((s) => cleanSchema(s)) as unknown as T;
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (k === "$schema" || k === "$id" || k === "$comment" || k === "examples") continue;
      out[k] = cleanSchema(v);
    }
    return out as T;
  }
  return schema;
}

/**
 * True when every object in the schema lists all its properties as required and
 * forbids extras, i.e. a provider's strict constrained decoding accepts it.
 */
export function isStrictCompatible(schema: JsonSchema): boolean {
  const s = schema as Schema;
  if (s.type === "object" || s.properties) {
    const props = Object.keys((s.properties ?? {}) as Record<string, unknown>);
    const required = (s.required as string[] | undefined) ?? [];
    if (s.additionalProperties !== false) return false;
    if (!props.every((p) => required.includes(p))) return false;
    if (!props.every((p) => isStrictCompatible((s.properties as Record<string, JsonSchema>)[p]))) return false;
  }
  if (s.items && typeof s.items === "object" && !isStrictCompatible(s.items as JsonSchema)) return false;
  return true;
}
