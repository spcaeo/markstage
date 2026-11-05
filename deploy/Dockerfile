# The Markstage server image (docs/DOCKER.md). Build from the repo root:
#   docker build -f deploy/Dockerfile -t markstage-server .
# CI builds it on every push and pull request and smoke-tests it (scripts/docker/smoke.mjs); a v* tag in the public
# repo publishes it as ghcr.io/spcaeo/markstage (.github/workflows/image.yml).
# The site's own build (`npm run build`) runs inside this container, in the mounted site repo, so the image carries
# Node and git; at start it installs the site's packages and builds its editor (deploy/docker/start.mjs).
ARG NODE_IMAGE=node:24-slim

# 1. the server's runtime packages, exactly the lockfile
FROM ${NODE_IMAGE} AS deps
WORKDIR /opt/markstage
# every workspace's manifest: npm ci checks the whole lockfile, then installs only the two packages named
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/editor/package.json packages/editor/
COPY packages/astro/package.json packages/astro/
COPY examples/blog/package.json examples/blog/
COPY examples/starter/package.json examples/starter/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --workspace @markstage/server --workspace @markstage/core \
 && npm cache clean --force

# 2. the image: Node, git (Markstage commits), ssh (pushes to a shared remote), tini (PID 1), the server
FROM ${NODE_IMAGE}
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates openssh-client tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/markstage
COPY --from=deps /opt/markstage/node_modules node_modules
COPY package.json ./
COPY packages/core packages/core
COPY packages/server/package.json packages/server/
COPY packages/server/bin packages/server/bin
COPY packages/server/src packages/server/src
COPY deploy/docker/start.mjs deploy/docker/start.mjs

RUN find node_modules -xtype l -delete \
 && ln -s /opt/markstage/packages/server/bin/markstage-server.mjs /usr/local/bin/markstage-server \
 && ln -s /opt/markstage/packages/server/bin/markstage-deploy.mjs /usr/local/bin/markstage-deploy \
 # the site repo is a bind mount owned by the host user; let git work in it
 && git config --system --add safe.directory /srv/content \
 && mkdir -p /srv/data /srv/content/node_modules /srv/site /srv/editor \
 && chown node:node /srv/data /srv/content /srv/content/node_modules /srv/site /srv/editor \
 && chmod 700 /srv/data

# /srv/data     data dir (config.json, markstage.db): secrets, mode 0700, never inside the site repo
# /srv/content  the site's git working copy; mount a volume over /srv/content/node_modules (Linux packages)
# /srv/site     releases written by markstage-deploy; the web server reads /srv/site/current/public
# /srv/editor   the site's editor, built at every start (MARKSTAGE_EDITOR_DIR)
# the release line (docs/RELEASES.md): an image has no .git, so the build passes the checkout's facts
ARG MARKSTAGE_VERSION=
ARG MARKSTAGE_COMMIT=
ARG MARKSTAGE_BUILD=
ARG MARKSTAGE_BUILT_AT=
ENV MARKSTAGE_COMMIT=$MARKSTAGE_COMMIT \
    MARKSTAGE_BUILD=$MARKSTAGE_BUILD \
    MARKSTAGE_BUILT_AT=$MARKSTAGE_BUILT_AT
ENV MARKSTAGE_DATA_DIR=/srv/data \
    MARKSTAGE_CONTENT_ROOT=/srv/content \
    MARKSTAGE_HOST=0.0.0.0 \
    MARKSTAGE_PORT=18231
LABEL org.opencontainers.image.title="Markstage server" \
      org.opencontainers.image.description="Markstage: edit an Astro site's Markdown on the real page. Sign-in, roles, history and publishing." \
      org.opencontainers.image.source="https://github.com/spcaeo/markstage" \
      org.opencontainers.image.licenses="Elastic-2.0" \
      org.opencontainers.image.version=$MARKSTAGE_VERSION \
      org.opencontainers.image.revision=$MARKSTAGE_COMMIT

USER node
# 18231 editor + API, 18245 previews (preview.origin), 18251 share links (share.origin); preview dev servers stay on
# loopback inside the container
EXPOSE 18231 18245 18251
VOLUME ["/srv/data", "/srv/site"]
# any HTTP answer (even 421 for the wrong host name) means the server is up; the first start installs the site's
# packages, so it gets five minutes before a failed check counts
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --start-interval=3s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.MARKSTAGE_PORT+'/markstage/').then(()=>process.exit(0),()=>process.exit(1))"]
ENTRYPOINT ["tini", "--", "node", "/opt/markstage/deploy/docker/start.mjs"]
CMD ["serve"]
