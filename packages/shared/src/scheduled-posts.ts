import { Static, Type } from "@sinclair/typebox";
import { JobSummarySchema } from "./jobs.js";
import { ScheduledPostStatus } from "./states.js";

export const ScheduledPostRemoteStatusSchema = Type.Union([
  Type.Literal("no_enviado"),
  Type.Literal("confirmado_meta"),
  Type.Literal("actualizacion_pendiente"),
  Type.Literal("cancelacion_pendiente"),
  Type.Literal("incierto")
]);

export const DeliveryModeSchema = Type.Union([
  Type.Literal("local_due_publish"),
  Type.Literal("remote_schedule"),
  Type.Literal("publish_now")
]);

export const ScheduledPostSchema = Type.Object({
  id: Type.String(),
  workspaceId: Type.String(),
  businessId: Type.String(),
  batchId: Type.String(),
  variantId: Type.String(),
  pageId: Type.String(),
  scheduledFor: Type.String(),
  facebookPostId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  facebookPhotoId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  facebookPhotoReused: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  remotePostType: Type.Optional(Type.Union([
    Type.Literal("photo"),
    Type.Literal("feed"),
    Type.Literal("unknown"),
    Type.Null()
  ])),
  remotePostUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  deliveryMode: DeliveryModeSchema,
  graphApiVersion: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  publishLeadSeconds: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  scheduledForUnix: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  status: ScheduledPostStatus,
  remoteStatus: ScheduledPostRemoteStatusSchema,
  retryCount: Type.Number(),
  lastRemoteSyncAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  remoteErrorCode: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  remoteTraceId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  caption: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  imageUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  styleId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  styleName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  createdAt: Type.String(),
  updatedAt: Type.String()
});

export const ConfirmCalendarBodySchema = Type.Object({
  periodDays: Type.Union([Type.Literal(7), Type.Literal(14), Type.Literal(30)])
});

export const UpdateScheduledPostBodySchema = Type.Object({
  scheduledFor: Type.String()
});

export const ScheduledPostsResponseSchema = Type.Object({
  schemaVersion: Type.Literal("scheduled_posts.v1"),
  scheduledPosts: Type.Array(ScheduledPostSchema),
  requestId: Type.String()
});

export const ConfirmCalendarResponseSchema = Type.Object({
  schemaVersion: Type.Literal("calendar_confirm.v1"),
  scheduledPosts: Type.Array(ScheduledPostSchema),
  job: JobSummarySchema,
  changed: Type.Object({
    entityIds: Type.Array(Type.String()),
    queryKeys: Type.Array(Type.String())
  }),
  requestId: Type.String()
});

export const ScheduledPostMutationResponseSchema = Type.Object({
  schemaVersion: Type.Literal("scheduled_post_mutation.v1"),
  scheduledPost: ScheduledPostSchema,
  job: Type.Optional(Type.Union([JobSummarySchema, Type.Null()])),
  changed: Type.Object({
    entityIds: Type.Array(Type.String()),
    queryKeys: Type.Array(Type.String())
  }),
  requestId: Type.String()
});

export type ScheduledPostRemoteStatus = Static<typeof ScheduledPostRemoteStatusSchema>;
export type DeliveryMode = Static<typeof DeliveryModeSchema>;
export type ScheduledPost = Static<typeof ScheduledPostSchema>;
export type ConfirmCalendarResponse = Static<typeof ConfirmCalendarResponseSchema>;
export type ScheduledPostsResponse = Static<typeof ScheduledPostsResponseSchema>;
export type ScheduledPostMutationResponse = Static<typeof ScheduledPostMutationResponseSchema>;

export type SchedulePeriodDays = 7 | 14 | 30;

export const DEFAULT_SCHEDULE_TIME_ZONE = "America/Mexico_City";

const anchorCommercialSlots: Array<readonly [number, number]> = [[13, 0]];

const spacedCommercialSlots: Array<readonly [number, number]> = [
  [10, 30],
  [16, 30],
  [19, 30],
  [8, 30]
];

const scheduleSlotKeyOfParts = (hour: number, minute: number) => `${hour}:${minute}`;

const buildScheduleTimeSlots = () => {
  const seen = new Set<string>();
  const slots: Array<readonly [number, number]> = [];
  const add = (hour: number, minute: number) => {
    const key = scheduleSlotKeyOfParts(hour, minute);
    if (seen.has(key)) return;
    seen.add(key);
    slots.push([hour, minute]);
  };

  anchorCommercialSlots.forEach(([hour, minute]) => add(hour, minute));
  spacedCommercialSlots.forEach(([hour, minute]) => add(hour, minute));

  for (let hour = 9; hour <= 20; hour += 1) {
    for (const minute of [0, 30]) add(hour, minute);
  }
  for (let hour = 8; hour <= 20; hour += 1) {
    for (const minute of [0, 15, 30, 45]) add(hour, minute);
  }
  for (const hour of [6, 7, 21, 22]) {
    for (const minute of [0, 15, 30, 45]) add(hour, minute);
  }
  return slots;
};

export const SCHEDULE_TIME_SLOTS = buildScheduleTimeSlots();

export const scheduledPostSlotKey = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16);
};

const localDateParts = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const read = (type: "year" | "month" | "day" | "hour" | "minute" | "second") =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second")
  };
};

const timeZoneOffsetMs = (date: Date, timeZone: string) => {
  const parts = localDateParts(date, timeZone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return localAsUtc - date.getTime();
};

const zonedTimeToUtcIso = (input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}) => {
  const utcGuess = new Date(Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0, 0));
  const offset = timeZoneOffsetMs(utcGuess, input.timeZone);
  return new Date(utcGuess.getTime() - offset).toISOString();
};

const calendarDateAfter = (base: Date, dayOffset: number, timeZone: string) => {
  const baseParts = localDateParts(base, timeZone);
  const target = new Date(Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day + dayOffset));
  return {
    year: target.getUTCFullYear(),
    month: target.getUTCMonth() + 1,
    day: target.getUTCDate()
  };
};

export const allocateScheduleSlots = (input: {
  count: number;
  periodDays: SchedulePeriodDays;
  occupiedSlots?: Iterable<string | Date | null | undefined>;
  now?: Date;
  timeZone?: string;
}) => {
  const count = Math.max(0, Math.floor(input.count));
  if (count === 0) return [];
  const timeZone = input.timeZone ?? DEFAULT_SCHEDULE_TIME_ZONE;
  const base = input.now ?? new Date();
  const used = new Set(
    Array.from(input.occupiedSlots ?? [])
      .filter((value): value is string | Date => Boolean(value))
      .map(scheduledPostSlotKey)
      .filter(Boolean)
  );
  const selected: string[] = [];
  for (const [hour, minute] of SCHEDULE_TIME_SLOTS) {
    for (let dayOffset = 1; dayOffset <= input.periodDays && selected.length < count; dayOffset += 1) {
      const targetDate = calendarDateAfter(base, dayOffset, timeZone);
      const scheduledFor = zonedTimeToUtcIso({ ...targetDate, hour, minute, timeZone });
      const key = scheduledPostSlotKey(scheduledFor);
      if (used.has(key)) continue;
      used.add(key);
      selected.push(scheduledFor);
    }
    if (selected.length >= count) break;
  }

  return selected;
};
