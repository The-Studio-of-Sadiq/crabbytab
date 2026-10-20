/**
 * A small schema language for the REST API: each schema validates untrusted JSON into a typed
 * value AND describes itself as JSON Schema (OpenAPI 3.1 uses JSON Schema 2020-12), so request
 * validation and the published OpenAPI document cannot drift apart.
 */

export type JsonSchema = { [key: string]: unknown };

export interface ValidationIssue {
  /** JSON-pointer-like path of the offending value, e.g. "speakers/0/name". */
  path: string;
  message: string;
}

export class SchemaValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super(issues.map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)).join("; "));
    this.name = "SchemaValidationError";
  }
}

export interface Schema<T> {
  /** Validates `value` and returns it typed (objects are rebuilt with only the known keys). */
  parse(value: unknown, path?: string): T;
  json(): JsonSchema;
  /** Marks the property optional when used in `object()`. */
  readonly optional: boolean;
}

type Infer<S> = S extends Schema<infer T> ? T : never;

function fail(path: string, message: string): never {
  throw new SchemaValidationError([{ path, message }]);
}

function make<T>(parse: (value: unknown, path: string) => T, json: () => JsonSchema, optional = false): Schema<T> {
  return { parse: (value, path = "") => parse(value, path), json, optional };
}

function describe(json: JsonSchema, description?: string): JsonSchema {
  return description ? { ...json, description } : json;
}

export interface StringOptions {
  min?: number;
  max?: number;
  pattern?: RegExp;
  description?: string;
  /** Trim surrounding whitespace before checking length (default true). */
  trim?: boolean;
  format?: string;
}

function string(options: StringOptions = {}): Schema<string> {
  const { min = 0, max = 10_000, pattern, trim = true } = options;
  return make(
    (value, path) => {
      if (typeof value !== "string") fail(path, "must be a string");
      const text = trim ? value.trim() : value;
      if (text.length < min) fail(path, min === 1 ? "must not be empty" : `must be at least ${min} characters`);
      if (text.length > max) fail(path, `must be at most ${max} characters`);
      if (pattern && !pattern.test(text)) fail(path, `must match ${pattern.source}`);
      return text;
    },
    () => describe({
      type: "string",
      ...(min > 0 ? { minLength: min } : {}),
      maxLength: max,
      ...(pattern ? { pattern: pattern.source } : {}),
      ...(options.format ? { format: options.format } : {}),
    }, options.description)
  );
}

function literalUnion<const T extends readonly string[]>(values: T, description?: string): Schema<T[number]> {
  return make(
    (value, path) => {
      if (typeof value !== "string" || !values.includes(value)) fail(path, `must be one of ${values.join(", ")}`);
      return value as T[number];
    },
    () => describe({ type: "string", enum: [...values] }, description)
  );
}

export interface NumberOptions {
  min?: number;
  max?: number;
  description?: string;
}

function number(options: NumberOptions = {}): Schema<number> {
  return make(
    (value, path) => {
      if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "must be a finite number");
      if (options.min !== undefined && value < options.min) fail(path, `must be at least ${options.min}`);
      if (options.max !== undefined && value > options.max) fail(path, `must be at most ${options.max}`);
      return value;
    },
    () => describe({
      type: "number",
      ...(options.min !== undefined ? { minimum: options.min } : {}),
      ...(options.max !== undefined ? { maximum: options.max } : {}),
    }, options.description)
  );
}

function integer(options: NumberOptions = {}): Schema<number> {
  const base = number(options);
  return make(
    (value, path) => {
      const parsed = base.parse(value, path);
      if (!Number.isInteger(parsed)) fail(path, "must be an integer");
      return parsed;
    },
    () => ({ ...base.json(), type: "integer" })
  );
}

function boolean(description?: string): Schema<boolean> {
  return make(
    (value, path) => {
      if (typeof value !== "boolean") fail(path, "must be true or false");
      return value;
    },
    () => describe({ type: "boolean" }, description)
  );
}

export interface ArrayOptions {
  min?: number;
  max?: number;
  description?: string;
  /** Reject duplicate primitive items. */
  unique?: boolean;
}

function array<T>(items: Schema<T>, options: ArrayOptions = {}): Schema<T[]> {
  const { min = 0, max = 1000 } = options;
  return make(
    (value, path) => {
      if (!Array.isArray(value)) fail(path, "must be an array");
      if (value.length < min) fail(path, `must have at least ${min} item${min === 1 ? "" : "s"}`);
      if (value.length > max) fail(path, `must have at most ${max} items`);
      const issues: ValidationIssue[] = [];
      const parsed: T[] = [];
      value.forEach((item, index) => {
        try {
          parsed.push(items.parse(item, path ? `${path}/${index}` : String(index)));
        } catch (error) {
          if (error instanceof SchemaValidationError) issues.push(...error.issues);
          else throw error;
        }
      });
      if (issues.length) throw new SchemaValidationError(issues);
      if (options.unique && new Set(parsed.map((item) => JSON.stringify(item))).size !== parsed.length) {
        fail(path, "must not contain duplicates");
      }
      return parsed;
    },
    () => describe({
      type: "array",
      items: items.json(),
      ...(min > 0 ? { minItems: min } : {}),
      maxItems: max,
      ...(options.unique ? { uniqueItems: true } : {}),
    }, options.description)
  );
}

type Shape = Record<string, Schema<unknown>>;
type RequiredKeys<S extends Shape> = { [K in keyof S]: S[K]["optional"] extends true ? never : K }[keyof S];
type OptionalKeys<S extends Shape> = Exclude<keyof S, RequiredKeys<S>>;
export type ObjectOf<S extends Shape> =
  { [K in RequiredKeys<S>]: Infer<S[K]> } & { [K in OptionalKeys<S>]?: Infer<S[K]> };

export interface ObjectOptions {
  description?: string;
  /** Reject keys not in the shape (default true: typos in writes must not be silently dropped). */
  strict?: boolean;
  /** At least this many of the shape's keys must be present (e.g. 1 for PATCH bodies). */
  minProperties?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function object<S extends Shape>(shape: S, options: ObjectOptions = {}): Schema<ObjectOf<S>> {
  const strict = options.strict ?? true;
  return make(
    (value, path) => {
      if (!isPlainObject(value)) fail(path, "must be an object");
      const issues: ValidationIssue[] = [];
      const result: Record<string, unknown> = {};
      const at = (key: string) => (path ? `${path}/${key}` : key);
      if (strict) {
        for (const key of Object.keys(value)) {
          if (!(key in shape)) issues.push({ path: at(key), message: "is not a known field" });
        }
      }
      let present = 0;
      for (const [key, schema] of Object.entries(shape)) {
        const item = value[key];
        if (item === undefined) {
          if (!schema.optional) issues.push({ path: at(key), message: "is required" });
          continue;
        }
        present += 1;
        try {
          result[key] = schema.parse(item, at(key));
        } catch (error) {
          if (error instanceof SchemaValidationError) issues.push(...error.issues);
          else throw error;
        }
      }
      if (options.minProperties !== undefined && present < options.minProperties) {
        issues.push({ path, message: `must contain at least ${options.minProperties} field(s)` });
      }
      if (issues.length) throw new SchemaValidationError(issues);
      return result as ObjectOf<S>;
    },
    () => {
      const required = Object.entries(shape).filter(([, schema]) => !schema.optional).map(([key]) => key);
      return describe({
        type: "object",
        properties: Object.fromEntries(Object.entries(shape).map(([key, schema]) => [key, schema.json()])),
        ...(required.length ? { required } : {}),
        ...(strict ? { additionalProperties: false } : {}),
        ...(options.minProperties ? { minProperties: options.minProperties } : {}),
      }, options.description);
    }
  );
}

/** A map with arbitrary (validated) keys, e.g. round id -> availability. */
function record<T>(values: Schema<T>, options: { keyPattern?: RegExp; maxKeys?: number; description?: string } = {}): Schema<Record<string, T>> {
  const maxKeys = options.maxKeys ?? 1000;
  return make(
    (value, path) => {
      if (!isPlainObject(value)) fail(path, "must be an object");
      const entries = Object.entries(value);
      if (entries.length > maxKeys) fail(path, `must have at most ${maxKeys} keys`);
      const result: Record<string, T> = {};
      for (const [key, item] of entries) {
        if (options.keyPattern && !options.keyPattern.test(key)) fail(path ? `${path}/${key}` : key, "is not a valid key");
        result[key] = values.parse(item, path ? `${path}/${key}` : key);
      }
      return result;
    },
    () => describe({
      type: "object",
      additionalProperties: values.json(),
      ...(options.keyPattern ? { propertyNames: { pattern: options.keyPattern.source } } : {}),
    }, options.description)
  );
}

export type OptionalSchema<T> = Schema<T | undefined> & { readonly optional: true };

function optional<T>(schema: Schema<T>): OptionalSchema<T> {
  return { parse: schema.parse, json: schema.json, optional: true };
}

/** Every property of a shape made optional (for PATCH bodies). */
function partial<S extends Shape>(shape: S): { [K in keyof S]: OptionalSchema<Exclude<Infer<S[K]>, undefined>> } {
  return Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [key, optional(schema)])
  ) as { [K in keyof S]: OptionalSchema<Exclude<Infer<S[K]>, undefined>> };
}

function nullable<T>(schema: Schema<T>): Schema<T | null> {
  return make(
    (value, path) => (value === null ? null : schema.parse(value, path)),
    () => {
      const json = schema.json();
      const type = json.type;
      return typeof type === "string" ? { ...json, type: [type, "null"] } : { anyOf: [json, { type: "null" }] };
    },
    schema.optional
  );
}

/** Any JSON value; used for response fields whose shape is owned by another module. */
function unknownValue(description?: string): Schema<unknown> {
  return make((value) => value, () => describe({}, description));
}

/** A reference to a named component schema, for responses (never used to parse). */
function ref(name: string): Schema<unknown> {
  return make((value) => value, () => ({ $ref: `#/components/schemas/${name}` }));
}

export const s = {
  string,
  enum: literalUnion,
  number,
  integer,
  boolean,
  array,
  object,
  record,
  optional,
  partial,
  nullable,
  unknown: unknownValue,
  ref,
};

export type { Infer };
