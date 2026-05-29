import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from 'react-native-paper';

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  small: 8,
  medium: 16,
  large: 24,
  full: 999,
} as const;

export const lightTheme: MD3Theme = {
  ...MD3LightTheme,
  roundness: 16,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#5B5BD6',
    onPrimary: '#FFFFFF',
    primaryContainer: '#E4E4FF',
    secondary: '#FF8A4C',
    surface: '#FAFAFA',
    surfaceVariant: '#F2F2F5',
    onSurface: '#1A1A1A',
    onSurfaceVariant: '#5A5A60',
    outline: '#C4C4CC',
    error: '#DC2626',
  },
};

export const darkTheme: MD3Theme = {
  ...MD3DarkTheme,
  roundness: 16,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#B4B4FF',
    onPrimary: '#1A1A4A',
    primaryContainer: '#3A3A8A',
    secondary: '#FFB587',
    surface: '#121212',
    surfaceVariant: '#1E1E22',
    onSurface: '#E6E6E6',
    onSurfaceVariant: '#A8A8B0',
    outline: '#44444A',
    error: '#F87171',
  },
};

export const semanticColors = {
  success: {
    light: '#16A34A',
    dark: '#4ADE80',
  },
  warning: {
    light: '#F59E0B',
    dark: '#FCD34D',
  },
};

