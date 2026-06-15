import { NextRequest, NextResponse } from "next/server";
import {
  addNote,
  configureSession,
  getSession,
  getSessionId,
  resetSession,
  startSession,
  type RetroColumn,
} from "@/lib/retro-session";

type SessionRequestBody = {
  action?: "configure" | "start" | "reset" | "addNote";
  sessionId?: string;
  durationMinutes?: number;
  column?: RetroColumn;
  text?: string;
};

function respondWithError(error: unknown, status = 400) {
  const message =
    error instanceof Error ? error.message : "Unable to update the session.";

  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const sessionId = getSessionId(request.nextUrl.searchParams.get("sessionId"));
    const session = await getSession(sessionId);

    return NextResponse.json({ session });
  } catch (error) {
    return respondWithError(error, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SessionRequestBody;
    const sessionId = getSessionId(body.sessionId);
    let session;

    switch (body.action) {
      case "configure":
        session = await configureSession(sessionId, Number(body.durationMinutes));
        break;
      case "start":
        session = await startSession(sessionId, Number(body.durationMinutes));
        break;
      case "reset":
        session = await resetSession(sessionId);
        break;
      case "addNote":
        session = await addNote(sessionId, body.column as RetroColumn, body.text ?? "");
        break;
      default:
        return respondWithError(new Error("Unknown session action."));
    }

    return NextResponse.json({ session });
  } catch (error) {
    return respondWithError(error);
  }
}
