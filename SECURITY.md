# Security Policy

## Supported versions

Only the latest commit on `main` is supported.

## Reporting a vulnerability

Please do not open a public issue for security problems involving:

- leaked session files such as `auth.json`
- private course content
- bypasses that weaken URL, path, or download protections

Instead, contact the maintainer privately and include:

- private contact: `discord: sipayisko`

- a short description of the issue
- reproduction steps
- impact assessment
- any proof-of-concept data with secrets removed

## Sensitive data handling

- Never commit `auth.json` or any browser storage export.
- Never attach private course downloads, screenshots, or API dumps to issues or pull requests.
- Redact tokens, cookies, account identifiers, and signed media URLs before sharing logs.
