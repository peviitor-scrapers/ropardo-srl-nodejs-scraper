# Instructions

## Project Purpose

This scraper extracts job listings from ROPARDO careers page (Romania only) and imports them to peviitor.ro.

Target: https://jobs.ropardo.ro/

## Model Schemas

The job and company models are defined in:
- `job-model.md` - Job model schema
- `company-model.md` - Company model schema

## Important

These models are **dynamic** and can change over time. They are based on the official Peviitor Core schemas which may be updated.

## How to Keep Models Updated

When working on this scraper:

1. **Check for updates** in the Peviitor Core repository:
   - Repository: https://github.com/peviitor-ro/peviitor_core
   - Main file: README.md (contains Job and Company model schemas)

2. **When to update**:
   - Before starting new development work
   - If field requirements or validations have changed
   - If new fields have been added

3. **How to update**:
   - Fetch the latest README.md from peviitor_core main branch
   - Compare with current job-model.md and company-model.md
   - Update local files if there are differences
   - Update index.js mapping logic if field requirements changed

## Technologies

- **Node.js & JavaScript** - For scraping and data extraction
- **Cheerio** - HTML parsing of ROPARDO careers page
- **Peviitor API** - For data storage and retrieval (api.peviitor.ro)
- **Big Pickle / Claude Code** - For development

## Workflow Steps

1. **Start with brand** - We know the brand ("ROPARDO")
2. **Search in DemoANAF** - Find company by brand, get CIF from search results
3. **Get company details from ANAF** - Using CIF, fetch full company data from ANAF
4. **Validate with Peviitor** - Verify company exists in Peviitor, get group/brand info
5. **Check existing jobs** - Query Peviitor API by CIF to see what jobs already exist
6. **Check company status** - If ANAF status = "inactive" → DELETE existing jobs and STOP
7. **Save company.json** - Save all ANAF + Peviitor data for backup
8. **Scrape new jobs** - Extract jobs from ROPARDO careers page (Romania)
9. **Transform for API** - Validate and fix job data:
   - location: Only Romanian cities allowed
   - tags: lowercase, no diacritics
   - company: uppercase
10. **Upsert to API** - Import/update jobs via Peviitor API
11. **Verify URLs** - Check existing job URLs still work, delete 404s

## Running the Scraper

```bash
# Run the full scraper workflow (single command)
node scraper/index.js
```

> **Important**: Scraper does NOT delete jobs from other sources (ANOFM, etc). It only upserts ROPARDO jobs. Existing jobs are preserved.

## Full Workflow (automatic)

When running `node scraper/index.js`, the following steps happen automatically:

1. **Check existing jobs count** - Query Peviitor API by CIF (read-only)
2. **Validate company via ANAF** - Check company exists and is active
3. **Scrape jobs** - Extract jobs from ROPARDO careers page (Romania only)
4. **Transform for API** - Fix locations (only Romanian cities), normalize fields
5. **Upsert to API** - Add/update jobs (API handles duplicates by URL)
6. **Verify URLs** - Delete job URLs that no longer work (404s)
7. **Show Summary** - Log job counts

**Important**: We do NOT delete all existing jobs! We only upsert ROPARDO jobs and delete individual URLs that returned 404. This preserves jobs from other sources (ANOFM, etc).

## Workflow Flowchart

```
scraper/config/company.json (single source of truth: CIF, brand, URLs)
    │
    ▼
scraper/index.js
    │
    ▼
querySOLR(CIF) - check existing jobs
    │
    ▼
company.js (validate company)
    ├── load cache (tmp/company.json)
    │   └── if fresh (<7 days), skip ANAF entirely
    ├── ANAF API ──► get company name + CIF (only if cache stale/missing)
    ├── CUIFirma ──► fallback if ANAF fails
    ├── Peviitor API ──► validate company model
    └── SOLR ──► check existing jobs count
    │
    ▼ (if active)
scrape ROPARDO careers page (jobs for Romania)
    │
    ▼
transformJobsForSOLR()
    ├── Filter: keep only Romanian locations
    ├── Fallback: "România" for unknown
    └── Format: lowercase tags, uppercase company
    │
    ▼
upsertJobs() - API handles duplicate by URL
    │
    ▼
generateJobsMarkdown() → docs/jobs.md
    └── committed to repo by CI → available on GitHub Pages
```

## File Responsibilities

| File | Role |
|------|------|
| `scraper/config/company.json` | **Single source of truth** for company identity (CIF, brand, URLs, API params) |
| `scraper/config/company.js` | ESM wrapper that loads `scraper/config/company.json` for Node code |
| `scraper/config/scraper.js` | ESM wrapper that loads `scraper/config/scraper.json` |
| `scraper/index.js` | Main entry point - full workflow: validate company → scrape → transform → upsert → verify URLs → generate docs/jobs.md |
| `scraper/company.js` | Validates company via ANAF + CUIFirma + Peviitor; caches in `tmp/company.json` (7-day TTL) |
| `scraper/anaf.js` | Multi-source company data module - ANAF (primary) + CUIFirma (MCP fallback + search) |
| `scraper/demoanaf.js` | CLI entry point for anaf.js (thin wrapper) |
| `scraper/api.js` | Peviitor API operations module - query, delete, upsert jobs/companies + standalone commands |
| `scraper/validate-jobs.js` | Manual deep validator (content-aware); thin CLI wrapper over `scraper/job-validator.js` |
| `scraper/job-validator.js` | Shared validation primitives: `validateByHead`, `validateByContent`, `validateByBrowser`, `DEFAULT_EXPIRED_KEYWORDS` |
| `scraper/markdown-generator.js` | Generates `docs/jobs.md` with company info and all scraped jobs |
| `tests/validate-ropardo-jobs.js` | CI fast validator (HEAD by default; --content / --browser modes); thin CLI over `job-validator.js` + Peviitor API |
| `tests/unit/index.test.js` | Unit tests for parseJobs, mapToJobModel, transformJobsForSOLR |
| `tests/unit/company.test.js` | Unit tests for validateAndGetCompany and fallback caching |
| `tests/unit/api.test.js` | Unit tests for api.js - query, upsert, delete, HTTP error handling |
| `tests/unit/demoanaf.test.js` | Unit tests for anaf.js - ANAF search and company retrieval |
| `tests/unit/job-validator.test.js` | Unit tests for job-validator.js |
| `tests/unit/markdown-generator.test.js` | Unit tests for markdown-generator.js |
| `tests/integration/workflow.test.js` | Live integration tests - ANAF + Peviitor API |
| `tests/e2e/scraper.test.js` | End-to-end tests with real ROPARDO portal + ANAF + Peviitor API |
| `tests/consistency/public.test.js` | Verifies repo is public on GitHub |
| `tests/consistency/repo.test.js` | Verifies branch, Pages, workflow files |
| `tests/consistency/topics.test.js` | Verifies required repo topics |
| `tests/consistency/workflow-naming.test.js` | Validates workflow naming conventions |

## API Endpoints

- **DemoANAF Search**: `https://demoanaf.ro/api/search?q=BRAND` - Search companies by name/brand
- **DemoANAF Company**: `https://demoanaf.ro/api/company/:cui` - Get company details by CIF
- **CUIFirma MCP**: `https://cuifirma.ro/mcp/cuifirma` - Company details fallback
- **CUIFirma Search**: `https://cuifirma.ro/api/search?q=BRAND` - Search fallback
- **Peviitor API**: `https://api.peviitor.ro/v1/` — all job and company operations go through this API
- **ROPARDO Careers**: `https://ropardo.ro/careers/` - HTML page scraped with Cheerio
- **ROPARDO Jobs**: `https://jobs.ropardo.ro/job/` - Individual job pages (used for URL validation)

## Rate Limiting & Politeness

The scraper is intentionally slow to be a good citizen:

| Setting | Value | Where |
|---------|-------|-------|
| Request timeout | 10000 ms | `scraper/index.js` — `ANOFM_TIMEOUT` constant |
| ANAF fallback | 1 attempt ANAF → CUIFirma | `scraper/anaf.js` — no retries, just fallback |
| Concurrency | 1 (sequential) | No `Promise.all` for paginated fetches |
| User-Agent | `job_seeker_ro_spider` | Identifies the scraper in server logs |

Derived scrapers should keep these defaults unless the target site explicitly permits otherwise.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_REPOSITORY` | Used by consistency tests — format: `owner/repo` |
| `GITHUB_TOKEN` | GitHub API token for consistency tests |

All Solr access goes through the Peviitor API client — no `SOLR_AUTH` is used anywhere. Never commit `.env.local`.

## Standalone Commands

```bash
# Query jobs in SOLR by CIF
node scraper/api.js <CIF>

# Extract existing jobs from SOLR by CIF
node scraper/api.js extract <CIF>

# Query company in SOLR
node scraper/api.js company <search_term>

# Get company details from ANAF/CUIFirma by CIF
node scraper/demoanaf.js <CIF>

# Search companies in ANAF/CUIFirma by brand
node scraper/demoanaf.js search <brand>

# Validate job URLs from SOLR by CIF (check active/expired)
node scraper/validate-jobs.js <CIF>

# Validate a single job URL
node scraper/validate-jobs.js url <url>

# Delete expired jobs from SOLR by CIF
node scraper/validate-jobs.js <CIF> --delete
```

## Testing

This project requires multiple levels of testing:

1. **Unit Tests** - Test individual modules (api.js, company.js, anaf.js, job-validator.js, markdown-generator.js) in isolation
2. **Integration Tests** - Test API interactions (ANAF, Peviitor) in `/tests/integration` folder
3. **E2E Tests** - Test full workflow in `/tests/e2e` folder

Run tests:
```bash
npm test
```

## Temporary Files

All temporary/scratch files must be placed in `tmp/` inside the project root (never outside the project). The `tmp/` directory is in `.gitignore` and will not be committed.

## Technical Debt / Completed

- [x] Extract demoanaf.js to separate module (#2)
- [x] Write Unit Tests for all modules (#3)
- [x] Write Integration Tests in separate folder (#4)
- [x] Write E2E automated tests in separate folder (#5)
- [ ] Write Unit/Component/E2E tests for index.js
