export const clamp = (value: number, min: number, max: number): number => {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
};

export const mean = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const variance = (values: number[]): number => {
  if (values.length <= 1) return 0;
  const m = mean(values);
  return mean(values.map((value) => (value - m) ** 2));
};

export const groupBy = <T>(values: readonly T[], keyFn: (value: T) => string): Record<string, T[]> => {
  return values.reduce<Record<string, T[]>>((acc, value) => {
    const key = keyFn(value);
    (acc[key] ??= []).push(value);
    return acc;
  }, {});
};

export const normalizeText = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

export const dayOfWeek = (dateLike: string | Date): number => {
  const date = typeof dateLike === "string" ? new Date(dateLike) : dateLike;
  return date.getUTCDay();
};

export const hourOfDay = (dateLike: string | Date): number => {
  const date = typeof dateLike === "string" ? new Date(dateLike) : dateLike;
  return date.getUTCHours();
};

export const hourBucket = (hour: number): string => {
  if (hour >= 6 && hour < 12) return "manana";
  if (hour >= 12 && hour < 15) return "mediodia";
  if (hour >= 15 && hour < 20) return "tarde";
  return "noche";
};

export const daysBetween = (a: string | Date, b: string | Date): number => {
  const dateA = typeof a === "string" ? new Date(a) : a;
  const dateB = typeof b === "string" ? new Date(b) : b;
  return Math.abs(dateB.getTime() - dateA.getTime()) / (1000 * 60 * 60 * 24);
};

export const timeDecayWeight = (occurredAt: string, now = new Date()): number => {
  const halfLifeDays = 90;
  const ageDays = daysBetween(occurredAt, now);
  return Math.pow(0.5, ageDays / halfLifeDays);
};

export const topEntries = <T>(entries: Array<[string, T]>, limit: number): Array<[string, T]> =>
  [...entries].sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, limit);
