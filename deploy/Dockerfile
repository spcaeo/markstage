# Markstage server image. Build from the repo root:  docker build -f deploy/Dockerfile -t markstage-server .
# The site's own build (e.g. `npx astro build`) runs inside this container, in the mounted content repo, so the
# image carries Node and git; the site's node_modules are installed into the mounted repo (see docs/DEPLOY.md).
FROM node:24-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/markstage

# manifests first, so a code change does not reinstall dependencies
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/editor/package.json packages/editor/
COPY packages/astro/package.json packages/astro/
COPY examples/blog/package.json examples/blog/
RUN npm ci --omit=dev --workspace @markstage/server --workspace @markstage/core \
 && npm cache clean --force

COPY packages/core packages/core
COPY packages/server/bin packages/server/bin
COPY packages/server/src packages/server/src

RUN ln -s /opt/markstage/packages/server/bin/markstage-server.mjs /usr/local/bin/markstage-server \
 && ln -s /opt/markstage/packages/server/bin/markstage-deploy.mjs /usr/local/bin/markstage-deploy \
 # the content repo is a bind mount owned by the host user; let git work in it
 && git config --system --add safe.directory /srv/content \
 && mkdir -p /srv/data /srv/content /srv/site \
 && chown node:node /srv/data /srv/site

# /srv/data     data dir (config.json, markstage.db): secrets, mode 0700, never inside the content repo
# /srv/content  the site's git working copy
# /srv/site     releases written by markstage-deploy; the web server reads /srv/site/current/public
# the release line (docs/RELEASES.md): an image has no .git, so the build passes the checkout's facts
ARG MARKSTAGE_COMMIT=
ARG MARKSTAGE_BUILD=
ARG MARKSTAGE_BUILT_AT=
ENV MARKSTAGE_COMMIT=$MARKSTAGE_COMMIT \
    MARKSTAGE_BUILD=$MARKSTAGE_BUILD \
    MARKSTAGE_BUILT_AT=$MARKSTAGE_BUILT_AT
ENV MARKSTAGE_DATA_DIR=/srv/data \
    MARKSTAGE_HOST=0.0.0.0 \
    MARKSTAGE_PORT=18231

USER node
# 18231 editor + API, 18245 previews (preview.origin), 18251 share links (share.origin); preview dev servers stay on
# loopback inside the container
EXPOSE 18231 18245 18251
# any HTTP answer (even 421 for the wrong host name) means the server is up
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.MARKSTAGE_PORT+'/markstage/').then(()=>process.exit(0),()=>process.exit(1))"]
CMD ["markstage-server", "serve"]
