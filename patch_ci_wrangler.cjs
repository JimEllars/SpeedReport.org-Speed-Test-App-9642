const fs = require('fs');

const path = '.github/workflows/deploy-cloudflare.yml';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  `      - name: Validate / Deploy Worker
        run: |
          cd speedreport-worker
          if [ -z "\${{ secrets.CLOUDFLARE_API_TOKEN }}" ]; then`,
  `      - name: Validate / Deploy Worker
        run: |
          cd speedreport-worker
          rm -rf ../.wrangler .wrangler
          if [ -z "\${{ secrets.CLOUDFLARE_API_TOKEN }}" ]; then`
);

fs.writeFileSync(path, content, 'utf8');
