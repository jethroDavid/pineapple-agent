import { createRequire } from "node:module";

type DateFnsFormat = (date: Date | number, formatString: string) => string;

const require = createRequire(import.meta.url);
const dateFnsFormat = loadDateFnsFormat();

export function formatProvisionalThreadTitle(date: Date): string {
  const formatted = dateFnsFormat
    ? dateFnsFormat(date, "MMM do, h aaa")
    : fallbackProvisionalDateFormat(date);

  return `Thread: ${formatted}`;
}

function loadDateFnsFormat(): DateFnsFormat | null {
  try {
    const module = require("date-fns") as {
      format?: DateFnsFormat;
    };

    return typeof module.format === "function" ? module.format : null;
  } catch {
    return null;
  }
}

function fallbackProvisionalDateFormat(date: Date): string {
  const month = date.toLocaleString("en-US", {
    month: "short"
  });
  const day = withOrdinalSuffix(date.getDate());
  const hour = date
    .toLocaleString("en-US", {
      hour: "numeric",
      hour12: true
    })
    .toLowerCase();

  return `${month} ${day}, ${hour}`;
}

function withOrdinalSuffix(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) {
    return `${day}th`;
  }

  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}
