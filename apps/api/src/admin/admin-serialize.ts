export function serializeAdminValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (isDecimalLike(value)) return value.toFixed(8);
  if (Array.isArray(value)) return value.map(serializeAdminValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        serializeAdminValue(nested),
      ]),
    );
  }
  return value;
}

export function serializeAdminRows<T>(rows: T[]): Array<Record<string, unknown>> {
  return rows.map((row) => serializeAdminValue(row) as Record<string, unknown>);
}

function isDecimalLike(value: unknown): value is { toFixed: (fractionDigits: number) => string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toFixed' in value &&
    typeof (value as { toFixed: unknown }).toFixed === 'function'
  );
}
