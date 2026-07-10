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

const ANRAF_RECORD = {
  cui: 5415866,
  name: 'ROPARDO SRL',
  address: 'IANCU DE HUNEDOARA, 48, Bucureşti Sectorul 1, Bucureşti',
  caenCode: '6220',
  inactive: false,
  inactiveSince: '2018-12-27',
  reactivatedSince: '2020-05-13',
  registrationNumber: 'J2014005735405',
  vatRegistered: true,
  onrcStatusLabel: 'Funcțiune',
  legalForm: 'SRL'
};

const CACHED_DATA = {
  cui: 5415866,
  name: 'ROPARDO SRL',
  address: 'MUNICIPIUL BUCUREŞTI, SECTOR 1, BLD IANCU DE HUNEDOARA, NR.48, ET.9',
  registrationNumber: 'J2014005735405',
  caenCode: '6220',
  inactive: false,
  onrcStatusLabel: 'Funcțiune',
  administrators: [{ name: 'JASON PETERSON', role: 'administrator' }],
  authorizedCaenCodes: ['6210', '6220', '6290', '7020', '8559']
};

describe('src/anaf.js', () => {
  let anaf;

  beforeAll(async () => {
    anaf = await import('../../src/anaf.js');
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('searchCompany', () => {
    it('should return array of companies for valid brand', async () => {
      mockFetch.mockResolvedValue(anafSearchResponse([
        { cui: 5415866, name: 'ROPARDO SRL', statusLabel: 'Funcțiune' }
      ]));

      const results = await anaf.searchCompany('ROPARDO');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('cui');
      expect(results[0]).toHaveProperty('name');
    });

    it('should return empty array for non-existent brand', async () => {
      mockFetch.mockResolvedValue(anafSearchResponse([]));

      const results = await anaf.searchCompany('NonExistentBrandXYZ123');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('should include statusLabel in results', async () => {
      mockFetch.mockResolvedValue(anafSearchResponse([
        { cui: 5415866, name: 'ROPARDO SRL', statusLabel: 'Funcțiune' }
      ]));

      const results = await anaf.searchCompany('ROPARDO');

      expect(results[0]).toHaveProperty('statusLabel', 'Funcțiune');
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValue(errorResponse(500));

      await expect(anaf.searchCompany('ROPARDO')).rejects.toThrow('ANAF search error: 500');
    });

    it('should encode brand name in URL', async () => {
      let capturedUrl;
      mockFetch.mockImplementation((url) => {
        capturedUrl = url;
        return Promise.resolve(anafSearchResponse([]));
      });

      await anaf.searchCompany('ROPARDO SRL');
      expect(capturedUrl).toContain(encodeURIComponent('ROPARDO SRL'));
    });
  });

  describe('getCompanyFromANAF', () => {
    it('should return company data for valid CIF', async () => {
      mockFetch.mockResolvedValue(anafCompanyResponse(ANRAF_RECORD));

      const data = await anaf.getCompanyFromANAF('5415866');

      expect(data).toBeDefined();
      expect(data.cui).toBe(5415866);
      expect(data.name).toBe('ROPARDO SRL');
      expect(data).toHaveProperty('address');
      expect(data).toHaveProperty('registrationNumber');
    });

    it('should retry on HTTP error then succeed', async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(500))           // ANAF attempt 1
        .mockResolvedValueOnce(errorResponse(500))           // cuifirma fallback
        .mockResolvedValueOnce(anafCompanyResponse(ANRAF_RECORD)); // ANAF attempt 2

      const data = await anaf.getCompanyFromANAF('5415866');

      expect(data).toBeDefined();
      expect(data.cui).toBe(5415866);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should throw after exhausting retries', async () => {
      mockFetch.mockResolvedValue(errorResponse(500));

      await expect(anaf.getCompanyFromANAF('5415866')).rejects.toThrow();
      // ANAF(1) + cuifirma + ANAF(2) + ANAF(3) = 4 calls
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('should handle API-level error response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, error: { message: 'Company not found' } })
      });

      await expect(anaf.getCompanyFromANAF('00000000')).rejects.toThrow();
    });

    it('should use cuifirma when ANAF fails', async () => {
      // ANAF fails, cuifirma returns valid data
      mockFetch
        .mockResolvedValueOnce(errorResponse(500))  // ANAF attempt 1
        .mockResolvedValueOnce({                     // cuifirma fallback
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

      const data = await anaf.getCompanyFromANAF('5415866');

      expect(data).toBeDefined();
      expect(data.name).toBe('ROPARDO SRL');
      expect(data.cui).toBe(5415866);
      expect(data.inactive).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should return null when data is null', async () => {
      mockFetch.mockResolvedValue(anafCompanyResponse(null));

      const data = await anaf.getCompanyFromANAF('5415866');
      expect(data).toBeNull();
    });
  });

  describe('getCompanyFromANAFWithFallback', () => {
    it('should return fresh data when API works', async () => {
      mockFetch.mockResolvedValue(anafCompanyResponse(ANRAF_RECORD));

      const data = await anaf.getCompanyFromANAFWithFallback('5415866');

      expect(data.name).toBe('ROPARDO SRL');
    });

    it('should use cached data when API fails', async () => {
      mockFetch.mockResolvedValue(errorResponse(500));

      const data = await anaf.getCompanyFromANAFWithFallback('5415866', CACHED_DATA);

      expect(data).toEqual(CACHED_DATA);
    });

    it('should throw when API fails and no cache available', async () => {
      mockFetch.mockResolvedValue(errorResponse(500));

      await expect(anaf.getCompanyFromANAFWithFallback('5415866')).rejects.toThrow();
    });
  });
});
