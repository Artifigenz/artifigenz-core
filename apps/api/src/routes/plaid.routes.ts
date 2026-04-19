import { Hono } from "hono";
import { CountryCode, Products } from "plaid";
import { clerkAuth } from "../platform/auth/clerk-middleware";
import { getPlaidClient } from "../agents/finance/lib/plaid-client";

/**
 * Popular retail banks to surface on the onboarding bank picker. We match
 * Plaid's returned institutions by name (case-insensitive substring) so we
 * don't hardcode Plaid institution IDs that could drift.
 */
const POPULAR_BANKS: Record<string, string[]> = {
  CA: [
    "TD Canada Trust",
    "RBC",
    "BMO",
    "Scotiabank",
    "CIBC",
    "National Bank",
    "Tangerine",
    "Desjardins",
    "Simplii",
    "HSBC Canada",
  ],
  US: [
    "Chase",
    "Bank of America",
    "Wells Fargo",
    "Citi",
    "American Express",
    "Capital One",
    "Discover",
    "US Bank",
    "PNC",
    "TD Bank",
  ],
};

interface Institution {
  id: string;
  name: string;
  logo: string | null;
  primaryColor: string | null;
  url: string | null;
  countries: string[];
}

// 24-hour cache keyed by country code. Institution metadata changes rarely;
// caching keeps us well under Plaid's rate limits.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; institutions: Institution[] }>();

async function fetchPopularInstitutions(country: string): Promise<Institution[]> {
  const cached = cache.get(country);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.institutions;
  }

  const popularNames = POPULAR_BANKS[country];
  if (!popularNames) return [];

  const plaid = getPlaidClient();
  // Plaid's institutionsGet returns up to 500 institutions per call. For CA/US
  // that comfortably covers every retail bank. We pull the full set once,
  // then match by name against our curated popular list below.
  const response = await plaid.institutionsGet({
    count: 500,
    offset: 0,
    country_codes: [country as CountryCode],
    options: {
      products: [Products.Transactions],
      include_optional_metadata: true,
    },
  });

  const allInstitutions = response.data.institutions;

  // Match each popular name against Plaid's returned list (case-insensitive
  // substring on institution.name). Preserve the order defined in POPULAR_BANKS
  // so the grid renders Big-Five banks first.
  const matched: Institution[] = [];
  for (const query of popularNames) {
    const q = query.toLowerCase();
    const hit = allInstitutions.find((i) => i.name.toLowerCase().includes(q));
    if (!hit) continue;
    matched.push({
      id: hit.institution_id,
      name: hit.name,
      logo: hit.logo ?? null,
      primaryColor: hit.primary_color ?? null,
      url: hit.url ?? null,
      countries: hit.country_codes,
    });
  }

  cache.set(country, { at: Date.now(), institutions: matched });
  return matched;
}

export function createPlaidRoutes() {
  const app = new Hono();
  app.use("/*", clerkAuth);

  // GET /api/plaid/institutions?country=CA
  app.get("/institutions", async (c) => {
    const country = (c.req.query("country") ?? "US").toUpperCase();
    if (!POPULAR_BANKS[country]) {
      return c.json({ institutions: [], country, supported: false });
    }
    try {
      const institutions = await fetchPopularInstitutions(country);
      return c.json({ institutions, country, supported: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Plaid error";
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
