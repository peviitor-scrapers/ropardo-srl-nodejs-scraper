# AGENTS.md — Rules for AI agents

## Project
ROPARDO scraper for peviitor.ro (Node.js, ESM, Jest)

## 🌱 This Repo Is a Derived Scraper
This repo is **derived from** the [epam-systems-international-srl-nodejs-scraper](https://github.com/sebiboga/epam-systems-international-srl-nodejs-scraper) template.

When making changes to this derived scraper:
- **All company-specific identity lives in `scraper/config/company.json`** (id, brand, company, URLs, location). Read from `scraper/config/company.js` in Node code, or via `jq` in workflows. Never hardcode in source files.
- **Only the API parsing logic in `scraper/index.js`** (`fetchJobsPage`, `parseApiJobs`) is ROPARDO-specific. The output shape (`mapToJobModel`, `transformJobsForSOLR`) must stay uniform across derived scrapers.

## Directory Structure
```
scraper/           — scraper source files (moved from root)
├── config/        — company.json, company.js (company identity)
├── index.js       — main scraper orchestrator
├── api.js         — API client
├── company.js     — company data fetcher
├── anaf.js        — ANAF library
├── job-validator.js — shared job validation
└── markdown-generator.js — generates docs/jobs.md
tests/             — test files
.github/workflows/ — CI workflows
ai/                — documentation for AI agents
docs/              — GitHub Pages content (jobs.md, test-results)
```

## Critical Rules

### 0. Background tasks — always pass `--repo` explicitly to `gh`

When polling a workflow run with `until [ "$(gh run view ID --json status -q .status)" = "completed" ]; do sleep N; done`, the `gh run view` command implicitly uses the current working directory's git remote. If the CWD is a different repo (e.g. you cd-ed elsewhere mid-task), `gh` looks in the wrong repo and returns 404 — the loop's check becomes `"" != "completed"` (always true) and the background task sleeps forever.

**Always specify the repo explicitly:**
```bash
gh run view <RUN_ID> --repo sebiboga/<derived-repo>-nodejs-scraper --json status -q .status
```

Before starting any `gh run watch` or polling loop in the background, sanity-check:
- Does the command include `--repo`?
- Is the run ID from the same repo as `--repo`?

If you spawn a stuck task, kill it immediately rather than letting it hang.

### 1. Temporary Files
All temporary/scratch files MUST go in `tmp/` inside the project root.
NEVER use paths outside the project (e.g. `C:\Users\...\AppData\Local\Temp\opencode`).

### 2. Issues & GitHub
- **Orice modificare de cod trebuie să aibă un issue în GitHub Issues** (vezi [ISSUES.md](ISSUES.md))
- Excepții: typo-uri, whitespace, documentație minoră
- Create a GitHub issue before implementing any change
- Commit messages must reference the issue they close
- Never commit credentials (`.env.local`, `*.pem`, etc.)
- Push after commit

### 3. Environment Variables
- `.env.local` is loaded automatically at runtime via `dotenv` (see `package.json`) — never commit it
- Solr access now uses the peviitor API (no direct SOLR_AUTH needed for most operations)
- Only `ensure-company-core` and `validate-jobs` workflow steps still use `SOLR_AUTH` for direct curl access
- Consistency tests need `GITHUB_REPOSITORY` (format: `owner/repo`) and `GITHUB_TOKEN`

### 4. Testing
```bash
# All tests
npm test

# Unit tests (no env vars needed)
npm run test:unit

# Integration tests (ANAF public API)
npm run test:integration

# E2E tests (real ROPARDO API)
npm run test:e2e

# Consistency tests (GitHub repo config — needs GITHUB_REPOSITORY + GITHUB_TOKEN)
npm run test:consistency
```

### 5. ESM + Jest
- Use `jest.unstable_mockModule` (NOT `jest.mock`) for mocking ESM modules
- Run with `--experimental-vm-modules` flag

### 6. Verification
- După orice modificare, urmează [VERIFY.md](VERIFY.md) pas cu pas
- Ultimul pas = rulează scraperul prin GitHub Actions, verifică job-urile prin API, și verifică că `docs/jobs.md` a fost generat și este accesibil pe GitHub Pages
- Toate workflow-urile din `.github/workflows/` trebuie să treacă înainte de merge

### 7. Module Structure
- `scraper/config/company.json` + `scraper/config/company.js` — single source of truth for company identity
- `scraper/anaf.js` — core ANAF library (imported by company.js); retry logic: 3 retries, 2s exponential backoff
- `scraper/markdown-generator.js` — generates `docs/jobs.md` after each scrape; called from index.js
- `scraper/job-validator.js` — shared `validateByHead` + `validateByContent` used by both validator CLIs
- `scraper/index.js` — main scraper orchestrator
- `scraper/api.js` — API client
- `scraper/anaf.js` — ANAF + CUIFirma fallback (company data operations)
- `scraper/demoanaf.js` — CLI entry point for anaf.js
- `tests/validate-ropardo-jobs.js` — CI validator (API-based, no direct SOLR_AUTH)
- `validate-jobs.js` — manual deep validator (content-aware)

### 8. Caching Behavior
- `tmp/company.json` — per-run scratch cache (gitignored)
- `docs/company.json` is regenerated on every scrape so GitHub Pages can read company identity

### 9. Company Core Schema (Solr)
Fields in company core (id = CIF):
| Field | Type | MultiValued | Notes |
|-------|------|:-----------:|-------|
| `company` | `string` | no | Legal name |
| `brand` | `string` | no | UPPERCASE |
| `status` | `string` | no | `activ` / `inactiv` |
| `location` | `text_general` | yes | Array |
| `website` | `string` | yes | Array of URLs |
| `career` | `string` | yes | Array of URLs |
| `lastScraped` | `string` | no | `YYYY-MM-DD` |
| `scraperFile` | `string` | no | GitHub workflow ref |
