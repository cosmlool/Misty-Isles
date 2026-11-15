type PlainRecord = Record<string, unknown>;

function isRecord(value: unknown): value is PlainRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}
function safeTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function safePrice(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 100_000_000;
}
function safeFee(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100_000_000;
}
function optionalName(value: unknown): string {
  return typeof value === 'string' && value.length <= 256 ? value : '';
}

/** Explicit client-facing allowlist; never spread persisted lot properties into a socket payload. */
export function projectAuctionLots(value: unknown): Array<{
  id: string; itemId: string; itemName: string; sellerId: string; sellerName: string;
  price: number; currency: 'gold' | 'crystals'; createdAt: number; status: 'active';
}> {
  if (!Array.isArray(value)) return [];
  const idCounts = new Map<string, number>();
  for (const raw of value) {
    if (isRecord(raw) && nonEmptyString(raw.id)) idCounts.set(raw.id, (idCounts.get(raw.id) ?? 0) + 1);
  }
  const result = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const status = raw.status ?? 'active';
    if (!nonEmptyString(raw.id) || idCounts.get(raw.id) !== 1
      || !nonEmptyString(raw.itemId) || !nonEmptyString(raw.sellerId)
      || !safePrice(raw.price) || (raw.currency !== 'gold' && raw.currency !== 'crystals')
      || !safeTimestamp(raw.createdAt) || status !== 'active') continue;
    result.push({
      id: raw.id, itemId: raw.itemId, itemName: optionalName(raw.itemName) || raw.itemId,
      sellerId: raw.sellerId, sellerName: optionalName(raw.sellerName),
      price: raw.price, currency: raw.currency as 'gold' | 'crystals', createdAt: raw.createdAt, status: 'active' as const,
    });
  }
  return result;
}

/** History is a read-only presentation view; malformed legacy entries are skipped, never rewritten. */
export function projectAuctionHistory(value: unknown): Array<{
  id: string; lotId: string; type: 'listed' | 'cancelled' | 'sold'; itemId: string; itemName: string;
  sellerId: string; sellerName: string; buyerId?: string; buyerName?: string;
  price: number; currency: 'gold' | 'crystals'; fee: number; createdAt: number;
  status: 'listed' | 'cancelled' | 'completed';
}> {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const raw of value) {
    if (!isRecord(raw) || !nonEmptyString(raw.id) || !nonEmptyString(raw.lotId)
      || !nonEmptyString(raw.itemId) || !nonEmptyString(raw.sellerId)
      || !safePrice(raw.price) || (raw.currency !== 'gold' && raw.currency !== 'crystals')
      || !safeFee(raw.fee) || !safeTimestamp(raw.createdAt)
      || !['listed', 'cancelled', 'sold'].includes(String(raw.type))) continue;
    const type = raw.type as 'listed' | 'cancelled' | 'sold';
    const expectedStatus = type === 'sold' ? 'completed' : type;
    if (raw.status !== undefined && raw.status !== expectedStatus) continue;
    if (type === 'sold' && raw.buyerId !== undefined && !nonEmptyString(raw.buyerId)) continue;
    result.push({
      id: raw.id, lotId: raw.lotId, type, itemId: raw.itemId,
      itemName: optionalName(raw.itemName) || raw.itemId,
      sellerId: raw.sellerId, sellerName: optionalName(raw.sellerName),
      ...(nonEmptyString(raw.buyerId) ? { buyerId: raw.buyerId } : {}),
      ...(typeof raw.buyerName === 'string' && raw.buyerName.length <= 256 ? { buyerName: raw.buyerName } : {}),
      price: raw.price, currency: raw.currency as 'gold' | 'crystals', fee: raw.fee, createdAt: raw.createdAt,
      status: expectedStatus as 'listed' | 'cancelled' | 'completed',
    });
  }
  return result;
}

/** Public analytics need sale facts only, not internal player identifiers or names. */
export function projectPublicMarketHistory(value: unknown): Array<{
  type: 'sold'; itemName: string; price: number; currency: 'gold' | 'crystals';
  fee: number; createdAt: number; status: 'completed';
}> {
  return projectAuctionHistory(value)
    .filter(entry => entry.type === 'sold' && entry.status === 'completed')
    .map(entry => ({
      type: 'sold' as const, itemName: entry.itemName, price: entry.price,
      currency: entry.currency, fee: entry.fee, createdAt: entry.createdAt,
      status: 'completed' as const,
    }));
}
