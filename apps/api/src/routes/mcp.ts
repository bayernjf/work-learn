import { Hono } from "hono";
import { cors } from "hono/cors";
import { createDirectContext } from "@work-learn/mcp-server/direct";
import { handleMcpHttpRequest } from "@work-learn/mcp-server/http";
import { createSupabaseServiceClient } from "../lib/supabase.js";
import { authenticate } from "../lib/auth.js";
import { resolvePublicOrigin } from "../lib/origin.js";

/**
 * Remote MCP endpoint (Streamable HTTP, stateless).
 *
 * Agents connect to https://work-learn.pages.dev/api/mcp -- the Cloudflare Pages
 * proxy for this API, reachable where the *.vercel.app origin is not -- with an
 * Authorization: Bearer <token> header. The token may be a Work Learn personal
 * access token, an OAuth access token, or a Supabase user JWT. A client with no
 * token gets a 401 pointing at the protected-resource metadata, which is how it
 * discovers the authorization server and runs the OAuth flow unattended -- the
 * only path that works on a phone, where there is no local process to configure.
 * The same twenty tools as the stdio MCP server are available, but the request runs
 * inside the API function and writes to Supabase directly.
 */
export const mcpRoute = new Hono();

const publicBase = (req: { url: string; header?: (name: string) => string | undefined }) =>
  resolvePublicOrigin(req);
const resourceUrl = (req: { url: string; header?: (name: string) => string | undefined }) =>
  `${publicBase(req)}/api/mcp`;
const resourceMetadataUrl = (req: { url: string; header?: (name: string) => string | undefined }) =>
  `${resourceUrl(req)}/.well-known/oauth-protected-resource`;

mcpRoute.use(
  "*",
  cors({
    origin: (origin) => origin ?? "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "Mcp-Session-Id"],
    // WWW-Authenticate carries the discovery pointer below. Without exposing it, a
    // browser-based client gets the 401 but cannot read where to authorize.
    exposeHeaders: ["Mcp-Session-Id", "WWW-Authenticate"]
  })
);

mcpRoute.get("/.well-known/oauth-protected-resource", (c) =>
  c.json({
    resource: resourceUrl(c.req),
    authorization_servers: [`${publicBase(c.req)}/api/oauth`],
    scopes_supported: [],
    bearer_methods_supported: ["header"]
  })
);

mcpRoute.all("/", async (c) => {
  const auth = await authenticate(c.req.header("Authorization"));
  if (!auth.ok) {
    // RFC 9728: the pointer to the protected-resource metadata is what lets a
    // client discover the authorization server and start the OAuth flow on its
    // own. Without it a client only learns that it was rejected.
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl(c.req)}"`
      }
    });
  }

  const supabase = createSupabaseServiceClient();
  const userId = auth.userId;
  return handleMcpHttpRequest(c.req.raw, () => createDirectContext(supabase, userId, auth.scopes));
});
