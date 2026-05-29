import type { BusinessHours, CalendarItem, Id, PageSchedulingSettings, WeekdayKey } from './types.js';

export type ScheduleInput = {
  variantIds: Id[];
  distributionDays: number;
  businessHours: BusinessHours;
  scheduling?: PageSchedulingSettings;
  occupiedSlots?: string[];
  startDate?: Date;
};

export type ScheduledVariant = {
  variantId: Id;
  scheduledAt: string;
};

type ZonedDateParts = {
  day: number;
  month: number;
  year: number;
};

type ZonedDateTimeParts = ZonedDateParts & {
  hour: number;
  minute: number;
};

const DEFAULT_MINUTES_BETWEEN_POSTS = 90;
const weekDayByJsDay: WeekdayKey[] = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

export function scheduleVariants({
  variantIds,
  distributionDays,
  businessHours,
  scheduling,
  occupiedSlots = [],
  startDate = new Date(),
}: ScheduleInput): ScheduledVariant[] {
  const timeZone = resolveTimeZone(scheduling?.timezone);

  if (timeZone) {
    return scheduleVariantsInTimeZone({
      businessHours,
      distributionDays,
      occupiedSlots,
      scheduling,
      startDate,
      timeZone,
      variantIds,
    });
  }

  return scheduleVariantsInLocalTime({
    businessHours,
    distributionDays,
    occupiedSlots,
    scheduling,
    startDate,
    variantIds,
  });
}

function scheduleVariantsInLocalTime({
  variantIds,
  distributionDays,
  businessHours,
  scheduling,
  occupiedSlots = [],
  startDate = new Date(),
}: ScheduleInput): ScheduledVariant[] {
  if (distributionDays < 1) {
    throw new RangeError('La distribucion debe ser de al menos 1 dia.');
  }

  if (variantIds.length === 0) {
    return [];
  }

  const occupied = new Set(occupiedSlots.map(toSlotKey));
  const occupiedTimes = occupiedTimesFromSlots(occupiedSlots);
  const gapMinutes = scheduling?.minGapMinutes ?? DEFAULT_MINUTES_BETWEEN_POSTS;
  const activeDays = scheduling?.activeDays?.length ? scheduling.activeDays : weekDayByJsDay;
  const maxPostsPerDay = scheduling?.maxPostsPerDay ?? Number.POSITIVE_INFINITY;
  const postsPerDay = Math.min(
    maxPostsPerDay,
    Math.ceil(variantIds.length / distributionDays),
  );
  const results: ScheduledVariant[] = [];
  let variantIndex = 0;
  let acceptedDays = 0;
  let dayOffset = scheduling?.startTodayOrTomorrow === 'today' ? 0 : 1;

  while (acceptedDays < distributionDays && variantIndex < variantIds.length) {
    const day = addDays(startOfDay(startDate), dayOffset);
    dayOffset += 1;

    if (!isAllowedDay(day, activeDays)) {
      continue;
    }

    acceptedDays += 1;

    const remaining = variantIds.length - variantIndex;
    const targetCount = Math.min(postsPerDay, remaining);
    const daySlots = candidateSlotsForDay(
      day,
      scheduling?.businessHours ?? businessHours,
      gapMinutes,
      targetCount,
    );
    const freeSlots = daySlots.filter((slot) =>
      isSlotAvailable(slot, occupied, occupiedTimes, gapMinutes),
    );
    const selectedSlots = scheduling?.distributeEvenly === false
      ? shuffledSlots(freeSlots).slice(0, postsPerDay).sort((left, right) => left.getTime() - right.getTime())
      : spreadSlots(freeSlots, postsPerDay);

    for (const slot of selectedSlots) {
      const variantId = variantIds[variantIndex];

      if (!variantId) {
        break;
      }

      reserveSlot(slot, occupied, occupiedTimes);
      results.push({
        variantId,
        scheduledAt: slot.toISOString(),
      });
      variantIndex += 1;
    }
  }

  while (variantIndex < variantIds.length) {
    const day = addDays(startOfDay(startDate), dayOffset);
    dayOffset += 1;

    if (!isAllowedDay(day, activeDays)) {
      continue;
    }

    const remaining = variantIds.length - variantIndex;
    const targetCount = Math.min(maxPostsPerDay, remaining);
    const daySlots = candidateSlotsForDay(
      day,
      scheduling?.businessHours ?? businessHours,
      gapMinutes,
      targetCount,
    );
    const freeSlots = daySlots.filter((slot) =>
      isSlotAvailable(slot, occupied, occupiedTimes, gapMinutes),
    );
    const selectedSlots = spreadSlots(freeSlots, maxPostsPerDay);

    for (const slot of selectedSlots) {
      const variantId = variantIds[variantIndex];

      if (!variantId) {
        break;
      }

      reserveSlot(slot, occupied, occupiedTimes);
      results.push({
        variantId,
        scheduledAt: slot.toISOString(),
      });
      variantIndex += 1;
    }
  }

  return results;
}

function scheduleVariantsInTimeZone({
  variantIds,
  distributionDays,
  businessHours,
  scheduling,
  occupiedSlots = [],
  startDate = new Date(),
  timeZone,
}: ScheduleInput & { timeZone: string }): ScheduledVariant[] {
  if (distributionDays < 1) {
    throw new RangeError('La distribucion debe ser de al menos 1 dia.');
  }

  if (variantIds.length === 0) {
    return [];
  }

  const occupied = new Set(occupiedSlots.map(toSlotKey));
  const occupiedTimes = occupiedTimesFromSlots(occupiedSlots);
  const gapMinutes = scheduling?.minGapMinutes ?? DEFAULT_MINUTES_BETWEEN_POSTS;
  const activeDays = scheduling?.activeDays?.length ? scheduling.activeDays : weekDayByJsDay;
  const maxPostsPerDay = scheduling?.maxPostsPerDay ?? Number.POSITIVE_INFINITY;
  const postsPerDay = Math.min(
    maxPostsPerDay,
    Math.ceil(variantIds.length / distributionDays),
  );
  const startDay = getZonedDateParts(startDate, timeZone);
  const results: ScheduledVariant[] = [];
  let variantIndex = 0;
  let acceptedDays = 0;
  let dayOffset = scheduling?.startTodayOrTomorrow === 'today' ? 0 : 1;

  while (acceptedDays < distributionDays && variantIndex < variantIds.length) {
    const day = addDaysToZonedDate(startDay, dayOffset);
    dayOffset += 1;

    if (!isAllowedZonedDay(day, activeDays)) {
      continue;
    }

    acceptedDays += 1;

    const remaining = variantIds.length - variantIndex;
    const targetCount = Math.min(postsPerDay, remaining);
    const daySlots = candidateSlotsForZonedDay(
      day,
      scheduling?.businessHours ?? businessHours,
      gapMinutes,
      targetCount,
      timeZone,
    );
    const freeSlots = daySlots.filter((slot) =>
      isSlotAvailable(slot, occupied, occupiedTimes, gapMinutes),
    );
    const selectedSlots = scheduling?.distributeEvenly === false
      ? shuffledSlots(freeSlots).slice(0, postsPerDay).sort((left, right) => left.getTime() - right.getTime())
      : spreadSlots(freeSlots, postsPerDay);

    for (const slot of selectedSlots) {
      const variantId = variantIds[variantIndex];

      if (!variantId) {
        break;
      }

      reserveSlot(slot, occupied, occupiedTimes);
      results.push({
        variantId,
        scheduledAt: slot.toISOString(),
      });
      variantIndex += 1;
    }
  }

  while (variantIndex < variantIds.length) {
    const day = addDaysToZonedDate(startDay, dayOffset);
    dayOffset += 1;

    if (!isAllowedZonedDay(day, activeDays)) {
      continue;
    }

    const remaining = variantIds.length - variantIndex;
    const targetCount = Math.min(maxPostsPerDay, remaining);
    const daySlots = candidateSlotsForZonedDay(
      day,
      scheduling?.businessHours ?? businessHours,
      gapMinutes,
      targetCount,
      timeZone,
    );
    const freeSlots = daySlots.filter((slot) =>
      isSlotAvailable(slot, occupied, occupiedTimes, gapMinutes),
    );
    const selectedSlots = spreadSlots(freeSlots, maxPostsPerDay);

    for (const slot of selectedSlots) {
      const variantId = variantIds[variantIndex];

      if (!variantId) {
        break;
      }

      reserveSlot(slot, occupied, occupiedTimes);
      results.push({
        variantId,
        scheduledAt: slot.toISOString(),
      });
      variantIndex += 1;
    }
  }

  return results;
}

export function calendarItemsFromSchedule(
  pageId: Id,
  scheduledVariants: ScheduledVariant[],
): CalendarItem[] {
  return scheduledVariants.map((item, index) => ({
    id: `calendar-${item.variantId}`,
    pageId,
    title: `Publicacion ${index + 1}`,
    status: 'scheduled',
    scheduledAt: item.scheduledAt,
    variantId: item.variantId,
  }));
}

function candidateSlotsForDay(
  day: Date,
  businessHours: BusinessHours,
  gapMinutes: number,
  targetCount: number,
): Date[] {
  const preferred = slotsBetween(day, businessHours.start, businessHours.end, gapMinutes);
  if (preferred.length >= targetCount) {
    return preferred;
  }

  const fallback = [
    ...slotsBetween(day, '06:00', businessHours.start, gapMinutes),
    ...slotsBetween(day, businessHours.end, '23:00', gapMinutes),
  ];

  return [...preferred, ...fallback];
}

function candidateSlotsForZonedDay(
  day: ZonedDateParts,
  businessHours: BusinessHours,
  gapMinutes: number,
  targetCount: number,
  timeZone: string,
): Date[] {
  const preferred = zonedSlotsBetween(day, businessHours.start, businessHours.end, gapMinutes, timeZone);
  if (preferred.length >= targetCount) {
    return preferred;
  }

  const fallback = [
    ...zonedSlotsBetween(day, '06:00', businessHours.start, gapMinutes, timeZone),
    ...zonedSlotsBetween(day, businessHours.end, '23:00', gapMinutes, timeZone),
  ];

  return [...preferred, ...fallback];
}

function slotsBetween(day: Date, start: string, end: string, gapMinutes: number): Date[] {
  const startMinutes = parseClock(start);
  const endMinutes = parseClock(end);
  const slots: Date[] = [];

  for (let minutes = startMinutes; minutes <= endMinutes; minutes += gapMinutes) {
    slots.push(addMinutes(day, minutes));
  }

  return slots;
}

function zonedSlotsBetween(
  day: ZonedDateParts,
  start: string,
  end: string,
  gapMinutes: number,
  timeZone: string,
): Date[] {
  const startMinutes = parseClock(start);
  const endMinutes = parseClock(end);
  const slots: Date[] = [];

  for (let minutes = startMinutes; minutes <= endMinutes; minutes += gapMinutes) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    slots.push(zonedDateTimeToUtc({ ...day, hour, minute }, timeZone));
  }

  return slots;
}

function shuffledSlots(slots: Date[]): Date[] {
  return [...slots].sort(() => Math.random() - 0.5);
}

function isAllowedDay(day: Date, activeDays: WeekdayKey[]): boolean {
  return activeDays.includes(weekDayByJsDay[day.getDay()] as WeekdayKey);
}

function isAllowedZonedDay(day: ZonedDateParts, activeDays: WeekdayKey[]): boolean {
  const jsDay = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
  return activeDays.includes(weekDayByJsDay[jsDay] as WeekdayKey);
}

function spreadSlots(slots: Date[], count: number): Date[] {
  if (slots.length <= count) {
    return slots;
  }

  if (count <= 1) {
    return [slots[Math.floor(slots.length / 2)] as Date];
  }

  const lastIndex = slots.length - 1;

  return Array.from({ length: count }, (_, index) => {
    const slotIndex = Math.round((index * lastIndex) / (count - 1));
    return slots[slotIndex] as Date;
  });
}

function isSlotAvailable(
  slot: Date,
  occupied: Set<string>,
  occupiedTimes: number[],
  gapMinutes: number,
): boolean {
  if (occupied.has(toSlotKey(slot.toISOString()))) {
    return false;
  }

  const time = slot.getTime();
  const minGapMs = gapMinutes * 60 * 1000;

  return occupiedTimes.every((existingTime) => Math.abs(existingTime - time) >= minGapMs);
}

function reserveSlot(slot: Date, occupied: Set<string>, occupiedTimes: number[]): void {
  occupied.add(toSlotKey(slot.toISOString()));
  occupiedTimes.push(slot.getTime());
}

function occupiedTimesFromSlots(slots: string[]): number[] {
  return slots
    .map((slot) => new Date(slot).getTime())
    .filter((time) => Number.isFinite(time));
}

function parseClock(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    throw new Error(`Horario invalido: ${value}`);
  }

  return (hours as number) * 60 + (minutes as number);
}

function startOfDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value: Date, days: number): Date {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function addMinutes(value: Date, minutes: number): Date {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() + minutes);
  return date;
}

function toSlotKey(value: string): string {
  return value.slice(0, 16);
}

function resolveTimeZone(value: string | undefined): string | undefined {
  if (!value || value === 'inherit' || value === 'auto') {
    return undefined;
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return value;
  } catch {
    return undefined;
  }
}

function getZonedDateParts(value: Date, timeZone: string): ZonedDateParts {
  const parts = getZonedDateTimeParts(value, timeZone);
  return {
    day: parts.day,
    month: parts.month,
    year: parts.year,
  };
}

function getZonedDateTimeParts(value: Date, timeZone: string): ZonedDateTimeParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    day: values.day as number,
    hour: values.hour as number,
    minute: values.minute as number,
    month: values.month as number,
    year: values.year as number,
  };
}

function addDaysToZonedDate(value: ZonedDateParts, days: number): ZonedDateParts {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return {
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
  };
}

function zonedDateTimeToUtc(value: ZonedDateTimeParts, timeZone: string): Date {
  const targetAsUtc = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute);
  const guess = new Date(targetAsUtc);
  const actual = getZonedDateTimeParts(guess, timeZone);
  const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);

  return new Date(guess.getTime() + targetAsUtc - actualAsUtc);
}
