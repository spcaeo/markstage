# Deploy files

What is here, for running the Markstage server on your own machine. docs/DEPLOY.md is the full guide.

| File | What it is |
| --- | --- |
| `config.example.json` | A starting `config.json` for a public server. Copy it to `<data dir>/config.json`, then change the hosts and paths. |
| `Dockerfile`, `docker/start.mjs` | The server image (docs/DOCKER.md): two stages, runs as `node`; at start it writes a first config, installs the site's packages and builds its editor. CI builds and smoke-tests it; a release tag publishes it as `ghcr.io/spcaeo/markstage`. |
| `compose.yaml` | The image with nginx: the data dir and the site repo mounted from the host, the releases in a shared volume. |
| `nginx/` | nginx recipes for the editor's host and the site's host (security headers, protected pages, uploads). |
| `recipes/publish-gate.mjs` | An optional check that runs between the build and the deploy step. |

The real `config.json` lives in the server's data dir (`MARKSTAGE_DATA_DIR`), never in the site repo. Keep the
data dir at mode 0700 and `config.json` at 0600: the data dir also holds the database with password hashes and
sessions. No secret goes in `config.json`: `config.example.json` lists, under `$secrets`, the environment variable
(or the file outside the repo) each one comes from. All host names in the examples are `example.com`.
