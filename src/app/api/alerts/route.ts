import { NextResponse } from "next/server";
import { fetchKeralaAlerts } from "@/lib/sachet";

export const revalidate = 600; // official alert feed: 10-minute cache

// Vercel's default function timeout is 10s. This route is network-bound
// against Indian government / weather endpoints from a US-region function,
// so it is given the full Hobby-tier headroom rather than risking a
// timeout during an event. 60s is the Hobby maximum.
export const maxDuration = 60;

/**
 * Official alerts for Kerala from the SACHET CAP feed (IMD / CWC / SDMA).
 * `success: false` means the government feed was unreachable — an empty
 * `alerts` array with `success: true` means "reachable, nothing active".
 */
export async function GET() {
  const alerts = await fetchKeralaAlerts();

  if (alerts === null) {
    return NextResponse.json(
      { success: false, error: "Official alert feed (SACHET) unreachable" },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, alerts });
}
