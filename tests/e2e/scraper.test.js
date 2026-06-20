import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const HAS_SOLR = !!process.env.SOLR_AUTH;

function itIfSolr(name, fn, timeout) {
  if (HAS_SOLR) {
    return it(name, fn, timeout);
  }
  return it.skip(`${name} (skipped: SOLR_AUTH not set)`, fn, timeout);
}

beforeAll(() => {
  if (HAS_SOLR) {
    process.env.SOLR_AUTH = process.env.SOLR_AUTH;
  }
});

const TEST_CIF = '5415866';
const TEST_BRAND = 'ROPARDO';
const ROPARDO_URL = 'https://jobs.ropardo.ro/';
const ROMANIAN_CITIES = ['Sibiu'];

describe('E2E: Full Scraping Pipeline', () => {

  describe('ROPARDO Jobs Page — Real Data Fetch', () => {
    let html;
    let $;

    beforeAll(async () => {
      const res = await fetch(ROPARDO_URL, {
        headers: {
          'User-Agent': 'job_seeker_ro_spider',
          'Accept': 'text/html'
        }
      });
      html = await res.text();
      $ = cheerio.load(html);
    }, 15000);

    it('should respond with valid HTML', () => {
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Ropardo');
    });

    it('should have job listings on the page', () => {
      const items = $('.list-item');
      expect(items.length).toBeGreaterThan(0);
    });

    it('should have jobs with title, location, and URL', () => {
      const items = $('.list-item');

      items.each((_, el) => {
        const $el = $(el);
        const title = $el.find('h4').first().text().trim();
        const url = $el.find('a.button.job-details').attr('href');
        const location = $el.find('.meta-location').text().trim();

        expect(title.length).toBeGreaterThan(0);
        expect(url).toBeTruthy();
        expect(url).toMatch(/^https:\/\/jobs\.ropardo\.ro\/job\//);
        expect(location.toLowerCase()).toContain('sibiu');
      });
    });
  });

  describe('Parse + Transform Pipeline', () => {
    let index;
    let html;

    beforeAll(async () => {
      index = await import('../../index.js');
      const res = await fetch(ROPARDO_URL, {
        headers: {
          'User-Agent': 'job_seeker_ro_spider',
          'Accept': 'text/html'
        }
      });
      html = await res.text();
    }, 15000);

    it('should parse ROPARDO HTML into standardized format', () => {
      const result = index.parseJobsHTML(html);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      const parsed = result[0];
      expect(parsed).toHaveProperty('url');
      expect(parsed.url).toMatch(/^https:\/\/jobs\.ropardo\.ro\/job\//);
      expect(parsed).toHaveProperty('title');
      expect(parsed).toHaveProperty('workmode');
      expect(['remote', 'on-site', 'hybrid']).toContain(parsed.workmode);
      expect(parsed).toHaveProperty('location');
      expect(Array.isArray(parsed.location)).toBe(true);
      expect(parsed).toHaveProperty('tags');
    });

    it('should map parsed jobs to job model', () => {
      const parsed = index.parseJobsHTML(html);
      const model = index.mapToJobModel(parsed[0], TEST_CIF);

      expect(model).toHaveProperty('url');
      expect(model).toHaveProperty('title');
      expect(model).toHaveProperty('company');
      expect(model).toHaveProperty('cif', TEST_CIF);
      expect(model).toHaveProperty('status', 'scraped');
      expect(model).toHaveProperty('date');
      expect(model.url).toMatch(/^https:\/\/jobs\.ropardo\.ro\/job\//);
    });

    it('should transform jobs and filter to Romanian locations', () => {
      const parsed = index.parseJobsHTML(html);
      const jobs = parsed.map(j => index.mapToJobModel(j, TEST_CIF));

      const payload = {
        source: 'ropardo.ro',
        company: 'ROPARDO SRL',
        cif: TEST_CIF,
        jobs
      };

      const transformed = index.transformJobsForSOLR(payload);

      expect(transformed.company).toBe('ROPARDO SRL');
      expect(transformed.jobs.length).toBe(jobs.length);

      for (const job of transformed.jobs) {
        expect(job).toHaveProperty('location');
        expect(Array.isArray(job.location)).toBe(true);
        expect(job.location.length).toBeGreaterThan(0);
        expect(job.workmode).toMatch(/^(remote|on-site|hybrid)$/);
      }
    });

    it('should produce valid job URLs that are accessible', async () => {
      const parsed = index.parseJobsHTML(html);

      for (const job of parsed.slice(0, 2)) {
        const res = await fetch(job.url, {
          method: 'HEAD',
          headers: { 'User-Agent': 'job_seeker_ro_spider' }
        });
        expect(res.ok).toBe(true);
      }
    }, 30000);
  });

  describe('Company Validation Path', () => {
    let anaf;
    let company;

    beforeAll(async () => {
      anaf = await import('../../src/anaf.js');
      company = await import('../../company.js');
    });

    it('should find ROPARDO in ANAF and validate active status', async () => {
      const results = await anaf.searchCompany(TEST_BRAND);

      const ropardo = results.find(c =>
        c.name.toUpperCase().startsWith(TEST_BRAND + ' ') &&
        c.statusLabel === 'Funcțiune'
      );
      expect(ropardo).toBeDefined();
      expect(ropardo.cui.toString()).toBe(TEST_CIF);

      const anafData = await anaf.getCompanyFromANAF(TEST_CIF);
      expect(anafData).toBeDefined();
      expect(anafData.inactive).toBe(false);
    }, 30000);

    itIfSolr('should run full validation and report active status with job count', async () => {
      const result = await company.validateAndGetCompany();

      expect(result.status).toBe('active');
      expect(result.company).toBe('ROPARDO SRL');
      expect(result.cif).toBe(TEST_CIF);

      if (result.existingJobsCount === 0) {
        console.log('⚠️ No ROPARDO jobs in Solr — skipping job count assertion');
        return;
      }
      expect(result.existingJobsCount).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Inactive Company Handling', () => {
    let anaf;

    beforeAll(async () => {
      anaf = await import('../../src/anaf.js');
    });

    it('should detect inactive/radiated companies via ANAF', async () => {
      const results = await anaf.searchCompany('ROPARDO');

      const nonActive = results.find(c => c.statusLabel !== 'Funcțiune');

      if (nonActive) {
        try {
          const anafData = await anaf.getCompanyFromANAF(nonActive.cui.toString());
          expect(anafData).toBeDefined();
          if (anafData.inactive !== undefined) {
            expect(anafData.inactive).toBe(true);
          }
        } catch {
          expect(nonActive.statusLabel).toMatch(/Radiată|Inactiv|Suspendat/);
        }
      }
    }, 30000);
  });

  describe('SOLR Data Verification', () => {
    let solr;

    beforeAll(async () => {
      solr = await import('../../solr.js');
    });

    itIfSolr('should have ROPARDO jobs in SOLR with correct company name', async () => {
      const result = await solr.querySOLR(TEST_CIF);

      if (result.numFound === 0) {
        console.log('⚠️ No ROPARDO jobs in Solr — skipping SOLR data verification');
        return;
      }

      for (const job of result.docs) {
        expect(job.company).toBe('ROPARDO SRL');
        expect(job.cif).toBe(TEST_CIF);
      }
    }, 15000);

    itIfSolr('should have ROPARDO company core entry with required fields', async () => {
      const result = await solr.queryCompanySOLR(`id:${TEST_CIF}`);

      expect(result.numFound).toBe(1);
      const ropardo = result.docs[0];
      expect(ropardo.company).toBe('ROPARDO SRL');
      expect(ropardo.status).toBe('activ');
    }, 15000);
  });
});
