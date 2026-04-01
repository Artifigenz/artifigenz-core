import 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MenuProvider } from '../components/MenuSheet';
import { ThemeProvider, useTheme } from '../components/ThemeContext';

function AppInner() {
  const { isDark, c } = useTheme();

  return (
    <MenuProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: c.bg },
        }}
      />
    </MenuProvider>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}
