import { NextResponse } from "next/server";
import { getAdminClient, isPushConfigured } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * Turn alerts off for a device.
 *
 * Knowing the full endpoint string is the capability here — it is opaque and
 * only the owning browser holds it. Opting out must always succeed cheaply,
 * so a missing row is reported as success rather than an error.
 */
export async function POST(request: Request) {
  if (!isPushConfigured()) {
    // Nothing could have been stored, so the caller is already unsubscribed.
    return NextResponse.json({ success: true });
  }

  let endpoint: string | undefined;
  try {
    ({ endpoint } = (await request.json()) as { endpoint?: string });
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!endpoint) {
    return NextResponse.json(
      { success: false, error: "endpoint is required" },
      { status: 400 }
    );
  }

  try {
    const { error } = await getAdminClient()
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint);

    if (error) {
      console.error("Push unsubscribe failed:", error.message);
      return NextResponse.json(
        { success: false, error: "Could not turn off alerts." },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("Push unsubscribe error:", err);
    return NextResponse.json(
      { success: false, error: "Could not turn off alerts." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
