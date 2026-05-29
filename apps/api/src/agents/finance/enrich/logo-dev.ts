/**
 * Logo.dev URL builder.
 *
 * Pattern: https://img.logo.dev/{domain}?token={publishable_key}&size=128&format=png
 *
 * The publishable key (pk_...) is safe to embed in URLs — that's its whole
 * point. We attach it server-side so the cluster API responses already
 * contain the full URL, and the browser just <img src> renders it.
 *
 * Free tier: 5,000 requests/day. Logo.dev caches aggressively at the CDN,
 * so the same domain across many users counts as one request.
 *
 * If LOGO_DEV_TOKEN isn't configured we return null and let callers fall
 * back to whatever logo source they had (Plaid's CDN, or no logo + the
 * initials chip in the UI).
 */
export function buildLogoDevUrl(
  website: string | null,
  options: { size?: number; format?: "png" | "svg" | "webp" } = {},
): string | null {
  const token = process.env.LOGO_DEV_TOKEN;
  if (!token || !website) return null;

  const domain = website
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
  if (!domain || !domain.includes(".")) return null;

  const params = new URLSearchParams({
    token,
    size: String(options.size ?? 128),
    format: options.format ?? "png",
  });
  return `https://img.logo.dev/${domain}?${params.toString()}`;
}
