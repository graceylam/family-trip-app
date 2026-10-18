type TimedItem = { time: string };
type DatedGroup<TItem extends TimedItem> = { date: string; stops: TItem[] };

function compareTextKeys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function validDateKey(value: string): string {
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "\uffff";
}

function timeInMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return Number.POSITIVE_INFINITY;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return Number.POSITIVE_INFINITY;
  return hours * 60 + minutes;
}

export function compareItineraryDates(left: string, right: string): number {
  return compareTextKeys(validDateKey(left), validDateKey(right));
}

export function compareItineraryTimes(left: string, right: string): number {
  return timeInMinutes(left) - timeInMinutes(right);
}

export function sortItineraryChronologically<
  TItem extends TimedItem,
  TDay extends DatedGroup<TItem>,
>(days: readonly TDay[]): TDay[] {
  return days
    .map((day) => ({
      ...day,
      stops: [...day.stops].sort((left, right) => compareItineraryTimes(left.time, right.time)),
    }) as TDay)
    .sort((left, right) => compareItineraryDates(left.date, right.date));
}
