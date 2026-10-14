import { BuiltinSignatureIds } from './builtin-signature-ids';
import type { FunctionParamDefinition, MutableFormulaRegistry } from './registry';
import { FormulaTypes } from './types';

/**
 * Registers the portable (data-only) definitions for all core/primitive functions and operators.
 *
 * These definitions are safe to ship to editors and other embedding tooling; execution is provided separately by backend-only implementations.
 */
export function registerCoreFormulaDefinitions(registry: MutableFormulaRegistry): void {
  // Arithmetic
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.ADD,
    name: 'ADD',
    category: 'core',
    description: 'Adds two numbers.',
    params: [
      { name: 'a', type: FormulaTypes.number(true) },
      { name: 'b', type: FormulaTypes.number(true) },
    ],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });
  registry.registerOperator({
    token: '+',
    precedence: 20,
    associativity: 'left',
    functionSignatureId: BuiltinSignatureIds.ADD,
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.SUB,
    name: 'SUB',
    category: 'core',
    description: 'Subtracts b from a.',
    params: [
      { name: 'a', type: FormulaTypes.number(true) },
      { name: 'b', type: FormulaTypes.number(true) },
    ],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });
  registry.registerOperator({
    token: '-',
    precedence: 20,
    associativity: 'left',
    functionSignatureId: BuiltinSignatureIds.SUB,
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.MUL,
    name: 'MUL',
    category: 'core',
    description: 'Multiplies two numbers.',
    params: [
      { name: 'a', type: FormulaTypes.number(true) },
      { name: 'b', type: FormulaTypes.number(true) },
    ],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });
  registry.registerOperator({
    token: '*',
    precedence: 30,
    associativity: 'left',
    functionSignatureId: BuiltinSignatureIds.MUL,
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.DIV,
    name: 'DIV',
    category: 'core',
    description: 'Divides a by b.',
    params: [
      { name: 'a', type: FormulaTypes.number(true) },
      { name: 'b', type: FormulaTypes.number(true) },
    ],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });
  registry.registerOperator({
    token: '/',
    precedence: 30,
    associativity: 'left',
    functionSignatureId: BuiltinSignatureIds.DIV,
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.POW,
    name: 'POW',
    category: 'core',
    description: 'Raises a number to a power.',
    params: [
      { name: 'base', type: FormulaTypes.number(true) },
      { name: 'exponent', type: FormulaTypes.number(true) },
    ],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });
  registry.registerOperator({
    token: '^',
    precedence: 40,
    associativity: 'right',
    functionSignatureId: BuiltinSignatureIds.POW,
  });

  // Comparison / equality
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.EQ,
    name: 'EQ',
    category: 'core',
    description: 'Returns true when a equals b.',
    params: [
      { name: 'a', type: FormulaTypes.any(true) },
      { name: 'b', type: FormulaTypes.any(true) },
    ],
    returnType: FormulaTypes.boolean(true),
    purity: 'pure',
  });
  registry.registerOperator({
    token: '=',
    precedence: 10,
    associativity: 'left',
    functionSignatureId: BuiltinSignatureIds.EQ,
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.NEQ,
    name: 'NEQ',
    category: 'core',
    description: 'Returns true when a does not equal b.',
    params: [
      { name: 'a', type: FormulaTypes.any(true) },
      { name: 'b', type: FormulaTypes.any(true) },
    ],
    returnType: FormulaTypes.boolean(true),
    purity: 'pure',
  });
  registry.registerOperator({
    token: '<>',
    precedence: 10,
    associativity: 'left',
    functionSignatureId: BuiltinSignatureIds.NEQ,
  });

  for (const [sig, name, token, description] of [
    [BuiltinSignatureIds.GT, 'GT', '>', 'Returns true when a is greater than b.'],
    [BuiltinSignatureIds.GTE, 'GTE', '>=', 'Returns true when a is greater than or equal to b.'],
    [BuiltinSignatureIds.LT, 'LT', '<', 'Returns true when a is less than b.'],
    [BuiltinSignatureIds.LTE, 'LTE', '<=', 'Returns true when a is less than or equal to b.'],
  ] as const) {
    const comparable = FormulaTypes.union(
      [
        FormulaTypes.number(true),
        FormulaTypes.text(true),
        FormulaTypes.list(FormulaTypes.any(true), true),
      ],
      true,
    );
    registry.registerFunction({
      signatureId: sig,
      name,
      category: 'core',
      description,
      params: [
        { name: 'a', type: comparable },
        { name: 'b', type: comparable },
      ],
      returnType: FormulaTypes.boolean(true),
      purity: 'pure',
    });
    registry.registerOperator({
      token,
      precedence: 10,
      associativity: 'left',
      functionSignatureId: sig,
    });
  }

  // Logic
  const booleanLike = FormulaTypes.union(
    [FormulaTypes.boolean(true), FormulaTypes.text(true)],
    true,
  );
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.AND,
    name: 'AND',
    category: 'core',
    description: 'Returns true if all values are set.',
    params: [{ name: 'values', type: booleanLike, variadic: true }],
    returnType: FormulaTypes.boolean(true),
    purity: 'pure',
    controlFlow: true,
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.OR,
    name: 'OR',
    category: 'core',
    description: 'Returns true if any value is set.',
    params: [{ name: 'values', type: booleanLike, variadic: true }],
    returnType: FormulaTypes.boolean(true),
    purity: 'pure',
    controlFlow: true,
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.NOT,
    name: 'NOT',
    category: 'core',
    description: 'Negate the value.',
    params: [{ name: 'value', type: FormulaTypes.any(true) }],
    returnType: FormulaTypes.boolean(true),
    purity: 'pure',
    controlFlow: true,
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.IF,
    name: 'IF',
    category: 'core',
    description: 'Returns "then" when cond is set, otherwise "else".',
    templates: [
      {
        name: 'T',
        description: 'The type of the returned value.',
      },
    ],
    params: [
      { name: 'cond', type: booleanLike },
      { name: 'then', type: FormulaTypes.template('T', { nullable: true }) },
      { name: 'else', type: FormulaTypes.template('T', { nullable: true }) },
    ],
    returnType: FormulaTypes.template('T', { nullable: true }),
    purity: 'pure',
    controlFlow: true,
  });

  // Empty checks
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.IS_EMPTY,
    name: 'IS_EMPTY',
    category: 'core',
    description: 'Returns whether the value is null, empty text, or an empty list.',
    params: [{ name: 'value', type: FormulaTypes.any(true) }],
    returnType: FormulaTypes.boolean(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.EMPTY,
    name: 'EMPTY',
    aliases: ['BLANK'],
    category: 'core',
    description: 'Returns an empty value (no value).',
    params: [],
    returnType: FormulaTypes.null(),
    purity: 'pure',
  });

  // Lists
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.LIST,
    name: 'LIST',
    category: 'core',
    description: 'Creates a list from the provided values.',
    templates: [
      {
        name: 'T',
        description: 'The type of each item in the list.',
      },
    ],
    params: [
      {
        name: 'values',
        type: FormulaTypes.template('T', { nullable: true }),
        variadic: true,
      },
    ],
    returnType: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
    purity: 'pure',
  });

  // LEN overloads (text and list). LENGTH is an alias.
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.LEN_TEXT,
    name: 'LEN',
    aliases: ['LENGTH'],
    category: 'core',
    description: 'Returns the number of characters in a text.',
    params: [{ name: 'text', type: FormulaTypes.text(true) }],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.LEN_LIST,
    name: 'LEN',
    aliases: ['LENGTH'],
    category: 'core',
    description: 'Returns the number of items in a list.',
    params: [{ name: 'list', type: FormulaTypes.list(FormulaTypes.any(true), true) }],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });

  // COUNT overloads
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.COUNT,
    name: 'COUNT',
    category: 'core',
    description: 'Counts the number of items in a list.',
    params: [{ name: 'list', type: FormulaTypes.list(FormulaTypes.any(true), true) }],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
    casts: [
      { from: FormulaTypes.list(FormulaTypes.any(true), true), to: FormulaTypes.number(true) },
    ],
  });
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.COUNT_VALUES,
    name: 'COUNT',
    category: 'core',
    description: 'Counts how many values were provided.',
    params: [{ name: 'values', type: FormulaTypes.any(true), variadic: true }],
    returnType: FormulaTypes.number(false),
    purity: 'pure',
  });

  // COUNT_UNIQUE
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.COUNT_UNIQUE,
    name: 'COUNT_UNIQUE',
    category: 'core',
    description: 'Counts the number of distinct values.',
    params: [{ name: 'values', type: FormulaTypes.any(true), variadic: true }],
    returnType: FormulaTypes.number(false),
    purity: 'pure',
  });

  // AVG
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.AVG,
    name: 'AVG',
    aliases: ['AVERAGE'],
    category: 'core',
    description: 'Returns the average of a list of numbers.',
    params: [{ name: 'values', type: FormulaTypes.list(FormulaTypes.number(true), true) }],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });

  // MIN / MAX / SUM / MEDIAN
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.MIN,
    name: 'MIN',
    category: 'core',
    description: 'Returns the smallest number in a list.',
    params: [{ name: 'values', type: FormulaTypes.list(FormulaTypes.number(true), true) }],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.MAX,
    name: 'MAX',
    category: 'core',
    description: 'Returns the largest number in a list.',
    params: [{ name: 'values', type: FormulaTypes.list(FormulaTypes.number(true), true) }],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.SUM,
    name: 'SUM',
    category: 'core',
    description: 'Returns the sum of a list of numbers.',
    params: [{ name: 'values', type: FormulaTypes.list(FormulaTypes.number(true), true) }],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.MEDIAN,
    name: 'MEDIAN',
    category: 'core',
    description: 'Returns the median of a list of numbers.',
    params: [{ name: 'values', type: FormulaTypes.list(FormulaTypes.number(true), true) }],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });

  // RANGE_SCORE
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.RANGE_SCORE,
    name: 'RANGE_SCORE',
    category: 'core',
    description: 'Computes a normalized score based on warning and bad thresholds.',
    params: [
      { name: 'value', type: FormulaTypes.number(true) },
      { name: 'bad_min', type: FormulaTypes.number(true) },
      { name: 'warn_min', type: FormulaTypes.number(true) },
      { name: 'warn_max', type: FormulaTypes.number(true) },
      { name: 'bad_max', type: FormulaTypes.number(true) },
    ],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });

  // FLAT
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.FLAT,
    name: 'FLAT',
    category: 'core',
    description: 'Flattens a list.',
    params: [{ name: 'list', type: FormulaTypes.list(FormulaTypes.any(true), true) }],
    returnType: FormulaTypes.list(FormulaTypes.any(true), true),
    purity: 'pure',
  });

  // CONCAT
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.CONCAT,
    name: 'CONCAT',
    category: 'core',
    description: 'Concatenates values into a single text.',
    params: [{ name: 'values', type: FormulaTypes.any(true), variadic: true }],
    returnType: FormulaTypes.text(true),
    purity: 'pure',
  });
  registry.registerOperator({
    token: '&',
    precedence: 20,
    associativity: 'left',
    functionSignatureId: BuiltinSignatureIds.CONCAT,
  });

  // JOIN
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.JOIN,
    name: 'JOIN',
    category: 'core',
    description: 'Joins a list of text values using a separator.',
    params: [
      { name: 'values', type: FormulaTypes.list(FormulaTypes.text(true), true) },
      { name: 'separator', type: FormulaTypes.text(true) },
    ],
    returnType: FormulaTypes.text(true),
    purity: 'pure',
  });

  // LOWER / UPPER
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.LOWER,
    name: 'LOWER',
    category: 'core',
    description: 'Converts text to lowercase.',
    params: [{ name: 'text', type: FormulaTypes.text(true) }],
    returnType: FormulaTypes.text(true),
    purity: 'pure',
  });
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.UPPER,
    name: 'UPPER',
    category: 'core',
    description: 'Converts text to uppercase.',
    params: [{ name: 'text', type: FormulaTypes.text(true) }],
    returnType: FormulaTypes.text(true),
    purity: 'pure',
  });

  // STARTS_WITH overloads
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.STARTS_WITH,
    name: 'STARTS_WITH',
    category: 'core',
    description: 'Whether the provided text starts with "needle".',
    params: [
      { name: 'text', type: FormulaTypes.text(true) },
      { name: 'needle', type: FormulaTypes.text(true) },
    ],
    returnType: FormulaTypes.boolean(true),
    purity: 'pure',
  });
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.STARTS_WITH_LIST,
    name: 'STARTS_WITH',
    category: 'core',
    description: 'Whether the text starts with any "needle" in "needles".',
    params: [
      { name: 'text', type: FormulaTypes.text(true) },
      { name: 'needles', type: FormulaTypes.list(FormulaTypes.text(true), true) },
    ],
    returnType: FormulaTypes.boolean(true),
    purity: 'pure',
  });

  // ENDS_WITH
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.ENDS_WITH,
    name: 'ENDS_WITH',
    category: 'core',
    description: 'Whether the text ends with "needle".',
    params: [
      { name: 'text', type: FormulaTypes.text(true) },
      { name: 'needle', type: FormulaTypes.text(true) },
    ],
    returnType: FormulaTypes.boolean(true),
    purity: 'pure',
  });

  // CONTAINS
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.CONTAINS,
    name: 'CONTAINS',
    category: 'core',
    description: 'Whether the text contains "needle".',
    params: [
      { name: 'text', type: FormulaTypes.text(true) },
      { name: 'needle', type: FormulaTypes.text(true) },
    ],
    returnType: FormulaTypes.boolean(true),
    purity: 'pure',
  });

  // MATCH_EXPRESSION
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.MATCH_EXPRESSION,
    name: 'MATCH_EXPRESSION',
    category: 'core',
    description: 'Whether the text matches the given pattern.',
    params: [
      { name: 'text', type: FormulaTypes.text(true) },
      { name: 'pattern', type: FormulaTypes.text(true) },
    ],
    returnType: FormulaTypes.boolean(true),
    purity: 'pure',
  });

  // FILTER helpers
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.FILTER,
    name: 'FILTER',
    category: 'core',
    description: 'Filter a list with the given check.',
    templates: [
      {
        name: 'T',
        description: 'The type of each item in the list.',
      },
    ],
    params: [
      {
        name: 'target',
        type: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
      },
      {
        name: 'operator',
        type: FormulaTypes.callable('function_or_operator', {
          paramTypes: [FormulaTypes.template('T', { nullable: true }), FormulaTypes.any(true)],
          returnType: FormulaTypes.boolean(true),
          minArity: 1,
          maxArity: 2,
        }),
        literalOnly: true,
      },
      { name: 'operatorValue', type: FormulaTypes.any(true), optional: true },
    ],
    returnType: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.FILTER_PROPERTY,
    name: 'FILTER_PROPERTY',
    category: 'core',
    description: 'Filter a list by checking a property of each item.',
    templates: [
      {
        name: 'T',
        description: 'The type of each item in the list.',
      },
    ],
    params: [
      {
        name: 'target',
        type: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
      },
      { name: 'property', type: FormulaTypes.text(false), literalOnly: true },
      {
        name: 'operator',
        type: FormulaTypes.callable('function_or_operator', {
          // FILTER_PROPERTY calls the operator with (propertyValue[, operatorValue]).
          // We intentionally keep propertyValue as Any because it depends on the property.
          paramTypes: [FormulaTypes.any(true), FormulaTypes.any(true)],
          returnType: FormulaTypes.boolean(true),
          minArity: 1,
          maxArity: 2,
        }),
        literalOnly: true,
      },
      { name: 'operatorValue', type: FormulaTypes.any(true), optional: true },
    ],
    returnType: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.INCLUDES,
    name: 'INCLUDES',
    category: 'core',
    description: 'Whether the list contains the provided value.',
    templates: [
      {
        name: 'T',
        description: 'The type of each item in the list.',
      },
    ],
    params: [
      {
        name: 'target',
        type: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
      },
      { name: 'value', type: FormulaTypes.template('T', { nullable: true }) },
    ],
    returnType: FormulaTypes.boolean(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.EACH,
    name: 'EACH',
    category: 'core',
    description: 'Transform a list of items.',
    templates: [
      {
        name: 'T',
        description: 'The type of each item in the input list.',
      },
      {
        name: 'R',
        description: 'The type of each item in the output list.',
      },
    ],
    params: [
      {
        name: 'target',
        type: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
      },
      {
        name: 'operator',
        type: FormulaTypes.callable('function_or_operator', {
          paramTypes: [FormulaTypes.template('T', { nullable: true })],
          returnType: FormulaTypes.template('R', { nullable: true }),
          minArity: 1,
        }),
        literalOnly: true,
      },
      { name: 'args', type: FormulaTypes.any(true), variadic: true, optional: true },
    ],
    returnType: FormulaTypes.list(FormulaTypes.template('R', { nullable: true }), true),
    purity: 'pure',
  });

  // Date / time
  const DateType = FormulaTypes.object(
    'date',
    {
      iso: FormulaTypes.text(false),
      year: FormulaTypes.number(false),
      month: FormulaTypes.number(false),
      day: FormulaTypes.number(false),
    },
    true,
  );
  const TimeType = FormulaTypes.object(
    'time',
    {
      iso: FormulaTypes.text(false),
      hour: FormulaTypes.number(false),
      minute: FormulaTypes.number(false),
      second: FormulaTypes.number(false),
    },
    true,
  );
  const DateTimeType = FormulaTypes.object(
    'datetime',
    {
      iso: FormulaTypes.text(false),
      date: DateType,
      time: TimeType,
    },
    true,
  );
  const DateLike = FormulaTypes.union([DateType, DateTimeType], true);
  const TimeLike = FormulaTypes.union([TimeType, DateTimeType], true);
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.DATE,
    name: 'DATE',
    category: 'core',
    description: 'Create a date value from year, month, and day.',
    params: [
      { name: 'year', type: FormulaTypes.number(true) },
      { name: 'month', type: FormulaTypes.number(true) },
      { name: 'day', type: FormulaTypes.number(true), optional: true },
    ],
    returnType: DateType,
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.DATEVALUE,
    name: 'DATEVALUE',
    category: 'core',
    description: 'Parse a date from a text or timestamp.',
    params: [
      {
        name: 'date_string',
        type: FormulaTypes.union([FormulaTypes.text(true), FormulaTypes.number(true)], true),
      },
    ],
    returnType: DateType,
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.TIME,
    name: 'TIME',
    category: 'core',
    description: 'Create a time value from hour, minute, and second.',
    params: [
      { name: 'hour', type: FormulaTypes.number(true) },
      { name: 'minute', type: FormulaTypes.number(true), optional: true },
      { name: 'second', type: FormulaTypes.number(true), optional: true },
    ],
    returnType: TimeType,
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.TIMEVALUE,
    name: 'TIMEVALUE',
    category: 'core',
    description: 'Parse a time from a text value.',
    params: [{ name: 'time_string', type: FormulaTypes.text(true) }],
    returnType: TimeType,
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.NOW,
    name: 'NOW',
    category: 'core',
    description: 'The current date and time.',
    params: [],
    returnType: DateTimeType,
    purity: 'uncached',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.TODAY,
    name: 'TODAY',
    category: 'core',
    description: 'The current date.',
    params: [],
    returnType: DateType,
    purity: 'uncached',
  });

  for (const [sig, name, description] of [
    [BuiltinSignatureIds.DAY, 'DAY', 'The day of the month from a date.'],
    [BuiltinSignatureIds.MONTH, 'MONTH', 'The month number from a date.'],
    [BuiltinSignatureIds.YEAR, 'YEAR', 'The year number from a date.'],
    [BuiltinSignatureIds.ISOWEEKNUM, 'ISOWEEKNUM', 'The ISO week number for a date.'],
  ] as const) {
    registry.registerFunction({
      signatureId: sig,
      name,
      category: 'core',
      description,
      params: [{ name: 'date', type: DateLike }],
      returnType: FormulaTypes.number(true),
      purity: 'pure',
    });
  }

  for (const [sig, name, description] of [
    [BuiltinSignatureIds.DAY_NOW, 'DAY', 'The current day of the month.'],
    [BuiltinSignatureIds.MONTH_NOW, 'MONTH', 'The current month number.'],
    [BuiltinSignatureIds.YEAR_NOW, 'YEAR', 'The current year number.'],
    [BuiltinSignatureIds.ISOWEEKNUM_NOW, 'ISOWEEKNUM', 'The current ISO week number.'],
  ] as const) {
    registry.registerFunction({
      signatureId: sig,
      name,
      category: 'core',
      description,
      params: [],
      returnType: FormulaTypes.number(true),
      purity: 'uncached',
    });
  }

  for (const [sig, name, description] of [
    [BuiltinSignatureIds.HOUR, 'HOUR', 'The hour component of a time value.'],
    [BuiltinSignatureIds.MINUTE, 'MINUTE', 'The minute component of a time value.'],
    [BuiltinSignatureIds.SECOND, 'SECOND', 'The second component of a time value.'],
  ] as const) {
    registry.registerFunction({
      signatureId: sig,
      name,
      category: 'core',
      description,
      params: [{ name: 'time', type: TimeLike }],
      returnType: FormulaTypes.number(true),
      purity: 'pure',
    });
  }

  for (const [sig, name, description] of [
    [BuiltinSignatureIds.HOUR_NOW, 'HOUR', 'The current hour.'],
    [BuiltinSignatureIds.MINUTE_NOW, 'MINUTE', 'The current minute.'],
    [BuiltinSignatureIds.SECOND_NOW, 'SECOND', 'The current second.'],
  ] as const) {
    registry.registerFunction({
      signatureId: sig,
      name,
      category: 'core',
      description,
      params: [],
      returnType: FormulaTypes.number(true),
      purity: 'uncached',
    });
  }

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.DAYS,
    name: 'DAYS',
    category: 'core',
    description: 'The number of days between two dates.',
    params: [
      { name: 'end_date', type: DateLike },
      { name: 'start_date', type: DateLike },
    ],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.DATEDIF,
    name: 'DATEDIF',
    category: 'core',
    description: 'The difference between two dates in the specified unit.',
    params: [
      { name: 'start_date', type: DateLike },
      { name: 'end_date', type: DateLike },
      { name: 'unit', type: FormulaTypes.text(true) },
    ],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.WEEKDAY,
    name: 'WEEKDAY',
    category: 'core',
    description: 'The weekday number for a date.',
    params: [
      { name: 'date', type: DateLike },
      { name: 'type', type: FormulaTypes.number(true), optional: true },
    ],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.WEEKDAY_NOW,
    name: 'WEEKDAY',
    category: 'core',
    description: 'The weekday number for today.',
    params: [],
    returnType: FormulaTypes.number(true),
    purity: 'uncached',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.WEEKNUM,
    name: 'WEEKNUM',
    category: 'core',
    description: 'The week number for a date.',
    params: [
      { name: 'date', type: DateLike },
      { name: 'type', type: FormulaTypes.number(true), optional: true },
    ],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.WEEKNUM_NOW,
    name: 'WEEKNUM',
    category: 'core',
    description: 'The week number for today.',
    params: [],
    returnType: FormulaTypes.number(true),
    purity: 'uncached',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.ISDATE,
    name: 'ISDATE',
    category: 'core',
    description: 'True when the value is a date, time, or datetime value.',
    params: [{ name: 'value', type: FormulaTypes.any(true) }],
    returnType: FormulaTypes.boolean(false),
    purity: 'pure',
  });

  // List helpers
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.SORT,
    name: 'SORT',
    category: 'core',
    description: 'Sort a list in ascending or descending order.',
    templates: [
      {
        name: 'T',
        description: 'The type of each item in the list.',
      },
    ],
    params: [
      {
        name: 'list',
        type: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
      },
      { name: 'descending', type: FormulaTypes.boolean(true), optional: true },
    ],
    returnType: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.SORT_BY_PROPERTY,
    name: 'SORT_BY_PROPERTY',
    category: 'core',
    description: 'Sort a list by the specified property.',
    templates: [
      {
        name: 'T',
        description: 'The type of each item in the list.',
      },
    ],
    params: [
      {
        name: 'list',
        type: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
      },
      { name: 'property', type: FormulaTypes.text(false), literalOnly: true },
      { name: 'descending', type: FormulaTypes.boolean(true), optional: true },
    ],
    returnType: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.INDEX,
    name: 'INDEX',
    category: 'core',
    description: 'Get an item from a list.',
    templates: [
      {
        name: 'T',
        description: 'The type of each item in the list.',
      },
    ],
    params: [
      {
        name: 'list',
        type: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
      },
      { name: 'index', type: FormulaTypes.number(true) },
    ],
    returnType: FormulaTypes.template('T', { nullable: true }),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.REDUCE,
    name: 'REDUCE',
    category: 'core',
    description: 'Reduce a list to a single value.',
    templates: [
      {
        name: 'A',
        description: 'The type of the reduced value.',
      },
      {
        name: 'T',
        description: 'The type of each item in the list.',
      },
    ],
    params: [
      { name: 'initial_value', type: FormulaTypes.template('A', { nullable: true }) },
      {
        name: 'list',
        type: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
      },
      {
        name: 'lambda',
        type: FormulaTypes.callable('function_or_operator', {
          paramTypes: [
            FormulaTypes.template('A', { nullable: true }),
            FormulaTypes.template('T', { nullable: true }),
          ],
          returnType: FormulaTypes.template('A', { nullable: true }),
          minArity: 2,
          maxArity: 2,
        }),
        literalOnly: true,
      },
    ],
    returnType: FormulaTypes.template('A', { nullable: true }),
    purity: 'pure',
    controlFlow: true,
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.TAKE,
    name: 'TAKE',
    category: 'core',
    description: 'A run of consecutive items from a list.',
    templates: [
      {
        name: 'T',
        description: 'The type of each item in the list.',
      },
    ],
    params: [
      {
        name: 'list',
        type: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
      },
      { name: 'count', description: 'How many items to take.', type: FormulaTypes.number(true) },
      {
        name: 'start',
        description: 'The 1-based position of the first item taken (default 1).',
        type: FormulaTypes.number(true),
        optional: true,
      },
    ],
    returnType: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.INDEX_OF,
    name: 'INDEX_OF',
    category: 'core',
    description: 'The 1-based position of the first item equal to the value.',
    templates: [
      {
        name: 'T',
        description: 'The type of each item in the list.',
      },
    ],
    params: [
      {
        name: 'list',
        type: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
      },
      { name: 'value', type: FormulaTypes.template('T', { nullable: true }) },
    ],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.FILTER_BY,
    name: 'FILTER_BY',
    category: 'core',
    description: 'Filter a list by checking the key at the same position in a second list.',
    templates: [
      {
        name: 'T',
        description: 'The type of each item in the list.',
      },
    ],
    params: [
      {
        name: 'list',
        type: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
      },
      {
        name: 'keys',
        description: 'One key per list item, checked in its place.',
        type: FormulaTypes.list(FormulaTypes.any(true), true),
      },
      {
        name: 'operator',
        type: FormulaTypes.callable('function_or_operator', {
          // FILTER_BY calls the operator with (key[, operatorValue]).
          paramTypes: [FormulaTypes.any(true), FormulaTypes.any(true)],
          returnType: FormulaTypes.boolean(true),
          minArity: 1,
          maxArity: 2,
        }),
        literalOnly: true,
      },
      { name: 'operatorValue', type: FormulaTypes.any(true), optional: true },
    ],
    // operator(key[; operatorValue]), the key taken from `keys` at the item's position.
    callableInvocation: [
      { kind: 'item', of: 1 },
      { kind: 'argument', at: 3 },
    ],
    returnType: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.DISTINCT,
    name: 'DISTINCT',
    category: 'core',
    description: 'The first occurrence of each distinct non-empty item, in order.',
    templates: [
      {
        name: 'T',
        description: 'The type of each item in the list.',
      },
    ],
    params: [
      {
        name: 'list',
        type: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
      },
    ],
    returnType: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.GROUP_COUNTS,
    name: 'GROUP_COUNTS',
    category: 'core',
    description: 'For each distinct non-empty item, in order, how many items equal it.',
    params: [{ name: 'list', type: FormulaTypes.list(FormulaTypes.any(true), true) }],
    returnType: FormulaTypes.list(FormulaTypes.number(false), true),
    purity: 'pure',
  });

  // Type predicates
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.ISNUMBER,
    name: 'ISNUMBER',
    category: 'core',
    description: 'Whether the value is a number.',
    params: [{ name: 'value', type: FormulaTypes.any(true) }],
    returnType: FormulaTypes.boolean(false),
    purity: 'pure',
  });
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.ISTEXT,
    name: 'ISTEXT',
    category: 'core',
    description: 'Whether the value is text.',
    params: [{ name: 'value', type: FormulaTypes.any(true) }],
    returnType: FormulaTypes.boolean(false),
    purity: 'pure',
  });

  // SWITCH
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.SWITCH,
    name: 'SWITCH',
    category: 'core',
    description: 'Chose a conditional result.',
    params: [
      { name: 'expression', type: FormulaTypes.any(true) },
      { name: 'casesAndValues', type: FormulaTypes.any(true), variadic: true },
    ],
    returnType: FormulaTypes.any(true),
    purity: 'pure',
    controlFlow: true,
  });

  // Math
  for (const [sig, name, description] of [
    [BuiltinSignatureIds.SIN, 'SIN', 'The sine of value (in radians).'],
    [BuiltinSignatureIds.COS, 'COS', 'The cosine of value (in radians).'],
    [BuiltinSignatureIds.TAN, 'TAN', 'The tangent of value (in radians).'],
    [BuiltinSignatureIds.ASIN, 'ASIN', 'The arcsine of value (in radians).'],
    [BuiltinSignatureIds.ACOS, 'ACOS', 'The arccosine of value (in radians).'],
    [BuiltinSignatureIds.ATAN, 'ATAN', 'The arctangent of value (in radians).'],
    [BuiltinSignatureIds.CEILING, 'CEILING', 'Round up to the nearest integer.'],
    [BuiltinSignatureIds.FLOOR, 'FLOOR', 'Round down to the nearest integer.'],
    [BuiltinSignatureIds.EXP, 'EXP', '"e" raised to the power of value.'],
    [BuiltinSignatureIds.LOG10, 'LOG10', 'The base-10 logarithm of value.'],
    [BuiltinSignatureIds.SQRT, 'SQRT', 'The square root of value.'],
  ] as const) {
    registry.registerFunction({
      signatureId: sig,
      name,
      category: 'core',
      description,
      params: [{ name: 'value', type: FormulaTypes.number(true) }],
      returnType: FormulaTypes.number(true),
      purity: 'pure',
    });
  }

  for (const [sig, name, description] of [
    [BuiltinSignatureIds.ISEVEN, 'ISEVEN', 'Whether value is an even integer.'],
    [BuiltinSignatureIds.ISODD, 'ISODD', 'Whether value is an odd integer.'],
  ] as const) {
    registry.registerFunction({
      signatureId: sig,
      name,
      category: 'core',
      description,
      params: [{ name: 'value', type: FormulaTypes.number(true) }],
      returnType: FormulaTypes.boolean(false),
      purity: 'pure',
    });
  }

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.LOG,
    name: 'LOG',
    category: 'core',
    description: 'The logarithm of value, using base 10 by default.',
    params: [
      { name: 'value', type: FormulaTypes.number(true) },
      { name: 'base', type: FormulaTypes.number(true), optional: true },
    ],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.MOD,
    name: 'MOD',
    category: 'core',
    description: 'The remainder after dividing dividend by divisor.',
    params: [
      { name: 'dividend', type: FormulaTypes.number(true) },
      { name: 'divisor', type: FormulaTypes.number(true) },
    ],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.PI,
    name: 'PI',
    category: 'core',
    description: 'The constant pi.',
    params: [],
    returnType: FormulaTypes.number(false),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.PRODUCT,
    name: 'PRODUCT',
    category: 'core',
    description: 'The product of the provided factors.',
    params: [{ name: 'factors', type: FormulaTypes.number(true), variadic: true }],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });

  for (const [sig, name, description] of [
    [BuiltinSignatureIds.ROUND, 'ROUND', 'Round to the given number of digits.'],
    [BuiltinSignatureIds.ROUNDDOWN, 'ROUNDDOWN', 'Round down to the given number of digits.'],
    [BuiltinSignatureIds.ROUNDUP, 'ROUNDUP', 'Round up to the given number of digits.'],
  ] as const) {
    registry.registerFunction({
      signatureId: sig,
      name,
      category: 'core',
      description,
      params: [
        { name: 'value', type: FormulaTypes.number(true) },
        { name: 'digits', type: FormulaTypes.number(true), optional: true },
      ],
      returnType: FormulaTypes.number(true),
      purity: 'pure',
    });
  }

  // Text helpers
  registry.registerFunction({
    signatureId: BuiltinSignatureIds.TO_TEXT,
    name: 'TO_TEXT',
    category: 'core',
    description: 'Convert a value to text.',
    params: [{ name: 'value', type: FormulaTypes.any(true) }],
    returnType: FormulaTypes.text(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.CHAR,
    name: 'CHAR',
    category: 'core',
    description: 'The Unicode character for a code point.',
    params: [{ name: 'table_number', type: FormulaTypes.number(true) }],
    returnType: FormulaTypes.text(true),
    purity: 'pure',
  });

  for (const [sig, name, description] of [
    [BuiltinSignatureIds.LEFT, 'LEFT', 'The leftmost characters of a string.'],
    [BuiltinSignatureIds.RIGHT, 'RIGHT', 'The rightmost characters of a string.'],
  ] as const) {
    registry.registerFunction({
      signatureId: sig,
      name,
      category: 'core',
      description,
      params: [
        { name: 'string', type: FormulaTypes.text(true) },
        { name: 'number_of_characters', type: FormulaTypes.number(true), optional: true },
      ],
      returnType: FormulaTypes.text(true),
      purity: 'pure',
    });
  }

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.MID,
    name: 'MID',
    category: 'core',
    description: 'A substring from string starting at starting_at for extract_length.',
    params: [
      { name: 'string', type: FormulaTypes.text(true) },
      { name: 'starting_at', type: FormulaTypes.number(true) },
      { name: 'extract_length', type: FormulaTypes.number(true) },
    ],
    returnType: FormulaTypes.text(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.REGEXEXTRACT,
    name: 'REGEXEXTRACT',
    category: 'core',
    description: 'A substring that matches an expression.',
    params: [
      { name: 'text', type: FormulaTypes.text(true) },
      { name: 'regular_expression', type: FormulaTypes.text(true) },
    ],
    returnType: FormulaTypes.text(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.REGEXREPLACE,
    name: 'REGEXREPLACE',
    category: 'core',
    description: 'Replace substrings that match an expression.',
    params: [
      { name: 'text', type: FormulaTypes.text(true) },
      { name: 'regular_expression', type: FormulaTypes.text(true) },
      { name: 'replacement', type: FormulaTypes.text(true) },
    ],
    returnType: FormulaTypes.text(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.REPLACE,
    name: 'REPLACE',
    category: 'core',
    description: 'Replace part of text at a position with new_text.',
    params: [
      { name: 'text', type: FormulaTypes.text(true) },
      { name: 'position', type: FormulaTypes.number(true) },
      { name: 'length', type: FormulaTypes.number(true) },
      { name: 'new_text', type: FormulaTypes.text(true) },
    ],
    returnType: FormulaTypes.text(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.SUBSTITUTE,
    name: 'SUBSTITUTE',
    category: 'core',
    description: 'Replace occurrences of search_for in text_to_search with replace_with.',
    params: [
      { name: 'text_to_search', type: FormulaTypes.text(true) },
      { name: 'search_for', type: FormulaTypes.text(true) },
      { name: 'replace_with', type: FormulaTypes.text(true) },
      { name: 'occurrence_number', type: FormulaTypes.number(true), optional: true },
    ],
    returnType: FormulaTypes.text(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.TRIM,
    name: 'TRIM',
    category: 'core',
    description: 'Trim and normalize whitespace in text.',
    params: [{ name: 'text', type: FormulaTypes.text(true) }],
    returnType: FormulaTypes.text(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.ENCODEURL,
    name: 'ENCODEURL',
    category: 'core',
    description: 'URL-encode text for safe use in a query string.',
    params: [{ name: 'text', type: FormulaTypes.text(true) }],
    returnType: FormulaTypes.text(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.ISURL,
    name: 'ISURL',
    category: 'core',
    description: 'Whether the value is a valid URL.',
    params: [{ name: 'value', type: FormulaTypes.any(true) }],
    returnType: FormulaTypes.boolean(false),
    purity: 'pure',
  });

  // Text segmentation: words, sentences and lines. Each definition gets its own parameter
  // objects, so no two definitions share a mutable `literalValues` array.
  const wordModeParam = (): FunctionParamDefinition => ({
    name: 'mode',
    description: 'How words are found: "whitespace" (default), "letters", "locale" or "pattern".',
    type: FormulaTypes.text(false),
    optional: true,
    literalOnly: true,
    literalValues: ['whitespace', 'letters', 'locale', 'pattern'],
  });
  const wordOptionParam = (): FunctionParamDefinition => ({
    name: 'option',
    description: 'The BCP 47 language tag in "locale" mode, the token pattern in "pattern" mode.',
    type: FormulaTypes.text(true),
    optional: true,
  });
  const lineModeParam = (): FunctionParamDefinition => ({
    name: 'mode',
    description: 'Which lines count: "non-blank" (default) or "all".',
    type: FormulaTypes.text(false),
    optional: true,
    literalOnly: true,
    literalValues: ['non-blank', 'all'],
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.WORDS,
    name: 'WORDS',
    category: 'core',
    description: 'Splits a text into its words.',
    params: [{ name: 'text', type: FormulaTypes.text(true) }, wordModeParam(), wordOptionParam()],
    returnType: FormulaTypes.list(FormulaTypes.text(false), true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.WORD_COUNT,
    name: 'WORD_COUNT',
    category: 'core',
    description: 'Counts the words in a text.',
    params: [{ name: 'text', type: FormulaTypes.text(true) }, wordModeParam(), wordOptionParam()],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.LEADING_WORDS,
    name: 'LEADING_WORDS',
    category: 'core',
    description: 'The first words of a text, joined by one space.',
    params: [
      { name: 'text', type: FormulaTypes.text(true) },
      {
        name: 'count',
        description: 'How many words to take; null when the text has fewer.',
        type: FormulaTypes.number(true),
      },
      wordModeParam(),
      wordOptionParam(),
    ],
    returnType: FormulaTypes.text(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.SENTENCES,
    name: 'SENTENCES',
    category: 'core',
    description: 'Splits a text into its sentences.',
    params: [
      { name: 'text', type: FormulaTypes.text(true) },
      {
        name: 'mode',
        description: 'What ends a sentence: "punctuation" (default) or "terminators".',
        type: FormulaTypes.text(false),
        optional: true,
        literalOnly: true,
        literalValues: ['punctuation', 'terminators'],
      },
      {
        name: 'keep',
        description: 'Tokens that never end a sentence, such as abbreviations.',
        type: FormulaTypes.list(FormulaTypes.text(true), true),
        optional: true,
      },
    ],
    returnType: FormulaTypes.list(FormulaTypes.text(false), true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.LINES,
    name: 'LINES',
    category: 'core',
    description: 'Splits a text into its lines.',
    params: [{ name: 'text', type: FormulaTypes.text(true) }, lineModeParam()],
    returnType: FormulaTypes.list(FormulaTypes.text(false), true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.LINE_COUNT,
    name: 'LINE_COUNT',
    category: 'core',
    description: 'Counts the lines in a text.',
    params: [{ name: 'text', type: FormulaTypes.text(true) }, lineModeParam()],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });

  // Phrases and markup.
  const phraseParams = (): FunctionParamDefinition[] => [
    { name: 'text', type: FormulaTypes.text(true) },
    {
      name: 'phrases',
      description: 'The phrases to look for, in priority order.',
      type: FormulaTypes.list(FormulaTypes.text(true), true),
    },
    {
      name: 'match',
      description: 'How a phrase must occur: "substring" (default) or "word".',
      type: FormulaTypes.text(false),
      optional: true,
      literalOnly: true,
      literalValues: ['substring', 'word'],
    },
    {
      name: 'ignoreCase',
      description: 'Compare after lower-casing both sides (default FALSE).',
      type: FormulaTypes.boolean(true),
      optional: true,
    },
  ];

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.FIRST_CONTAINED,
    name: 'FIRST_CONTAINED',
    category: 'core',
    description: 'The first phrase, in list order, that the text contains.',
    params: phraseParams(),
    returnType: FormulaTypes.text(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.CONTAINS_ANY,
    name: 'CONTAINS_ANY',
    category: 'core',
    description: 'Whether the text contains any of the phrases.',
    params: phraseParams(),
    returnType: FormulaTypes.boolean(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.MISSING_FROM,
    name: 'MISSING_FROM',
    category: 'core',
    description: 'The items, in order, that the text does not contain.',
    params: [
      { name: 'items', type: FormulaTypes.list(FormulaTypes.text(true), true) },
      { name: 'text', type: FormulaTypes.text(true) },
      {
        name: 'normalise',
        description: 'How both sides are compared: "whitespace" (default), "exact" or "loose".',
        type: FormulaTypes.text(false),
        optional: true,
        literalOnly: true,
        literalValues: ['whitespace', 'exact', 'loose'],
      },
    ],
    returnType: FormulaTypes.list(FormulaTypes.text(false), true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.PLAIN_TEXT,
    name: 'PLAIN_TEXT',
    category: 'core',
    description: 'The text of HTML or markdown markup, one line per block.',
    params: [
      { name: 'markup', type: FormulaTypes.text(true) },
      {
        name: 'format',
        description: 'The markup language: "html" or "markdown".',
        type: FormulaTypes.text(false),
        literalOnly: true,
        literalValues: ['html', 'markdown'],
      },
    ],
    returnType: FormulaTypes.text(true),
    purity: 'pure',
  });

  registry.registerFunction({
    signatureId: BuiltinSignatureIds.MARKDOWN_BLOCKS,
    name: 'MARKDOWN_BLOCKS',
    category: 'core',
    description: 'The text of the markdown blocks of one kind, in order.',
    params: [
      { name: 'text', type: FormulaTypes.text(true) },
      {
        name: 'kind',
        description:
          'The block kind: "heading", "heading-1" to "heading-6", "list-item", "table-row", "paragraph" or "code".',
        type: FormulaTypes.text(false),
        literalOnly: true,
        literalValues: [
          'heading',
          'heading-1',
          'heading-2',
          'heading-3',
          'heading-4',
          'heading-5',
          'heading-6',
          'list-item',
          'table-row',
          'paragraph',
          'code',
        ],
      },
    ],
    returnType: FormulaTypes.list(FormulaTypes.text(false), true),
    purity: 'pure',
  });
}
