'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

// Routes an anonymous visitor can reach without being redirected to /sign-in.
// '/' is the public landing page; authed users visiting it are bounced to /app.
const PUBLIC_ROUTES = ['/', '/sign-in', '/sign-up', '/sso-callback'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || (route !== '/' && pathname.startsWith(`${route}/`))
  );
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = isPublicPath(pathname);
  const isLanding = pathname === '/';

  useEffect(() => {
    if (!isLoaded) return;

    // Authed users shouldn't see the landing page — send them to the dashboard.
    if (isLanding && isSignedIn) {
      router.replace('/app');
      return;
    }

    // Anon users shouldn't see protected routes — send them to sign-in
    // with the original destination preserved as redirect_url.
    if (!isPublic && !isSignedIn) {
      const target =
        pathname && pathname !== '/'
          ? `/sign-in?redirect_url=${encodeURIComponent(pathname)}`
          : '/sign-in';
      router.replace(target);
    }
  }, [isLoaded, isSignedIn, isPublic, isLanding, pathname, router]);

  // Landing renders immediately for anon; for authed it renders null
  // during the redirect to /app to avoid a flash of landing content.
  if (isLanding) {
    if (!isLoaded) return null;
    if (isSignedIn) return null;
    return <>{children}</>;
  }

  // Other public routes (/sign-in, /sign-up, /sso-callback) always render.
  if (isPublic) {
    return <>{children}</>;
  }

  // Protected routes: render nothing while loading or during redirect,
  // otherwise render children for signed-in users.
  if (!isLoaded || !isSignedIn) {
    return null;
  }

  return <>{children}</>;
}
