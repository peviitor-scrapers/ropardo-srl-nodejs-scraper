import { jest } from '@jest/globals';

const mockFetch = jest.fn();

jest.unstable_mockModule('node-fetch', () => ({
  default: mockFetch
}));

function makeApiSuccessResponse(data) {
  return {
    ok: true,
    json: async () => ({ success: true, ...data })
  };
}

function makeErrorResponse(status, text) {
  return {
    ok: false,
    status,
    text: async () => text
  };
}

describe('api.js', () => {
  let api;

  beforeAll(async () => {
    api = await import('../../scraper/api.js');
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('querySOLR', () => {
    it('should return response object with docs', async () => {
      mockFetch.mockResolvedValue(makeApiSuccessResponse({
        total: 2,
        data: [
          { id: 'job1', url: 'https://test.com/1', cif: '5415866' },
          { id: 'job2', url: 'https://test.com/2', cif: '5415866' }
        ]
      }));

      const result = await api.querySOLR('5415866');

      expect(result).toHaveProperty('numFound', 2);
      expect(result).toHaveProperty('docs');
      expect(Array.isArray(result.docs)).toBe(true);
      expect(result.docs).toHaveLength(2);
    });

    it('should return empty docs when no jobs found', async () => {
      mockFetch.mockResolvedValue(makeApiSuccessResponse({
        total: 0,
        data: []
      }));

      const result = await api.querySOLR('99999999');

      expect(result.numFound).toBe(0);
      expect(result.docs).toEqual([]);
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(500, 'Internal Server Error'));

      await expect(api.querySOLR('5415866')).rejects.toThrow();
    });
  });

  describe('getCompanyByCif', () => {
    it('should return company data', async () => {
      mockFetch.mockResolvedValue(makeApiSuccessResponse({
        data: [{ id: '5415866', company: 'ROPARDO SRL', brand: 'ROPARDO' }]
      }));

      const result = await api.getCompanyByCif('5415866');

      expect(result).toBeDefined();
      expect(result.brand).toBe('ROPARDO');
    });

    it('should return null when company not found', async () => {
      mockFetch.mockResolvedValue(makeApiSuccessResponse({
        data: []
      }));

      const result = await api.getCompanyByCif('00000000');

      expect(result).toBeNull();
    });
  });

  describe('upsertJobs', () => {
    it('should accept array of jobs', async () => {
      mockFetch.mockResolvedValue(makeApiSuccessResponse({ count: 1 }));

      const testJob = {
        url: 'https://test.com/job1',
        title: 'Test Job',
        company: 'TEST COMPANY',
        cif: '12345678',
        status: 'scraped'
      };

      await expect(api.upsertJobs([testJob])).resolves.not.toThrow();
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(400, 'Bad Request'));

      await expect(api.upsertJobs([{ url: 'https://test.com/bad' }])).rejects.toThrow();
    });
  });

  describe('upsertCompany', () => {
    it('should send company data to API', async () => {
      mockFetch.mockResolvedValue(makeApiSuccessResponse({}));

      const companyDoc = {
        id: '5415866',
        company: 'ROPARDO SRL',
        brand: 'ROPARDO',
        status: 'activ',
        location: ['Romania'],
        website: ['https://www.ropardo.ro'],
        career: ['https://jobs.ropardo.ro']
      };

      await expect(api.upsertCompany(companyDoc)).resolves.not.toThrow();
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(500, 'Error'));

      await expect(api.upsertCompany({ id: '5415866' })).rejects.toThrow();
    });
  });

  describe('deleteJobByUrl', () => {
    it('should delete a job by URL', async () => {
      mockFetch.mockResolvedValue(makeApiSuccessResponse({}));

      await expect(api.deleteJobByUrl('https://test.com/old-job')).resolves.not.toThrow();
    });

    it('should handle 404 gracefully', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(404, 'Not Found'));

      await expect(api.deleteJobByUrl('https://test.com/missing')).resolves.not.toThrow();
    });

    it('should throw on other HTTP errors', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(500, 'Error'));

      await expect(api.deleteJobByUrl('https://test.com/bad')).rejects.toThrow();
    });
  });

  describe('deleteJobsByCIF', () => {
    it('should delete all jobs for a CIF', async () => {
      mockFetch.mockResolvedValue(makeApiSuccessResponse({ count: 3 }));

      await expect(api.deleteJobsByCIF('5415866')).resolves.not.toThrow();
    });

    it('should handle 404 gracefully', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(404, 'Not Found'));

      await expect(api.deleteJobsByCIF('99999999')).resolves.not.toThrow();
    });

    it('should throw on other HTTP errors', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(500, 'Error'));

      await expect(api.deleteJobsByCIF('5415866')).rejects.toThrow();
    });
  });

  describe('Data Integrity', () => {
    it('should not have duplicate URLs for same CIF', async () => {
      mockFetch.mockResolvedValue(makeApiSuccessResponse({
        total: 2,
        data: [
          { url: 'https://test.com/job1', title: 'Job 1', cif: '5415866' },
          { url: 'https://test.com/job2', title: 'Job 2', cif: '5415866' }
        ]
      }));

      const result = await api.querySOLR('5415866');
      const urls = result.docs.map(j => j.url);
      const uniqueUrls = new Set(urls);

      expect(uniqueUrls.size).toBe(result.numFound);
    });

    it('should have valid CIF format for all jobs', async () => {
      mockFetch.mockResolvedValue(makeApiSuccessResponse({
        total: 2,
        data: [
          { url: 'https://test.com/1', title: 'Job 1', cif: '5415866' },
          { url: 'https://test.com/2', title: 'Job 2', cif: '12345678' }
        ]
      }));

      const result = await api.querySOLR('5415866');

      for (const job of result.docs) {
        expect(job.cif).toMatch(/^\d{7,9}$/);
      }
    });

    it('should have valid status values', async () => {
      const validStatuses = ['scraped', 'tested', 'verified', 'published'];

      mockFetch.mockResolvedValue(makeApiSuccessResponse({
        total: 3,
        data: [
          { url: 'https://test.com/1', title: 'Job 1', cif: '5415866', status: 'scraped' },
          { url: 'https://test.com/2', title: 'Job 2', cif: '5415866', status: 'verified' },
          { url: 'https://test.com/3', title: 'Job 3', cif: '5415866', status: 'published' }
        ]
      }));

      const result = await api.querySOLR('5415866');

      for (const job of result.docs) {
        expect(validStatuses).toContain(job.status);
      }
    });
  });
});
