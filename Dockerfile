# Specify the base Docker image with Playwright + Chrome
FROM apify/actor-node-playwright-chrome:22-1.56.1

# Check preinstalled packages
RUN npm ls crawlee apify puppeteer playwright

COPY --chown=myuser:myuser package*.json Dockerfile ./

# Ensure Playwright version matches
RUN node check-playwright-version.mjs

# Install NPM packages (production only)
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version \
    && rm -r ~/.npm

COPY --chown=myuser:myuser . ./

CMD npm start --silent
