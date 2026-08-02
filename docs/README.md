# job_seeker_ro_spider — ROPARDO

**job_seeker_ro_spider** — scraper pentru job-urile ROPARDO SRL din România.

Extrage anunțurile de pe portalul ROPARDO și le publică în [peviitor.ro](https://peviitor.ro) prin API-ul Peviitor.

## Identificare

Toate request-urile HTTP folosesc User-Agent-ul:

```
job_seeker_ro_spider
```

## Ce face

1. **Validează compania** — interoghează API-ul public ANAF ([demoanaf.ro](https://demoanaf.ro)) după CIF-ul ROPARDO (5415866) și verifică:
   - Denumirea oficială: ROPARDO SRL
   - Status: activ/inactiv/radiat
   - Adresa completă din registrul comerțului
2. **Cross-validează cu Peviitor** — verifică existența companiei în API-ul Peviitor
3. **Scrape-uiește job-urile** — extrage lista completă de job-uri de pe portalul ROPARDO (https://ropardo.ro/careers/)
4. **Transformă datele** — normalizează locațiile (doar orașe românești), tag-urile (lowercase), workmode-ul (remote/on-site/hybrid)
5. **Stochează în Peviitor** — upsert prin API-ul Peviitor (job-uri și date companie)
6. **Generează docs/jobs.md** — fișier markdown cu informații companie + toate job-urile curente, publicat pe [GitHub Pages](https://sebiboga.github.io/ropardo-srl-nodejs-scraper/jobs.md)

## Structură proiect

```
├── scraper/
│   ├── config/company.json     # Sursa unică de adevăr (CIF, brand, URL-uri, API)
│   ├── config/company.js       # Loader ESM pentru scraper/config/company.json
│   ├── config/scraper.json     # Config scraper (apiBase, careersUrl)
│   ├── index.js                # Orchestrator principal
│   ├── company.js              # Validare companie (ANAF + CUIFirma + Peviitor) cu cache 7 zile
│   ├── anaf.js                 # Modul date companie (ANAF + CUIFirma fallback + search)
│   ├── demoanaf.js             # CLI wrapper pentru anaf.js
│   ├── api.js                  # Operații API Peviitor (query, upsert, delete, company)
│   ├── job-validator.js        # Primitivă comună: validateByHead, validateByContent, validateByBrowser
│   ├── validate-jobs.js        # Validator deep manual (content-aware)
│   └── markdown-generator.js   # Generează docs/jobs.md după scrape
├── ROBOTS.md                   # Analiză robots.txt și politici de scraping
├── tests/
│   ├── unit/          # Teste unitare
│   ├── integration/   # Teste de integrare (ANAF + Peviitor live)
│   ├── e2e/           # Teste end-to-end (pipelin complet)
│   └── consistency/   # Teste consistență repo GitHub
└── .github/workflows/
    ├── job-seeker-ro-spider.yml     # Rulează zilnic la 6 AM UTC
    ├── automation-testing.yml       # Teste automate la fiecare push/PR
    ├── job-deep-validate.yml        # Validare deep manuală (Playwright)
    └── job-recovery-from-disaster.yml # Recuperare job-uri din docs/jobs.md
```

## API-uri folosite

| API | URL | Autentificare |
|-----|-----|--------------|
| ROPARDO | https://ropardo.ro/careers/ | Public |
| ANAF (demoanaf) | `https://demoanaf.ro/api/...` | Public |
| CUIFirma | `https://cuifirma.ro/api/...` | Public |
| Peviitor | `https://api.peviitor.ro/v1/` | Public |

Toate operațiile SOLR trec prin API-ul Peviitor — nu se folosește acces direct la SOLR.

## Testare

```bash
# Toate testele
npm test

# Doar unitare
npm run test:unit

# Doar integrare (necesită ANAF live, Peviitor API conditional)
npm run test:integration

# Doar E2E (portal real ROPARDO + ANAF + Peviitor)
npm run test:e2e
```
