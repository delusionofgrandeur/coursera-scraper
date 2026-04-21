# Public Release Checklist

Use this checklist before changing the repository visibility from private to public.

## Repo content

- [ ] No `auth.json`, cookies, signed URLs, screenshots, course exports, or debug dumps are tracked.
- [ ] No sample files contain private account identifiers, enrolled-course data, or browser storage exports.
- [ ] No local-only files are accidentally staged in `git status`.
- [ ] `.gitignore` still covers session files, debug dumps, exports, and partial downloads.
- [ ] Any old commits that contained secrets or private artifacts have been reviewed separately before public release.

## Code and security validation

- [ ] Run `npm run scan:sensitive` and confirm it passes.
- [ ] Run `npm run lint` and confirm it passes.
- [ ] Run `npm run build` and confirm it passes.
- [ ] Run `npm run audit:prod` and confirm it passes.
- [ ] Confirm CodeQL workflow exists and is enabled.
- [ ] Confirm Dependabot configuration exists and is enabled.
- [ ] Confirm no unnecessary browser flags, hardcoded tokens, or security-bypass notes remain in the codebase.

## Package and distribution surface

- [ ] Review `package.json` name, description, keywords, homepage, bugs URL, and repository URL for public wording.
- [ ] Confirm published files only include the intended runtime surface.
- [ ] Run `npm pack --dry-run --json` and review the tarball contents before publishing anywhere.
- [ ] Decide explicitly whether this project will ever be published to npm. If not, keep distribution limited to GitHub source.
- [ ] Confirm no release artifacts in `dist/` contain embedded secrets or local file paths.

## Branding and messaging

- [ ] README states the project is unofficial.
- [ ] README states the project is not affiliated with or endorsed by Coursera.
- [ ] README frames the project as educational and personal offline use only.
- [ ] No Coursera logo or official brand assets are present in the repository.
- [ ] No wording implies official partnership, endorsement, support, or approval.
- [ ] Repo description, topics, and About section on GitHub match the same unofficial wording.

## Legal and risk posture

- [ ] You accept the remaining Terms, trademark, and takedown risk of a public Coursera-specific repo.
- [ ] README does not overclaim legality or imply that “educational use” removes all legal risk.
- [ ] LICENSE is present and is the license you actually want to grant.
- [ ] SECURITY.md is present and asks reporters not to post secrets or private course content publicly.
- [ ] CONTRIBUTING.md tells contributors not to commit session files or private artifacts.
- [ ] You have a private contact method ready for vulnerability reports or complaints.

## GitHub settings

- [ ] Repository visibility is still `Private` until final review is complete.
- [ ] Default branch is correct.
- [ ] Branch protection is enabled for `main`.
- [ ] Require pull request review and/or required status checks if that matches how you want to maintain the repo.
- [ ] Code scanning is enabled if available for the repository.
- [ ] Dependabot alerts and security updates are enabled.
- [ ] Actions permissions are restricted to the minimum needed.
- [ ] Repository secrets and variables have been reviewed; no stale or unnecessary values remain.
- [ ] Issues, Discussions, Wiki, and Projects settings match how much public interaction you actually want.
- [ ] The About sidebar, website link, and social preview image do not use official Coursera assets.

## Docs quality check

- [ ] Review the README from the perspective of an external reviewer.
- [ ] Confirm setup instructions work from a fresh clone.
- [ ] Confirm development commands in README, CONTRIBUTING, and CI are consistent.
- [ ] Confirm SECURITY.md and CONTRIBUTING.md are linked or easy to discover.
- [ ] Confirm issue templates do not ask users to paste sensitive files or private course content.

## Before flipping to public

- [ ] Confirm the repo name, description, and topics are the exact public-facing wording you want.
- [ ] Confirm the latest push is the intended release commit.
- [ ] Confirm no outstanding local changes remain unintentionally uncommitted.
- [ ] Confirm you are comfortable with the possibility of complaints or takedown requests.
- [ ] Confirm you know whether you will respond by editing, renaming, privating, or deleting the repo if contacted.

## Immediately after going public

- [ ] Re-open the public repo page and review the About section, README, and visible files as an external user would see them.
- [ ] Check the Actions tab to confirm CI, CodeQL, and Dependabot are functioning.
- [ ] Watch initial issues/discussions for users posting secrets or private course materials.
- [ ] Be ready to quickly remove accidental sensitive submissions from issues, PRs, or discussions.

## Recommended pre-public commands

```bash
npm run scan:sensitive
npm run lint
npm run build
npm run audit:prod
npm pack --dry-run --json
git status
```
