# job_seeker_ro_spider — ROPARDO Romania Scraper

[![Oportunitati SI Cariere](https://github.com/sebiboga/ropardo-srl-nodejs-scraper/actions/workflows/job-seeker-ro-spider.yml/badge.svg)](https://github.com/sebiboga/ropardo-srl-nodejs-scraper/actions/workflows/job-seeker-ro-spider.yml)
[![Automation Tests](https://github.com/sebiboga/ropardo-srl-nodejs-scraper/actions/workflows/automation-testing.yml/badge.svg)](https://github.com/sebiboga/ropardo-srl-nodejs-scraper/actions/workflows/automation-testing.yml)

[![Version](https://img.shields.io/github/package-json/v/sebiboga/ropardo-srl-nodejs-scraper?label=version&color=blue)](CHANGELOG.md)
[![Test Results](https://img.shields.io/badge/test--results-HTML-9b59b6)](https://sebiboga.github.io/ropardo-srl-nodejs-scraper/test-results/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![JavaScript](https://img.shields.io/badge/javascript-ESM-F7DF1E?logo=javascript&logoColor=black)](https://ecma-international.org/)
[![Node.js](https://img.shields.io/badge/node-24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Website](https://img.shields.io/website?url=https%3A%2F%2Fpeviitor.ro&label=peviitor.ro)](https://peviitor.ro)
[![API](https://img.shields.io/website?url=https%3A%2F%2Fapi.peviitor.ro%2F&label=api.peviitor.ro)](https://api.peviitor.ro/)
[![SOLR](https://img.shields.io/website?url=https%3A%2F%2Fsolr.peviitor.ro%2Fsolr%2F&label=solr.peviitor.ro)](https://solr.peviitor.ro/solr/)
[![GitHub Pages](https://img.shields.io/github/deployments/sebiboga/ropardo-srl-nodejs-scraper/github-pages?label=GitHub%20Pages)](https://sebiboga.github.io/ropardo-srl-nodejs-scraper/)

**job_seeker_ro_spider** — un scraper pentru job-urile ROPARDO SRL din România. Extrage anunțurile de pe [ROPARDO Jobs](https://jobs.ropardo.ro/) și le publică în [peviitor.ro](https://peviitor.ro) prin API-ul SOLR.

> **🌱 Derivat din [job_seeker_ro_spider](https://github.com/sebiboga/epam-systems-international-srl-nodejs-scraper) (template).** Pentru pattern-ul complet de derivare, vezi [CONTRIBUTING.md](CONTRIBUTING.md) din template.

## Overview

Proiectul automatizează colectarea zilnică a job-urilor ROPARDO din România, menținând board-ul peviitor.ro la zi cu cele mai recente oportunități de carieră.

## Features

- Extrage job-uri de pe [jobs.ropardo.ro](https://jobs.ropardo.ro/)
- Validează compania via ANAF (CUI, status activ/inactiv, adresă completă)
- **Cache ANAF la 7 zile** — committed în repo, nu lovește demoANAF la fiecare scrape
- **Fallback la cache stale** dacă ANAF e indisponibil
- Cross-validează cu Peviitor API
- Stochează în SOLR (job core + company core)
- Generează `docs/jobs.md` automat — accesibil pe GitHub Pages
- **Identitate companie într-un singur fișier** (`config/company.json`) — derivare ușoară pentru alte companii
- GitHub Actions: scrape zilnic + testare automată (unit, integration, e2e, consistency)
- Teste SOLR condiționale — auto-skip când `SOLR_AUTH` nu e setat
- Se identifică prin User-Agent: `job_seeker_ro_spider`

## Project Structure

```
├── index.js                    # Main scraper entry point
├── company.js                  # Company validation via ANAF + Peviitor + SOLR
├── demoanaf.js                 # CLI wrapper for src/anaf.js
├── solr.js                     # SOLR operations (query, upsert, delete, company)
├── validate-jobs.js            # Job URL validator — checks active/expired, deletes stale jobs
├── config/
│   ├── company.json            # Single source of truth: CIF, brand, URLs, API params
│   └── company.js              # ESM loader for company.json
├── src/
│   ├── anaf.js                 # ANAF API core module (search + company details)
│   ├── markdown-generator.js   # Generates docs/jobs.md from scraped data
│   └── job-validator.js        # Shared validateByHead + validateByContent
├── company.json                # ANAF data cache (committed, 7-day TTL)
├── tests/
│   ├── package.json            # Jest config for test suite
│   ├── company.json            # Mock ANAF data used in unit tests
│   ├── validate-ropardo-jobs.js   # SOLR job URL validation script
│   ├── unit/
│   │   ├── index.test.js       # Tests for parseApiJobs/parseHtmlJobs, mapToJobModel, transformJobsForSOLR
│   │   ├── company.test.js     # Tests for validateAndGetCompany, fallback caching
│   │   ├── solr.test.js        # Tests for query, upsert, delete operations
│   │   └── demoanaf.test.js    # Tests for ANAF search and company retrieval
│   ├── integration/
│   │   └── workflow.test.js    # Live ANAF + SOLR integration tests
│   ├── e2e/
│   │   └── scraper.test.js     # Full pipeline tests with real ROPARDO API
│   └── consistency/
│       ├── public.test.js      # Verifies repo is public
│       ├── repo.test.js        # Verifies branch, Pages, secrets, workflows
│       ├── topics.test.js      # Verifies required repo topics
│       └── workflow-naming.test.js  # Validates workflow naming conventions
├── docs/
│   ├── index.html              # Live job board (GitHub Pages)
│   ├── jobs.md                 # Scraped jobs in markdown (generated by CI)
│   ├── README.md
│   └── test-results/           # Test reports (generated by CI)
│       ├── index.html
│       ├── pre-scrape-unit.html
│       ├── pre-scrape-integration.html
│       ├── post-scrape.html
│       └── post-scrape-consistency.html
├── .github/
│   ├── CODEOWNERS
│   └── workflows/
│       ├── job-seeker-ro-spider.yml     # Daily scraping at 6 AM UTC
│       └── automation-testing.yml       # Automation Tests on push/PR
└── package.json
```

## Setup

### Prerequisites

- Node.js 24+
- npm

### Installation

```bash
npm install
```

### Configuration

Set the `SOLR_AUTH` environment variable with your Solr credentials:

```bash
export SOLR_AUTH="username:password"
```

## Usage

### Run the Scraper

```bash
npm run scrape
```

### Run Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e
```

## Workflows

### Daily Scraping

The `job-seeker-ro-spider.yml` workflow runs daily at 6 AM UTC via GitHub Actions. It:
1. Runs pre-scrape tests (unit + integration)
2. Validates company data via ANAF
3. Scrapes current job listings from ROPARDO careers
4. Updates Solr with new/removed jobs
5. Runs post-scrape tests (e2e + consistency)
6. Uploads test results and job data as artifacts
7. Generates [`docs/jobs.md`](https://sebiboga.github.io/ropardo-srl-nodejs-scraper/jobs.md) with company info and all scraped jobs
8. Pushes test reports and `docs/jobs.md` to [`docs/`](https://sebiboga.github.io/ropardo-srl-nodejs-scraper/)

### Test Automation

The `automation-testing.yml` workflow runs on every push and pull request. It:
1. Ensures ROPARDO exists in the company core
2. Runs unit, integration, e2e, and consistency tests
3. Validates data integrity in Solr
4. Pushes test reports to [`docs/test-results/`](https://sebiboga.github.io/ropardo-srl-nodejs-scraper/test-results/)

## 📐 Acest Repo Este Un Derivat

Acest scraper este **derivat din** [job_seeker_ro_spider](https://github.com/sebiboga/epam-systems-international-srl-nodejs-scraper) — template-ul de referință pentru scraper-ele Node.js din ecosistemul peviitor.ro.

A fost creat folosind feature-ul "Use this template" de pe GitHub, păstrând întreaga structură, workflow-uri și layere de testare.

## Acknowledgments

This project was developed with assistance from **[Claude Code](https://claude.ai/code)** by Anthropic.

Special thanks to the open source community and the peviitor.ro team for their support.

## License

Copyright (c) 2024-2026 BOGA SEBASTIAN-NICOLAE

Licensed under the [MIT License](LICENSE).

## Managed By

This project is managed by [ASOCIATIA OPORTUNITATI SI CARIERE](https://oportunitatisicariere.ro) and used as a web scraper for the [peviitor.ro](https://peviitor.ro) job board project.

## Robots.txt Policy

Acest scraper respectă regulile din [robots.txt](https://jobs.ropardo.ro/robots.txt) al ROPARDO. Pentru analiza completă, vezi [ROBOTS.md](ROBOTS.md).

## Disclaimer

This scraper is designed for educational purposes and legitimate job data aggregation for the Romanian job market. Please respect ROPARDO's Terms of Service and robots.txt when using this scraper.
