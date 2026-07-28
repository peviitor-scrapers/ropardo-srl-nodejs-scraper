/**
 * Company Module - Company Validation and Data Management
 * 
 * PURPOSE: Handles company data validation from ANAF, caches company information,
 * and validates companies against the Peviitor API. This module ensures the scraper
 * only processes legitimate, active companies registered in Romania.
 */

import fetch from "node-fetch";
import fs from "fs";
import { querySOLR, deleteJobsByCIF } from "./api.js";
import { getCompanyFromANAF } from "./company-data.js";
import companyConfig from "./config/company.js";

// ============================================================================
// CONFIGURATION — derived from config/company.json
// ============================================================================

// Peviitor API base URL for company validation
const PEVIITOR_API_URL = "https://api.peviitor.ro/v1/firme/company/";

const COMPANY_ID = companyConfig.id;
const COMPANY_BRAND = companyConfig.brand || null;

// Cache TTL — re-fetch from ANAF if cached data is older than this
const CACHE_MAX_AGE_DAYS = 7;

// ANAF raw data cache (per-run, for offline fallback)
const ANAF_CACHE_PATH = "scraper/anaf-cache.json";

// ============================================================================
// COMPANY MODEL - Defines the expected schema for company data
// ============================================================================

/**
 * Company model field definitions for validation
 * Used to ensure data integrity and compliance with Peviitor schema
 */
const COMPANY_MODEL_FIELDS = [
  { name: "id", required: true, type: "string" },           // CIF/CUI as string
  { name: "company", required: true, type: "string" },      // Official company name
  { name: "brand", required: false, type: "string" },        // Marketing brand name
  { name: "group", required: false, type: "string" },        // Corporate group
  { name: "status", required: false, type: "string", allowed: ["activ", "suspendat", "inactiv", "radiat"] }, // Romanian business status
  { name: "location", required: false, type: "array" },     // Office locations
  { name: "website", required: false, type: "array" },       // Company website URLs
  { name: "career", required: false, type: "array" },       // Career page URLs
  { name: "lastScraped", required: false, type: "string" },  // Last scrape timestamp
  { name: "scraperFile", required: false, type: "string" }   // Link to scraper source
];

// ============================================================================
// PEVIITOR API - External validation
// ============================================================================

/**
 * Fetches company data from Peviitor API
 * Used for cross-validation with Peviitor's existing company database
 * @param {string} companyName - Name to search for
 * @returns {Promise<Object|null>} - Company data or null if not found
 */
async function getCompanyFromPeviitor(companyName) {
  const url = `${PEVIITOR_API_URL}?name=${encodeURIComponent(companyName)}`;
  const res = await fetch(url, {
    headers: {
      origin: "https://peviitor.ro",
      referer: "https://peviitor.ro/",
      "User-Agent": "job_seeker_ro_spider"
    }
  });
  
  if (!res.ok) {
    throw new Error(`Peviitor API error: ${res.status}`);
  }
  
  const data = await res.json();
  if (!data.success) {
    throw new Error(`Peviitor API failed: ${JSON.stringify(data)}`);
  }
  return data.data?.[0] || null;
}

// ============================================================================
// DATA VALIDATION
// ============================================================================

/**
 * Validates company data against the COMPANY_MODEL schema
 * Checks for required fields, correct types, and allowed values
 * @param {Object} data - Company data to validate
 * @returns {boolean} - True if valid, false otherwise
 */
function validateCompanyModel(data) {
  console.log("\n=== Company Model Validation ===\n");
  
  const errors = [];
  
  // Check each field in the model
  for (const field of COMPANY_MODEL_FIELDS) {
    const value = data[field.name];
    
    // Check required fields
    if (field.required && (value === undefined || value === null || value === "")) {
      errors.push(`Missing required field: ${field.name}`);
      continue;
    }
    
    // Validate field types
    if (value !== undefined && value !== null) {
      if (field.type === "string" && typeof value !== "string") {
        errors.push(`Field ${field.name} should be string, got ${typeof value}`);
      }
      if (field.type === "array" && !Array.isArray(value)) {
        errors.push(`Field ${field.name} should be array, got ${typeof value}`);
      }
      // Validate allowed values for enum fields
      if (field.allowed && !field.allowed.includes(value)) {
        errors.push(`Field ${field.name} has invalid value "${value}". Allowed: ${field.allowed.join(", ")}`);
      }
    }
  }
  
  // Warn about extra fields not in the model
  const allowedFields = COMPANY_MODEL_FIELDS.map(f => f.name);
  const extraFields = Object.keys(data).filter(k => !allowedFields.includes(k));
  if (extraFields.length > 0) {
    console.log(`Note: Extra fields in Peviitor (not in model): ${extraFields.join(", ")}`);
  }
  
  // Report results
  if (errors.length > 0) {
    console.log("ERRORS:");
    errors.forEach(e => console.log(`  - ${e}`));
    return false;
  }
  
  console.log("All required fields present and valid!");
  return true;
}

// ============================================================================
// DATA PERSISTENCE - Caching company data
// ============================================================================

/**
 * Saves ANAF raw data for offline fallback.
 * Updates lastScraped in config/company.json (the single source of truth).
 * @param {Object} anafData - Company data from ANAF
 * @param {Object} peviitorData - Company data from Peviitor (optional)
 */
function saveCompanyData(anafData, peviitorData) {
  // Save ANAF raw data for offline fallback
  const anafCache = {
    validatedAt: new Date().toISOString(),
    anaf: anafData,
    peviitor: peviitorData
  };
  fs.mkdirSync("scraper", { recursive: true });
  fs.writeFileSync(ANAF_CACHE_PATH, JSON.stringify(anafCache, null, 2), "utf-8");
  console.log(`✅ Saved ANAF cache to ${ANAF_CACHE_PATH}`);

  // Update lastScraped in config/company.json (single source of truth)
  const configPath = "scraper/config/company.json";
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  config.lastScraped = new Date().toISOString().split("T")[0];
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  console.log(`✅ Updated lastScraped in ${configPath}`);
}

/**
 * Loads ANAF raw cache for offline fallback.
 */
function loadAnafCache() {
  if (!fs.existsSync(ANAF_CACHE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(ANAF_CACHE_PATH, "utf-8"));
  } catch (e) {
    console.log(`Warning: Could not parse ${ANAF_CACHE_PATH}`);
    return null;
  }
}

/**
 * Checks whether the config lastScraped is still fresh (within CACHE_MAX_AGE_DAYS).
 */
function isCacheFresh() {
  if (!companyConfig.lastScraped) return false;
  const ageMs = Date.now() - new Date(companyConfig.lastScraped).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays < CACHE_MAX_AGE_DAYS;
}

// ============================================================================
// COMPANY DATA RETRIEVAL - Main entry point for getting company info
// ============================================================================

/**
 * Gets company data, preferring cache over live API calls.
 * CIF and brand are read from config/company.json.
 * Cache order: config/company.json (lastScraped) → ANAF live.
 * Stale config is used as fallback if ANAF is unreachable.
 * @returns {Promise<Object>} - Company data with company name, CIF, and active status
 */
export async function getCompanyData() {
  // Fresh cache → use it, skip ANAF
  if (isCacheFresh() && companyConfig.id) {
    console.log(`Using cached company data for CIF: ${companyConfig.id}`);
    console.log(`Cached name: ${companyConfig.company}`);
    console.log(`Cached status: ${companyConfig.status}`);

    const company = companyConfig.company.toUpperCase();
    const cif = companyConfig.id;
    const active = companyConfig.status === "activ";

    // Load raw ANAF data for fallback
    const anafCache = loadAnafCache();
    const anafData = anafCache?.anaf || null;

    return { company, cif, active, anafData };
  }

  // Stale or missing cache → try ANAF, fall back to stale cache if ANAF fails
  console.log(`Fetching fresh company data from ANAF for CIF: ${COMPANY_ID}`);
  let anafData;
  try {
    anafData = await getCompanyFromANAF(COMPANY_ID);
  } catch (err) {
    if (companyConfig.lastScraped) {
      console.log(`⚠️ ANAF unreachable (${err.message}) — falling back to stale config`);
      return {
        company: companyConfig.company.toUpperCase(),
        cif: companyConfig.id,
        active: companyConfig.status === "activ",
        anafData: null
      };
    }
    throw err;
  }

  if (!anafData) {
    throw new Error("No data from ANAF - cannot proceed with scraping");
  }
  if (!anafData.name) {
    throw new Error("ANAF returned no company name - cannot proceed with scraping");
  }

  console.log(`ANAF returned name: ${anafData.name}`);
  console.log(`ANAF returned CUI: ${anafData.cui}`);
  console.log(`ANAF status: ${anafData.inactive ? "INACTIVE" : "ACTIVE"}`);

  const company = anafData.name.toUpperCase();
  const cif = anafData.cui.toString();
  const active = !anafData.inactive;

  return { company, cif, active, anafData };
}

// ============================================================================
// COMPANY VALIDATION WORKFLOW - Orchestrates validation steps
// ============================================================================

/**
 * Complete company validation workflow:
 * 1. Validate company exists in ANAF (active)
 * 2. Check existing jobs in SOLR
 * 3. Cross-validate with Peviitor API
 * 4. Cache data for offline use
 * 5. Delete SOLR jobs if company is inactive
 * 
 * @returns {Promise<Object>} - Validation result with status and job count
 */
export async function validateAndGetCompany() {
  console.log("=== Step 1: Validate company via ANAF ===\n");
  
  // Get company data from ANAF (or cache)
  const { company, cif, active, anafData } = await getCompanyData();
  
  // Check how many jobs already exist in SOLR for this company
  console.log("\n=== Step 2: Check existing jobs in SOLR ===\n");
  const solrResult = await querySOLR(cif);
  console.log(`Jobs found in SOLR for CIF ${cif}: ${solrResult.numFound}`);
  
  // Cross-validate with Peviitor
  console.log("\n=== Step 3: Validate via Peviitor ===\n");
  let peviitorData = null;
  try {
    peviitorData = await getCompanyFromPeviitor(companyConfig.company);
    console.log("Peviitor data fetched successfully");
  } catch (e) {
    console.log("Peviitor API error:", e.message);
  }
  
  // Save company data to cache
  saveCompanyData(anafData, peviitorData);
  
  // If company is inactive, remove their jobs from SOLR
  if (!active) {
    console.log("\n⚠️ Company is INACTIVE in ANAF - deleting jobs from SOLR and stopping");
    if (solrResult.numFound > 0) {
      await deleteJobsByCIF(cif);
    }
    return { status: "inactive", company, cif, existingJobsCount: solrResult.numFound };
  }
  
  const address = anafData?.headquartersAddress?.locality || anafData?.address || "";
  
  console.log(`\n✅ Company validated: ${company}, CIF: ${cif}`);
  console.log("Ready to scrape jobs...\n");
  
  return { status: "active", company, cif, existingJobsCount: solrResult.numFound, address, anafData };
}

// ============================================================================
// STANDALONE MODE - Run company.js directly for testing
// ============================================================================

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("company.js")) {
  console.log("=== Running company.js independently ===\n");
  
  const { company, cif, active } = await getCompanyData();
  console.log(`\nResult: company=${company}, cif=${cif}, active=${active}`);
  
  console.log("\n=== Peviitor Validation Test ===\n");
  
  try {
    const peviitorData = await getCompanyFromPeviitor(company);
    console.log("Peviitor Data:");
    console.log(JSON.stringify(peviitorData, null, 2));
    validateCompanyModel(peviitorData);
  } catch (e) {
    console.log("Peviitor API error:", e.message);
  }
  
  const result = await validateAndGetCompany();
  
  console.log("\nResult:", result);
}
