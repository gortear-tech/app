import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Card, Text, useTheme } from 'react-native-paper';
import type { Page } from '@cadencia/shared';
import { radius, spacing } from '../theme';

type PageCardProps = {
  page: Page;
  selected?: boolean;
  onPress: () => void;
};

export function PageCard({ page, selected = false, onPress }: PageCardProps) {
  const theme = useTheme();

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={page.name} onPress={onPress}>
      <Card
        mode={selected ? 'elevated' : 'contained'}
        style={[
          styles.card,
          selected && {
            borderColor: theme.colors.primary,
            borderWidth: 2,
          },
        ]}
      >
        <Image source={{ uri: page.coverUrl }} style={styles.cover} contentFit="cover" />
        <View style={styles.body}>
          <Image
            source={{ uri: page.profileUrl }}
            style={[
              styles.avatar,
              {
                borderColor: theme.colors.surface,
              },
            ]}
            contentFit="cover"
          />
          <View style={styles.text}>
            <Text variant="titleMedium">{page.name}</Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {page.category} · {page.settings.seoKeywords.join(', ')}
            </Text>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: {
    borderRadius: radius.full,
    borderWidth: 3,
    height: 56,
    marginTop: -32,
    width: 56,
  },
  body: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    paddingTop: 0,
  },
  card: {
    borderRadius: radius.medium,
    overflow: 'hidden',
  },
  cover: {
    aspectRatio: 16 / 7,
    width: '100%',
  },
  text: {
    flex: 1,
    justifyContent: 'center',
  },
});
