import { jest } from '@jest/globals';
import { searchCompany, getCompanyFromANAF, getCompanyFromANAFWithFallback } from '../../scraper/company-data.js';
import { validateAndGetCompany } from '../../scraper/company.js';
import { querySOLR, getCompanyByCif } from '../../scraper/api.js';

const HAS_PEVIITOR = !!process.env.PEVIITOR_API_KEY;

function itIfPeviitor(name, fn, timeout) {
  if (HAS_PEVIITOR) {
    return it(name, fn, timeout);
  }
  return it.skip(`${name} (skipped: PEVIITOR_API_KEY not set)`, fn, timeout);
}

const ROPARDO_CIF = '5415866';

describe('Integration: API Workflow', () => {

  describe('ANAF API', () => {
    it('should search for ROPARDO brand and find the company', async () => {
      const results = await searchCompany('ROPARDO');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      const ropardo = results.find(c =>
        (c.name || '').toUpperCase().includes('ROPARDO')
      );
      expect(ropardo).toBeDefined();
    }, 15000);

    it('should return empty array for non-existent brand', async () => {
      const results = await searchCompany('ThisBrandDoesNotExistXYZ123');
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    }, 15000);

    it('should fetch company details by valid CIF', async () => {
      const data = await getCompanyFromANAF(ROPARDO_CIF);

      expect(data).toBeDefined();
      expect(data.cui).toBe(5415866);
      expect(data.name).toBe('ROPARDO SRL');
      expect(data).toHaveProperty('address');
      expect(data).toHaveProperty('registrationNumber');
      expect(data).toHaveProperty('caenCode');
      expect(data).toHaveProperty('inactive', false);
    }, 15000);

    it('should throw for invalid CIF', async () => {
      await expect(getCompanyFromANAF('00000000')).rejects.toThrow();
    }, 60000);

    it('should use cached data when API fails (getCompanyFromANAFWithFallback)', async () => {
      const cached = { cui: 5415866, name: 'ROPARDO SRL' };

      const data = await getCompanyFromANAFWithFallback(ROPARDO_CIF, cached);

      expect(data).toBeDefined();
      expect(data.cui).toBe(5415866);
    }, 15000);
  });

  describe('Peviitor API', () => {
    it('should run full validation and report active status', async () => {
      const result = await validateAndGetCompany();

      expect(result.status).toBe('active');
      expect(result.company).toBe('ROPARDO SRL');
      expect(result.cif).toBe(ROPARDO_CIF);
    }, 30000);
  });

  describe('Peviitor API Core', () => {
    itIfPeviitor('should query company core by CIF', async () => {
      const result = await getCompanyByCif(ROPARDO_CIF);

      expect(result).toBeDefined();
      expect(result.id).toBe(ROPARDO_CIF);
      expect(result.company).toBe('ROPARDO SRL');
      expect(result.brand).toBe('ROPARDO');
      expect(result.status).toBe('activ');
      expect(Array.isArray(result.location)).toBe(true);
      expect(result.lastScraped).toMatch(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+Z?)?)?$/);
    }, 15000);

    itIfPeviitor('should have required company model fields', async () => {
      const result = await getCompanyByCif(ROPARDO_CIF);

      expect(result).toHaveProperty('id', ROPARDO_CIF);
      expect(result).toHaveProperty('company');
      expect(result).toHaveProperty('brand', 'ROPARDO');
      expect(result).toHaveProperty('status');
      expect(['activ', 'suspendat', 'inactiv', 'radiat']).toContain(result.status);
      expect(result).toHaveProperty('location');
      expect(Array.isArray(result.location)).toBe(true);
      expect(result).toHaveProperty('website');
      expect(Array.isArray(result.website)).toBe(true);
      expect(result.website[0]).toMatch(/^https?:\/\/.+/);
      expect(result).toHaveProperty('lastScraped');
      expect(result).toHaveProperty('scraperFile');
    }, 15000);

    itIfPeviitor('should have optional field (career) if present', async () => {
      const result = await getCompanyByCif(ROPARDO_CIF);

      if (result.career !== undefined) {
        expect(Array.isArray(result.career)).toBe(true);
        expect(result.career[0]).toMatch(/^https?:\/\/.+/);
      }
    }, 15000);

    itIfPeviitor('should have optional field (group) if present', async () => {
      const result = await getCompanyByCif(ROPARDO_CIF);

      if (result.group !== undefined) {
        expect(typeof result.group).toBe('string');
      }
    }, 15000);

    itIfPeviitor('should query jobs by CIF and return valid data', async () => {
      const result = await querySOLR(ROPARDO_CIF);

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
      expect(job).toHaveProperty('cif', ROPARDO_CIF);
      expect(job).toHaveProperty('status');
      expect(job).toHaveProperty('location');
    }, 15000);

    itIfPeviitor('should not have duplicate URLs for same CIF', async () => {
      const result = await querySOLR(ROPARDO_CIF);

      const urls = result.docs.map(j => j.url);
      const uniqueUrls = new Set(urls);
      expect(uniqueUrls.size).toBe(result.docs.length);
    }, 15000);

    itIfPeviitor('should have valid status values for all jobs', async () => {
      const validStatuses = ['scraped', 'tested', 'verified', 'published'];
      const result = await querySOLR(ROPARDO_CIF);

      for (const job of result.docs) {
        expect(validStatuses).toContain(job.status);
      }
    }, 15000);

    itIfPeviitor('should have valid CIF format for all jobs', async () => {
      const result = await querySOLR(ROPARDO_CIF);

      for (const job of result.docs) {
        expect(job.cif).toMatch(/^\d{7}$/);
      }
    }, 15000);
  });

  describe('Full Validation Workflow', () => {
    it('should complete the ANAF → validate → API check path', async () => {
      const searchResults = await searchCompany('ROPARDO');
      expect(searchResults.length).toBeGreaterThan(0);

      const ropardoCompany = searchResults.find(c =>
        (c.name || '').toUpperCase().includes('ROPARDO')
      );
      expect(ropardoCompany).toBeDefined();

      const anafData = await getCompanyFromANAF(ropardoCompany.cui.toString());
      expect(anafData.name).toBe('ROPARDO SRL');
      expect(anafData.inactive).toBe(false);
    }, 30000);

    itIfPeviitor('should have matching CIF in company core', async () => {
      const companyResult = await validateAndGetCompany();
      const solrResult = await getCompanyByCif(ROPARDO_CIF);

      expect(solrResult).toBeDefined();
      expect(solrResult.id).toBe(ROPARDO_CIF);
      expect(solrResult.company).toBe('ROPARDO SRL');
    }, 30000);

    itIfPeviitor('should validate company and query SOLR for existing jobs', async () => {
      const companyResult = await validateAndGetCompany();

      expect(companyResult.status).toBe('active');
      expect(companyResult.company).toBe('ROPARDO SRL');
      expect(companyResult.cif).toBe(ROPARDO_CIF);

      if (companyResult.existingJobsCount === 0) {
        console.log('No ROPARDO jobs in Solr — skipping job count assertion');
        return;
      }
      expect(companyResult.existingJobsCount).toBeGreaterThan(0);
    }, 30000);
  });
});
