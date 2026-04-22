# Security Setup for Local Development

## Pre-commit Secret Scanning (TruffleHog)

The CI pipeline runs TruffleHog on every push and PR. To catch secrets **before**
they reach GitHub, set up the pre-commit hook locally:

### Steps (run once per developer)

1. **Install TruffleHog:**
   ```bash
   brew install trufflehog
   ```

2. **Copy the pre-commit hook script:**
   ```bash
   cp scripts/pre-commit-trufflehog .git/hooks/pre-commit
   ```

3. **Make it executable:**
   ```bash
   chmod +x .git/hooks/pre-commit
   ```

4. **Verify it works:**
   ```bash
   git diff --cached --name-only  # should list staged files
   .git/hooks/pre-commit          # should print "No secrets found"
   ```

### Notes

- The hook is **not checked into git** (`.git/hooks/` is gitignored by default).
  Every developer must install it manually.
- If TruffleHog is **not installed**, the hook prints a warning and exits 0 —
  it will NOT block your commit. Install it to get protection.
- If a secret is detected: remove it from the staged file, rotate the credential,
  then re-stage and commit.

## GitHub Secrets Required

Add these to the repo under **Settings → Secrets and variables → Actions**:

| Secret name  | Where to get it                          | Used by      |
|--------------|------------------------------------------|--------------|
| `SNYK_TOKEN` | https://app.snyk.io/account              | snyk.yml     |

Snyk free tier: 200 tests/month — sufficient for a small team.

## Semgrep (optional enhancement)

Semgrep runs without a token using open-source rules. If you want Semgrep Cloud
dashboards (free for open-source), add:

| Secret name           | Where to get it              |
|-----------------------|------------------------------|
| `SEMGREP_APP_TOKEN`   | https://semgrep.dev/manage   |
