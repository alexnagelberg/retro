import { NextRequest, NextResponse } from "next/server";
import { setRefreshedEpoch } from "@/lib/retro-session";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const authorization = request.headers.get("authorization");

    if (authorization !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const refreshed = await setRefreshedEpoch();

    return NextResponse.json({ refreshed });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to refresh Redis key.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
