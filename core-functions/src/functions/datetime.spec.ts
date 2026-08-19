import { evalFormulaOutput, evalOk } from '../test-helpers/eval-formula';

describe('Date/Time', () => {
  it('builds and extracts ISO dates', async () => {
    expect(await evalOk('DAY(DATE(2024; 2; 29))')).toBe(29);
    expect(await evalOk('MONTH(DATE(2024; 2; 29))')).toBe(2);
    expect(await evalOk('YEAR(DATE(2024; 2; 29))')).toBe(2024);
    expect(await evalOk('DATE(2024; 2).iso')).toBe('2024-02-01');

    // Invalid dates return null.
    expect(await evalOk('DATE(2024; 13; 1)')).toBe(null);
    expect(await evalOk('DATE(2024; 2; 30)')).toBe(null);
  });

  it('supports property-like access for date/time values', async () => {
    expect(await evalOk('DATE(2024; 2; 29).day')).toBe(29);
    expect(await evalOk('DATE(2024; 2; 29).month')).toBe(2);
    expect(await evalOk('DATE(2024; 2; 29).year')).toBe(2024);
    expect(await evalOk('DATE(2024; 2; 29).iso')).toBe('2024-02-29');

    expect(await evalOk('TIME(1; 2; 3).hour')).toBe(1);
    expect(await evalOk('TIME(1; 2; 3).minute')).toBe(2);
    expect(await evalOk('TIME(1; 2; 3).second')).toBe(3);
    expect(await evalOk('TIME(1; 2; 3).iso')).toBe('01:02:03');

    const nowDateIso = await evalOk('NOW().date.iso');
    expect(nowDateIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('parses ISO datetime strings in DATEVALUE/TIMEVALUE', async () => {
    expect(await evalOk('DATEVALUE("2024-02-29T01:02:03Z").iso')).toBe('2024-02-29');
    expect(await evalOk('TIMEVALUE("2024-02-29T01:02:03Z").iso')).toBe('01:02:03');

    // Accept space separator and missing seconds.
    expect(await evalOk('DATEVALUE("2024-02-29 01:02Z").iso')).toBe('2024-02-29');
    expect(await evalOk('TIMEVALUE("2024-02-29 01:02Z").iso')).toBe('01:02:00');
  });

  it('DATEVALUE accepts numeric timestamps (seconds or milliseconds)', async () => {
    expect(await evalOk('DATEVALUE(0).iso')).toBe('1970-01-01');
    expect(await evalOk('DATEVALUE(86400).iso')).toBe('1970-01-02');
    expect(await evalOk('DATEVALUE(1700000000000).iso')).toBe('2023-11-14');

    // Same instant in seconds vs milliseconds.
    expect(await evalOk('DATEVALUE(1700000000).iso')).toBe('2023-11-14');

    // Non-finite numbers return null.
    expect(await evalOk('DATEVALUE(1/0)')).toBe(null);
  });

  it('converts date/time/datetime to text', async () => {
    expect(await evalOk('TO_TEXT(DATE(2024; 2; 29))')).toBe('2024-02-29');
    expect(await evalOk('TO_TEXT(TIME(1; 2; 3))')).toBe('01:02:03');

    const nowText = await evalOk('TO_TEXT(NOW())');
    expect(nowText).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('builds and extracts ISO times', async () => {
    expect(await evalOk('HOUR(TIME(1; 2; 3))')).toBe(1);
    expect(await evalOk('MINUTE(TIME(1; 2; 3))')).toBe(2);
    expect(await evalOk('SECOND(TIME(1; 2; 3))')).toBe(3);
    expect(await evalOk('TIME(1).iso')).toBe('01:00:00');
    expect(await evalOk('TIME(1; 2).iso')).toBe('01:02:00');

    // Invalid times return null.
    expect(await evalOk('TIME(24; 0; 0)')).toBe(null);
    expect(await evalOk('TIME(23; 60; 0)')).toBe(null);
    expect(await evalOk('TIME(23; 0; 60)')).toBe(null);
  });

  it('computes date differences', async () => {
    expect(await evalOk('DAYS(DATE(2024;1;2); DATE(2024;1;1))')).toBe(1);
    expect(await evalOk('DATEDIF(DATE(2024;1;1); DATE(2025;1;1); "Y")')).toBe(1);
    expect(await evalOk('DATEDIF(DATE(2024;1;15); DATE(2024;3;14); "M")')).toBe(1);
    expect(await evalOk('DATEDIF(DATE(2024;1;1); DATE(2024;1;31); "D")')).toBe(30);
  });

  it('computes weekday/week numbers', async () => {
    // 2024-01-01 is a Monday.
    expect(await evalOk('WEEKDAY(DATE(2024;1;1); 1)')).toBe(2);
    expect(await evalOk('WEEKDAY(DATE(2024;1;1); 2)')).toBe(1);
    expect(await evalOk('ISOWEEKNUM(DATE(2024;1;4))')).toBe(1);
    expect(await evalOk('WEEKNUM(DATE(2024;1;1); 2)')).toBe(1);
    expect(await evalOk('WEEKNUM(DATE(2024;1;8); 2)')).toBe(2);
  });

  it('supports no-arg overloads for current date/time components', async () => {
    // Ensure overload binding picks the uncached *_NOW signatures.
    const daySig = await evalFormulaOutput('DAY()');
    expect(daySig.compiled.root.kind).toBe('call');
    if (daySig.compiled.root.kind === 'call')
      expect(daySig.compiled.root.signatureId).toBe('DAY_NOW/v1');
    const monthSig = await evalFormulaOutput('MONTH()');
    if (monthSig.compiled.root.kind === 'call')
      expect(monthSig.compiled.root.signatureId).toBe('MONTH_NOW/v1');
    const yearSig = await evalFormulaOutput('YEAR()');
    if (yearSig.compiled.root.kind === 'call')
      expect(yearSig.compiled.root.signatureId).toBe('YEAR_NOW/v1');
    const hourSig = await evalFormulaOutput('HOUR()');
    if (hourSig.compiled.root.kind === 'call')
      expect(hourSig.compiled.root.signatureId).toBe('HOUR_NOW/v1');
    const minuteSig = await evalFormulaOutput('MINUTE()');
    if (minuteSig.compiled.root.kind === 'call')
      expect(minuteSig.compiled.root.signatureId).toBe('MINUTE_NOW/v1');
    const secondSig = await evalFormulaOutput('SECOND()');
    if (secondSig.compiled.root.kind === 'call')
      expect(secondSig.compiled.root.signatureId).toBe('SECOND_NOW/v1');
    const isoWeekSig = await evalFormulaOutput('ISOWEEKNUM()');
    if (isoWeekSig.compiled.root.kind === 'call')
      expect(isoWeekSig.compiled.root.signatureId).toBe('ISOWEEKNUM_NOW/v1');
    const weekdaySig = await evalFormulaOutput('WEEKDAY()');
    if (weekdaySig.compiled.root.kind === 'call')
      expect(weekdaySig.compiled.root.signatureId).toBe('WEEKDAY_NOW/v1');
    const weeknumSig = await evalFormulaOutput('WEEKNUM()');
    if (weeknumSig.compiled.root.kind === 'call')
      expect(weeknumSig.compiled.root.signatureId).toBe('WEEKNUM_NOW/v1');

    const day = await evalOk('DAY()');
    expect(typeof day).toBe('number');
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);

    const month = await evalOk('MONTH()');
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);

    const year = await evalOk('YEAR()');
    expect(year).toBeGreaterThanOrEqual(1970);

    const hour = await evalOk('HOUR()');
    expect(hour).toBeGreaterThanOrEqual(0);
    expect(hour).toBeLessThanOrEqual(23);

    const minute = await evalOk('MINUTE()');
    expect(minute).toBeGreaterThanOrEqual(0);
    expect(minute).toBeLessThanOrEqual(59);

    const second = await evalOk('SECOND()');
    expect(second).toBeGreaterThanOrEqual(0);
    expect(second).toBeLessThanOrEqual(59);

    const isoWeek = await evalOk('ISOWEEKNUM()');
    expect(isoWeek).toBeGreaterThanOrEqual(1);
    expect(isoWeek).toBeLessThanOrEqual(53);

    const weekday = await evalOk('WEEKDAY()');
    expect(weekday).toBeGreaterThanOrEqual(1);
    expect(weekday).toBeLessThanOrEqual(7);

    const weeknum = await evalOk('WEEKNUM()');
    expect(weeknum).toBeGreaterThanOrEqual(1);
    expect(weeknum).toBeLessThanOrEqual(53);
  });

  it('validates ISO dates', async () => {
    expect(await evalOk('ISDATE(DATEVALUE("2024-02-29"))')).toBe(true);
    expect(await evalOk('ISDATE("2024-02-30")')).toBe(false);
  });
});
