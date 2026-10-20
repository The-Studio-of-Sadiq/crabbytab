import { NextResponse } from "next/server";
import { buildOpenApiDocument } from "@/lib/api/v1/openapi";
import { API_ROUTES } from "@/lib/api/v1/routes";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(buildOpenApiDocument(API_ROUTES), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
