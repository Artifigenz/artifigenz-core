'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

// Routes an anonymous visitor can reach without being redirected to /sign-in.
// '/' is now the chat (protected) — we no longer host a marketing landing.
// '/share' hosts read-only conversation snapshots that anyone with the link
// can view without an account.
const PUBLIC_ROUTES = ['/sign-in', '/sign-up', '/sso-callback', '/share'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = isPublicPath(pathname);

  useEffect(() => {
    if (!isLoaded) return;

    // Anon users on any protected route → sign-in, preserve target as
    // redirect_url so post-auth they land back where they were headed.
    if (!isPublic && !isSignedIn) {
      const target =
        pathname && pathname !== '/'
          ? `/sign-in?redirect_url=${encodeURIComponent(pathname)}`
          : '/sign-in';
      router.replace(target);
    }
  }, [isLoaded, isSignedIn, isPublic, pathname, router]);

  // Public routes (/sign-in, /sign-up, /sso-callback, /share) always render.
  if (isPublic) {
    return <>{children}</>;
  }

  // Protected routes: render nothing while loading or during the redirect
  // to sign-in, otherwise render children for signed-in users.
  if (!isLoaded || !isSignedIn) {
    return null;
  }

  return <>{children}</>;
}
