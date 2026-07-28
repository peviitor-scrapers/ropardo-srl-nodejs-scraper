# Contributing

Thank you for your interest in contributing!

## 🌱 Acesta este un Repo Derivat

Acest scraper este **derivat din** [epam-systems-international-srl-nodejs-scraper](https://github.com/sebiboga/epam-systems-international-srl-nodejs-scraper) — template-ul de referință pentru scraper-ele Node.js din ecosistemul peviitor.ro.

Pentru a deriva un scraper nou pentru altă companie, urmează instrucțiunile din template-ul EPAM.

## Code Style for Contributions to This Repo

- Use ES6+ modules (`type: module` in `package.json`)
- Add tests for new features in the matching `tests/<level>/` folder
- Ensure all tests pass before submitting PR
- Update relevant `.md` files (especially `files.md` and `AGENTS.md`) when adding new files
- Reference a GitHub issue in every commit (see [ISSUES.md](ISSUES.md))

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/ropardo-srl-nodejs-scraper.git

# Install dependencies
npm install

# Run tests
npm test
```

## Reporting Issues

Open a [GitHub Issue](https://github.com/sebiboga/ropardo-srl-nodejs-scraper/issues) with:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Node version, OS)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
