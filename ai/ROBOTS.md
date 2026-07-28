# Robots.txt Analysis — ROPARDO

Sursa: https://jobs.ropardo.ro/robots.txt

## Diferență față de EPAM template

Template-ul EPAM are reguli stricte (Disallow `/api/*`, `/*/vacancy/*`). ROPARDO poate avea reguli diferite — analizează robots.txt înainte de a scraper-ui.

## Recomandare

robots.txt NU este legal binding, dar reprezintă intenția proprietarului site-ului.

Scraperul respectă aceleași principii ca template-ul: rate limiting, User-Agent identificabil (`job_seeker_ro_spider`), o singură cerere simultană.
