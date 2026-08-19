const DENYLISTED_PROPERTY_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

export function isDenylistedPropertyName(name: string): boolean {
  if (DENYLISTED_PROPERTY_NAMES.has(name)) return true;
  return name.startsWith('__');
}
