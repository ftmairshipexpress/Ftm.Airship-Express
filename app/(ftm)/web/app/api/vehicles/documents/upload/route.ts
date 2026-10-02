import { NextResponse } from "next/server";
import { hasPermission } from "../../../../lib/permissions";
import { authenticateFtmRequest } from "../../../../lib/server/ftmRequestAuth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authenticateFtmRequest(request);
  if (!("context" in auth)) return auth.response;
  if (!hasPermission(auth.context.user.role, "fvm", "create")) return NextResponse.json({ error: "Permission denied: fvm.create" }, { status: 403 });
  let body: { path?: string; content?: string; content_type?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "A valid JSON request body is required." }, { status: 400 });
  }
  if (!body.path || !body.content) return NextResponse.json({ error: "path and content are required" }, { status: 400 });
  const file = Buffer.from(body.content, "base64");
  if (!file.length) return NextResponse.json({ error: "Document content is empty" }, { status: 400 });
  if (file.length > 15 * 1024 * 1024) return NextResponse.json({ error: "Document file is too large" }, { status: 413 });

  const supabase = auth.context.serviceClient;
  const bucketName = "vehicle-documents";
  const { data: buckets, error: bucketLookupError } = await supabase.storage.listBuckets();
  const exists = !bucketLookupError && (buckets || []).some((bucket) => bucket.id === bucketName || bucket.name === bucketName);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(bucketName, { public: false });
    if (error && !/already exists|duplicate/i.test(error.message)) {
      return NextResponse.json({ error: "Unable to initialize document storage", details: error.message }, { status: 503 });
    }
  }
  const { error } = await supabase.storage.from(bucketName).upload(body.path, file, {
    contentType: body.content_type || "application/octet-stream",
    upsert: false,
  });
  if (error) return NextResponse.json({ error: "Unable to upload vehicle document", details: error.message }, { status: 500 });
  return NextResponse.json({ path: body.path }, { status: 201 });
}