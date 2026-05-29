import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text, useTheme } from 'react-native-paper';
import type { Photo } from '@cadencia/shared';
import { radius, spacing } from '../theme';

type PhotoTileProps = {
  photo: Photo;
  selected?: boolean;
  stackSize?: number;
  onPress: () => void;
  onLongPress?: () => void;
};

export function PhotoTile({
  photo,
  selected = false,
  stackSize = 1,
  onPress,
  onLongPress,
}: PhotoTileProps) {
  const theme = useTheme();
  const stackCount = stackSize > 1 ? stackSize - 1 : 0;

  return (
    <Pressable
      accessibilityLabel={photo.name}
      accessibilityRole="button"
      onLongPress={onLongPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          opacity: pressed ? 0.86 : 1,
          borderColor: selected ? theme.colors.primary : 'transparent',
        },
      ]}
    >
      <Image source={{ uri: photo.thumbnailUrl }} style={styles.image} contentFit="cover" />
      <View style={styles.topOverlay}>
        <View style={styles.inlineBadges}>
          {photo.isFavorite ? (
            <View style={[styles.iconBadge, { backgroundColor: 'rgba(0, 0, 0, 0.54)' }]}>
              <MaterialCommunityIcons color="#FFFFFF" name="star" size={15} />
            </View>
          ) : null}
          {photo.lowQuality ? (
            <View style={[styles.iconBadge, { backgroundColor: theme.colors.error }]}>
              <MaterialCommunityIcons color="#FFFFFF" name="alert-outline" size={15} />
            </View>
          ) : null}
          {photo.status === 'archived' ? (
            <View style={[styles.iconBadge, { backgroundColor: 'rgba(0, 0, 0, 0.54)' }]}>
              <MaterialCommunityIcons color="#FFFFFF" name="archive-outline" size={15} />
            </View>
          ) : null}
          {photo.status === 'trashed' ? (
            <View style={[styles.iconBadge, { backgroundColor: theme.colors.error }]}>
              <MaterialCommunityIcons color="#FFFFFF" name="trash-can-outline" size={15} />
            </View>
          ) : null}
        </View>
        <View
          style={[
            styles.check,
            {
              backgroundColor: selected ? theme.colors.primary : 'rgba(0, 0, 0, 0.46)',
            },
          ]}
        >
          <MaterialCommunityIcons
            color={selected ? theme.colors.onPrimary : '#FFFFFF'}
            name={selected ? 'check' : 'dots-horizontal'}
            size={18}
          />
        </View>
      </View>
      <View style={styles.bottomScrim} />
      <View style={styles.bottomOverlay}>
        <Text numberOfLines={1} variant="labelMedium" style={styles.nameText}>
          {photo.name}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.badge, { backgroundColor: 'rgba(255, 255, 255, 0.88)' }]}>
            <Text numberOfLines={1} variant="labelSmall" style={{ color: theme.colors.onSurface }}>
              {photo.category}
            </Text>
          </View>
          {stackCount > 0 ? (
            <View style={[styles.badge, { backgroundColor: 'rgba(0, 0, 0, 0.54)' }]}>
              <Text variant="labelSmall" style={styles.badgeText}>
                +{stackCount}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      {!photo.description ? (
        <View style={[styles.missingBadge, { backgroundColor: theme.colors.error }]}>
          <Text variant="labelSmall" style={styles.badgeText}>
            Sin descripcion
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.small,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  badgeText: {
    color: '#FFFFFF',
  },
  bottomOverlay: {
    bottom: spacing.xs,
    gap: spacing.xxs,
    left: spacing.xs,
    position: 'absolute',
    right: spacing.xs,
  },
  bottomScrim: {
    backgroundColor: 'rgba(0, 0, 0, 0.34)',
    bottom: 0,
    height: '42%',
    left: 0,
    position: 'absolute',
    right: 0,
  },
  check: {
    alignItems: 'center',
    borderRadius: radius.full,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  iconBadge: {
    alignItems: 'center',
    borderRadius: radius.full,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  image: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  inlineBadges: {
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.xxs,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xxs,
  },
  missingBadge: {
    borderRadius: radius.small,
    left: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    position: 'absolute',
    top: 42,
  },
  nameText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  topOverlay: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.xs,
  },
  tile: {
    aspectRatio: 1,
    borderWidth: 2,
    borderRadius: radius.small,
    minHeight: 104,
    overflow: 'hidden',
  },
});
