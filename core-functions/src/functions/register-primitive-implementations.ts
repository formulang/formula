import { BuiltinSignatureIds } from '@formulang/definitions';
import type { InMemoryFunctionImplementationRegistry } from '../implementation-registry';
import { AddImplementation } from './add';
import { AndImplementation } from './and';
import { AvgImplementation } from './avg';
import { ConcatImplementation } from './concat';
import { ContainsImplementation } from './contains';
import { CountListImplementation, CountValuesImplementation } from './count';
import { CountUniqueImplementation } from './count-unique';
import {
  DateDifImplementation,
  DateImplementation,
  DateValueImplementation,
  DayImplementation,
  DayNowImplementation,
  DaysImplementation,
  HourImplementation,
  HourNowImplementation,
  IsDateImplementation,
  IsoWeekNumImplementation,
  IsoWeekNumNowImplementation,
  MinuteImplementation,
  MinuteNowImplementation,
  MonthImplementation,
  MonthNowImplementation,
  NowImplementation,
  SecondImplementation,
  SecondNowImplementation,
  TimeImplementation,
  TimeValueImplementation,
  TodayImplementation,
  WeekdayImplementation,
  WeekdayNowImplementation,
  WeekNumImplementation,
  WeekNumNowImplementation,
  YearImplementation,
  YearNowImplementation,
} from './datetime';
import { DivImplementation } from './div';
import { EachImplementation } from './each';
import { EmptyImplementation } from './empty';
import { EndsWithImplementation } from './ends-with';
import { EqImplementation } from './eq';
import { FilterImplementation } from './filter';
import { FilterByImplementation } from './filter-by';
import { FilterPropertyImplementation } from './filter-property';
import { FlatImplementation } from './flat';
import { GtImplementation } from './gt';
import { GteImplementation } from './gte';
import { IfImplementation } from './if';
import { IncludesImplementation } from './includes';
import { IsEmptyImplementation } from './is-empty';
import { JoinImplementation } from './join';
import { LenListImplementation, LenTextImplementation } from './len';
import { ListImplementation } from './list';
import {
  DistinctImplementation,
  GroupCountsImplementation,
  IndexImplementation,
  IndexOfImplementation,
  ReduceImplementation,
  SortByPropertyImplementation,
  SortImplementation,
  TakeImplementation,
} from './list-ops';
import { LowerImplementation } from './lower';
import { LtImplementation } from './lt';
import { LteImplementation } from './lte';
import {
  AcosImplementation,
  AsinImplementation,
  AtanImplementation,
  CeilingImplementation,
  CosImplementation,
  ExpImplementation,
  FloorImplementation,
  IsEvenImplementation,
  IsOddImplementation,
  Log10Implementation,
  LogImplementation,
  ModImplementation,
  PiImplementation,
  ProductImplementation,
  RoundDownImplementation,
  RoundImplementation,
  RoundUpImplementation,
  SinImplementation,
  SqrtImplementation,
  TanImplementation,
} from './math-extra';
import { MaxImplementation } from './max';
import { MedianImplementation } from './median';
import { MinImplementation } from './min';
import { MulImplementation } from './mul';
import { NeqImplementation } from './neq';
import { NotImplementation } from './not';
import { OrImplementation } from './or';
import {
  ContainsAnyImplementation,
  FirstContainedImplementation,
  MissingFromImplementation,
} from './phrase-match';
import { PowImplementation } from './pow';
import { RangeScoreImplementation } from './range-score';
import {
  MatchExpressionImplementation,
  RegexExtractImplementation,
  RegexReplaceImplementation,
} from './regex';
import { StartsWithImplementation, StartsWithListImplementation } from './starts-with';
import { SubImplementation } from './sub';
import { SumImplementation } from './sum';
import { SwitchImplementation } from './switch';
import {
  CharImplementation,
  EncodeUrlImplementation,
  IsUrlImplementation,
  LeftImplementation,
  MidImplementation,
  ReplaceImplementation,
  RightImplementation,
  SubstituteImplementation,
  ToTextImplementation,
  TrimImplementation,
} from './text-extra';
import {
  LeadingWordsImplementation,
  LineCountImplementation,
  LinesImplementation,
  SentencesImplementation,
  WordCountImplementation,
  WordsImplementation,
} from './text-segmentation';
import { IsNumberImplementation, IsTextImplementation } from './type-predicates';
import { UpperImplementation } from './upper';

/**
 * Register backend-only implementations for all core/primitive functions.
 *
 * Portable definitions (params/returnType/operators) are registered separately
 * from `definitions/register-core-definitions.ts`.
 *
 * All implementations use a static signature ID versioning scheme (e.g. "ADD/v1") that's kept stable across releases.
 */
export function registerPrimitiveFormulaImplementations(
  implementations: InMemoryFunctionImplementationRegistry,
): void {
  implementations.register('ADD/v1', new AddImplementation({ signatureId: 'ADD/v1' }));
  implementations.register('SUB/v1', new SubImplementation({ signatureId: 'SUB/v1' }));
  implementations.register('MUL/v1', new MulImplementation({ signatureId: 'MUL/v1' }));
  implementations.register('DIV/v1', new DivImplementation({ signatureId: 'DIV/v1' }));
  implementations.register(
    BuiltinSignatureIds.POW,
    new PowImplementation({ signatureId: BuiltinSignatureIds.POW }),
  );

  implementations.register('EQ/v1', new EqImplementation({ signatureId: 'EQ/v1' }));
  implementations.register('NEQ/v1', new NeqImplementation({ signatureId: 'NEQ/v1' }));
  implementations.register('GT/v1', new GtImplementation({ signatureId: 'GT/v1' }));
  implementations.register('GTE/v1', new GteImplementation({ signatureId: 'GTE/v1' }));
  implementations.register('LT/v1', new LtImplementation({ signatureId: 'LT/v1' }));
  implementations.register('LTE/v1', new LteImplementation({ signatureId: 'LTE/v1' }));

  implementations.register('AND/v1', new AndImplementation({ signatureId: 'AND/v1' }));
  implementations.register('OR/v1', new OrImplementation({ signatureId: 'OR/v1' }));
  implementations.register('NOT/v1', new NotImplementation({ signatureId: 'NOT/v1' }));
  implementations.register('IF/v1', new IfImplementation({ signatureId: 'IF/v1' }));
  implementations.register(
    'IS_EMPTY/v1',
    new IsEmptyImplementation({ signatureId: 'IS_EMPTY/v1' }),
  );
  implementations.register('EMPTY/v1', new EmptyImplementation({ signatureId: 'EMPTY/v1' }));

  implementations.register('LIST/v1', new ListImplementation({ signatureId: 'LIST/v1' }));
  implementations.register(
    'LEN_TEXT/v1',
    new LenTextImplementation({ signatureId: 'LEN_TEXT/v1' }),
  );
  implementations.register(
    'LEN_LIST/v1',
    new LenListImplementation({ signatureId: 'LEN_LIST/v1' }),
  );
  implementations.register('COUNT/v1', new CountListImplementation({ signatureId: 'COUNT/v1' }));
  implementations.register(
    'COUNT_VALUES/v1',
    new CountValuesImplementation({ signatureId: 'COUNT_VALUES/v1' }),
  );
  implementations.register(
    'COUNT_UNIQUE/v1',
    new CountUniqueImplementation({ signatureId: 'COUNT_UNIQUE/v1' }),
  );
  implementations.register('AVG/v1', new AvgImplementation({ signatureId: 'AVG/v1' }));
  implementations.register('MIN/v1', new MinImplementation({ signatureId: 'MIN/v1' }));
  implementations.register('MAX/v1', new MaxImplementation({ signatureId: 'MAX/v1' }));
  implementations.register('SUM/v1', new SumImplementation({ signatureId: 'SUM/v1' }));
  implementations.register('MEDIAN/v1', new MedianImplementation({ signatureId: 'MEDIAN/v1' }));
  implementations.register(
    'RANGE_SCORE/v1',
    new RangeScoreImplementation({ signatureId: 'RANGE_SCORE/v1' }),
  );
  implementations.register('FLAT/v1', new FlatImplementation({ signatureId: 'FLAT/v1' }));

  implementations.register('CONCAT/v1', new ConcatImplementation({ signatureId: 'CONCAT/v1' }));
  implementations.register(
    BuiltinSignatureIds.JOIN,
    new JoinImplementation({ signatureId: BuiltinSignatureIds.JOIN }),
  );
  implementations.register('LOWER/v1', new LowerImplementation({ signatureId: 'LOWER/v1' }));
  implementations.register('UPPER/v1', new UpperImplementation({ signatureId: 'UPPER/v1' }));
  implementations.register(
    'STARTS_WITH/v1',
    new StartsWithImplementation({ signatureId: 'STARTS_WITH/v1' }),
  );
  implementations.register(
    'STARTS_WITH_LIST/v1',
    new StartsWithListImplementation({ signatureId: 'STARTS_WITH_LIST/v1' }),
  );
  implementations.register(
    'ENDS_WITH/v1',
    new EndsWithImplementation({ signatureId: 'ENDS_WITH/v1' }),
  );
  implementations.register(
    'CONTAINS/v1',
    new ContainsImplementation({ signatureId: 'CONTAINS/v1' }),
  );
  implementations.register(
    'MATCH_EXPRESSION/v1',
    new MatchExpressionImplementation({ signatureId: 'MATCH_EXPRESSION/v1' }),
  );

  implementations.register('FILTER/v1', new FilterImplementation({ signatureId: 'FILTER/v1' }));
  implementations.register(
    'FILTER_PROPERTY/v1',
    new FilterPropertyImplementation({ signatureId: 'FILTER_PROPERTY/v1' }),
  );
  implementations.register(
    'INCLUDES/v1',
    new IncludesImplementation({ signatureId: 'INCLUDES/v1' }),
  );
  implementations.register('EACH/v1', new EachImplementation({ signatureId: 'EACH/v1' }));

  // Date / time
  implementations.register('DATE/v1', new DateImplementation({ signatureId: 'DATE/v1' }));
  implementations.register(
    'DATEVALUE/v1',
    new DateValueImplementation({ signatureId: 'DATEVALUE/v1' }),
  );
  implementations.register('TIME/v1', new TimeImplementation({ signatureId: 'TIME/v1' }));
  implementations.register(
    'TIMEVALUE/v1',
    new TimeValueImplementation({ signatureId: 'TIMEVALUE/v1' }),
  );
  implementations.register('NOW/v1', new NowImplementation({ signatureId: 'NOW/v1' }));
  implementations.register('TODAY/v1', new TodayImplementation({ signatureId: 'TODAY/v1' }));
  implementations.register('DAY/v1', new DayImplementation({ signatureId: 'DAY/v1' }));
  implementations.register('DAY_NOW/v1', new DayNowImplementation({ signatureId: 'DAY_NOW/v1' }));
  implementations.register('MONTH/v1', new MonthImplementation({ signatureId: 'MONTH/v1' }));
  implementations.register(
    'MONTH_NOW/v1',
    new MonthNowImplementation({ signatureId: 'MONTH_NOW/v1' }),
  );
  implementations.register('YEAR/v1', new YearImplementation({ signatureId: 'YEAR/v1' }));
  implementations.register(
    'YEAR_NOW/v1',
    new YearNowImplementation({ signatureId: 'YEAR_NOW/v1' }),
  );
  implementations.register('HOUR/v1', new HourImplementation({ signatureId: 'HOUR/v1' }));
  implementations.register(
    'HOUR_NOW/v1',
    new HourNowImplementation({ signatureId: 'HOUR_NOW/v1' }),
  );
  implementations.register('MINUTE/v1', new MinuteImplementation({ signatureId: 'MINUTE/v1' }));
  implementations.register(
    'MINUTE_NOW/v1',
    new MinuteNowImplementation({ signatureId: 'MINUTE_NOW/v1' }),
  );
  implementations.register('SECOND/v1', new SecondImplementation({ signatureId: 'SECOND/v1' }));
  implementations.register(
    'SECOND_NOW/v1',
    new SecondNowImplementation({ signatureId: 'SECOND_NOW/v1' }),
  );
  implementations.register('DAYS/v1', new DaysImplementation({ signatureId: 'DAYS/v1' }));
  implementations.register('DATEDIF/v1', new DateDifImplementation({ signatureId: 'DATEDIF/v1' }));
  implementations.register(
    'ISOWEEKNUM/v1',
    new IsoWeekNumImplementation({ signatureId: 'ISOWEEKNUM/v1' }),
  );
  implementations.register(
    'ISOWEEKNUM_NOW/v1',
    new IsoWeekNumNowImplementation({ signatureId: 'ISOWEEKNUM_NOW/v1' }),
  );
  implementations.register('WEEKDAY/v1', new WeekdayImplementation({ signatureId: 'WEEKDAY/v1' }));
  implementations.register(
    'WEEKDAY_NOW/v1',
    new WeekdayNowImplementation({ signatureId: 'WEEKDAY_NOW/v1' }),
  );
  implementations.register('WEEKNUM/v1', new WeekNumImplementation({ signatureId: 'WEEKNUM/v1' }));
  implementations.register(
    'WEEKNUM_NOW/v1',
    new WeekNumNowImplementation({ signatureId: 'WEEKNUM_NOW/v1' }),
  );

  // List ops
  implementations.register('SORT/v1', new SortImplementation({ signatureId: 'SORT/v1' }));
  implementations.register(
    'SORT_BY_PROPERTY/v1',
    new SortByPropertyImplementation({ signatureId: 'SORT_BY_PROPERTY/v1' }),
  );
  implementations.register('REDUCE/v1', new ReduceImplementation({ signatureId: 'REDUCE/v1' }));
  implementations.register('INDEX/v1', new IndexImplementation({ signatureId: 'INDEX/v1' }));
  implementations.register(
    BuiltinSignatureIds.TAKE,
    new TakeImplementation({ signatureId: BuiltinSignatureIds.TAKE }),
  );
  implementations.register(
    BuiltinSignatureIds.INDEX_OF,
    new IndexOfImplementation({ signatureId: BuiltinSignatureIds.INDEX_OF }),
  );
  implementations.register(
    BuiltinSignatureIds.FILTER_BY,
    new FilterByImplementation({ signatureId: BuiltinSignatureIds.FILTER_BY }),
  );
  implementations.register(
    BuiltinSignatureIds.DISTINCT,
    new DistinctImplementation({ signatureId: BuiltinSignatureIds.DISTINCT }),
  );
  implementations.register(
    BuiltinSignatureIds.GROUP_COUNTS,
    new GroupCountsImplementation({ signatureId: BuiltinSignatureIds.GROUP_COUNTS }),
  );

  // Type predicates
  implementations.register('ISDATE/v1', new IsDateImplementation({ signatureId: 'ISDATE/v1' }));
  implementations.register(
    'ISNUMBER/v1',
    new IsNumberImplementation({ signatureId: 'ISNUMBER/v1' }),
  );
  implementations.register('ISTEXT/v1', new IsTextImplementation({ signatureId: 'ISTEXT/v1' }));

  // Control flow
  implementations.register('SWITCH/v1', new SwitchImplementation({ signatureId: 'SWITCH/v1' }));

  // Math
  implementations.register('SIN/v1', new SinImplementation({ signatureId: 'SIN/v1' }));
  implementations.register('COS/v1', new CosImplementation({ signatureId: 'COS/v1' }));
  implementations.register('TAN/v1', new TanImplementation({ signatureId: 'TAN/v1' }));
  implementations.register('ASIN/v1', new AsinImplementation({ signatureId: 'ASIN/v1' }));
  implementations.register('ACOS/v1', new AcosImplementation({ signatureId: 'ACOS/v1' }));
  implementations.register('ATAN/v1', new AtanImplementation({ signatureId: 'ATAN/v1' }));
  implementations.register('CEILING/v1', new CeilingImplementation({ signatureId: 'CEILING/v1' }));
  implementations.register('FLOOR/v1', new FloorImplementation({ signatureId: 'FLOOR/v1' }));
  implementations.register('ROUND/v1', new RoundImplementation({ signatureId: 'ROUND/v1' }));
  implementations.register(
    'ROUNDDOWN/v1',
    new RoundDownImplementation({ signatureId: 'ROUNDDOWN/v1' }),
  );
  implementations.register('ROUNDUP/v1', new RoundUpImplementation({ signatureId: 'ROUNDUP/v1' }));
  implementations.register('EXP/v1', new ExpImplementation({ signatureId: 'EXP/v1' }));
  implementations.register('LOG/v1', new LogImplementation({ signatureId: 'LOG/v1' }));
  implementations.register('LOG10/v1', new Log10Implementation({ signatureId: 'LOG10/v1' }));
  implementations.register('MOD/v1', new ModImplementation({ signatureId: 'MOD/v1' }));
  implementations.register('PI/v1', new PiImplementation({ signatureId: 'PI/v1' }));
  implementations.register('PRODUCT/v1', new ProductImplementation({ signatureId: 'PRODUCT/v1' }));
  implementations.register('SQRT/v1', new SqrtImplementation({ signatureId: 'SQRT/v1' }));
  implementations.register('ISEVEN/v1', new IsEvenImplementation({ signatureId: 'ISEVEN/v1' }));
  implementations.register('ISODD/v1', new IsOddImplementation({ signatureId: 'ISODD/v1' }));

  // Text
  implementations.register('TO_TEXT/v1', new ToTextImplementation({ signatureId: 'TO_TEXT/v1' }));
  implementations.register('CHAR/v1', new CharImplementation({ signatureId: 'CHAR/v1' }));
  implementations.register('LEFT/v1', new LeftImplementation({ signatureId: 'LEFT/v1' }));
  implementations.register('RIGHT/v1', new RightImplementation({ signatureId: 'RIGHT/v1' }));
  implementations.register('MID/v1', new MidImplementation({ signatureId: 'MID/v1' }));
  implementations.register(
    'REGEXEXTRACT/v1',
    new RegexExtractImplementation({ signatureId: 'REGEXEXTRACT/v1' }),
  );
  implementations.register(
    'REGEXREPLACE/v1',
    new RegexReplaceImplementation({ signatureId: 'REGEXREPLACE/v1' }),
  );
  implementations.register('REPLACE/v1', new ReplaceImplementation({ signatureId: 'REPLACE/v1' }));
  implementations.register(
    'SUBSTITUTE/v1',
    new SubstituteImplementation({ signatureId: 'SUBSTITUTE/v1' }),
  );
  implementations.register('TRIM/v1', new TrimImplementation({ signatureId: 'TRIM/v1' }));
  implementations.register(
    'ENCODEURL/v1',
    new EncodeUrlImplementation({ signatureId: 'ENCODEURL/v1' }),
  );
  implementations.register('ISURL/v1', new IsUrlImplementation({ signatureId: 'ISURL/v1' }));

  // Text segmentation
  implementations.register(
    BuiltinSignatureIds.WORDS,
    new WordsImplementation({ signatureId: BuiltinSignatureIds.WORDS }),
  );
  implementations.register(
    BuiltinSignatureIds.WORD_COUNT,
    new WordCountImplementation({ signatureId: BuiltinSignatureIds.WORD_COUNT }),
  );
  implementations.register(
    BuiltinSignatureIds.LEADING_WORDS,
    new LeadingWordsImplementation({ signatureId: BuiltinSignatureIds.LEADING_WORDS }),
  );
  implementations.register(
    BuiltinSignatureIds.SENTENCES,
    new SentencesImplementation({ signatureId: BuiltinSignatureIds.SENTENCES }),
  );
  implementations.register(
    BuiltinSignatureIds.LINES,
    new LinesImplementation({ signatureId: BuiltinSignatureIds.LINES }),
  );
  implementations.register(
    BuiltinSignatureIds.LINE_COUNT,
    new LineCountImplementation({ signatureId: BuiltinSignatureIds.LINE_COUNT }),
  );

  // Phrases
  implementations.register(
    BuiltinSignatureIds.FIRST_CONTAINED,
    new FirstContainedImplementation({ signatureId: BuiltinSignatureIds.FIRST_CONTAINED }),
  );
  implementations.register(
    BuiltinSignatureIds.CONTAINS_ANY,
    new ContainsAnyImplementation({ signatureId: BuiltinSignatureIds.CONTAINS_ANY }),
  );
  implementations.register(
    BuiltinSignatureIds.MISSING_FROM,
    new MissingFromImplementation({ signatureId: BuiltinSignatureIds.MISSING_FROM }),
  );
}
