/**
 * Peviitor API Module
 *
 * PURPOSE: Provides interface to Solr database via the peviitor API for
 * storing and retrieving job listings and company data.
 *
 * This module handles:
 * - Querying jobs by company CIF (via peviitor API)
 * - Querying/upserting company data (via peviitor API)
 * - Adding/updating (upserting) jobs (via peviitor API)
 * - Deleting jobs by CIF or URL (via peviitor API)
 * - URL validation and cleanup
 *
 * All operations go through the peviitor API — no direct Solr access.
 */

import fetch from "node-fetch";
import fs from "fs";

// ============================================================================
// CONFIGURATION
// ============================================================================

// Peviitor API base URL for all operations
const API_BASE_URL = "https://api.peviitor.ro/v1";

// HTTP request timeout in milliseconds
const TIMEOUT = 10000;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Zero-pads a CIF to exactly 8 digits (Peviitor API requirement)
 */
function padCif(cif) {
  return String(cif).padStart(8, "0");
}

// ============================================================================
// COMPANY OPERATIONS - Via peviitor API
// ============================================================================

/**
 * Searches for a company by CIF using the peviitor API
 * @param {string} cif - Company CIF to search for
 * @returns {Promise<Object|null>} - Company data or null if not found
 */
export async function getCompanyByCif(cif) {
  const url = `${API_BASE_URL}/firme/company/?cif=${encodeURIComponent(padCif(cif))}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "job_seeker_ro_spider"
    }
  });

  if (!res.ok) {
    throw new Error(`API company search error: ${res.status}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(`API company search failed: ${JSON.stringify(data)}`);
  }

  return data.data?.[0] || null;
}

/**
 * Searches for companies by name using the peviitor API
 * @param {string} name - Company name to search for (partial match)
 * @returns {Promise<Array>} - Array of matching companies
 */
export async function searchCompanyByName(name) {
  const url = `${API_BASE_URL}/firme/company/?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "job_seeker_ro_spider"
    }
  });

  if (!res.ok) {
    throw new Error(`API company search error: ${res.status}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(`API company search failed: ${JSON.stringify(data)}`);
  }

  return data.data || [];
}

/**
 * Upserts (adds or updates) a company document via the peviitor API
 * @param {Object} companyDoc - Company document with id, company, brand, status, location, etc.
 */
export async function upsertCompany(companyDoc) {
  const url = `${API_BASE_URL}/firme/company/add/`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "job_seeker_ro_spider"
    },
    body: JSON.stringify({ ...companyDoc, id: padCif(companyDoc.id) })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API company upsert error: ${res.status} - ${text}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(`API company upsert failed: ${JSON.stringify(data)}`);
  }

  console.log(`✅ Company "${companyDoc.company}" upserted via API.`);
}

// ============================================================================
// JOB OPERATIONS - Via peviitor API
// ============================================================================

/**
 * Queries jobs from Solr by company CIF via the peviitor API
 * @param {string} cif - Company CIF/CUI to search for
 * @returns {Promise<Object>} - { numFound, docs } normalized to match direct Solr format
 */
export async function querySOLR(cif) {
  const url = `${API_BASE_URL}/scraper/jobs/?cif=${encodeURIComponent(padCif(cif))}&rows=500`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "job_seeker_ro_spider"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API jobs query error: ${res.status} - ${text}`);
  }

  const data = await res.json();

  return {
    numFound: data.total ?? 0,
    docs: data.data ?? []
  };
}

// ============================================================================
// DELETE OPERATIONS - Via peviitor API
// ============================================================================

/**
 * Deletes all jobs for a company by CIF via the peviitor API
 * Used when a company becomes inactive in ANAF
 * @param {string} cif - Company CIF to delete jobs for
 */
export async function deleteJobsByCIF(cif) {
  const url = `${API_BASE_URL}/scraper/jobs/delete/`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "job_seeker_ro_spider"
    },
    body: JSON.stringify({ cif: padCif(cif) })
  });

  if (res.status === 404) {
    console.log(`⚠️ No jobs found for CIF ${cif} — nothing to delete.`);
    return;
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API jobs delete error: ${res.status} - ${text}`);
  }

  const data = await res.json();
  console.log(`✅ Deleted ${data.count ?? 0} jobs for CIF ${cif} via API.`);
}

/**
 * Deletes a single job by its URL via the peviitor API
 * Used when a job posting is no longer available
 * @param {string} url - Job URL to delete
 */
export async function deleteJobByUrl(url) {
  const apiUrl = `${API_BASE_URL}/scraper/jobs/delete/`;
  const res = await fetch(apiUrl, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "job_seeker_ro_spider"
    },
    body: JSON.stringify({ url })
  });

  if (res.status === 404) {
    return;
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API jobs delete error: ${res.status} - ${text}`);
  }
}

// ============================================================================
// UPSERT OPERATIONS - Add or update jobs (via peviitor API)
// ============================================================================

/**
 * Upserts (adds or updates) jobs via the peviitor API
 * Jobs are matched by URL - if URL exists, job is updated; otherwise, new job is added
 * Diacritics in city names are auto-fixed, tags are auto-lowercased
 * @param {Array} jobs - Array of job objects to upsert
 */
export async function upsertJobs(jobs) {
  const url = `${API_BASE_URL}/scraper/jobs/upload/`;

  const paddedJobs = jobs.map(job => ({
    ...job,
    cif: padCif(job.cif)
  }));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "job_seeker_ro_spider"
    },
    body: JSON.stringify(paddedJobs)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API jobs upload error: ${res.status} - ${text}`);
  }

  const data = await res.json();
  console.log(`✅ Upserted ${data.count ?? jobs.length} jobs via API.`);
}

// ============================================================================
// URL VALIDATION - Verify job URLs are still active
// ============================================================================

/**
 * Checks if a job URL is still valid (returns 200 OK)
 * @param {string} url - URL to check
 * @returns {Promise<Object>} - Status info {url, status, valid, error}
 */
async function checkUrl(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { "User-Agent": "job_seeker_ro_spider" }
    });
    return { url, status: res.status, valid: res.ok };
  } catch (err) {
    return { url, status: 0, valid: false, error: err.message };
  }
}

// ============================================================================
// VERIFICATION WORKFLOW - Check and clean up invalid URLs
// ============================================================================

/**
 * Verifies job URLs in jobs_existing.json and removes invalid ones
 * This is used for post-scrape cleanup of expired job postings
 */
async function runVerification(cif) {
  console.log("=== Verify SOLR Jobs ===\n");

  const result = await querySOLR(cif);
  console.log(`Total jobs in SOLR for CIF ${cif}: ${result.numFound}`);

  console.log("\nFirst 5 jobs:");
  result.docs.slice(0, 5).forEach((job, i) => {
    console.log(`${i+1}. ${job.title} (${job.location?.join(', ')}) - ${job.workmode}`);
  });

  if (fs.existsSync("scraper/jobs_existing.json")) {
    console.log("\n=== Verify existing URLs ===\n");
    const existing = JSON.parse(fs.readFileSync("scraper/jobs_existing.json", "utf-8"));
    const existingJobs = existing.jobs || [];
    console.log(`Checking ${existingJobs.length} URLs...`);

    const invalidUrls = [];
    for (let i = 0; i < existingJobs.length; i++) {
      const job = existingJobs[i];
      const res = await checkUrl(job.url);
      console.log(`[${i+1}/${existingJobs.length}] ${res.status > 0 ? res.status : 'ERR'} - ${job.url}`);
      if (!res.valid) invalidUrls.push(job.url);
    }

    if (invalidUrls.length > 0) {
      console.log(`\n⚠️ ${invalidUrls.length} invalid URLs found - deleting via API...`);
      for (const url of invalidUrls) {
        await deleteJobByUrl(url);
      }
      console.log(`✅ Deleted ${invalidUrls.length} invalid jobs via API`);
    }

    if (invalidUrls.length === 0) {
      console.log("\n✅ All URLs valid - deleting scraper/jobs_existing.json");
      fs.unlinkSync("scraper/jobs_existing.json");
    } else {
      console.log("⚠️ Keeping scraper/jobs_existing.json for reference");
    }
  }
}

// ============================================================================
// EXTRACT WORKFLOW - Backup jobs before scraping
// ============================================================================

/**
 * Extracts current jobs from Solr and saves to backup file
 * Used before scraping to preserve existing job data
 * @param {string} cif - Company CIF
 */
async function runExtract(cif) {
  console.log("=== Extract existing jobs from SOLR ===\n");

  try {
    const result = await querySOLR(cif);
    console.log(`Found ${result.numFound} existing jobs in SOLR for CIF ${cif}`);

    if (result.numFound === 0) {
      console.log("No existing jobs to backup.");
      return;
    }

    const backup = {
      extractedAt: new Date().toISOString(),
      cif: cif,
      count: result.numFound,
      jobs: result.docs
    };

    fs.writeFileSync("scraper/jobs_existing.json", JSON.stringify(backup, null, 2), "utf-8");
    console.log("\n✅ Saved existing jobs to scraper/jobs_existing.json\n");
  } catch (err) {
    console.error("Failed to extract existing jobs:", err.message);
    process.exit(1);
  }
}

// ============================================================================
// COMPANY QUERY WORKFLOW - Query company core via API
// ============================================================================

/**
 * Queries companies from Solr company core via peviitor API
 * Useful for debugging and verification
 * @param {Array} args - Command line arguments
 */
async function runCompanyQuery(args) {
  console.log("=== Query Company via API ===\n");
  
  const query = args[1] || "ropardo";
  console.log(`Query: ${query}`);
  
  const results = await searchCompanyByName(query);
  console.log(`Found ${results.length} companies`);
  
  if (results.length > 0) {
    console.log("\nResults:");
    results.forEach((doc, i) => {
      console.log(`  ${i+1}. ${doc.company} (CIF: ${doc.id})`);
    });
  }
}

// ============================================================================
// STANDALONE MODE - Run api.js directly for maintenance tasks
// ============================================================================

/**
 * Usage:
 *   node api.js <CIF>              - Verify jobs for a company
 *   node api.js extract <CIF>      - Extract jobs to backup file
 *   node api.js company            - Query companies via API
 *   node api.js company <name>     - Search companies by name
 */
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("api.js")) {
  const args = process.argv.slice(2);
  
  if (args.includes("extract")) {
    const cif = args[1] || null;
    if (!cif) {
      console.error("Error: CIF required. Usage: node api.js extract <CIF>");
      process.exit(1);
    }
    await runExtract(cif);
  } else if (args.includes("company")) {
    await runCompanyQuery(args);
  } else {
    const cif = args[0] || null;
    if (!cif) {
      console.error("Error: CIF required. Usage: node api.js <CIF>");
      process.exit(1);
    }
    await runVerification(cif);
  }
}
