export function parseAdminPlayerIds(raw: string | undefined): Set<string> {
  return new Set(
    String(raw || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean),
  );
}
