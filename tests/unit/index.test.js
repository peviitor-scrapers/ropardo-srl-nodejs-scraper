import { jest } from '@jest/globals';

describe('index.js Component Tests', () => {
  let index;

  beforeAll(async () => {
    index = await import('../../scraper/index.js');
  });

  describe('normalizeTitle', () => {
    it('should trim whitespace', () => {
      expect(index.normalizeTitle('  Senior Developer  ')).toBe('Senior Developer');
    });

    it('should collapse multiple spaces', () => {
      expect(index.normalizeTitle('Senior   Developer')).toBe('Senior Developer');
    });

    it('should return empty string for falsy input', () => {
      expect(index.normalizeTitle(null)).toBe('');
      expect(index.normalizeTitle(undefined)).toBe('');
      expect(index.normalizeTitle('')).toBe('');
    });
  });

  describe('normalizeLocation', () => {
    it('should split location by comma and return city', () => {
      expect(index.normalizeLocation('Cluj-Napoca, Romania')).toEqual(['Cluj-Napoca']);
    });

    it('should return single city for single value', () => {
      expect(index.normalizeLocation('Sibiu')).toEqual(['Sibiu']);
    });

    it('should return empty array for "remote"', () => {
      expect(index.normalizeLocation('Remote')).toEqual([]);
    });

    it('should return empty array for falsy input', () => {
      expect(index.normalizeLocation(null)).toEqual([]);
      expect(index.normalizeLocation('')).toEqual([]);
    });
  });

  describe('normalizeRemote', () => {
    it('should return true for "Remote"', () => {
      expect(index.normalizeRemote('Remote')).toBe(true);
    });

    it('should return true for "remote"', () => {
      expect(index.normalizeRemote('remote')).toBe(true);
    });

    it('should return false for "on-site"', () => {
      expect(index.normalizeRemote('on-site')).toBe(false);
    });

    it('should return false for falsy input', () => {
      expect(index.normalizeRemote(null)).toBe(false);
      expect(index.normalizeRemote('')).toBe(false);
    });
  });

  describe('normalizeWorkmode', () => {
    it('should return "remote" for remote workmode', () => {
      expect(index.normalizeWorkmode('Remote')).toBe('remote');
      expect(index.normalizeWorkmode('remote work')).toBe('remote');
    });

    it('should return "on-site" for on-site workmode', () => {
      expect(index.normalizeWorkmode('on-site')).toBe('on-site');
      expect(index.normalizeWorkmode('On Site')).toBe('on-site');
    });

    it('should return "hybrid" for other workmodes', () => {
      expect(index.normalizeWorkmode('hybrid')).toBe('hybrid');
      expect(index.normalizeWorkmode('Hybrid')).toBe('hybrid');
    });

    it('should default to "on-site" for falsy input', () => {
      expect(index.normalizeWorkmode(null)).toBe('on-site');
      expect(index.normalizeWorkmode('')).toBe('on-site');
    });
  });

  describe('extractTeamFromTitle', () => {
    it('should extract team from bracket prefix', () => {
      expect(index.extractTeamFromTitle('[Engineering] Senior Developer')).toBe('Engineering');
    });

    it('should return null when no bracket prefix', () => {
      expect(index.extractTeamFromTitle('Senior Developer')).toBeNull();
    });

    it('should return null for falsy input', () => {
      expect(index.extractTeamFromTitle(null)).toBeNull();
    });
  });

  describe('extractJobTypeFromTitle', () => {
    it('should detect internship', () => {
      expect(index.extractJobTypeFromTitle('Summer Intern')).toBe('internship');
      expect(index.extractJobTypeFromTitle('Student Program')).toBe('internship');
    });

    it('should detect part-time', () => {
      expect(index.extractJobTypeFromTitle('Developer (part time)')).toBe('part-time');
    });

    it('should default to full-time', () => {
      expect(index.extractJobTypeFromTitle('Senior Developer')).toBe('full-time');
    });
  });

  describe('normalizeJobType', () => {
    it('should normalize internship types', () => {
      expect(index.normalizeJobType('intern')).toBe('internship');
      expect(index.normalizeJobType('Internship')).toBe('internship');
    });

    it('should normalize part-time types', () => {
      expect(index.normalizeJobType('part time')).toBe('part-time');
      expect(index.normalizeJobType('Part-time')).toBe('part-time');
    });

    it('should default to full-time', () => {
      expect(index.normalizeJobType('full-time')).toBe('full-time');
      expect(index.normalizeJobType(null)).toBe('full-time');
    });
  });

  describe('parseJobs', () => {
    it('should parse raw API results into normalized jobs', () => {
      const rawJobs = [
        {
          id: '123',
          title: 'Senior Developer',
          location: 'Cluj-Napoca, Romania',
          applyUrl: 'https://jobs.ropardo.ro/jobs/123',
          department: 'IT',
          companyData: { address: 'Cluj-Napoca' }
        }
      ];

      const result = index.parseJobs(rawJobs);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('url', 'https://jobs.ropardo.ro/jobs/123');
      expect(result[0]).toHaveProperty('title', 'Senior Developer');
      expect(result[0]).toHaveProperty('workmode');
      expect(['remote', 'on-site', 'hybrid']).toContain(result[0].workmode);
    });

    it('should skip jobs without title', () => {
      const rawJobs = [
        { id: '123', title: '', location: 'Cluj' },
        { id: '456', title: null, location: 'Sibiu' }
      ];

      const result = index.parseJobs(rawJobs);
      expect(result).toHaveLength(0);
    });

    it('should handle empty array', () => {
      const result = index.parseJobs([]);
      expect(result).toEqual([]);
    });

    it('should use applyUrl as primary URL', () => {
      const rawJobs = [
        {
          id: '123',
          title: 'Job',
          applyUrl: 'https://custom-url.com/apply'
        }
      ];

      const result = index.parseJobs(rawJobs);
      expect(result[0].url).toBe('https://custom-url.com/apply');
    });

    it('should fallback to raw.url when applyUrl missing', () => {
      const rawJobs = [
        { title: 'Job', url: 'https://jobs.ropardo.ro/job/test/' }
      ];

      const result = index.parseJobs(rawJobs);
      expect(result[0].url).toBe('https://jobs.ropardo.ro/job/test/');
    });

    it('should use workplace as location fallback', () => {
      const rawJobs = [
        {
          title: 'Job',
          location: '',
          employment: 'Full-time',
          workplace: 'Sibiu'
        }
      ];

      const result = index.parseJobs(rawJobs);
      expect(result[0].location).toEqual(['Sibiu']);
    });

    it('should extract tags from department', () => {
      const rawJobs = [
        {
          id: '123',
          title: 'Job',
          department: 'Engineering'
        }
      ];

      const result = index.parseJobs(rawJobs);
      expect(result[0].tags).toEqual(['engineering']);
    });
  });
});
