import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Button, Text, useTheme } from 'react-native-paper';
import { openMetaLogin } from '../src/auth';
import { Screen } from '../src/components/Screen';
import { describeApiError, fetchMetaStatus, type MetaConnectionStatus } from '../src/api';
import { radius, spacing } from '../src/theme';

export default function LoginScreen() {
  const theme = useTheme();
  const [status, setStatus] = useState<MetaConnectionStatus | undefined>();
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const checkSession = () => {
    let active = true;

    setLoading(true);
    setNotice('');
    fetchMetaStatus()
      .then((result) => {
        if (active) {
          setStatus(result);
        }
      })
      .catch((error) => {
        if (active) {
          setNotice(describeApiError(error));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  };

  useEffect(() => {
    return checkSession();
  }, []);

  useEffect(() => {
    if (!loading && status?.ok) {
      router.replace('/pages');
    }
  }, [loading, status?.ok]);

  const startFacebookLogin = async () => {
    if (status?.ok) {
      router.replace('/pages');
      return;
    }

    setConnecting(true);
    setNotice('');

    try {
      await openMetaLogin();
    } catch (error) {
      setNotice(describeApiError(error));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Screen scroll={false}>
      <View style={styles.container}>
        <View style={[styles.mark, { backgroundColor: theme.colors.primaryContainer }]}>
          <MaterialCommunityIcons color={theme.colors.primary} name="calendar-edit" size={48} />
        </View>
        <View style={styles.copy}>
          <Text variant="displaySmall">Cadencia</Text>
          <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
            Crea, revisa y programa publicaciones por pagina sin mezclar contenido entre cuentas.
          </Text>
        </View>
        {loading ? (
          <View style={styles.statusRow}>
            <ActivityIndicator />
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              Revisando sesion de Meta...
            </Text>
          </View>
        ) : null}
        {!loading && status?.ok ? (
          <View style={[styles.notice, { backgroundColor: theme.colors.primaryContainer }]}>
            <Text variant="bodyMedium" style={{ color: theme.colors.onPrimaryContainer }}>
              Sesion activa con {status.user?.name ?? 'Facebook'}.
            </Text>
          </View>
        ) : null}
        {!loading && status?.error ? (
          <View style={[styles.notice, { backgroundColor: theme.colors.errorContainer }]}>
            <Text variant="bodyMedium" style={{ color: theme.colors.onErrorContainer }}>
              {status.error.code === 190
                ? 'Tu conexion con Meta necesita renovarse.'
                : status.error.message}
            </Text>
          </View>
        ) : null}
        {notice ? (
          <View style={[styles.notice, { backgroundColor: theme.colors.errorContainer }]}>
            <Text variant="bodyMedium" style={{ color: theme.colors.onErrorContainer }}>
              {notice}
            </Text>
          </View>
        ) : null}
        <Button
          accessibilityLabel="Continuar con Facebook"
          icon="facebook"
          loading={connecting}
          mode="contained"
          disabled={loading}
          onPress={startFacebookLogin}
          style={styles.button}
        >
          {status?.ok ? 'Ver paginas conectadas' : 'Iniciar sesion con Facebook'}
        </Button>
        {!loading && notice ? (
          <Button mode="text" onPress={checkSession}>
            Reintentar
          </Button>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'stretch',
    minHeight: 56,
    justifyContent: 'center',
  },
  container: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xl,
    justifyContent: 'center',
  },
  copy: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  mark: {
    alignItems: 'center',
    borderRadius: 28,
    height: 96,
    justifyContent: 'center',
    width: 96,
  },
  notice: {
    alignSelf: 'stretch',
    borderRadius: radius.small,
    padding: spacing.md,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
