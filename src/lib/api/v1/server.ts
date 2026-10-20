import { getPublicViewReader, publishPublicView } from "@/lib/publicView/store";
import { clientAddressFromHeaders } from "@/lib/privateTeamRateLimit";
import { createFirestoreApiStore } from "./firestoreStore";
import { handleApiRequest, type ApiServices } from "./http";
import { MemoryRateLimiter } from "./rateLimit";
import { API_ROUTES } from "./routes";
import { ApiError } from "./errors";

const limiter = new MemoryRateLimiter();
let services: ApiServices | null = null;

function getServices(): ApiServices {
  services ??= {
    store: createFirestoreApiStore(),
    publicView: getPublicViewReader,
    routes: API_ROUTES,
    limiter,
    now: () => new Date(),
    publishPublicView: (tournamentId) => publishPublicView({ tournamentId }),
  };
  return services;
}

/** Next.js route adapter: /api/v1/<path> -> handleApiRequest. */
export async function serveApiRequest(request: Request, pathSegments: string[] | undefined): Promise<Response> {
  let resolved: ApiServices;
  try {
    resolved = getServices();
  } catch (error) {
    console.error("CrabbyTab API is not configured:", error);
    const unavailable = new ApiError(503, "unavailable", "Server-side Firebase is not configured.");
    return Response.json(unavailable.body(), { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const url = new URL(request.url);
  const result = await handleApiRequest({
    method: request.method,
    path: `/${(pathSegments ?? []).map(encodeURIComponent).join("/")}`,
    searchParams: url.searchParams,
    headers: request.headers,
    text: () => request.text(),
    clientAddress: clientAddressFromHeaders(request.headers),
  }, resolved);
  return result.status === 204
    ? new Response(null, { status: 204, headers: result.headers })
    : Response.json(result.body, { status: result.status, headers: result.headers });
}
