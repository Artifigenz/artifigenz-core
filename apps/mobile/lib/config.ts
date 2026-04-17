/**
 * Mobile app configuration constants.
 *
 * EXPO_PUBLIC_* env vars are inlined at build time by Expo's babel preset.
 * Fallbacks are provided for local development.
 */

export const CLERK_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ??
  'pk_test_YW1hemVkLWdpcmFmZmUtMi5jbGVyay5hY2NvdW50cy5kZXYk';

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
