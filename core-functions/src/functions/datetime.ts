import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import {
  makeOkBoolean,
  makeOkNull,
  makeOkNumber,
  makeOkObject,
  withWarnings,
} from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import {
  formatIsoDate,
  formatIsoTime,
  isoWeekNumber,
  parseIsoDate,
  parseIsoTime,
  utcDaysBetween,
  weekNumber,
  wholeMonthsBetween,
  wholeYearsBetween,
} from './date-time-helpers';
import { asNumber, asText, isEmptyValue } from './helpers';

function warnType(fn: string, message: string, meta?: Record<string, unknown>) {
  return withWarnings(makeOkNull(fn), [{ code: 'TYPE', message, meta }]);
}

type FormulaDateValue = {
  __formula_object_kind: 'date';
  iso: string;
  year: number;
  month: number;
  day: number;
};

type FormulaTimeValue = {
  __formula_object_kind: 'time';
  iso: string;
  hour: number;
  minute: number;
  second: number;
};

type FormulaDateTimeValue = {
  __formula_object_kind: 'datetime';
  iso: string;
  date: FormulaDateValue;
  time: FormulaTimeValue;
};

function isDateValue(v: any): v is FormulaDateValue {
  return !!(
    v &&
    typeof v === 'object' &&
    v.__formula_object_kind === 'date' &&
    typeof v.iso === 'string'
  );
}
function isTimeValue(v: any): v is FormulaTimeValue {
  return !!(
    v &&
    typeof v === 'object' &&
    v.__formula_object_kind === 'time' &&
    typeof v.iso === 'string'
  );
}
function isDateTimeValue(v: any): v is FormulaDateTimeValue {
  return !!(
    v &&
    typeof v === 'object' &&
    v.__formula_object_kind === 'datetime' &&
    typeof v.iso === 'string' &&
    v.date &&
    v.time
  );
}

function dateFromUnknown(raw: unknown) {
  if (isDateValue(raw)) return parseIsoDate(raw.iso);
  if (isDateTimeValue(raw)) return parseIsoDate(raw.date?.iso);
  return parseIsoDate(raw);
}

function timeFromUnknown(raw: unknown) {
  if (isTimeValue(raw)) return parseIsoTime(raw.iso);
  if (isDateTimeValue(raw)) return parseIsoTime(raw.time?.iso);
  return parseIsoTime(raw);
}

function makeDateValue(d: { year: number; month: number; day: number }): FormulaDateValue {
  const iso = formatIsoDate(d);
  return { __formula_object_kind: 'date', iso, year: d.year, month: d.month, day: d.day };
}

function makeTimeValue(t: { hour: number; minute: number; second: number }): FormulaTimeValue {
  const iso = formatIsoTime(t);
  return { __formula_object_kind: 'time', iso, hour: t.hour, minute: t.minute, second: t.second };
}

function readDateOrWarn(fn: string, raw: unknown) {
  const d = dateFromUnknown(raw);
  if (d) return { date: d, out: null as any };
  if (!isEmptyValue(raw)) {
    return { date: null, out: warnType(fn, `${fn} expects a Date value`) };
  }
  return { date: null, out: makeOkNull(fn) };
}

function readTimeOrWarn(fn: string, raw: unknown) {
  const t = timeFromUnknown(raw);
  if (t) return { time: t, out: null as any };
  if (!isEmptyValue(raw)) {
    return { time: null, out: warnType(fn, `${fn} expects a Time value`) };
  }
  return { time: null, out: makeOkNull(fn) };
}

export class DateImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00002;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const y = asNumber(args[0]);
    const m = asNumber(args[1]);
    const dRaw = args.length >= 3 ? args[2] : null;
    const d = dRaw == null || isEmptyValue(dRaw) ? 1 : asNumber(dRaw);
    if (y == null || m == null || d == null) {
      if (!isEmptyValue(args[0]) || !isEmptyValue(args[1]) || !isEmptyValue(dRaw)) {
        return warnType('DATE', 'DATE expects (year, month, [day]) as numbers');
      }
      return makeOkNull('DATE');
    }
    const year = Math.trunc(y);
    const month = Math.trunc(m);
    const day = Math.trunc(d);
    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      !Number.isFinite(day) ||
      month < 1 ||
      month > 12
    ) {
      return makeOkNull('DATE');
    }
    const iso = parseIsoDate(formatIsoDate({ year, month, day }));
    if (!iso) return makeOkNull('DATE');
    return makeOkObject('DATE', makeDateValue(iso), 'date');
  }
}

export class DateValueImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00003;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const raw = args[0];

    if (typeof raw === 'number' && Number.isFinite(raw)) {
      // Accept timestamps in either seconds or milliseconds.
      const ms = Math.abs(raw) < 100_000_000_000 ? raw * 1_000 : raw;
      const dt = new Date(ms);
      if (!Number.isFinite(dt.getTime())) return makeOkNull('DATEVALUE');
      const y = dt.getUTCFullYear();
      const mo = dt.getUTCMonth() + 1;
      const da = dt.getUTCDate();
      return makeOkObject('DATEVALUE', makeDateValue({ year: y, month: mo, day: da }), 'date');
    }

    const t = asText(raw);
    if (t == null) {
      if (!isEmptyValue(raw)) return warnType('DATEVALUE', 'DATEVALUE expects text or a timestamp');
      return makeOkNull('DATEVALUE');
    }
    const d = parseIsoDate(t);
    return d ? makeOkObject('DATEVALUE', makeDateValue(d), 'date') : makeOkNull('DATEVALUE');
  }
}

export class TimeImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00002;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const h = asNumber(args[0]);
    const mRaw = args.length >= 2 ? args[1] : null;
    const sRaw = args.length >= 3 ? args[2] : null;
    const m = mRaw == null || isEmptyValue(mRaw) ? 0 : asNumber(mRaw);
    const s = sRaw == null || isEmptyValue(sRaw) ? 0 : asNumber(sRaw);
    if (h == null || m == null || s == null) {
      if (!isEmptyValue(args[0]) || !isEmptyValue(mRaw) || !isEmptyValue(sRaw)) {
        return warnType('TIME', 'TIME expects (hour, [minute], [second]) as numbers');
      }
      return makeOkNull('TIME');
    }
    const hour = Math.trunc(h);
    const minute = Math.trunc(m);
    const second = Math.trunc(s);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59)
      return makeOkNull('TIME');
    return makeOkObject('TIME', makeTimeValue({ hour, minute, second }), 'time');
  }
}

export class TimeValueImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00003;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const raw = args[0];
    const t = asText(raw);
    if (t == null) {
      if (!isEmptyValue(raw)) return warnType('TIMEVALUE', 'TIMEVALUE expects text');
      return makeOkNull('TIMEVALUE');
    }
    const parsed = parseIsoTime(t);
    return parsed
      ? makeOkObject('TIMEVALUE', makeTimeValue(parsed), 'time')
      : makeOkNull('TIMEVALUE');
  }
}

export class NowImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00001;
  }

  protected evaluate(_args: unknown[], _ctx: FormulaExecutionContext) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const mo = now.getUTCMonth() + 1;
    const da = now.getUTCDate();
    const h = now.getUTCHours();
    const mi = now.getUTCMinutes();
    const s = now.getUTCSeconds();
    const date = formatIsoDate({ year: y, month: mo, day: da });
    const time = formatIsoTime({ hour: h, minute: mi, second: s });
    const dateVal = makeDateValue({ year: y, month: mo, day: da });
    const timeVal = makeTimeValue({ hour: h, minute: mi, second: s });
    const dt: FormulaDateTimeValue = {
      __formula_object_kind: 'datetime',
      iso: `${date}T${time}Z`,
      date: dateVal,
      time: timeVal,
    };
    return makeOkObject('NOW', dt, 'datetime');
  }
}

export class TodayImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00001;
  }

  protected evaluate(_args: unknown[], _ctx: FormulaExecutionContext) {
    const dt = new Date();
    const y = dt.getUTCFullYear();
    const mo = dt.getUTCMonth() + 1;
    const da = dt.getUTCDate();
    return makeOkObject('TODAY', makeDateValue({ year: y, month: mo, day: da }), 'date');
  }
}

export class DayImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00002;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const { date, out } = readDateOrWarn('DAY', args[0]);
    if (!date) return out;
    return makeOkNumber('DAY', date.day);
  }
}

function utcNowParts() {
  const dt = new Date();
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
    hour: dt.getUTCHours(),
    minute: dt.getUTCMinutes(),
    second: dt.getUTCSeconds(),
  };
}

export class DayNowImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00002;
  }
  protected evaluate(_args: unknown[], _ctx: FormulaExecutionContext) {
    return makeOkNumber('DAY', utcNowParts().day);
  }
}

export class MonthNowImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00002;
  }
  protected evaluate(_args: unknown[], _ctx: FormulaExecutionContext) {
    return makeOkNumber('MONTH', utcNowParts().month);
  }
}

export class YearNowImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00002;
  }
  protected evaluate(_args: unknown[], _ctx: FormulaExecutionContext) {
    return makeOkNumber('YEAR', utcNowParts().year);
  }
}

export class HourNowImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00002;
  }
  protected evaluate(_args: unknown[], _ctx: FormulaExecutionContext) {
    return makeOkNumber('HOUR', utcNowParts().hour);
  }
}

export class MinuteNowImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00002;
  }
  protected evaluate(_args: unknown[], _ctx: FormulaExecutionContext) {
    return makeOkNumber('MINUTE', utcNowParts().minute);
  }
}

export class SecondNowImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00002;
  }
  protected evaluate(_args: unknown[], _ctx: FormulaExecutionContext) {
    return makeOkNumber('SECOND', utcNowParts().second);
  }
}

export class IsoWeekNumNowImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00003;
  }
  protected evaluate(_args: unknown[], _ctx: FormulaExecutionContext) {
    const p = utcNowParts();
    return makeOkNumber('ISOWEEKNUM', isoWeekNumber({ year: p.year, month: p.month, day: p.day }));
  }
}

export class WeekdayNowImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00003;
  }
  protected evaluate(_args: unknown[], _ctx: FormulaExecutionContext) {
    const p = utcNowParts();
    const dow0 = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    return makeOkNumber('WEEKDAY', dow0 === 0 ? 1 : dow0 + 1);
  }
}

export class WeekNumNowImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00004;
  }
  protected evaluate(_args: unknown[], _ctx: FormulaExecutionContext) {
    const p = utcNowParts();
    return makeOkNumber('WEEKNUM', weekNumber({ year: p.year, month: p.month, day: p.day }, 0));
  }
}

export class MonthImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00002;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const { date, out } = readDateOrWarn('MONTH', args[0]);
    if (!date) return out;
    return makeOkNumber('MONTH', date.month);
  }
}

export class YearImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00002;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const { date, out } = readDateOrWarn('YEAR', args[0]);
    if (!date) return out;
    return makeOkNumber('YEAR', date.year);
  }
}

export class HourImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00002;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const { time, out } = readTimeOrWarn('HOUR', args[0]);
    if (!time) return out;
    return makeOkNumber('HOUR', time.hour);
  }
}

export class MinuteImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00002;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const { time, out } = readTimeOrWarn('MINUTE', args[0]);
    if (!time) return out;
    return makeOkNumber('MINUTE', time.minute);
  }
}

export class SecondImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00002;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const { time, out } = readTimeOrWarn('SECOND', args[0]);
    if (!time) return out;
    return makeOkNumber('SECOND', time.second);
  }
}

export class DaysImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00003;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const a = dateFromUnknown(args[0]);
    const b = dateFromUnknown(args[1]);
    if (!a || !b) {
      if (!isEmptyValue(args[0]) || !isEmptyValue(args[1])) {
        return warnType('DAYS', 'DAYS expects (end_date, start_date) as Date values');
      }
      return makeOkNull('DAYS');
    }
    return makeOkNumber('DAYS', utcDaysBetween(b, a));
  }
}

export class DateDifImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00005;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const start = dateFromUnknown(args[0]);
    const end = dateFromUnknown(args[1]);
    const unit = asText(args[2]);
    if (!start || !end || unit == null) {
      if (!isEmptyValue(args[0]) || !isEmptyValue(args[1]) || !isEmptyValue(args[2])) {
        return warnType('DATEDIF', 'DATEDIF expects (start_date, end_date, unit)');
      }
      return makeOkNull('DATEDIF');
    }
    const u = unit.trim().toUpperCase();
    if (utcDaysBetween(start, end) < 0) return makeOkNull('DATEDIF');
    if (u === 'D' || u === 'DAY' || u === 'DAYS') {
      return makeOkNumber('DATEDIF', utcDaysBetween(start, end));
    }
    if (u === 'M' || u === 'MONTH' || u === 'MONTHS') {
      return makeOkNumber('DATEDIF', wholeMonthsBetween(start, end));
    }
    if (u === 'Y' || u === 'YEAR' || u === 'YEARS') {
      return makeOkNumber('DATEDIF', wholeYearsBetween(start, end));
    }
    return makeOkNull('DATEDIF');
  }
}

export class IsoWeekNumImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00003;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const { date, out } = readDateOrWarn('ISOWEEKNUM', args[0]);
    if (!date) return out;
    return makeOkNumber('ISOWEEKNUM', isoWeekNumber(date));
  }
}

export class WeekdayImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00003;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const { date, out } = readDateOrWarn('WEEKDAY', args[0]);
    if (!date) return out;
    const typRaw = args.length >= 2 ? args[1] : undefined;
    const typ = typRaw == null ? 1 : asNumber(typRaw);
    if (typ == null) {
      if (!isEmptyValue(typRaw)) return warnType('WEEKDAY', 'WEEKDAY type must be a number');
      return makeOkNull('WEEKDAY');
    }
    const t = Math.trunc(typ);
    const dow0 = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay(); // 0..6, Sunday=0
    if (t === 1) return makeOkNumber('WEEKDAY', dow0 === 0 ? 1 : dow0 + 1);
    if (t === 2) return makeOkNumber('WEEKDAY', dow0 === 0 ? 7 : dow0);
    if (t === 3) return makeOkNumber('WEEKDAY', dow0 === 0 ? 6 : dow0 - 1);
    return makeOkNull('WEEKDAY');
  }
}

export class WeekNumImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00004;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const { date, out } = readDateOrWarn('WEEKNUM', args[0]);
    if (!date) return out;
    const typRaw = args.length >= 2 ? args[1] : undefined;
    const typ = typRaw == null ? 1 : asNumber(typRaw);
    if (typ == null) {
      if (!isEmptyValue(typRaw)) return warnType('WEEKNUM', 'WEEKNUM type must be a number');
      return makeOkNull('WEEKNUM');
    }
    const t = Math.trunc(typ);
    if (t === 1) return makeOkNumber('WEEKNUM', weekNumber(date, 0));
    if (t === 2) return makeOkNumber('WEEKNUM', weekNumber(date, 1));
    return makeOkNull('WEEKNUM');
  }
}

export class IsDateImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }
  estimateCostsInSeconds(): number {
    return 0.00002;
  }
  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const raw = args[0];
    if (raw == null) return makeOkBoolean('ISDATE', false);
    const isObj = isDateValue(raw) || isDateTimeValue(raw);
    const isStr = typeof raw === 'string' && parseIsoDate(raw) != null;
    return makeOkBoolean('ISDATE', isObj || isStr);
  }
}
