import { Linking, Platform } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { fetchMetaLoginUrl } from './api';

const mobileRedirectUrl = 'cadencia:///';

if (Platform.OS === 'web') {
  WebBrowser.maybeCompleteAuthSession();
}

export async function openMetaLogin(): Promise<void> {
  const target = Platform.OS === 'web' ? 'web' : 'mobile';
  const url = await fetchMetaLoginUrl(target);

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.location.assign(url);
    return;
  }

  let result: WebBrowser.WebBrowserAuthSessionResult;

  try {
    await WebBrowser.warmUpAsync();
    result = await WebBrowser.openAuthSessionAsync(url, mobileRedirectUrl, {
      enableDefaultShareMenuItem: false,
      showTitle: true,
    });
  } catch (error) {
    try {
      await Linking.openURL(url);
      return;
    } catch {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error('Android no encontro un navegador disponible para abrir Facebook.');
    }
  } finally {
    await WebBrowser.coolDownAsync().catch(() => undefined);
  }

  if (result.type === 'success') {
    handleMetaReturnUrl(result.url);
    return;
  }

  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw new Error('Inicio de sesion cancelado antes de conectar Facebook.');
  }

  throw new Error('Facebook no devolvio una respuesta valida de inicio de sesion.');
}

function handleMetaReturnUrl(url: string): void {
  const parsedUrl = new URL(url);
  const metaState = parsedUrl.searchParams.get('meta');

  if (metaState === 'connected') {
    router.replace('/pages');
    return;
  }

  if (metaState === 'error') {
    const code = parsedUrl.searchParams.get('code');
    throw new Error(
      code
        ? `Facebook devolvio un error al conectar la cuenta (${code}).`
        : 'Facebook devolvio un error al conectar la cuenta.',
    );
  }

  if (parsedUrl.pathname.startsWith('/pages')) {
    router.replace('/pages');
    return;
  }

  router.replace('/');
}
