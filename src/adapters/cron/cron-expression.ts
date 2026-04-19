import { createRequire } from "node:module";

export interface ParsedCronExpression {
  expression: string;
}

interface CronDateLike {
  toDate(): Date;
}

interface CronIterator {
  next(): CronDateLike;
}

interface CronExpressionParserLike {
  parse: (expression: string, options?: { currentDate?: Date }) => CronIterator;
}

interface CronParserModuleLike {
  CronExpressionParser?: CronExpressionParserLike;
  default?: {
    CronExpressionParser?: CronExpressionParserLike;
  };
}

let cachedCronParserModule: CronParserModuleLike | null = null;

export function parseCronExpression(expression: string): ParsedCronExpression {
  const normalizedExpression = expression.trim();

  if (normalizedExpression.length === 0) {
    throw new Error("Cron expression cannot be empty.");
  }

  createCronIterator(normalizedExpression, new Date());

  return {
    expression: normalizedExpression
  };
}

export function getNextCronOccurrence(
  parsed: ParsedCronExpression,
  afterDate: Date
): Date | null {
  try {
    const iterator = createCronIterator(parsed.expression, afterDate);
    return iterator.next().toDate();
  } catch {
    return null;
  }
}

function loadCronParserModule(): CronParserModuleLike {
  if (cachedCronParserModule !== null) {
    return cachedCronParserModule;
  }

  const require = createRequire(import.meta.url);

  try {
    cachedCronParserModule = require("cron-parser") as CronParserModuleLike;
    return cachedCronParserModule;
  } catch {
    throw new Error(
      "cron-parser is not installed. Run `pnpm add cron-parser`."
    );
  }
}

function createCronIterator(expression: string, currentDate: Date): CronIterator {
  const module = loadCronParserModule();
  const parser = module.CronExpressionParser ?? module.default?.CronExpressionParser;

  if (parser === undefined) {
    throw new Error(
      "Unsupported cron-parser module format. Expected CronExpressionParser (cron-parser v5)."
    );
  }

  return parser.parse(expression, {
    currentDate
  });
}
