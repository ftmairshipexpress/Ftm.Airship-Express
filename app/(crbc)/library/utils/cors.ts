import { NextResponse } from "next/server";

export const CORS_METHODS = {
  GET: ["GET", "OPTIONS"],
  PATCH: ["PATCH", "OPTIONS"],
  POST: ["POST", "OPTIONS"],
  PUT: ["PUT", "OPTIONS"],
  DELETE: ["DELETE", "OPTIONS"],
} as const;

const ALLOWED_ORIGIN = "http://localhost:5173"; 

export function getCorsHeaders(
    methods: readonly string[]
){
    return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": methods.join(", "),
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    };
}

export function corsOptionsResponse(
  methods: readonly string[]
) {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(methods),
  });
}
