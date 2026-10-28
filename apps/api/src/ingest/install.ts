import { randomBytes } from "node:crypto";

import { getConnector } from "#connectors";
import { convertManifest } from "#connectors/github/app";
import type { Installed } from "#connectors/types";
import type { AppContext } from "#context";
import { violates } from "#db/errors";
import {
  findConnectionByExternalId,
  findRevokedConnection,
  insertConnection,
  updateConnectionById,
} from "#db/queries/connections";
import type { ConnectionRow } from "#db/queries/connections";
import {
  deleteInstallState,
  findInstallState,
  insertInstallState,
} from "#db/queries/install-states";
import type { InstallState } from "#db/queries/install-states";
import { findMemberById } from "#db/queries/members";
import type { Member } from "#db/queries/members";
import { transact } from "#db/transact";
import { hashToken } from "#lib/crypto";
import { ApiError, badRequest, conflict } from "#lib/errors";
import { newId } from "#lib/ids";
import { HOUR_MS } from "#lib/time";

import { callbackUrl, loadApp, requireServerAdmin, saveApp } from "./apps";
import { queueSync } from "./sync-queue";

/**
 * A random single-use token bound to the admin and workspace, valid for an hour. Only its hash is
 * stored, so reading the table doesn't let anyone finish someone else's install.
 */
export async function newState(
  ctx: AppContext,
  params: {
    provider: string;
    purpose: InstallState["purpose"];
    member: Member;
    data?: Record<string, unknown>;
  }
) {
  const token = randomBytes(32).toString("base64url");
  await insertInstallState(ctx.db, {
    id: hashToken(token),
    provider: params.provider,
    purpose: params.purpose,
    workspaceId: params.member.workspaceId,
    memberId: params.member.id,
    data: params.data ?? {},
    expiresAt: new Date(ctx.now().getTime() + HOUR_MS),
  });
  return token;
}

export async function takeState(
  ctx: AppContext,
  params: { provider: string; purpose: InstallState["purpose"]; token?: string }
) {
  const row = params.token
    ? await deleteInstallState(ctx.db, {
        id: hashToken(params.token),
        provider: params.provider,
        purpose: params.purpose,
        now: ctx.now(),
      })
    : undefined;
  return row ?? expired();
}

/** The state without using it up, for a callback that may still fail on the provider's side. */
export async function peekState(
  ctx: AppContext,
  params: { provider: string; purpose: InstallState["purpose"]; token?: string }
) {
  const row = params.token
    ? await findInstallState(ctx.db, {
        id: hashToken(params.token),
        provider: params.provider,
        purpose: params.purpose,
        now: ctx.now(),
      })
    : undefined;
  return row ?? expired();
}

function expired(): never {
  throw badRequest(
    "This link has expired or was already used. Start again from Worklog."
  );
}

async function installable(ctx: AppContext, provider: string) {
  const spec = getConnector(provider)?.app;
  if (!spec) {
    throw badRequest(`${provider} doesn't install as an app`);
  }
  const app = await loadApp(ctx, provider);
  if (!app) {
    throw badRequest(
      `This server has no ${provider} app yet. An admin creates it first (PUT /v1/apps/${provider}).`
    );
  }
  return { spec, app };
}

export async function beginInstall(
  ctx: AppContext,
  member: Member,
  provider: string
) {
  const { spec, app } = await installable(ctx, provider);
  const state = await newState(ctx, { provider, purpose: "install", member });
  return { url: spec.installUrl(app, state, callbackUrl(ctx, provider)) };
}

/**
 * The first step of GitHub's manifest flow: a link to the page that posts the manifest to GitHub.
 * Refused before GitHub creates anything when the server has an app: a second one there would
 * only be orphaned.
 */
export async function beginAppCreation(
  ctx: AppContext,
  member: Member,
  input: {
    name?: string;
    organization?: string;
    replace?: boolean;
    secret?: string;
  }
) {
  await requireServerAdmin(ctx, input.secret);
  if (input.replace !== true && (await loadApp(ctx, "github"))) {
    throw conflict(
      "This server already has a GitHub App. Pass replace to create a new one anyway; installations made with the old one stop working."
    );
  }
  const state = await newState(ctx, {
    provider: "github",
    purpose: "create_app",
    member,
    data: { replace: input.replace === true },
  });
  const { host } = new URL(ctx.config.PUBLIC_URL);
  const query = new URLSearchParams({
    state,
    name: input.name ?? `Worklog (${host})`.slice(0, 34),
    ...(input.organization ? { organization: input.organization } : {}),
  });
  return {
    url: `${ctx.config.PUBLIC_URL}/oauth/github/manifest?${query.toString()}`,
  };
}

/**
 * GitHub made the app from the manifest: store it, then install it. When another app was stored
 * meanwhile, this one stays unused and the admin is told where to delete it.
 */
export async function finishAppCreation(
  ctx: AppContext,
  query: { state?: string; code?: string }
): Promise<
  | { type: "install"; url: string }
  | { type: "saved" }
  | { type: "orphaned"; slug: string; url: string }
> {
  const state = await takeState(ctx, {
    provider: "github",
    purpose: "create_app",
    token: query.state,
  });
  if (!query.code) {
    throw badRequest("GitHub sent no code back, so no app was created.");
  }
  const { url, ...created } = await convertManifest(ctx, query.code);
  try {
    await saveApp(
      ctx,
      "github",
      { ...created, createdVia: "manifest" },
      { replace: state.data.replace === true }
    );
  } catch (error) {
    // GitHub has already made the app; its credentials are only ever handed over once.
    if (error instanceof ApiError && error.status === 409) {
      return { type: "orphaned", slug: created.slug, url };
    }
    throw error;
  }
  const member = await findMemberById(ctx.db, { id: state.memberId });
  return member
    ? { type: "install", ...(await beginInstall(ctx, member, "github")) }
    : { type: "saved" };
}

/** The provider redirected back: verify, then connect the installation to the admin's workspace. */
export async function completeInstall(
  ctx: AppContext,
  provider: string,
  query: Record<string, string>
) {
  // Checked first and used up last: a link survives this server or the provider failing
  // halfway, and still works only once.
  const { spec, app } = await installable(ctx, provider);
  const token = { provider, purpose: "install" as const, token: query.state };
  await peekState(ctx, token);
  const installed = await spec.completeInstall(
    ctx,
    app,
    query,
    callbackUrl(ctx, provider)
  );
  const state = await takeState(ctx, token);
  return await connectInstallation(ctx, {
    provider,
    workspaceId: state.workspaceId,
    memberId: state.memberId,
    installed,
  });
}

/**
 * One installation feeds one workspace. Installing again (new repos, a reinstall after an
 * uninstall) updates the same connection and keeps what the admin chose for it.
 */
export async function connectInstallation(
  ctx: AppContext,
  params: {
    provider: string;
    workspaceId: string;
    memberId: string;
    installed: Installed;
  }
): Promise<ConnectionRow> {
  const { provider, workspaceId, memberId, installed } = params;
  try {
    return await transact(ctx, async (tx) => {
      // GitHub gives a reinstall a new installation id; the account finds what it replaces.
      const byId = await findConnectionByExternalId(tx.db, {
        provider,
        externalId: installed.externalId,
      });
      const existing =
        byId ??
        (installed.account
          ? await findRevokedConnection(tx.db, {
              workspaceId,
              provider,
              account: installed.account,
            })
          : undefined);
      let found = existing;
      if (found && found.workspaceId !== workspaceId) {
        if (found.status !== "revoked") {
          throw conflict(
            `That ${provider} account is already connected to another workspace on this server`
          );
        }
        // Uninstalled there: the installation is free, and the old connection keeps its history.
        await updateConnectionById(tx.db, {
          id: found.id,
          set: { externalId: null },
        });
        found = undefined;
      }
      const conn = found
        ? await updateConnectionById(tx.db, {
            id: found.id,
            set: {
              // The admin may have renamed it; a renamed account says so by webhook.
              externalId: installed.externalId,
              // An admin's pause outlasts a reinstall, as it does the provider's unsuspend.
              status: found.status === "paused" ? "paused" : "active",
              statusReason: null,
              // The admin's choices stay; what the provider just said about itself replaces
              // what it said before.
              settings: { ...found.settings, ...installed.settings },
              secrets: tx.secrets.seal({
                ...tx.secrets.open(found.secrets),
                ...installed.secrets,
              }),
              installedById: memberId,
            },
          })
        : await insertNew(tx, params);
      await queueSync(tx, conn);
      return conn;
    });
  } catch (error) {
    if (violates(error, "connections_external_uq")) {
      throw conflict(`That ${provider} account was just connected; try again`);
    }
    throw error;
  }
}

async function insertNew(
  ctx: AppContext,
  params: {
    provider: string;
    workspaceId: string;
    memberId: string;
    installed: Installed;
  }
) {
  const row: ConnectionRow = {
    id: newId("con"),
    workspaceId: params.workspaceId,
    provider: params.provider,
    name: params.installed.name,
    status: "active",
    statusReason: null,
    externalId: params.installed.externalId,
    installedById: params.memberId,
    settings: params.installed.settings,
    secrets: ctx.secrets.seal(params.installed.secrets),
    lastEventAt: null,
    rejections: 0,
    lastRejectedAt: null,
    lastRejection: null,
    createdAt: ctx.now(),
  };
  await insertConnection(ctx.db, row);
  return row;
}
