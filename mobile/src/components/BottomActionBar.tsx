import { StyleSheet, View } from 'react-native';
import { Button, Surface } from 'react-native-paper';
import { spacing } from '../theme';

type BottomActionBarProps = {
  backLabel?: string;
  nextLabel?: string;
  onBack?: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  nextLoading?: boolean;
};

export function BottomActionBar({
  backLabel = 'Atras',
  nextLabel = 'Siguiente',
  onBack,
  onNext,
  nextDisabled = false,
  nextLoading = false,
}: BottomActionBarProps) {
  return (
    <Surface elevation={1} style={styles.container}>
      <View style={styles.row}>
        <Button
          accessibilityLabel={backLabel}
          disabled={!onBack}
          mode="outlined"
          onPress={onBack}
          style={styles.button}
        >
          {backLabel}
        </Button>
        <Button
          accessibilityLabel={nextLabel}
          disabled={nextDisabled || nextLoading}
          loading={nextLoading}
          mode="contained"
          onPress={onNext}
          style={[styles.button, styles.primary]}
        >
          {nextLabel}
        </Button>
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
  },
  container: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  primary: {
    minHeight: 56,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
