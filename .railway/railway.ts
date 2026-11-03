import { defineRailway, github, postgres, project, service } from "railway/iac";
import type { BuildConfig } from "railway/iac";

// Railway builds a commit only once its GitHub checks pass (CI, the images' smoke tests), so
// what deploys is what CI tested.
const SOURCE = github("Irere123/worklog", {
  branch: "main",
  checkSuites: true,
});

// A commit that touches none of a service's paths (docs, the Tinybird project) doesn't
// redeploy it.
const LOCKFILE = ["package.json", "bun.lock", ".dockerignore"];
const BACKEND_BUILD: BuildConfig = {
  builder: "DOCKERFILE",
  dockerfilePath: "apps/api/Dockerfile",
  watchPatterns: ["apps/api/**", ...LOCKFILE],
};

// Production refuses to start without these.
const REQUIRED = ["WORKLOG_SECRET_KEY", "AUTH_SECRET", "PUBLIC_URL"];

// Add a name once it's set as a shared variable: a reference to one that isn't set has no value
// to resolve to. apps/api/.env.example lists them all (OPENROUTER_API_KEY, RESEND_API_KEY,
// TINYBIRD_TOKEN, the GitHub, Slack and Discord apps…).
const INTEGRATIONS: string[] = [];

const API_PORT = "4000";
const WORKER_PORT = "4001";
const WEB_PORT = "8080";

/**
 * Worklog's production on Railway. `web` is the only public service: it serves the web app and
 * passes the API's paths to `api` over the private network. `worker` runs the jobs. Preview with
 * `railway config plan`, apply with `railway config apply`; docs/DEPLOY.md walks through the
 * first time, including the shared variables and the web service's domain.
 */
export default defineRailway((ctx) => {
  const db = postgres("postgres");

  // Set once in the project's shared variables and referenced by both backend services, so the
  // two processes can't disagree. Never in this file: it's in git, and Railway's
  // `randomString` is a hash of its label, which anyone can recompute.
  const shared = Object.fromEntries(
    [...REQUIRED, ...INTEGRATIONS].map((name) => [name, ctx.shared[name]])
  );
  // "::": the private network carries IPv6.
  const backend = { ...shared, DATABASE_URL: db.env.DATABASE_URL, HOST: "::" };

  const api = service("api", {
    source: SOURCE,
    build: BACKEND_BUILD,
    deploy: {
      // Once per deploy, before the new processes start: a migration that fails stops the
      // deploy, and the running version keeps serving.
      preDeployCommand: ["bun scripts/migrate.ts"],
      healthcheckPath: "/health",
      healthcheckTimeout: 120,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
      // The old deployment keeps serving until the new one is healthy, then gets SIGTERM and
      // this long to finish: the API drains for 10 seconds, then closes the database and flushes
      // telemetry.
      overlapSeconds: 15,
      drainingSeconds: 30,
    },
    env: { ...backend, PORT: API_PORT, RUN_SCHEDULER: "false" },
  });

  const worker = service("worker", {
    source: SOURCE,
    build: BACKEND_BUILD,
    deploy: {
      startCommand: "bun src/worker.ts",
      // Its health check: a new worker must reach the database before the old one stops.
      healthcheckPath: "/health",
      healthcheckTimeout: 120,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
      // Graphile Worker lets running jobs finish on SIGTERM, and a briefing waits on a model
      // for a while. One cut short keeps its lock until the hourly release.
      drainingSeconds: 120,
    },
    // PORT is where Railway sends the health check.
    env: { ...backend, PORT: WORKER_PORT, WORKER_PORT },
  });

  const web = service("web", {
    source: SOURCE,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "apps/web/Dockerfile",
      watchPatterns: ["apps/web/**", ...LOCKFILE],
    },
    deploy: {
      healthcheckPath: "/health",
      healthcheckTimeout: 60,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
      overlapSeconds: 15,
      // Long enough for open event streams to be cut and reconnect to the new deployment.
      drainingSeconds: 15,
    },
    env: {
      PORT: WEB_PORT,
      // Railway's edge holds TLS, so Caddy serves plain HTTP behind it.
      SITE_ADDRESS: `:${WEB_PORT}`,
      API_UPSTREAM: `\${{api.RAILWAY_PRIVATE_DOMAIN}}:${API_PORT}`,
    },
  });

  return project("worklog", { resources: [db, api, worker, web] });
});
