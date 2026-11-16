function parsePlayerJson(value: string, field: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Player ${field} contains invalid JSON; refusing to replace its contents. ${String(error)}`);
  }
  return parsed;
}

export function readPlayerArray(value: string, field = 'array data'): any[] {
  const parsed = parsePlayerJson(value, field);
  if (!Array.isArray(parsed)) {
    throw new Error(`Player ${field} has an invalid structure; expected an array.`);
  }
  return parsed;
}

export function readPlayerObject(value: string, field = 'object data'): Record<string, any> {
  const parsed = parsePlayerJson(value, field);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Player ${field} has an invalid structure; expected an object.`);
  }
  return parsed as Record<string, any>;
}
