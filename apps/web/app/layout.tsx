import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import ThemeProvider from '@/components/ThemeProvider';
import AuraGradient from '@/components/effects/AuraGradient';
import AuthGate from '@/components/auth/AuthGate';
import './globals.css';

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Artifigenz',
  description:
    'Artifigenz builds AI-native products for the agentic era. Founded by Cooper and Rajan RK.',
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body className={jetbrainsMono.className}>
          <ThemeProvider>
            <AuraGradient />
            {/* Clerk bot protection — must exist in DOM when sign-up runs.
                Kept at root layout level so it's always present. */}
            <div id="clerk-captcha" style={{ position: 'absolute', left: '-9999px', width: 0, height: 0, overflow: 'hidden' }} />
            <AuthGate>{children}</AuthGate>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
