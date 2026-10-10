import { NextResponse } from "next/server";

export const runtime = "nodejs";

const document = {
  openapi: "3.1.0",
  info: {
    title: "CrabbyTab Read-only Tournament API",
    version: "1.0.0",
    description: "Read-only access to released tournament draws, or to all draws when using an administrator-issued read:draws token. Tokens never grant write access.",
  },
  servers: [{ url: "/" }],
  paths: {
    "/api/v1/tournaments/{slug}/draws": {
      get: {
        operationId: "getTournamentDraws",
        summary: "List visible tournament draws",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "slug",
            in: "path",
            required: true,
            schema: { type: "string", pattern: "^[a-z0-9-]{1,40}$" },
          },
          {
            name: "roundSeq",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1 },
            description: "Limit the response to one round sequence number.",
          },
        ],
        responses: {
          "200": {
            description: "Tournament metadata, rounds, and redacted debate assignments.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["tournament", "rounds", "debates"],
                  properties: {
                    tournament: { type: "object" },
                    rounds: { type: "array", items: { type: "object" } },
                    debates: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
          "401": { description: "Missing, invalid, or revoked API token." },
          "403": { description: "Token scope does not permit the requested data." },
          "404": { description: "Tournament or requested round not found." },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "CrabbyTab API token" },
    },
  },
};

export async function GET() {
  return NextResponse.json(document, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
