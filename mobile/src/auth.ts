import { Linking, Platform } from 'react-native';
import { fetchMetaLoginUrl } from './api';

export async function openMetaLogin(): Promise<void> {
  const url = await fetchMetaLoginUrl();

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.location.assign(url);
    return;
  }

  await Linking.openURL(url);
}
