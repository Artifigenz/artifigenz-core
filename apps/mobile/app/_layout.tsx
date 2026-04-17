import 'react-native-gesture-handler';
import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ClerkProvider, ClerkLoaded, useAuth } from '@clerk/clerk-expo';
import { MenuProvider } from '../components/MenuSheet';
import { ThemeProvider, useTheme } from '../components/ThemeContext';
import { CLERK_PUBLISHABLE_KEY } from '../lib/config';
import { tokenCache } from '../lib/token-cache';

const PUBLIC_ROUTES = ['sign-in', 'sign-up'];

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;

    const currentRoute = segments[0] ?? '';
    const isPublic = PUBLIC_ROUTES.includes(currentRoute);

    if (!isSignedIn && !isPublic) {
      router.replace('/sign-in');
    } else if (isSignedIn && isPublic) {
      router.replace('/');
    }
  }, [isSignedIn, isLoaded, segments]);

  return <>{children}</>;
}

function AppInner() {
  const { isDark, c } = useTheme();

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <ClerkLoaded>
        <AuthGate>
          <MenuProvider>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: c.bg },
              }}
            />
          </MenuProvider>
        </AuthGate>
      </ClerkLoaded>
    </ClerkProvider>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}
