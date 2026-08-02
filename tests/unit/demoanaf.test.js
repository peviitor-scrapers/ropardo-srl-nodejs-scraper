import { jest } from '@jest/globals';

const mockFetch = jest.fn();

jest.unstable_mockModule('node-fetch', () => ({
  default: mockFetch
}));

function anafSearchResponse(results) {
  return {
    ok: true,
    json: async () => ({ data: results, success: true })
  };
}

function anafCompanyResponse(data) {
  return {
    ok: true,
    json: async () => ({ data, success: true })
  };
}

function errorResponse(status) {
  return {
    ok: false,
    status,
    text: async () => 'Error'
  };
}

const ANAF_RECORD = {
  cui: 5415866,
  name: 'ROPARDO SRL',
  address: 'Str. RECONSTRUCTIEI, 2 A, Municipiul Sibiu, Sibiu',
  caenCode: '6220',
  inactive: false,
  registrationNumber: 'J2014005735405',
  vatRegistered: true,
  headquartersAddress: { locality: 'Sibiu' }
};

const CACHED_DATA = {
  cui: 5415866,
  name: 'ROPARDO SRL',
  address: 'MUNICIPIUL BUCUREŞTI, SECTOR 1',
  registrationNumber: 'J2014005735405',
  caenCode: '6220',
  inactive: false
};

describe('anaf.js', () => {
  let companyData;

  beforeAll(async () => {
    companyData = await import('../../scraper/anaf.js');
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('searchCompany', () => {
    it('should return array of companies for valid brand', async () => {
      mockFetch.mockResolvedValue(anafSearchResponse([
        { cui: 5415866, name: 'ROPARDO SRL', statusLabel: 'Funcțiune' }
      ]));

      const results = await companyData.searchCompany('ROPARDO');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('cui');
      expect(results[0]).toHaveProperty('name');
    });

    it('should return empty array for non-existent brand', async () => {
      mockFetch.mockResolvedValue(anafSearchResponse([]));

      const results = await companyData.searchCompany('NonExistentBrandXYZ123');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('should include statusLabel in results', async () => {
      mockFetch.mockResolvedValue(anafSearchResponse([
        { cui: 5415866, name: 'ROPARDO SRL', statusLabel: 'Funcțiune' }
      ]));

      const results = await companyData.searchCompany('ROPARDO');

      expect(results[0]).toHaveProperty('statusLabel', 'Funcțiune');
    });

    it('should throw on ANAF search error', async () => {
      mockFetch.mockResolvedValue(errorResponse(500));

      await expect(companyData.searchCompany('ROPARDO')).rejects.toThrow();
    });

    it('should encode brand name in URL', async () => {
      let capturedUrl;
      mockFetch.mockImplementation((url) => {
        capturedUrl = url;
        return Promise.resolve(anafSearchResponse([]));
      });

      await companyData.searchCompany('ROPARDO SRL');
      expect(capturedUrl).toContain(encodeURIComponent('ROPARDO SRL'));
    });
  });

  describe('getCompanyFromANAF', () => {
    it('should return company data for valid CIF', async () => {
      mockFetch.mockResolvedValue(anafCompanyResponse(ANAF_RECORD));

      const data = await companyData.getCompanyFromANAF('5415866');

      expect(data).toBeDefined();
      expect(data.cui).toBe(5415866);
      expect(data.name).toBe('ROPARDO SRL');
      expect(data).toHaveProperty('address');
      expect(data).toHaveProperty('registrationNumber');
    });

    it('should try cuifirma when ANAF fails', async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(500))  // ANAF fails
        .mockResolvedValueOnce({                     // cuifirma succeeds
          ok: true,
          json: async () => ({
            jsonrpc: "2.0",
            id: 1,
            result: {
              content: [{
                type: "text",
                text: JSON.stringify({
                  cui: "5415866",
                  name: "ROPARDO SRL",
                  is_active: true,
                  location: "Municipiul Sibiu, Sibiu"
                })
              }]
            }
          })
        });

      const data = await companyData.getCompanyFromANAF('5415866');

      expect(data).toBeDefined();
      expect(data.name).toBe('ROPARDO SRL');
      expect(data.cui).toBe(5415866);
      expect(data.inactive).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw when both sources fail', async () => {
      mockFetch.mockResolvedValue(errorResponse(500));

      await expect(companyData.getCompanyFromANAF('5415866')).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle API-level error response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, error: { message: 'Company not found' } })
      });

      await expect(companyData.getCompanyFromANAF('00000000')).rejects.toThrow();
    });
  });

  describe('getCompanyFromANAFWithFallback', () => {
    it('should return fresh data when API works', async () => {
      mockFetch.mockResolvedValue(anafCompanyResponse(ANAF_RECORD));

      const data = await companyData.getCompanyFromANAFWithFallback('5415866');

      expect(data.name).toBe('ROPARDO SRL');
    });

    it('should use cached data when API fails', async () => {
      mockFetch.mockResolvedValue(errorResponse(500));

      const data = await companyData.getCompanyFromANAFWithFallback('5415866', CACHED_DATA);

      expect(data).toEqual(CACHED_DATA);
    });

    it('should throw when API fails and no cache available', async () => {
      mockFetch.mockResolvedValue(errorResponse(500));

      await expect(companyData.getCompanyFromANAFWithFallback('5415866')).rejects.toThrow();
    });
  });
});
