import { parseCronExpression } from "./cron-expression.js";
import { createOneShotCronExpression } from "./cron-reminder.js";

type ReminderUnit = "second" | "minute" | "hour" | "day" | "week";

const reminderUnitAliases: Record<string, ReminderUnit> = {
  s: "second",
  sec: "second",
  secs: "second",
  second: "second",
  seconds: "second",
  m: "minute",
  min: "minute",
  mins: "minute",
  minute: "minute",
  minutes: "minute",
  h: "hour",
  hr: "hour",
  hrs: "hour",
  hour: "hour",
  hours: "hour",
  d: "day",
  day: "day",
  days: "day",
  w: "week",
  week: "week",
  weeks: "week"
};

const reminderUnitPattern = Object.keys(reminderUnitAliases).join("|");
const oneShotReminderExpression = new RegExp(
  `^(?:in\\s+)?(\\d+)\\s*(${reminderUnitPattern})(?:\\s+from\\s+now)?$`
);
const recurringReminderExpression = new RegExp(
  `^every\\s+(\\d+)\\s*(${reminderUnitPattern})$`
);

export function resolveCronReminderExpression(
  rawExpression: string,
  options: {
    oneShot: boolean;
    now?: Date;
  }
): string {
  const expression = rawExpression.trim();

  if (!expression) {
    throw new Error("expression cannot be empty.");
  }

  const parsedCron = parseCronSyntax(expression);

  if (parsedCron !== null) {
    return parsedCron;
  }

  const normalizedExpression = normalizeReminderExpression(expression);
  const oneShotExpression = parseOneShotReminderExpression(
    normalizedExpression,
    options.now ?? new Date()
  );

  if (oneShotExpression !== null) {
    if (!options.oneShot) {
      throw new Error("Duration expressions like 'in 15 seconds' require one_time=true.");
    }

    return createOneShotCronExpression(oneShotExpression);
  }

  const recurringExpression = parseRecurringReminderExpression(normalizedExpression);

  if (recurringExpression !== null) {
    if (options.oneShot) {
      throw new Error("Recurring expressions like 'every 5 minutes' require one_time=false.");
    }

    return recurringExpression;
  }

  throw new Error(
    `Invalid expression "${rawExpression}". Use cron syntax or phrases like "in 15 seconds"/"every 5 minutes".`
  );
}

function parseCronSyntax(expression: string): string | null {
  try {
    return parseCronExpression(expression).expression;
  } catch {
    return null;
  }
}

function normalizeReminderExpression(expression: string): string {
  return expression.toLowerCase().trim().replace(/[.!?]+$/, "");
}

function parseReminderAmount(
  expression: string,
  pattern: RegExp
): { amount: number; unit: ReminderUnit } | null {
  const match = expression.match(pattern);

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Expression amount must be greater than zero.");
  }

  const unitAlias = match[2];

  if (unitAlias === undefined) {
    return null;
  }

  const unit = reminderUnitAliases[unitAlias];

  if (unit === undefined) {
    return null;
  }

  return {
    amount,
    unit
  };
}

function parseOneShotReminderExpression(
  expression: string,
  now: Date
): Date | null {
  const parsed = parseReminderAmount(expression, oneShotReminderExpression);

  if (parsed === null) {
    return null;
  }

  const next = new Date(now);

  switch (parsed.unit) {
    case "second":
      next.setSeconds(next.getSeconds() + parsed.amount);
      return next;
    case "minute":
      next.setMinutes(next.getMinutes() + parsed.amount);
      return next;
    case "hour":
      next.setHours(next.getHours() + parsed.amount);
      return next;
    case "day":
      next.setDate(next.getDate() + parsed.amount);
      return next;
    case "week":
      next.setDate(next.getDate() + parsed.amount * 7);
      return next;
  }
}

function parseRecurringReminderExpression(expression: string): string | null {
  const parsed = parseReminderAmount(expression, recurringReminderExpression);

  if (parsed === null) {
    return null;
  }

  switch (parsed.unit) {
    case "second":
      return `*/${parsed.amount} * * * * *`;
    case "minute":
      return `0 */${parsed.amount} * * * *`;
    case "hour":
      return `0 0 */${parsed.amount} * * *`;
    case "day":
      if (parsed.amount !== 1) {
        throw new Error(
          "Recurring intervals longer than one day are not represented precisely in cron. Use an explicit cron expression."
        );
      }

      return "0 0 0 * * *";
    case "week":
      if (parsed.amount !== 1) {
        throw new Error(
          "Recurring intervals longer than one week are not represented precisely in cron. Use an explicit cron expression."
        );
      }

      return "0 0 0 * * 0";
  }
}
