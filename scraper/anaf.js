/**
 * Company Data Module — ANAF + CUIFirma MCP
 *
 * Strategy: 1 try demoanaf.ro → 1 try cuifirma.ro MCP → cached data. No retries.
 * Search: 1 try demoanaf.ro → 1 try cuifirma.ro search.
 */

import fetch from "node-fetch";

const ANAF_API_URL = "https://demoanaf.ro/api/company/";
const ANAF_SEARCH_URL = "https://demoanaf.ro/api/search";
const CUIFIRMA_MCP_URL = "https://cuifirma.ro/mcp/cuifirma";
const CUIFIRMA_SEARCH_URL = "https://cuifirma.ro/api/search";
const TIMEOUT_MS = 10000;

// ============================================================================
// CUIFirma MCP — company details fallback
// ============================================================================

function extractRegNumber(profile) {
  const idSection = profile.sections?.find(s => s.key === "identificare_juridica");
  const regField = idSection?.fields?.find(f => f.label === "Număr registru");
  return regField?.value || null;
}

function extractVatStatus(profile) {
  const fiscalSection = profile.sections?.find(s => s.key === "rezumat_fiscal");
  const tvaField = fiscalSection?.fields?.find(f => f.label === "Status TVA");
  return tvaField?.value?.toLowerCase().includes("plătitor") ?? null;
}

function extractEFactura(profile) {
  const fiscalSection = profile.sections?.find(s => s.key === "rezumat_fiscal");
  const efField = fiscalSection?.fields?.find(f => f.label === "RO e-Factura");
  return efField?.value?.toLowerCase().includes("înregistrat") ?? null;
}

async function fetchFromCuifirma(cif) {
  const cui = String(cif).replace(/^RO/i, "");

  const res = await fetch(CUIFIRMA_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "job_seeker_ro_spider"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get-firm-profile",
        arguments: { cui }
      }
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });

  if (!res.ok) throw new Error(`CUIFirma MCP error: ${res.status}`);

  const json = await res.json();
  if (json.error) throw new Error(`CUIFirma MCP: ${json.error.message || JSON.stringify(json.error)}`);

  const content = json.result?.content?.[0];
  if (!content || json.result?.isError) throw new Error("CUIFirma returned no data");

  const profile = typeof content.text === "string" ? JSON.parse(content.text) : content.text;
  if (!profile || !profile.cui) throw new Error("CUIFirma returned no data");

  return {
    name: profile.name || profile.display_name,
    cui: Number(profile.cui),
    inactive: profile.is_active === false,
    inactiveSince: null,
    reactivatedSince: null,
    address: profile.location || null,
    headquartersAddress: profile.location ? { locality: profile.location } : undefined,
    registrationNumber: extractRegNumber(profile),
    caenCode: profile.primary_caen_display || null,
    vatRegistered: extractVatStatus(profile),
    eFacturaRegistered: extractEFactura(profile)
  };
}

// ============================================================================
// ANAF — primary source
// ============================================================================

async function fetchFromAnaf(cif) {
  const res = await fetch(`${ANAF_API_URL}${cif}`, {
    headers: { "User-Agent": "job_seeker_ro_spider" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`ANAF API error: ${res.status}`);
  const json = await res.json();
  if (json.success === false) throw new Error(json.error?.message || "ANAF returned error");
  return json.data || null;
}

async function searchFromAnaf(brandName) {
  const res = await fetch(`${ANAF_SEARCH_URL}?q=${encodeURIComponent(brandName)}`, {
    headers: { "User-Agent": "job_seeker_ro_spider" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`ANAF search error: ${res.status}`);
  const json = await res.json();
  return json.data || [];
}

// ============================================================================
// CUIFirma — search fallback
// ============================================================================

async function searchFromCuifirma(brandName) {
  const res = await fetch(`${CUIFIRMA_SEARCH_URL}?q=${encodeURIComponent(brandName)}`, {
    headers: { "User-Agent": "job_seeker_ro_spider" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`CUIFirma search error: ${res.status}`);
  const json = await res.json();
  return (json.results || []).map(r => ({
    cui: String(r.cui),
    name: r.name,
    statusLabel: r.is_active ? "Funcțiune" : (r.status_label || "Inactiv")
  }));
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Fetches company by CIF — ANAF first, CUIFirma MCP fallback
 */
export async function getCompanyFromANAF(cif) {
  try {
    console.log(`Fetching company data for CIF: ${cif} (demoanaf.ro)...`);
    return await fetchFromAnaf(cif);
  } catch (err) {
    console.log(`DemoANAF failed: ${err.message} — trying cuifirma.ro MCP...`);
    return await fetchFromCuifirma(cif);
  }
}

/**
 * Fetches company with fallback to cached data
 */
export async function getCompanyFromANAFWithFallback(cif, cachedData = null) {
  try {
    return await getCompanyFromANAF(cif);
  } catch (err) {
    console.log(`\n⚠️ All company data sources unavailable: ${err.message}`);
    if (cachedData) {
      console.log("✅ Using cached company data as fallback");
      return cachedData;
    }
    throw err;
  }
}

/**
 * Searches companies by brand — ANAF first, CUIFirma fallback
 */
export async function searchCompany(brandName) {
  try {
    return await searchFromAnaf(brandName);
  } catch (err) {
    console.log(`DemoANAF search failed: ${err.message} — trying cuifirma.ro...`);
    return await searchFromCuifirma(brandName);
  }
}
