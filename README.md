# SpeedReport.org

SpeedReport.org is a React single-page application and Cloudflare Worker that
measures download speed, upload speed, latency, jitter, packet loss, and
loaded latency. Test history remains in the visitor's browser.

## Local development

```sh
npm install
npm run dev
```

The speed test needs the edge Worker. In a second terminal:

```sh
npm --prefix speedreport-worker install
npm --prefix speedreport-worker run dev
```

Set `VITE_SPEED_TEST_WORKER_URL` to the Worker URL only when the frontend and
Worker use different origins. The production deployment uses same-origin
`/api/*` endpoints, so no public API URL or CORS configuration is required.

## Deploying to Cloudflare

The deployment packages the Vite build as Worker static assets and serves
diagnostic endpoints from the same Worker. It creates the `speedreport.org`
custom domain on the authenticated Cloudflare account.

```sh
npm install
npm --prefix speedreport-worker install
npm run deploy:dry-run
```

Configure the required Worker secrets once in the Cloudflare account; do not
put them in `wrangler.jsonc`, `.env`, patch files, or a pull request:

```sh
npm --prefix speedreport-worker exec wrangler secret put ADMIN_SECRET
npm --prefix speedreport-worker exec wrangler secret put RESEND_API_KEY
```

## GitHub-to-Cloudflare deployment

`.github/workflows/deploy-cloudflare.yml` validates every pull request and
deploys the `speedreport-edge-engine` Worker after a successful push to
`main`. It builds the Vite application, then deploys the Worker and its
generated `dist` assets together. Deployment is serialized so concurrent
merges cannot overwrite one another.

Before the first deployment, add these repository Actions secrets in
**Settings > Secrets and variables > Actions**:

- `CLOUDFLARE_ACCOUNT_ID`: `75c34bd25e04d106a9108737a3d3bcf1`
- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token scoped to this account with
  Workers Scripts: Edit and Workers Routes: Edit permissions for the
  `speedreport.org` zone.

The deployment uses `--keep-vars`, so runtime secrets and dashboard-managed
variables are preserved. Configure `ADMIN_SECRET` and `RESEND_API_KEY` in
Cloudflare before enabling scheduled executive reports:

```sh
npm --prefix speedreport-worker exec wrangler secret put ADMIN_SECRET
npm --prefix speedreport-worker exec wrangler secret put RESEND_API_KEY
```

For manual release validation, run `npm run lint`, `npm test`, `npm run build`,
and `npm run deploy:dry-run`. After deployment, verify
`https://speedreport.org/health` and run a full speed test from
`https://speedreport.org/`.
