// Utility: convert object keys from snake_case to camelCase
export function snakeToCamelObj(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const camel = key.replace(/_([A-Za-z0-9])/g, (_, c) => c.toUpperCase());
    out[camel] = value;
  }
  return out;
}

export function snakeToCamelArray(rows) {
  return rows.map(r => snakeToCamelObj(r));
}
