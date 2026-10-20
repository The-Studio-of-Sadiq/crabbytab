import { serveApiRequest } from "@/lib/api/v1/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ path?: string[] }> };

async function handle(request: Request, { params }: RouteParams): Promise<Response> {
  const { path } = await params;
  return serveApiRequest(request, path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
