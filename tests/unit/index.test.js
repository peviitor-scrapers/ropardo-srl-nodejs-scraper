import { jest } from '@jest/globals';

describe('index.js Component Tests', () => {
  let index;

  beforeAll(async () => {
    index = await import('../../index.js');
  });

  describe('transformJobsForSOLR', () => {
    it('should filter locations to only Romanian cities', () => {
      const payload = {
        jobs: [
          { url: 'https://jobs.ropardo.ro/job/1', title: 'Job 1', location: ['România'] },
          { url: 'https://jobs.ropardo.ro/job/2', title: 'Job 2', location: ['Sibiu'] },
          { url: 'https://jobs.ropardo.ro/job/3', title: 'Job 3', location: ['Bulgaria'] },
          { url: 'https://jobs.ropardo.ro/job/4', title: 'Job 4', location: ['Cluj-Napoca'] },
          { url: 'https://jobs.ropardo.ro/job/5', title: 'Job 5', location: [] }
        ]
      };

      const result = index.transformJobsForSOLR(payload);

      expect(result.jobs[0].location).toEqual(['România']);
      expect(result.jobs[1].location).toEqual(['Sibiu']);
      expect(result.jobs[2].location).toEqual(['România']);
      expect(result.jobs[3].location).toEqual(['Cluj-Napoca']);
      expect(result.jobs[4].location).toEqual(['România']);
    });

    it('should keep company uppercase', () => {
      const payload = {
        source: 'ropardo.ro',
        company: 'ropardo srl',
        cif: '5415866',
        jobs: [
          { url: 'https://jobs.ropardo.ro/job/1', title: 'Job 1', company: 'ropardo srl', cif: '5415866' }
        ]
      };

      const result = index.transformJobsForSOLR(payload);

      expect(result.company).toBe('ROPARDO SRL');
    });

    it('should normalize workmode values', () => {
      const payload = {
        jobs: [
          { url: 'https://jobs.ropardo.ro/job/1', title: 'Job 1', workmode: 'Remote' },
          { url: 'https://jobs.ropardo.ro/job/2', title: 'Job 2', workmode: 'ON-SITE' },
          { url: 'https://jobs.ropardo.ro/job/3', title: 'Job 3', workmode: 'Hybrid' },
          { url: 'https://jobs.ropardo.ro/job/4', title: 'Job 4', workmode: 'hybrid' }
        ]
      };

      const result = index.transformJobsForSOLR(payload);

      expect(result.jobs[0].workmode).toBe('remote');
      expect(result.jobs[1].workmode).toBe('on-site');
      expect(result.jobs[2].workmode).toBe('hybrid');
      expect(result.jobs[3].workmode).toBe('hybrid');
    });

    it('should handle empty jobs array', () => {
      const result = index.transformJobsForSOLR({ jobs: [] });
      expect(result.jobs).toEqual([]);
    });
  });

  describe('mapToJobModel', () => {
    it('should map raw job to job model format', () => {
      const rawJob = {
        url: 'https://jobs.ropardo.ro/job/senior-java-developer/',
        title: 'Senior Java Developer',
        location: ['Sibiu'],
        tags: ['java', 'spring boot'],
        workmode: 'remote'
      };

      const COMPANY_NAME = 'ROPARDO SRL';
      const COMPANY_CIF = '5415866';

      const result = index.mapToJobModel(rawJob, COMPANY_CIF, COMPANY_NAME);

      expect(result.url).toBe(rawJob.url);
      expect(result.title).toBe(rawJob.title);
      expect(result.company).toBe(COMPANY_NAME);
      expect(result.cif).toBe(COMPANY_CIF);
      expect(result.location).toEqual(rawJob.location);
      expect(result.tags).toEqual(rawJob.tags);
      expect(result.workmode).toBe(rawJob.workmode);
      expect(result.status).toBe('scraped');
      expect(result.date).toBeDefined();
    });

    it('should remove undefined fields', () => {
      const rawJob = {
        url: 'https://jobs.ropardo.ro/job/test/',
        title: 'Job 1'
      };

      const result = index.mapToJobModel(rawJob, '5415866');

      expect(result.location).toBeUndefined();
      expect(result.tags).toBeUndefined();
      expect(result.workmode).toBeUndefined();
    });

    it('should handle missing title', () => {
      const rawJob = { url: 'https://jobs.ropardo.ro/job/test/' };

      const result = index.mapToJobModel(rawJob, '5415866');

      expect(result.title).toBeUndefined();
      expect(result.url).toBe('https://jobs.ropardo.ro/job/test/');
    });
  });

  describe('parseJobsHTML', () => {
    it('should parse job listings from ROPARDO HTML', () => {
      const html = `<div class="jobs-wrapper col-lg-8">
        <div class="listing">
          <div class="list-item">
            <div class="details">
              <h4>Senior Java Developer</h4>
              <div class="meta-info">
                <div class="meta meta-location"><i class="fa fa-map-marker"></i>Sibiu</div>
                <div class="meta meta-shedule-duration"><i class="fa fa-calendar"></i>Full-time | Remote</div>
              </div>
              <p><strong>Tech skills:</strong>&nbsp;Java 8+, Spring Boot</p>
            </div>
            <a class="button job-details" href="https://jobs.ropardo.ro/job/senior-java-developer/">See job</a>
          </div>
          <div class="list-item">
            <div class="details">
              <h4>Junior BI Developer</h4>
              <div class="meta-info">
                <div class="meta meta-location"><i class="fa fa-map-marker"></i>Sibiu, România</div>
                <div class="meta meta-shedule-duration"><i class="fa fa-calendar"></i>Full-time/ part time/on site</div>
              </div>
              <p><strong>Tech skills:</strong>&nbsp;SQL, NoSQL</p>
            </div>
            <a class="button job-details" href="https://jobs.ropardo.ro/job/junior-bi-developer/">See job</a>
          </div>
        </div>
      </div>`;

      const result = index.parseJobsHTML(html);

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Senior Java Developer');
      expect(result[0].location).toEqual(['Sibiu']);
      expect(result[0].workmode).toBe('remote');
      expect(result[0].tags).toEqual(['java 8+', 'spring boot']);
      expect(result[0].url).toBe('https://jobs.ropardo.ro/job/senior-java-developer/');

      expect(result[1].title).toBe('Junior BI Developer');
      expect(result[1].location).toEqual(['Sibiu']);
      expect(result[1].workmode).toBe('hybrid');
      expect(result[1].tags).toEqual(['sql', 'nosql']);
    });

    it('should handle empty HTML', () => {
      const result = index.parseJobsHTML('<html><body></body></html>');
      expect(result).toEqual([]);
    });

    it('should handle missing fields gracefully', () => {
      const html = `<div class="jobs-wrapper col-lg-8">
        <div class="listing">
          <div class="list-item">
            <div class="details">
              <h4>Test Job</h4>
            </div>
          </div>
        </div>
      </div>`;

      const result = index.parseJobsHTML(html);

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Test Job');
      expect(result[0].location).toEqual(['Sibiu']);
      expect(result[0].workmode).toBe('on-site');
      expect(result[0].tags).toEqual([]);
    });
  });
});
