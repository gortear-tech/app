import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ActivityIndicator, Button, Text, useTheme } from 'react-native-paper';
import type { Page } from '@cadencia/shared';
import { openMetaLogin } from '../src/auth';
import { PageCard } from '../src/components/PageCard';
import { Screen } from '../src/components/Screen';
import { describeApiError, fetchMetaStatus, type MetaConnectionStatus } from '../src/api';
import { loadPages, type DataSource } from '../src/data/live';
import { radius, spacing } from '../src/theme';

type PageSelectionState = {
  authRequired?: boolean;
  loading: boolean;
  pages: Page[];
  source: DataSource;
  notice?: string;
};

export default function PageSelectionScreen() {
  const theme = useTheme();
  const [state, setState] = useState<PageSelectionState>({
    loading: true,
    pages: [],
    source: 'demo',
  });
  const [metaStatus, setMetaStatus] = useState<MetaConnectionStatus | undefined>();
  const [checkingSession, setCheckingSession] = useState(true);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let active = true;

    loadPages().then((result) => {
      if (!active) {
        return;
      }

      setState({
        loading: false,
        authRequired: result.authRequired,
        pages: result.pages,
        source: result.source,
        notice: result.notice,
      });
    });
    fetchMetaStatus()
      .then((result) => {
        if (active) {
          setMetaStatus(result);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setCheckingSession(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const reconnectMeta = async () => {
    setConnecting(true);

    try {
      await openMetaLogin();
    } catch (error) {
      setState((current) => ({
        ...current,
        notice: describeApiError(error),
      }));
    } finally {
      setConnecting(false);
    }
  };

  const sessionRequired = !checkingSession && Boolean(state.authRequired || metaStatus === undefined || !metaStatus.ok);

  return (
    <Screen>
      <Text variant="headlineMedium">Selecciona una pagina</Text>
      <Text variant="bodyMedium">
        Cada pagina carga su propia galeria, calendario, configuracion y tokens.
      </Text>

      {state.loading ? (
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Conectando con Meta...
          </Text>
        </View>
      ) : null}

      {state.notice ? <Notice text={state.notice} /> : null}

      {checkingSession && !state.loading ? (
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Revisando sesion...
          </Text>
        </View>
      ) : null}

      {sessionRequired ? (
        <View style={[styles.notice, { backgroundColor: theme.colors.primaryContainer }]}>
          <Text variant="titleMedium" style={{ color: theme.colors.onPrimaryContainer }}>
            Inicia sesion con Facebook
          </Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onPrimaryContainer }}>
            Cadencia necesita una sesion activa para mostrar y administrar paginas reales.
          </Text>
          <Button icon="facebook" loading={connecting} mode="contained" onPress={reconnectMeta}>
            Continuar con Facebook
          </Button>
        </View>
      ) : null}

      {!state.loading && !sessionRequired && state.pages.length === 0 ? (
        <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant }}>
          No encontre paginas disponibles para esta cuenta.
        </Text>
      ) : null}

      {!sessionRequired ? <ScreenList pages={state.pages} source={state.source} /> : null}
    </Screen>
  );
}

function ScreenList({ pages, source }: { pages: Page[]; source: DataSource }) {
  return (
    <>
      {pages.map((page) => (
        <PageCard
          key={page.id}
          page={page}
          selected={source === 'meta'}
          onPress={() =>
            router.push({
              pathname: '/page/[pageId]',
              params: { pageId: page.id },
            })
          }
        />
      ))}
    </>
  );
}

function Notice({ text }: { text: string }) {
  const theme = useTheme();

  return (
    <View style={[styles.notice, { backgroundColor: theme.colors.errorContainer }]}>
      <Text variant="bodyMedium" style={{ color: theme.colors.onErrorContainer }}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 48,
  },
  notice: {
    borderRadius: radius.small,
    padding: spacing.md,
  },
});
