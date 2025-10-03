# Render Deployment Guide

This guide documents how the `main` branch of the public repository is deployed to Render and how to keep the branch safe while the app remains public.

## Overview

- **Service URL:** https://be-ssrt-2.onrender.com/
- **Tech stack:** NestJS + Prisma + Supabase + Bull queues (Redis) + optional Ollama/Gemini integrations.
- **Deployment target:** Render Web Service in the Oregon (US West) region.

## Prerequisites

1. Supabase project with credentials for pooled (port 6543) and direct (port 5432) connections.
2. Redis provider (e.g., Redis Cloud/Upstash) if queue processing must run in production.
3. Node.js `>=18` locally for parity with Render's Node 22 runtime.
4. `pnpm`/`npm` installed for building locally (`npm` is used in production).
5. Required secrets for integrations (GitHub, MailerSend, Slack, Jira, Gemini) if those features are needed.

## Local Build Verification

Before pushing to `main`, confirm the production build is healthy:

```bash
npm ci
npm run build
npm run start:prod
```

When `start:prod` runs locally, the app should start without uncaught exceptions and connect to Supabase.

## Render Configuration

Create or edit a Web Service on Render with the following settings:

| Setting | Value |
| --- | --- |
| Root Directory | `ossrepo-backend` |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm run start:prod` |
| Instance Type | `Free` (512 MB RAM, 0.1 CPU) |
| Auto deploy | Enabled for the `main` branch |

Render injects `PORT`. The Nest bootstrap code already listens on `process.env.PORT` with a `0.0.0.0` host, so no extra change is required.

### Environment Variables

**⚠️ Security Note:** Environment variables contain sensitive information and should be configured directly in Render's dashboard, not documented in public repositories.

Configure the following environment variables in Render's Environment tab:
- Database connection strings (DATABASE_URL, DIRECT_URL)
- JWT secrets
- API keys for third-party services
- Redis configuration (if using cloud Redis)

Refer to your local `.env.example` file for the complete list of required variables.

### Deploying Updates

1. Push changes to `main` (or merge a PR into `main`).
2. Render auto-deploys the latest commit. Watch the logs for:
   - `✅ Database connected successfully` (Prisma)
   - Any warnings about missing integrations you intentionally disabled.
3. Verify Swagger UI at `https://be-ssrt-2.onrender.com/api#/` loads and that sample endpoints respond.

To deploy manually (without pushing new commits) use Render → Deploys → **Manual Deploy ➜ Deploy latest commit**.

### Rolling Back

Render keeps previous deploys. Use the Deploys tab to redeploy a known-good build if the latest changes misbehave. Ensure schema migrations are reversible before rolling back.

## Protecting the `main` Branch

Because the repository is public, locking down `main` prevents accidental or malicious pushes.

1. **Enable branch protection** in your Git hosting provider (GitHub recommended):
   - Require pull requests before merging.
   - Enforce status checks (e.g. `npm run build`, `npm run test`) if you wire them up in CI.
   - Restrict who can push directly to `main` (e.g. only maintainers).
2. **Use signed commits or verified authors** when possible.
3. **Create a release branch** for large features: work in `feature/*` branches, open PRs into `main`, and trigger Render deployments only after review.
4. **Monitor the Render deploy logs**: unexpected deploys or environment variable changes may indicate unauthorized pushes.
5. **Rotate secrets** stored in Render if the repository is ever forked or if accidental exposure is suspected.

If you prefer to keep the repo public but avoid auto-deploying unknown commits, disable Render auto-deploy and trigger manual deploys only after reviewing commits pulled from upstream.

## Operational Notes

- Services log warnings when optional integrations are not configured. This is expected behavior.
- AI-related services fall back gracefully when binaries or keys are missing.
- Prisma migrations should be run locally against the direct database URL, committed to the repo, and then deployed to Render.

Keep this document updated whenever the deployment process changes.
