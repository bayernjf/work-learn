#!/usr/bin/env node
/**
 * Verify the public entry a remote MCP client is told to use.
 *
 * Why this exists: the entry advertised to clients comes from
 * WORK_LEARN_PUBLIC_API_URL on the API, and every discovery hop is built from
 * it. If that value points at an origin users cannot reach, the OAuth flow dies
 * on the first hop -- the 401's resource_metadata pointer -- long before any
 * issuer comparison happens. This walks the whole chain from one entry and
 * reports the first hop that leaves it.
 *
 * Read-only: GET requests only. It never registers a client, so it writes
 * nothing to the production database.
 *
 * Usage: node scripts/check-public-entry.mjs [entryUrl]
 *        default entryUrl: https://work-learn.pages.dev
 */

const entry = new URL(process.argv[2] ?? "https://work-learn.pages.dev");
const expected = entry.origin;

const results = [];

async function get(url, label) {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    const body = await response.text();
    return { label, url, ok: true, status: response.status, headers: response.headers, body };
  } catch (error) {
    return { label, url, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function record(check, pass, detail) {
  results.push({ check, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${check}\n      ${detail}`);
}

const config = await get(new URL("/api/config", entry), "GET /api/config");
if (!config.ok) {
  record("/api/config reachable", false, `${config.url} -> ${config.error}`);
} else {
  const data = JSON.parse(config.body)?.data ?? {};
  record("/api/config reachable", true, `${config.url} -> ${config.status}`);
  record(
    "/api/config apiUrl stays on the entry origin",
    data.apiUrl === expected,
    `apiUrl = ${data.apiUrl} (expected ${expected}). This is the URL the Web "Connect an agent" panel shows and copies into agent configs.`
  );
}

const mcp = await get(new URL("/api/mcp", entry), "GET /api/mcp");
if (!mcp.ok) {
  record("/api/mcp reachable", false, `${mcp.url} -> ${mcp.error}`);
} else {
  record("/api/mcp rejects an anonymous client with 401", mcp.status === 401, `${mcp.url} -> ${mcp.status}`);
  const challenge = mcp.headers.get("www-authenticate") ?? "";
  const pointer = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
  record("401 carries a resource_metadata pointer", !!pointer, challenge || "(no WWW-Authenticate header)");

  if (pointer) {
    record(
      "discovery pointer stays on the entry origin",
      new URL(pointer).origin === expected,
      `pointer = ${pointer}. A client is sent here first; if this origin is unreachable for the user, the flow stops before authorization.`
    );

    const resource = await get(pointer, "GET resource metadata");
    if (!resource.ok) {
      record("resource metadata fetchable from the pointer", false, `${pointer} -> ${resource.error}`);
    } else {
      const meta = JSON.parse(resource.body);
      record("resource metadata fetchable from the pointer", true, `${pointer} -> ${resource.status}`);
      const server = meta.authorization_servers?.[0];
      record(
        "authorization_servers[0] stays on the entry origin",
        typeof server === "string" && new URL(server).origin === expected,
        `authorization_servers[0] = ${server}`
      );

      if (typeof server === "string") {
        const asMeta = await get(`${server.replace(/\/$/, "")}/.well-known/oauth-authorization-server`, "GET authorization server metadata");
        if (!asMeta.ok) {
          record("authorization server metadata fetchable", false, `${asMeta.url} -> ${asMeta.error}`);
        } else {
          const as = JSON.parse(asMeta.body);
          record("authorization server metadata fetchable", true, `${asMeta.url} -> ${asMeta.status}`);
          // RFC 8414: the issuer must be identical to the URL the metadata was
          // fetched from, or a strict client rejects the response outright.
          record(
            "issuer matches the metadata URL (RFC 8414)",
            as.issuer === server.replace(/\/$/, ""),
            `issuer = ${as.issuer} (fetched from ${server})`
          );
          for (const key of ["authorization_endpoint", "token_endpoint", "registration_endpoint"]) {
            record(
              `${key} stays on the entry origin`,
              typeof as[key] === "string" && new URL(as[key]).origin === expected,
              `${key} = ${as[key]}`
            );
          }
        }
      }
    }
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed against ${expected}`);
if (failed.length > 0) {
  console.log("\nFix: the advertised entry comes from WORK_LEARN_PUBLIC_API_URL on the API deployment.");
  console.log(`     Set it to ${expected} and redeploy, then re-run this script.`);
  process.exitCode = 1;
}
