import { NextRequest, NextResponse } from "next/server";
import {
  addNote,
  configureSession,
  deleteNote,
  editNote,
  getSession,
  getSessionId,
  resetSession,
  startSession,
  stopSession,
  toggleThumbsUp,
  type RetroColumn,
} from "@/lib/retro-session";

type SessionRequestBody = {
  action?:
    | "configure"
    | "start"
    | "stop"
    | "reset"
    | "addNote"
    | "editNote"
    | "deleteNote"
    | "toggleThumbsUp";
  sessionId?: string;
  durationMinutes?: number;
  column?: RetroColumn;
  noteId?: string;
  participantId?: string;
  text?: string;
};

function respondWithError(error: unknown, status = 400) {
  const message =
    error instanceof Error && error.message
      ? error.message
      : "Unable to reach the Redis session store.";

  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const sessionId = getSessionId(request.nextUrl.searchParams.get("sessionId"));
    const session = await getSession(sessionId);

    return NextResponse.json({ session });
  } catch (error) {
    const status =
      error instanceof Error && error.message === "A session id is required."
        ? 400
        : 500;

    return respondWithError(error, status);
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
      case "stop":
        session = await stopSession(sessionId);
        break;
      case "reset":
        session = await resetSession(sessionId);
        break;
      case "addNote":
        session = await addNote(sessionId, body.column as RetroColumn, body.text ?? "");
        break;
      case "editNote":
        session = await editNote(
          sessionId,
          body.column as RetroColumn,
          body.noteId ?? "",
          body.text ?? "",
        );
        break;
      case "deleteNote":
        session = await deleteNote(
          sessionId,
          body.column as RetroColumn,
          body.noteId ?? "",
        );
        break;
      case "toggleThumbsUp":
        session = await toggleThumbsUp(
          sessionId,
          body.column as RetroColumn,
          body.noteId ?? "",
          body.participantId ?? "",
        );
        break;
      default:
        return respondWithError(new Error("Unknown session action."));
    }

    return NextResponse.json({ session });
  } catch (error) {
    return respondWithError(error);
  }
}
