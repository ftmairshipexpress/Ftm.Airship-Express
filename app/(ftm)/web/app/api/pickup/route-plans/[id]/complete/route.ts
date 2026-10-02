import { handlePickupRequest } from "../../../../../lib/server/ftmPickup";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = (request: Request, { params }: { params: { id: string } }) => handlePickupRequest(request, `/route-plans/${encodeURIComponent(params.id)}/complete`);