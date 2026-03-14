import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import ThemeProvider from '@/components/ThemeProvider';
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
    <html lang="en" suppressHydrationWarning>
      <body className={jetbrainsMono.className}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
