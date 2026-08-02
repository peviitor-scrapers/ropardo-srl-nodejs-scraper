import { jest } from '@jest/globals';
import fetch from 'node-fetch';
import { normalizeTitle, normalizeLocation, normalizeRemote, normalizeWorkmode, parseJobs, fetchJobs } from '../../scraper/index.js';
import { searchCompany, getCompanyFromANAF } from '../../scraper/anaf.js';
import { validateAndGetCompany } from '../../scraper/company.js';
import { querySOLR, getCompanyByCif } from '../../scraper/api.js';

const API_BASE = 'https://api.peviitor.ro/v1';
const TEST_CIF = '5415866';
const TEST_BRAND = 'ROPARDO';
const CAREERS_URL = 'https://ropardo.ro/careers/';

let HAS_API = false;

async function checkApiAvailability() {
  try {
    const res = await fetch(`${API_BASE}/scraper/jobs/?cif=${TEST_CIF}&rows=1`, {
      signal: AbortSignal.timeout(5000)
    });
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

let HAS_ANAF = false;

async function checkAnafAvailability() {
  try {
    const res = await fetch('https://demoanaf.ro/api/search?q=test', {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

function itIfApi(name, fn, timeout) {
  if (HAS_API) {
    return it(name, fn, timeout);
  }
  return it.skip(`${name} (skipped: API unavailable)`, fn, timeout);
}

function itIfAnaf(name, fn, timeout) {
  if (HAS_ANAF) {
    return it(name, fn, timeout);
  }
  return it.skip(`${name} (skipped: ANAF API unavailable)`, fn, timeout);
}

beforeAll(async () => {
  [HAS_API, HAS_ANAF] = await Promise.all([checkApiAvailability(), checkAnafAvailability()]);
});

describe('E2E: Full Scraping Pipeline', () => {

  describe('Fetch Real Data', () => {
    let rawJobs;

    beforeAll(async () => {
      rawJobs = await fetchJobs();
    }, 30000);

    it('should scrape jobs from careers page', () => {
      expect(Array.isArray(rawJobs)).toBe(true);
      expect(rawJobs.length).toBeGreaterThan(0);
    });

    it('should have jobs with title and applyUrl', () => {
      const job = rawJobs[0];
      expect(job).toHaveProperty('title');
      expect(typeof job.title).toBe('string');
      expect(job.title.length).toBeGreaterThan(0);
      expect(job).toHaveProperty('applyUrl');
      expect(job.applyUrl).toMatch(/^https?:\/\//);
    });
  });

  describe('Parse + Transform Pipeline', () => {
    let rawJobs;

    beforeAll(async () => {
      rawJobs = await fetchJobs();
    }, 30000);

    it('should fetch jobs from API', () => {
      expect(Array.isArray(rawJobs)).toBe(true);
      expect(rawJobs.length).toBeGreaterThan(0);
    });

    it('should parse raw jobs into normalized format', () => {
      const parsed = parseJobs(rawJobs);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);

      const job = parsed[0];
      expect(job).toHaveProperty('url');
      expect(job.url).toMatch(/^https?:\/\//);
      expect(job).toHaveProperty('title');
      expect(typeof job.title).toBe('string');
      expect(job.title.length).toBeGreaterThan(0);
      expect(job).toHaveProperty('workmode');
      expect(['remote', 'on-site', 'hybrid']).toContain(job.workmode);
      expect(job).toHaveProperty('location');
      expect(Array.isArray(job.location)).toBe(true);
    });

    it('should normalize titles by collapsing whitespace', () => {
      expect(normalizeTitle('  Senior   Developer  ')).toBe('Senior Developer');
      expect(normalizeTitle(null)).toBe('');
      expect(normalizeTitle('')).toBe('');
    });

    it('should normalize locations to array', () => {
      expect(normalizeLocation('Sibiu')).toEqual(['Sibiu']);
      expect(normalizeLocation('Sibiu, Romania')).toEqual(['Sibiu']);
      expect(normalizeLocation('remote')).toEqual([]);
      expect(normalizeLocation(null)).toEqual([]);
    });

    it('should normalize remote flag', () => {
      expect(normalizeRemote('remote')).toBe(true);
      expect(normalizeRemote('Remote')).toBe(true);
      expect(normalizeRemote('on-site')).toBe(false);
      expect(normalizeRemote(null)).toBe(false);
    });

    it('should normalize workmode', () => {
      expect(normalizeWorkmode('remote')).toBe('remote');
      expect(normalizeWorkmode('on-site')).toBe('on-site');
      expect(normalizeWorkmode('on site')).toBe('on-site');
      expect(normalizeWorkmode('hybrid')).toBe('hybrid');
      expect(normalizeWorkmode(null)).toBe('on-site');
    });

    it('should produce valid job URLs', async () => {
      const parsed = parseJobs(rawJobs);

      for (const job of parsed.slice(0, 2)) {
        const res = await fetch(job.url, {
          method: 'HEAD',
          headers: { 'User-Agent': 'job_seeker_ro_spider' }
        });
        expect(res.ok).toBe(true);
      }
    }, 30000);
  });

  describe('Company Validation', () => {
    it('should find ROPARDO in company search', async () => {
      const results = await searchCompany(TEST_BRAND);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      const ropardo = results.find(c =>
        (c.name || '').toUpperCase().startsWith(TEST_BRAND) ||
        (c.cui || '').toString() === TEST_CIF
      );
      expect(ropardo).toBeDefined();
    }, 30000);

    it('should return empty array for non-existent brand', async () => {
      const results = await searchCompany('ThisBrandDoesNotExistXYZ123');
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    }, 15000);

    it('should fetch company details by valid CIF from ANAF', async () => {
      const data = await getCompanyFromANAF(TEST_CIF);

      expect(data).toBeDefined();
      expect(data.cui).toBe(5415866);
      expect(data.name).toBe('ROPARDO SRL');
      expect(data).toHaveProperty('inactive', false);
    }, 30000);

    it('should throw for invalid CIF', async () => {
      await expect(getCompanyFromANAF('00000000')).rejects.toThrow();
    }, 60000);
  });

  describe('Peviitor API', () => {
    it('should run full validation and report active status', async () => {
      const result = await validateAndGetCompany();

      expect(result.status).toBe('active');
      expect(result.company).toBe('ROPARDO SRL');
      expect(result.cif).toBe(TEST_CIF);
    }, 30000);
  });

  describe('API Data Verification', () => {
    itIfApi('should query jobs by CIF and return valid data', async () => {
      const result = await querySOLR(TEST_CIF);

      if (result.numFound === 0) {
        console.log('No ROPARDO jobs in Solr — skipping job field assertions');
        return;
      }

      expect(result.numFound).toBeGreaterThan(0);
      expect(Array.isArray(result.docs)).toBe(true);

      const job = result.docs[0];
      expect(job).toHaveProperty('url');
      expect(job).toHaveProperty('title');
      expect(job).toHaveProperty('company', 'ROPARDO SRL');
      expect(job).toHaveProperty('cif', TEST_CIF);
      expect(job).toHaveProperty('status');
      expect(job).toHaveProperty('location');
    }, 15000);

    itIfApi('should query company core by CIF', async () => {
      const result = await getCompanyByCif(TEST_CIF);

      expect(result).toBeDefined();
      expect(result.id).toBe(TEST_CIF);
      expect(result.company).toBe('ROPARDO SRL');
      expect(result.status).toBe('activ');
      expect(Array.isArray(result.location)).toBe(true);
      expect(result.lastScraped).toMatch(/^\d{4}-\d{2}-\d{2}/);
    }, 15000);
  });
});
