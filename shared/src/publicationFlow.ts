import { scheduleVariants, type ScheduledVariant } from './scheduler.js';
import type {
  Batch,
  BatchPhase,
  BatchStatus,
  BusinessHours,
  Id,
  PageSchedulingSettings,
  SchedulingHistoryEntry,
  Variant,
  WeekdayKey,
} from './types.js';

export const BATCH_ACTIVE_STATUSES: BatchStatus[] = [
  'queued',
  'generating',
  'awaiting_review',
  'scheduling',
  'publishing',
];

export const BATCH_ACCENT_COLORS = [
  '#8EC5FF',
  '#A7E7B7',
  '#FFD38E',
  '#D7B8FF',
  '#FFB7C7',
  '#A7E2E3',
];

export const DRAFT_PURGE_DAYS = 30;
export const DRAFT_PURGE_WARNING_DAYS = 3;

export function isActiveBatchStatus(status: BatchStatus): boolean {
  return BATCH_ACTIVE_STATUSES.includes(status);
}

export function batchPhase(status: BatchStatus): BatchPhase {
  if (status === 'draft' || status === 'queued') {
    return 'prepare';
  }

  if (status === 'generating') {
    return 'generating';
  }

  if (status === 'awaiting_review' || status === 'scheduling' || status === 'publishing') {
    return 'review_schedule';
  }

  if (status === 'failed') {
    return 'failed';
  }

  return 'done';
}

export function batchPhaseLabel(status: BatchStatus): string {
  const labels: Record<BatchPhase, string> = {
    done: 'Archivado',
    failed: 'Fallido',
    generating: 'Generando',
    prepare: status === 'draft' ? 'Borrador' : 'En cola',
    review_schedule: status === 'awaiting_review' ? 'Listo para revisar' : 'Programando',
  };

  return labels[batchPhase(status)];
}

export function batchProgress(batch: Batch, variants: Variant[] = []): number {
  if (batch.status === 'draft') {
    return 0;
  }

  if (batch.status === 'queued') {
    return 0.08;
  }

  if (batch.status === 'generating') {
    const total = expectedVariantCount(batch);
    const ready = variants.filter((variant) =>
      ['ready', 'approved', 'scheduled', 'published', 'failed'].includes(variant.status),
    ).length;

    return Math.max(0.12, Math.min(0.86, ready / Math.max(1, total)));
  }

  if (batch.status === 'awaiting_review') {
    return 0.9;
  }

  if (batch.status === 'scheduling') {
    return 0.94;
  }

  if (batch.status === 'publishing') {
    return 0.98;
  }

  if (batch.status === 'archived') {
    return 1;
  }

  return 0;
}

export function expectedVariantCount(batch: Pick<Batch, 'selectedPhotoIds' | 'variantsPerPhoto'>): number {
  return batch.selectedPhotoIds.length * batch.variantsPerPhoto;
}

export function findScheduleConflicts(
  proposedSlots: string[],
  occupiedSlots: string[],
  minGapMinutes: number,
): string[] {
  const conflicts = new Set<string>();
  const minGapMs = Math.max(0, minGapMinutes) * 60 * 1000;
  const accepted: number[] = [];
  const occupiedTimes = occupiedSlots
    .map((slot) => new Date(slot).getTime())
    .filter((time) => Number.isFinite(time));

  proposedSlots.forEach((slot) => {
    const time = new Date(slot).getTime();

    if (!Number.isFinite(time)) {
      conflicts.add(slot);
      return;
    }

    const hasConflict = [...occupiedTimes, ...accepted].some(
      (existingTime) => Math.abs(existingTime - time) < minGapMs,
    );

    if (hasConflict) {
      conflicts.add(slot);
      return;
    }

    accepted.push(time);
  });

  return [...conflicts];
}

export function createBatchLabel(existingCount: number, createdAt = new Date()): string {
  if (existingCount >= 0 && existingCount < 3) {
    return `Lote ${String.fromCharCode(65 + existingCount)}`;
  }

  return `Lote del ${new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'short',
  }).format(createdAt)}`;
}

export type SmartScheduleInput = {
  variantIds: Id[];
  businessHours: BusinessHours;
  scheduling?: PageSchedulingSettings;
  occupiedSlots?: string[];
  history?: SchedulingHistoryEntry[];
  distributionDays?: number;
  startDate?: Date;
};

export type SmartScheduledVariant = ScheduledVariant & {
  score: number;
};

export function suggestSmartSchedule({
  variantIds,
  businessHours,
  scheduling,
  occupiedSlots = [],
  history = [],
  distributionDays,
  startDate = new Date(),
}: SmartScheduleInput): SmartScheduledVariant[] {
  if (variantIds.length === 0) {
    return [];
  }

  const historyStrength = history.reduce((sum, entry) => sum + Math.max(0, entry.score), 0);
  const maxPostsPerDay = scheduling?.maxPostsPerDay ?? 4;
  const resolvedDistributionDays = Math.max(
    1,
    distributionDays ?? Math.ceil(variantIds.length / Math.max(1, maxPostsPerDay)),
  );

  if (history.length < 5 || historyStrength < 5) {
    return scheduleVariants({
      businessHours,
      distributionDays: resolvedDistributionDays,
      occupiedSlots,
      scheduling,
      startDate,
      variantIds,
    }).map((slot) => ({ ...slot, score: 0 }));
  }

  const occupiedSlotValues = [...occupiedSlots];
  const occupied = new Set(occupiedSlotValues.map(toSlotKey));
  const occupiedTimes = occupiedTimesFromSlots(occupiedSlotValues);
  const activeDays = scheduling?.activeDays?.length ? scheduling.activeDays : WEEKDAY_KEYS;
  const minGapMinutes = scheduling?.minGapMinutes ?? 60;
  const historyByDay = scoreHistoryByDay(history);
  const historyByDayHour = scoreHistoryByDayHour(history);
  const candidateDays = buildCandidateDays(startDate, activeDays, resolvedDistributionDays * 4);
  const chosenDays = candidateDays
    .map((date) => ({
      date,
      score: historyByDay.get(dayOfWeekMondayFirst(date)) ?? 0,
    }))
    .sort((left, right) => right.score - left.score || left.date.getTime() - right.date.getTime())
    .slice(0, resolvedDistributionDays)
    .sort((left, right) => left.date.getTime() - right.date.getTime());
  const results: SmartScheduledVariant[] = [];
  let variantIndex = 0;

  for (const day of chosenDays) {
    if (variantIndex >= variantIds.length) {
      break;
    }

    const dayIndex = dayOfWeekMondayFirst(day.date);
    const hours = candidateHours(businessHours, minGapMinutes)
      .map((hour) => ({
        hour,
        score: (historyByDayHour.get(`${dayIndex}:${hour}`) ?? 0) + middayBias(hour),
      }))
      .sort((left, right) => right.score - left.score || left.hour - right.hour);
    let postsForDay = 0;

    for (const candidate of hours) {
      if (variantIndex >= variantIds.length || postsForDay >= maxPostsPerDay) {
        break;
      }

      const scheduledAt = dateAtHour(day.date, candidate.hour).toISOString();

      if (occupied.has(toSlotKey(scheduledAt))) {
        continue;
      }

      if (!respectsGapAgainstTimes(scheduledAt, occupiedTimes, minGapMinutes)) {
        continue;
      }

      if (!respectsGap(scheduledAt, results, minGapMinutes)) {
        continue;
      }

      occupied.add(toSlotKey(scheduledAt));
      occupiedSlotValues.push(scheduledAt);
      occupiedTimes.push(new Date(scheduledAt).getTime());
      results.push({
        variantId: variantIds[variantIndex] as Id,
        scheduledAt,
        score: candidate.score,
      });
      variantIndex += 1;
      postsForDay += 1;
    }
  }

  if (variantIndex < variantIds.length) {
    const remaining = variantIds.slice(variantIndex);
    const fallback = scheduleVariants({
      businessHours,
      distributionDays: Math.max(1, Math.ceil(remaining.length / Math.max(1, maxPostsPerDay))),
      occupiedSlots: occupiedSlotValues,
      scheduling,
      startDate,
      variantIds: remaining,
    });

    results.push(...fallback.map((slot) => ({ ...slot, score: 0 })));
  }

  return results;
}

const WEEKDAY_KEYS: WeekdayKey[] = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];

function scoreHistoryByDay(history: SchedulingHistoryEntry[]): Map<number, number> {
  const score = new Map<number, number>();

  history.forEach((entry) => {
    score.set(entry.dayOfWeek, (score.get(entry.dayOfWeek) ?? 0) + entry.score);
  });

  return score;
}

function scoreHistoryByDayHour(history: SchedulingHistoryEntry[]): Map<string, number> {
  const score = new Map<string, number>();

  history.forEach((entry) => {
    const key = `${entry.dayOfWeek}:${entry.hour}`;
    score.set(key, (score.get(key) ?? 0) + entry.score);
  });

  return score;
}

function buildCandidateDays(startDate: Date, activeDays: WeekdayKey[], wanted: number): Date[] {
  const days: Date[] = [];
  const active = new Set(activeDays);
  let offset = 1;

  while (days.length < Math.max(wanted, activeDays.length) && offset < 90) {
    const day = startOfDay(addDays(startDate, offset));

    if (active.has(WEEKDAY_KEYS[dayOfWeekMondayFirst(day)] as WeekdayKey)) {
      days.push(day);
    }

    offset += 1;
  }

  return days;
}

function candidateHours(hours: BusinessHours, gapMinutes: number): number[] {
  const start = Math.ceil(parseClock(hours.start) / 60);
  const end = Math.floor(parseClock(hours.end) / 60);
  const step = Math.max(1, Math.ceil(gapMinutes / 60));
  const result: number[] = [];

  for (let hour = start; hour <= end; hour += step) {
    result.push(hour);
  }

  return result.length > 0 ? result : [10, 14, 18];
}

function dayOfWeekMondayFirst(value: Date): number {
  return (value.getDay() + 6) % 7;
}

function dateAtHour(day: Date, hour: number): Date {
  const date = new Date(day);
  date.setHours(hour, 0, 0, 0);
  return date;
}

function respectsGap(
  scheduledAt: string,
  selected: Array<Pick<SmartScheduledVariant, 'scheduledAt'>>,
  minGapMinutes: number,
): boolean {
  const time = new Date(scheduledAt).getTime();
  const minGapMs = minGapMinutes * 60 * 1000;

  return selected.every((item) => Math.abs(new Date(item.scheduledAt).getTime() - time) >= minGapMs);
}

function respectsGapAgainstTimes(
  scheduledAt: string,
  occupiedTimes: number[],
  minGapMinutes: number,
): boolean {
  const time = new Date(scheduledAt).getTime();
  const minGapMs = minGapMinutes * 60 * 1000;

  return occupiedTimes.every((existingTime) => Math.abs(existingTime - time) >= minGapMs);
}

function occupiedTimesFromSlots(slots: string[]): number[] {
  return slots
    .map((slot) => new Date(slot).getTime())
    .filter((time) => Number.isFinite(time));
}

function middayBias(hour: number): number {
  return Math.max(0, 4 - Math.abs(hour - 14) / 2);
}

function parseClock(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
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

function toSlotKey(value: string): string {
  return value.slice(0, 16);
}
