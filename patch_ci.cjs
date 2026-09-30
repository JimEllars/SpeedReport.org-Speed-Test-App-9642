const fs = require('fs');

const path = '.github/workflows/deploy-cloudflare.yml';
let content = fs.readFileSync(path, 'utf8');

// The deploy worker needs `dist` to exist, so we need to run `npm ci` and `npm run build` in the root of the project during the `deploy-worker` job as well, or we need to pass artifacts between jobs.
// To keep it simple, we can just run `npm ci` and `npm run build` in the root before running wrangler deploy.

content = content.replace(
  `- name: Install Worker dependencies
        run: |
          cd speedreport-worker
          npm ci`,
  `- name: Install root dependencies & build
        run: |
          npm ci
          npm run build
      - name: Install Worker dependencies
        run: |
          cd speedreport-worker
          npm ci`
);

fs.writeFileSync(path, content, 'utf8');
