# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-20

### Added
- Initial release — derived from [epam-systems-international-srl-nodejs-scraper](https://github.com/sebiboga/epam-systems-international-srl-nodejs-scraper)
- Job scraping from ROPARDO careers portal (https://ropardo.ro/careers/)
- Company validation via ANAF (CIF: 5415866)
- GitHub Actions workflows for daily scraping and testing
- Comprehensive test suite (unit, integration, E2E, consistency)
- Romanian location filtering
- Work mode normalization

### Changed
- Restructured to `scraper/` layout matching the EPAM template: `index.js`, `api.js`, `company.js`, `anaf.js`, `demoanaf.js`, `job-validator.js`, `validate-jobs.js`, `markdown-generator.js` + `config/`
- All Solr operations go through the Peviitor API (`scraper/api.js`) — no direct Solr access, no `SOLR_AUTH`
- Company identity lives in `scraper/config/company.json` (single source of truth); `scraperFile` is the GitHub Actions workflow URL (no raw)
- ANAF company data module (`scraper/anaf.js`): ANAF primary + CUIFirma fallback (MCP + search)
- `scraper/job-validator.js`: `validateByHead`, `validateByContent`, `validateByBrowser` (Playwright headless Chromium, catches JS-rendered 404s)
- `tests/validate-ropardo-jobs.js`: multi-mode validator (`--head`, `--content`, `--browser`, `--delete`)
- `scraper/markdown-generator.js`: generates `docs/jobs.md` with escaped markdown
- New workflows: `job-deep-validate.yml` (manual Playwright deep validation), `job-recovery-from-disaster.yml` (re-upload jobs from `docs/jobs.md`), `automation-template-sync-check.yml` (weekly template sync check)
- `package.json`: added `cheerio` dependency and `playwright` devDependency
- Docs updated to match post-refactor state (`ai/`, `docs/`, README)

## License

Copyright (c) 2024-2026 BOGA SEBASTIAN-NICOLAE
Licensed under MIT License
