import { Linking, Platform } from 'react-native';
import { fetchMetaLoginUrl } from './api';

export async function openMetaLogin(): Promise<void> {
  const target = Platform.OS === 'web' ? 'web' : 'mobile';
  const url = await fetchMetaLoginUrl(target);

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.location.assign(url);
    return;
  }

  await Linking.openURL(url);
}
