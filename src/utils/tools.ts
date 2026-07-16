import fs from 'fs';
import path from 'path';
import { Subscription } from '../types';

// Path to subscription registry
const DB_PATH = path.join(process.cwd(), 'src/data/subscriptions.json');

// Ensure database file exists, or write default list
export function getDbPath(): string {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return DB_PATH;
}

/**
 * Tool 1: get_obligations(status, category)
 * Returns the list of subscriptions / financial obligations of the user.
 * Reads from subscriptions.json with optional filters.
 */
export function get_obligations(
  status?: 'active' | 'inactive' | null,
  category?: string | null
): Subscription[] {
  try {
    const dbFile = getDbPath();
    if (!fs.existsSync(dbFile)) {
      return [];
    }
    const rawData = fs.readFileSync(dbFile, 'utf8');
    const subscriptions: Subscription[] = JSON.parse(rawData);

    return subscriptions.filter((sub) => {
      if (status && sub.status !== status) {
        return false;
      }
      if (category && sub.category.toLowerCase() !== category.toLowerCase()) {
        return false;
      }
      return true;
    });
  } catch (error) {
    console.error('Error reading subscriptions database:', error);
    throw new Error('Database access failed');
  }
}

/**
 * Fallback currency conversion rates (Base: RUB)
 * Rates as of simulation July 2026
 */
const FALLBACK_RATES: Record<string, number> = {
  RUB: 1.0,
  USD: 90.5,
  EUR: 98.2,
  GBP: 115.3,
  JPY: 0.58,
};

/**
 * Tool 2: convert_currency(amount, from_currency, to_currency)
 * Converts amount from one currency to another using Frankfurter API,
 * with graceful fallback to standard rates.
 */
export async function convert_currency(
  amount: number,
  from_currency: string,
  to_currency: string
): Promise<{ amount: number; source: 'api' | 'fallback'; rate: number }> {
  const fromUpper = from_currency.toUpperCase();
  const toUpper = to_currency.toUpperCase();

  if (amount === 0) {
    return { amount: 0, source: 'fallback', rate: 1 };
  }

  if (fromUpper === toUpper) {
    return { amount, source: 'fallback', rate: 1 };
  }

  try {
    // Fetch latest rates with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const url = `https://api.frankfurter.dev/v2/rate/${fromUpper}/${toUpper}`;
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json() as any;
      const rate = data.rate;
      if (rate !== undefined && typeof rate === 'number') {
        return {
          amount: Number((amount * rate).toFixed(2)),
          source: 'api',
          rate: Number(rate.toFixed(4)),
        };
      }
    }
  } catch (e) {
    console.warn('Frankfurter API failed or timed out. Falling back to internal rates.', e);
  }

  // Fallback conversion logic
  const fromRateInRub = FALLBACK_RATES[fromUpper];
  const toRateInRub = FALLBACK_RATES[toUpper];

  if (!fromRateInRub || !toRateInRub) {
    throw new Error(`Unsupported currency conversion: ${fromUpper} to ${toUpper}`);
  }

  // Convert via RUB base
  // e.g., converting 10 USD to EUR:
  // 10 USD = 10 * 90.5 RUB = 905 RUB
  // 905 RUB = 905 / 98.2 EUR = 9.22 EUR
  const amountInRub = amount * fromRateInRub;
  const convertedAmount = amountInRub / toRateInRub;
  const effectiveRate = fromRateInRub / toRateInRub;

  return {
    amount: Number(convertedAmount.toFixed(2)),
    source: 'fallback',
    rate: Number(effectiveRate.toFixed(4)),
  };
}
