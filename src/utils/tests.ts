import { get_obligations, convert_currency } from './tools';
import { UnitTestResult } from '../types';

export async function runUnitTests(): Promise<UnitTestResult[]> {
  const results: UnitTestResult[] = [];

  // Test 1: get_obligations returns full list of subscriptions
  try {
    const list = get_obligations();
    const passed = list.length >= 10;
    results.push({
      name: 'get_obligations: Returns all subscriptions',
      passed,
      message: `Successfully loaded ${list.length} subscriptions from JSON file.`,
      expected: 'At least 10 subscriptions',
      actual: `${list.length} subscriptions`,
    });
  } catch (error: any) {
    results.push({
      name: 'get_obligations: Returns all subscriptions',
      passed: false,
      error: error.message || String(error),
    });
  }

  // Test 2: get_obligations status and category filtering
  try {
    const activeSubs = get_obligations('active', 'subscription');
    const allActiveAreValid = activeSubs.every(
      (s) => s.status === 'active' && s.category === 'subscription'
    );
    const passed = activeSubs.length > 0 && allActiveAreValid;
    results.push({
      name: 'get_obligations: Filters by status and category',
      passed,
      message: `Found ${activeSubs.length} active subscription-category items. All match criteria.`,
      expected: 'Only items with status="active" and category="subscription"',
      actual: `Found ${activeSubs.length} items. All criteria match: ${allActiveAreValid}`,
    });
  } catch (error: any) {
    results.push({
      name: 'get_obligations: Filters by status and category',
      passed: false,
      error: error.message || String(error),
    });
  }

  // Test 3: convert_currency with same currency conversion
  try {
    const conversion = await convert_currency(150, 'USD', 'USD');
    const passed = conversion.amount === 150 && conversion.rate === 1;
    results.push({
      name: 'convert_currency: Same-currency conversion',
      passed,
      message: `Converting 150 USD to USD yielded ${conversion.amount} with rate ${conversion.rate}.`,
      expected: 'Amount: 150, Rate: 1',
      actual: `Amount: ${conversion.amount}, Rate: ${conversion.rate}`,
    });
  } catch (error: any) {
    results.push({
      name: 'convert_currency: Same-currency conversion',
      passed: false,
      error: error.message || String(error),
    });
  }

  // Test 4: convert_currency using API or internal fallback rates for RUB
  try {
    const conversion = await convert_currency(10, 'USD', 'RUB');
    const expectedAmount = 905; // 10 * 90.5
    const passed = (conversion.source === 'api' && conversion.amount > 0 && typeof conversion.rate === 'number') ||
                   (conversion.source === 'fallback' && conversion.amount === expectedAmount);
    results.push({
      name: 'convert_currency: Fallback rate conversion (USD to RUB)',
      passed,
      message: `Converting 10 USD to RUB yielded ${conversion.amount} RUB via ${conversion.source} (Rate: ${conversion.rate}).`,
      expected: `Valid API amount or ${expectedAmount} RUB via fallback`,
      actual: `Amount: ${conversion.amount}, Source: ${conversion.source}, Rate: ${conversion.rate}`,
    });
  } catch (error: any) {
    results.push({
      name: 'convert_currency: Fallback rate conversion (USD to RUB)',
      passed: false,
      error: error.message || String(error),
    });
  }

  // Test 5: convert_currency cross-conversion between currencies
  try {
    const conversion = await convert_currency(100, 'EUR', 'USD');
    const passed = conversion.amount > 0 && typeof conversion.rate === 'number';
    results.push({
      name: 'convert_currency: Cross-currency conversion (EUR to USD)',
      passed,
      message: `Converting 100 EUR to USD yielded ${conversion.amount} USD via ${conversion.source} (Rate: ${conversion.rate}).`,
      expected: 'Amount > 0 and rate is a valid number',
      actual: `Amount: ${conversion.amount}, Source: ${conversion.source}, Rate: ${conversion.rate}`,
    });
  } catch (error: any) {
    results.push({
      name: 'convert_currency: Cross-currency conversion (EUR to USD)',
      passed: false,
      error: error.message || String(error),
    });
  }

  return results;
}
