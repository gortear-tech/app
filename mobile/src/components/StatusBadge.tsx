import { Chip, useTheme } from 'react-native-paper';
import type { VariantStatus } from '@cadencia/shared';

type StatusBadgeProps = {
  status: VariantStatus | 'scheduled' | 'published';
};

const labels: Record<StatusBadgeProps['status'], string> = {
  approved: 'Aprobada',
  failed: 'Error',
  generating: 'Generando',
  pending: 'Pendiente',
  published: 'Publicada',
  ready: 'Lista',
  rejected: 'Rechazada',
  scheduled: 'Programada',
  skipped: 'Saltada',
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const theme = useTheme();
  const isFinal = status === 'published' || status === 'approved' || status === 'ready';
  const isDanger = status === 'failed' || status === 'rejected';

  return (
    <Chip
      compact
      mode="flat"
      style={{
        backgroundColor: isDanger
          ? theme.colors.errorContainer
          : isFinal
            ? theme.colors.primaryContainer
            : theme.colors.surfaceVariant,
      }}
    >
      {labels[status]}
    </Chip>
  );
}
