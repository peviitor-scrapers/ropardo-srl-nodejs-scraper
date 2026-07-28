import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
import { fileURLToPath } from "url";
import { validateAndGetCompany } from "./company.js";
import { querySOLR, upsertJobs, upsertCompany, deleteJobByUrl } from "./api.js";
import { generateJobsMarkdown } from "./markdown-generator.js";
import companyConfig from "./config/company.js";

const COMPANY_ID = companyConfig.id;

const CAREERS_URL = "https://ropardo.ro/careers/";
const JOBS_BASE = "https://jobs.ropardo.ro/job/";

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
// JOB FETCHING — HTML scraping from ropardo.ro/careers + job pages
// ============================================================================

async function fetchHTML(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "job_seeker_ro_spider" }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return await res.text();
}

async function fetchJobs() {
  console.log("Fetching ROPARDO job links from careers page...");

  const html = await fetchHTML(CAREERS_URL);
  const $ = cheerio.load(html);

  const jobUrls = [];
  $('a[href^="https://jobs.ropardo.ro/job/"]').each((_, el) => {
    const href = $(el).attr("href").replace(/\/$/, "/");
    if (!jobUrls.includes(href)) jobUrls.push(href);
  });

  console.log(`Found ${jobUrls.length} job link(s)`);

  const allJobs = [];
  for (const jobUrl of jobUrls) {
    try {
      console.log(`  Scraping: ${jobUrl}`);
      const jobHtml = await fetchHTML(jobUrl);
      const $job = cheerio.load(jobHtml);

      const title = normalizeTitle($job("h1").first().text());
      if (!title) continue;

      const employment = $job(".sidebar-section h5").filter((_, el) => $job(el).text().trim() === "Employment").closest(".sidebar-section").text().replace("Employment", "").trim();
      const workplace = $job(".sidebar-section h5").filter((_, el) => $job(el).text().trim() === "Workplace").closest(".sidebar-section").text().replace("Workplace", "").trim();

      let applyUrl = jobUrl;
      $job('a.button[href]').each((_, el) => {
        const text = $job(el).text().toLowerCase();
        if (text.includes("apply")) {
          applyUrl = $job(el).attr("href");
        }
      });

      allJobs.push({
        title,
        url: jobUrl,
        applyUrl,
        location: workplace || undefined,
        employment: employment || undefined
      });
    } catch (err) {
      console.log(`  Warning: failed to scrape ${jobUrl}: ${err.message}`);
    }
  }

  console.log(`Fetched ${allJobs.length} jobs from ROPARDO website`);
  return allJobs;
}

// ============================================================================
// STUDENT PROGRAMS — scrape from ropardo.ro/careers/for-students/
// ============================================================================

const STUDENTS_URL = "https://ropardo.ro/careers/for-students/";

async function fetchStudentPrograms() {
  console.log("Fetching ROPARDO student programs...");
  const html = await fetchHTML(STUDENTS_URL);
  const $ = cheerio.load(html);

  const programs = [];
  const seen = new Set();

  $("h2, h3").each((_, el) => {
    const text = normalizeTitle($(el).text());
    if (!text || text.length < 4) return;
    if (/^(careers|do it|recreate|start by|we like|open pos|\u2026|online\.)/i.test(text)) return;

    const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const anchor = `#${slug}`;
    const url = `${STUDENTS_URL}${anchor}`;

    if (!seen.has(url)) {
      seen.add(url);
      programs.push({
        title: text,
        url,
        location: "Sibiu",
        employment: "Full-time/Part-time"
      });
    }
  });

  console.log(`Found ${programs.length} student program(s)`);
  return programs;
}

// ============================================================================
// JOB PARSING — normalizes scraped HTML data
// ============================================================================

function parseJobs(rawJobs) {
  const jobs = [];

  for (const raw of rawJobs) {
    const title = normalizeTitle(raw.title);
    if (!title) continue;

    let location = normalizeLocation(raw.location || raw.workplace);

    const employment = (raw.employment || "").toLowerCase();
    let workmode = "on-site";
    if (employment.includes("remote") || raw.location?.toLowerCase().includes("remote")) {
      workmode = "remote";
    } else if (employment.includes("hybrid")) {
      workmode = "hybrid";
    }

    const tags = [];
    if (raw.department) tags.push(raw.department.toLowerCase());

    const url = raw.url || raw.applyUrl;

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

    console.log("=== Step 1: Get existing jobs from SOLR ===");
    const existingResult = await querySOLR(COMPANY_ID);
    const existingCount = existingResult.numFound;
    const existingUrls = new Set(existingResult.docs.map(doc => doc.url).filter(Boolean));
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
    console.log(`Jobs scraped from ROPARDO website: ${scrapedCount}`);

    const studentPrograms = await fetchStudentPrograms();
    const parsedStudentPrograms = parseJobs(studentPrograms);
    for (const prog of parsedStudentPrograms) {
      if (!allRawJobs.find(j => j.url === prog.url)) {
        allRawJobs.push(prog);
      }
    }
    console.log(`Student programs added: ${parsedStudentPrograms.length}`);

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

    // Step 4.5: Delete stale jobs — URLs in SOLR but no longer on the website
    const scrapedUrls = new Set(transformedPayload.jobs.map(job => job.url));
    const staleUrls = [...existingUrls].filter(url => !scrapedUrls.has(url));

    if (staleUrls.length > 0) {
      console.log(`\n=== Step 4.5: Delete ${staleUrls.length} stale job(s) ===`);
      for (const url of staleUrls) {
        console.log(`  Deleting: ${url}`);
        await deleteJobByUrl(url);
      }
      console.log(`✅ Deleted ${staleUrls.length} stale job(s)`);
    } else {
      console.log("\n✅ No stale jobs to delete");
    }

    console.log("\n=== Step 5: Summary ===");

    await new Promise(r => setTimeout(r, 2000));
    const finalResult = await querySOLR(COMPANY_ID);
    console.log(`\n=== SUMMARY ===`);
    console.log(`Jobs existing in SOLR before scrape: ${existingCount}`);
    console.log(`Jobs scraped from ROPARDO website: ${scrapedCount}`);
    console.log(`Stale jobs deleted: ${staleUrls.length}`);
    console.log(`Jobs in SOLR after scrape: ${finalResult.numFound}`);
    console.log(`====================`);

    console.log("\n=== DONE ===");
    console.log("Scraper completed successfully!");

  } catch (err) {
    console.error("Scraper failed:", err);
    process.exit(1);
  }
}

export { normalizeTitle, normalizeLocation, normalizeRemote, normalizeWorkmode, extractTeamFromTitle, extractJobTypeFromTitle, normalizeJobType, parseJobs, fetchJobs, fetchStudentPrograms, main };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
