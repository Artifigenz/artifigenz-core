'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';

const PUBLIC_ROUTES = ['/sign-in', '/sign-up', '/sso-callback'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = isPublicPath(pathname);

  useEffect(() => {
    if (!isLoaded) return;
    if (isPublic) return;
    if (!isSignedIn) {
      const target =
        pathname && pathname !== '/'
          ? `/sign-in?redirect_url=${encodeURIComponent(pathname)}`
          : '/sign-in';
      router.replace(target);
    }
  }, [isLoaded, isSignedIn, isPublic, pathname, router]);

  // Public routes always render.
  if (isPublic) {
    return <>{children}</>;
  }

  // While Clerk is loading, or while redirecting anon users away,
  // render nothing so we don't flash protected UI.
  if (!isLoaded || !isSignedIn) {
    return null;
  }

  return <>{children}</>;
}
