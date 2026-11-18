import { defineRailway, github, postgres, project, service } from "railway/iac";
import type { BuildConfig } from "railway/iac";

const SOURCE = github("Irere123/worklog", {
  branch: "main",
  checkSuites: true,
});

const LOCKFILE = ["package.json", "bun.lock", ".dockerignore"];
const BACKEND_BUILD: BuildConfig = {
  builder: "DOCKERFILE",
  dockerfilePath: "apps/api/Dockerfile",
  watchPatterns: ["apps/api/**", ...LOCKFILE],
};

const REQUIRED = ["WORKLOG_SECRET_KEY", "AUTH_SECRET", "PUBLIC_URL"];

const INTEGRATIONS: string[] = [
  "GITHUB_APP_ID",
  "GITHUB_APP_SLUG",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_WEBHOOK_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
];

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

  const shared = Object.fromEntries(
    [...REQUIRED, ...INTEGRATIONS].map((name) => [name, ctx.shared[name]])
  );
  const backend = { ...shared, DATABASE_URL: db.env.DATABASE_URL, HOST: "::" };

  const api = service("api", {
    source: SOURCE,
    build: BACKEND_BUILD,
    deploy: {
      preDeployCommand: ["bun scripts/migrate.ts"],
      healthcheckPath: "/health",
      healthcheckTimeout: 120,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
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
      healthcheckPath: "/health",
      healthcheckTimeout: 120,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
      drainingSeconds: 120,
    },
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
      drainingSeconds: 15,
    },
    env: {
      PORT: WEB_PORT,
      SITE_ADDRESS: `:${WEB_PORT}`,
      API_UPSTREAM: `\${{api.RAILWAY_PRIVATE_DOMAIN}}:${API_PORT}`,
    },
  });

  return project("worklog", { resources: [db, api, worker, web] });
});
