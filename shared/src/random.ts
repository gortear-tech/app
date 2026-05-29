export type RandomSource = () => number;

export function shuffle<T>(items: readonly T[], random: RandomSource = Math.random): T[] {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex] as T, result[index] as T];
  }

  return result;
}

export function groupedShuffle<T>(
  items: readonly T[],
  getRank: (item: T) => number,
  random: RandomSource = Math.random,
): T[] {
  const groups = new Map<number, T[]>();

  for (const item of items) {
    const rank = getRank(item);
    groups.set(rank, [...(groups.get(rank) ?? []), item]);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, group]) => shuffle(group, random));
}

