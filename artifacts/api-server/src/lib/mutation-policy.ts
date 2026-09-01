export type JsonObject = Record<string, unknown>;

export function allowlistedObject(
  input: unknown,
  allowedKeys: readonly string[],
): JsonObject | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const object = input as JsonObject;
  if (Object.keys(object).some((key) => !allowedKeys.includes(key))) return null;
  return Object.fromEntries(
    allowedKeys
      .filter((key) => Object.prototype.hasOwnProperty.call(object, key))
      .map((key) => [key, object[key]]),
  );
}