import { FlatList, StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import type { CalendarItem } from '@cadencia/shared';
import { radius, spacing } from '../theme';

type MinimalCalendarStripProps = {
  items: CalendarItem[];
};

export function MinimalCalendarStrip({ items }: MinimalCalendarStripProps) {
  const theme = useTheme();
  const days = buildDays(items);

  return (
    <FlatList
      horizontal
      data={days}
      keyExtractor={(day) => day.key}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <View
          style={[
            styles.day,
            {
              backgroundColor: theme.colors.surfaceVariant,
              borderColor: theme.colors.outline,
            },
          ]}
        >
          <Text variant="labelMedium">{item.label}</Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {item.date}
          </Text>
          <View style={styles.dots}>
            {Array.from({ length: Math.min(item.count, 4) }).map((_, index) => (
              <View
                key={`${item.key}-${index}`}
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      item.published > index ? theme.colors.secondary : theme.colors.primary,
                  },
                ]}
              />
            ))}
            {item.count === 0 ? (
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                -
              </Text>
            ) : null}
          </View>
        </View>
      )}
    />
  );
}

function buildDays(items: CalendarItem[]) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = date.toISOString().slice(0, 10);
    const dayItems = items.filter((item) => item.scheduledAt.slice(0, 10) === key);

    return {
      key,
      count: dayItems.length,
      published: dayItems.filter((item) => item.status === 'published').length,
      label: new Intl.DateTimeFormat('es-MX', { weekday: 'short' }).format(date),
      date: new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' }).format(date),
    };
  });
}

const styles = StyleSheet.create({
  day: {
    borderRadius: radius.small,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 92,
    padding: spacing.sm,
  },
  dot: {
    borderRadius: radius.full,
    height: 7,
    width: 7,
  },
  dots: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    minHeight: 18,
    paddingTop: spacing.xs,
  },
  list: {
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
});
