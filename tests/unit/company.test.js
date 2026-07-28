import { jest } from '@jest/globals';
import fs from 'fs';

const mockFetch = jest.fn();

jest.unstable_mockModule('node-fetch', () => ({
  default: mockFetch
}));

const ANAF_RECORD = {
  cui: 5415866,
  name: 'ROPARDO SRL',
  address: 'Str. RECONSTRUCTIEI, 2 A, Municipiul Sibiu, Sibiu',
  caenCode: '6220',
  inactive: false,
  vatRegistered: true,
  eFacturaRegistered: false,
  headquartersAddress: { locality: 'Sibiu' }
};

function anafCompanyResponse(data) {
  return {
    ok: true,
    json: async () => ({ data, success: true })
  };
}

function solrResponse(numFound, docs) {
  return {
    ok: true,
    json: async () => ({ success: true, total: numFound, data: docs })
  };
}

function peviitorResponse(companies) {
  return {
    ok: true,
    json: async () => ({ success: true, data: companies })
  };
}

function errorResponse(status) {
  return {
    ok: false,
    status,
    text: async () => 'Error'
  };
}

describe('company.js', () => {
  let company;
  const CACHE_PATH = 'scraper/anaf-cache.json';
  const CONFIG_PATH = 'scraper/config/company.json';
  let originalConfig;

  beforeAll(async () => {
    originalConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    company = await import('../../scraper/company.js');
  });

  beforeEach(() => {
    mockFetch.mockReset();
    if (fs.existsSync(CACHE_PATH)) fs.unlinkSync(CACHE_PATH);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...originalConfig, lastScraped: null }), 'utf-8');
  });

  afterAll(() => {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(originalConfig, null, 2), 'utf-8');
    if (fs.existsSync(CACHE_PATH)) fs.unlinkSync(CACHE_PATH);
  });

  describe('validateAndGetCompany', () => {
    it('should return company data with status active', async () => {
      mockFetch
        .mockResolvedValueOnce(anafCompanyResponse(ANAF_RECORD))   // getCompanyFromANAF
        .mockResolvedValueOnce(solrResponse(5, [                   // querySOLR
          { url: 'https://test.com/1', title: 'Job 1' },
          { url: 'https://test.com/2', title: 'Job 2' }
        ]))
        .mockResolvedValueOnce(peviitorResponse([{ company: 'ROPARDO SRL' }])); // peviitor

      const result = await company.validateAndGetCompany();

      expect(result).toHaveProperty('status', 'active');
      expect(result).toHaveProperty('company', 'ROPARDO SRL');
      expect(result).toHaveProperty('cif');
      expect(result).toHaveProperty('existingJobsCount');
      expect(typeof result.existingJobsCount).toBe('number');
    });

    it.skip('should return inactive when company is inactive in ANAF (requires config isolation)', async () => {
      const inactiveRecord = { ...ANAF_RECORD, inactive: true };

      mockFetch
        .mockResolvedValueOnce(anafCompanyResponse(inactiveRecord))  // getCompanyFromANAF
        .mockResolvedValueOnce(solrResponse(0, []))                  // querySOLR (0 jobs)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }); // peviitor (will fail gracefully)

      const result = await company.validateAndGetCompany();

      expect(result).toHaveProperty('status', 'inactive');
      expect(result).toHaveProperty('company', 'ROPARDO SRL');
    });
  });
});
