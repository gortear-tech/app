import { describe, expect, it } from "vitest";
import { allocateScheduleSlots, DEFAULT_SCHEDULE_TIME_ZONE, SCHEDULE_TIME_SLOTS } from "./scheduled-posts.js";

const fixedNow = new Date("2026-05-24T18:00:00.000Z");

const localTimeKey = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_SCHEDULE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(value));

const localDayKey = (value: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_SCHEDULE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));

describe("allocateScheduleSlots", () => {
  it("keeps a 68-slot weekly capacity with commercial slots before extended hours", () => {
    expect(SCHEDULE_TIME_SLOTS).toHaveLength(68);
    expect(SCHEDULE_TIME_SLOTS.slice(0, 5)).toEqual([
      [13, 0],
      [10, 30],
      [16, 30],
      [19, 30],
      [8, 30]
    ]);
  });

  it("uses one central commercial slot per day before adding more daily slots", () => {
    const slots = allocateScheduleSlots({ count: 14, periodDays: 7, now: fixedNow });
    const times = slots.map(localTimeKey);
    const firstWaveDays = slots.slice(0, 7).map(localDayKey);

    expect(slots).toHaveLength(14);
    expect(times.slice(0, 7)).toEqual(Array(7).fill("13:00"));
    expect(new Set(firstWaveDays).size).toBe(7);
    expect(times.slice(7, 14)).toEqual(Array(7).fill("10:30"));
  });

  it("moves the next batch to the next commercial layer when the anchor layer is occupied", () => {
    const firstBatch = allocateScheduleSlots({ count: 7, periodDays: 7, now: fixedNow });
    const secondBatch = allocateScheduleSlots({ count: 7, periodDays: 7, occupiedSlots: firstBatch, now: fixedNow });

    expect(firstBatch.map(localTimeKey)).toEqual(Array(7).fill("13:00"));
    expect(secondBatch.map(localTimeKey)).toEqual(Array(7).fill("10:30"));
  });

  it("distributes 21 posts as 3 posts per day over 7 days", () => {
    const slots = allocateScheduleSlots({ count: 21, periodDays: 7, now: fixedNow });
    const dayCounts = slots.reduce<Record<string, number>>((acc, slot) => {
      const day = localDayKey(slot);
      acc[day] = (acc[day] ?? 0) + 1;
      return acc;
    }, {});

    expect(slots).toHaveLength(21);
    expect(Object.values(dayCounts)).toEqual(Array(7).fill(3));
    expect(slots.map(localTimeKey).filter((time) => time === "13:00")).toHaveLength(7);
    expect(slots.map(localTimeKey).filter((time) => time === "10:30")).toHaveLength(7);
    expect(slots.map(localTimeKey).filter((time) => time === "16:30")).toHaveLength(7);
  });

  it("distributes 70 posts as 10 posts per day over 7 days", () => {
    const slots = allocateScheduleSlots({ count: 70, periodDays: 7, now: fixedNow });
    const dayCounts = slots.reduce<Record<string, number>>((acc, slot) => {
      const day = localDayKey(slot);
      acc[day] = (acc[day] ?? 0) + 1;
      return acc;
    }, {});

    expect(slots).toHaveLength(70);
    expect(Object.values(dayCounts)).toEqual(Array(7).fill(10));
    expect(new Set(slots.map((slot) => slot.slice(0, 16))).size).toBe(70);
  });

  it("places a second 30-post batch around an existing 30-post batch without repeating slots", () => {
    const firstBatch = allocateScheduleSlots({ count: 30, periodDays: 7, now: fixedNow });
    const secondBatch = allocateScheduleSlots({ count: 30, periodDays: 7, occupiedSlots: firstBatch, now: fixedNow });
    const combined = [...firstBatch, ...secondBatch];
    const exactSlots = combined.map((slot) => slot.slice(0, 16));

    expect(firstBatch).toHaveLength(30);
    expect(secondBatch).toHaveLength(30);
    expect(new Set(exactSlots).size).toBe(60);
    expect(secondBatch.slice(0, 5).map(localTimeKey)).toEqual(Array(5).fill("08:30"));
    expect(secondBatch.slice(5, 12).map(localTimeKey)).toEqual(Array(7).fill("09:00"));
  });

  it("only uses extended hours after commercial hours are full", () => {
    const commercialCapacity = SCHEDULE_TIME_SLOTS.filter(([hour]) => hour >= 8 && hour <= 20).length * 7;
    const commercialSlots = allocateScheduleSlots({ count: commercialCapacity, periodDays: 7, now: fixedNow });
    const overflow = allocateScheduleSlots({ count: 1, periodDays: 7, occupiedSlots: commercialSlots, now: fixedNow });

    expect(commercialSlots).toHaveLength(commercialCapacity);
    expect(
      commercialSlots.every((slot) => {
        const hour = Number(localTimeKey(slot).slice(0, 2));
        return hour >= 8 && hour <= 20;
      })
    ).toBe(true);
    expect(overflow).toHaveLength(1);
    expect(Number(localTimeKey(overflow[0]!).slice(0, 2))).toBeLessThan(8);
  });
});
