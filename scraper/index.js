import fetch from "node-fetch";
import fs from "fs";
import { fileURLToPath } from "url";
import { validateAndGetCompany } from "./company.js";
import { querySOLR, upsertJobs, upsertCompany } from "./api.js";
import { generateJobsMarkdown } from "./markdown-generator.js";
import companyConfig from "./config/company.js";

const COMPANY_ID = companyConfig.id;

const POSITIONS_API = "https://jobs.ropardo.ro/api/apply/positions";
const JOBS_PAGE = "https://jobs.ropardo.ro/jobs";

const ANOFM_TIMEOUT = 10000;

let COMPANY_NAME = null;

// ============================================================================
// NORMALIZATION FUNCTIONS
// ============================================================================

function normalizeTitle(title) {
  if (!title) return "";
  return title.replace(/\s+/g, " ").trim();
}

function normalizeLocation(location) {
  if (!location) return [];
  const parts = location.split(",").map(s => s.trim());
  const city = parts[0];
  if (!city) return [];
  if (/^remote$/i.test(city)) return [];
  return [city];
}

function normalizeRemote(raw) {
  if (!raw) return false;
  return /remote/i.test(String(raw));
}

function normalizeWorkmode(wm) {
  if (!wm) return "on-site";
  const lower = wm.toLowerCase();
  if (lower.includes("remote")) return "remote";
  if (lower.includes("on site") || lower.includes("on-site")) return "on-site";
  return "hybrid";
}

function extractTeamFromTitle(title) {
  const match = title?.match(/^\[([^\]]+)\]\s*/);
  return match ? match[1].trim() : null;
}

function extractJobTypeFromTitle(title) {
  if (!title) return null;
  const lower = title.toLowerCase();
  if (lower.includes("intern") || lower.includes("student")) return "internship";
  if (lower.includes("part time") || lower.includes("part-time")) return "part-time";
  return "full-time";
}

function normalizeJobType(type) {
  if (!type) return "full-time";
  const lower = type.toLowerCase();
  if (lower.includes("intern")) return "internship";
  if (lower.includes("part")) return "part-time";
  return "full-time";
}

// ============================================================================
// JOB FETCHING — paginated JSON API
// ============================================================================

async function fetchJobs() {
  const allJobs = [];
  let page = 1;
  let total = Infinity;

  console.log("Fetching ROPARDO jobs from API...");

  while (true) {
    const url = `${POSITIONS_API}?page=${page}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "job_seeker_ro_spider",
        "Accept": "application/json"
      }
    });

    if (!res.ok) {
      throw new Error(`API error ${res.status} fetching page ${page}`);
    }

    const data = await res.json();

    if (page === 1 && data.metadata) {
      total = data.metadata.total || 0;
      console.log(`Total jobs available: ${total}`);
    }

    const results = data.results || [];
    if (results.length === 0) break;

    allJobs.push(...results);

    if (data.metadata) {
      const pageSize = data.metadata.pageSize || 20;
      if (page * pageSize >= total) break;
    } else {
      break;
    }

    page++;
  }

  console.log(`Fetched ${allJobs.length} jobs from ${page} page(s)`);
  return allJobs;
}

// ============================================================================
// JOB PARSING — uses companyData from API response
// ============================================================================

function parseJobs(rawJobs) {
  const jobs = [];

  for (const raw of rawJobs) {
    const title = normalizeTitle(raw.title);
    if (!title) continue;

    let location = normalizeLocation(raw.location);

    if (location.length === 0 && raw.companyData?.address) {
      location = normalizeLocation(raw.companyData.address);
    }

    let workmode = "on-site";
    if (raw.location?.toLowerCase().includes("remote")) {
      workmode = "remote";
    }

    const tags = [];
    if (raw.department) tags.push(raw.department.toLowerCase());

    const url = raw.applyUrl || `${JOBS_PAGE}/${raw.id}`;

    jobs.push({
      url,
      title,
      workmode,
      location: location.length > 0 ? location : undefined,
      tags: tags.length > 0 ? tags : undefined
    });
  }

  return jobs;
}

// ============================================================================
// ANOFM INTEGRATION
// ============================================================================

async function searchANOFM(cif) {
  const jobs = [];
  try {
    console.log(`Searching ANOFM by CIF: ${cif}`);
    const payload = {
      current: 1,
      rowCount: 250,
      sort: { created_at: "desc" },
      employer_tax_code: cif
    };
    const res = await fetch("https://mediere.anofm.ro/api/entity/vw_public_job_posting", {
      method: "POST",
      timeout: ANOFM_TIMEOUT,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "job_seeker_ro_spider"
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.log(`  ANOFM returned ${res.status}`);
      return jobs;
    }
    const data = await res.json();
    for (const row of data.rows || []) {
      const locationParts = (row.address_locality_name || "").split(">").map(s => s.trim());
      const location = locationParts.length > 1 ? locationParts[locationParts.length - 1] : locationParts[0];
      jobs.push({
        url: `https://mediere.anofm.ro/app/module/mediere/job/${row.id}`,
        title: row.occupation,
        location: location ? [location] : undefined,
        source: "ANOFM"
      });
    }
    console.log(`  Found ${jobs.length} jobs on ANOFM`);
  } catch (err) {
    console.log(`  ANOFM error: ${err.message}`);
  }
  return jobs;
}

// ============================================================================
// JOB MODEL MAPPING
// ============================================================================

function mapToJobModel(rawJob, cif, companyName = COMPANY_NAME) {
  const now = new Date().toISOString();

  const job = {
    url: rawJob.url,
    title: rawJob.title,
    company: companyName,
    cif: cif,
    location: rawJob.location?.length ? rawJob.location : undefined,
    tags: rawJob.tags?.length ? rawJob.tags : undefined,
    workmode: rawJob.workmode || undefined,
    date: now,
    status: "scraped"
  };

  Object.keys(job).forEach((k) => job[k] === undefined && delete job[k]);

  return job;
}

function transformJobsForSOLR(payload) {
  const romanianCities = [
    "Bucharest", "București", "Cluj-Napoca", "Cluj Napoca",
    "Timișoara", "Timisoara", "Iași", "Iasi", "Brașov", "Brasov",
    "Constanța", "Constanta", "Craiova", "Bacău", "Sibiu",
    "Târgu Mureș", "Targu Mures", "Oradea", "Baia Mare", "Satu Mare",
    "Ploiești", "Ploiesti", "Pitești", "Pitesti", "Arad", "Galați", "Galati",
    "Brăila", "Braila", "Drobeta-Turnu Severin", "Râmnicu Vâlcea", "Ramnicu Valcea",
    "Buzău", "Buzau", "Botoșani", "Botosani", "Zalău", "Zalau", "Hunedoara", "Deva",
    "Suceava", "Bistrița", "Bistrita", "Tulcea", "Călărași", "Calarasi",
    "Giurgiu", "Alba Iulia", "Slatina", "Piatra Neamț", "Piatra Neamt", "Roman",
    "Dumbrăvița", "Dumbravita", "Voluntari", "Popești-Leordeni", "Popesti-Leordeni",
    "Chitila", "Mogoșoaia", "Mogosoaia", "Otopeni", "Pantelimon", "Apahida"
  ];

  const citySet = new Set(romanianCities.map(c => c.toLowerCase()));

  const transformed = {
    ...payload,
    company: payload.company?.toUpperCase(),
    jobs: payload.jobs.map(job => {
      const validLocations = (job.location || []).filter(loc => {
        const lower = loc.toLowerCase().trim();
        if (lower === "romania" || lower === "românia") return true;
        return citySet.has(lower);
      }).map(loc => loc.toLowerCase() === "romania" ? "România" : loc);

      return {
        ...job,
        location: validLocations.length > 0 ? validLocations : ["România"],
        workmode: normalizeWorkmode(job.workmode)
      };
    })
  };

  return transformed;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const testOnlyOnePage = process.argv.includes("--test");

  try {
    fs.mkdirSync("scraper", { recursive: true });

    console.log("=== Step 1: Get existing jobs count ===");
    const existingResult = await querySOLR(COMPANY_ID);
    const existingCount = existingResult.numFound;
    console.log(`Found ${existingCount} existing jobs in SOLR`);

    console.log("=== Step 2: Validate company via ANAF ===");
    const { company, cif, address, status } = await validateAndGetCompany();
    COMPANY_NAME = company;
    const localCif = cif;

    if (status === "inactive") {
      console.log("⚠️ Company is INACTIVE — jobs deleted, skipping scrape.");
      return;
    }

    try {
      await upsertCompany({
        id: cif,
        company,
        brand: companyConfig.brand || undefined,
        status: status || "activ",
        location: address ? [address] : companyConfig.location,
        website: companyConfig.website,
        career: companyConfig.career,
        scraperFile: companyConfig.scraperFile,
        lastScraped: new Date().toISOString().split("T")[0]
      });
    } catch (err) {
      console.log(`Note: Could not upsert company to SOLR core: ${err.message}`);
    }

    const rawApiJobs = await fetchJobs();
    let allRawJobs = parseJobs(rawApiJobs);
    const scrapedCount = allRawJobs.length;
    console.log(`Jobs scraped from ROPARDO API: ${scrapedCount}`);

    if (!testOnlyOnePage) {
      const anofmJobs = await searchANOFM(localCif);
      const anofmCount = anofmJobs.length;
      for (const job of anofmJobs) {
        if (!allRawJobs.find(j => j.url === job.url)) {
          allRawJobs.push(job);
        }
      }
      console.log(`Jobs added from ANOFM: ${anofmCount}`);
    }

    const jobs = allRawJobs.map(job => mapToJobModel(job, localCif));

    const payload = {
      source: "ropardo.ro",
      scrapedAt: new Date().toISOString(),
      company: COMPANY_NAME,
      cif: localCif,
      jobs
    };

    console.log("Transforming jobs for SOLR...");
    const transformedPayload = transformJobsForSOLR(payload);
    const validCount = transformedPayload.jobs.filter(j => j.location).length;
    console.log(`Jobs with valid Romanian locations: ${validCount}`);

    fs.writeFileSync("scraper/jobs.json", JSON.stringify(transformedPayload, null, 2), "utf-8");
    console.log("Saved scraper/jobs.json");

    const companyData = {
      id: localCif,
      company: transformedPayload.company,
      brand: companyConfig.brand || undefined,
      status: status || "activ",
      location: address ? [address] : companyConfig.location,
      website: companyConfig.website,
      career: companyConfig.career,
      lastScraped: new Date().toISOString().split("T")[0]
    };
    const markdown = generateJobsMarkdown(companyData, transformedPayload.jobs);
    fs.mkdirSync("docs", { recursive: true });
    fs.writeFileSync("docs/jobs.md", markdown, "utf-8");
    console.log("Saved docs/jobs.md");

    fs.copyFileSync("scraper/config/company.json", "docs/company.json");
    console.log("Copied scraper/config/company.json → docs/company.json");

    console.log("\n=== Step 4: Upsert jobs to SOLR ===");
    await upsertJobs(transformedPayload.jobs);

    console.log("\n=== Step 5: Summary ===");

    const finalResult = await querySOLR(COMPANY_ID);
    console.log(`\n=== SUMMARY ===`);
    console.log(`Jobs existing in SOLR before scrape: ${existingCount}`);
    console.log(`Jobs scraped from ROPARDO website: ${scrapedCount}`);
    console.log(`Jobs in SOLR after scrape: ${finalResult.numFound}`);
    console.log(`====================`);

    console.log("\n=== DONE ===");
    console.log("Scraper completed successfully!");

  } catch (err) {
    console.error("Scraper failed:", err);
    process.exit(1);
  }
}

export { normalizeTitle, normalizeLocation, normalizeRemote, normalizeWorkmode, extractTeamFromTitle, extractJobTypeFromTitle, normalizeJobType, parseJobs, fetchJobs, main };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
