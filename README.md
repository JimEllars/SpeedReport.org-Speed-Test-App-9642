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
npm run deploy
```

After deployment, verify `https://speedreport.org/health` and run a full speed
test from `https://speedreport.org/`.
