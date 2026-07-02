import { createClient } from "redis";

export type RetroColumn = "wentWell" | "needsImprovement" | "actionItems" | "kudos";

export type RetroNote = {
  id: string;
  text: string;
  createdAt: number;
  thumbsUpParticipantIds: string[];
};

export type RetroSession = {
  id: string;
  durationMinutes: number;
  startedAt: number | null;
  status: "idle" | "running" | "ended";
  columns: Record<RetroColumn, RetroNote[]>;
};

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_DURATION_MINUTES = 10;

const columnKeys: RetroColumn[] = [
  "wentWell",
  "needsImprovement",
  "actionItems",
  "kudos",
];

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const redis = createClient({
  url: redisUrl,
  socket: {
    connectTimeout: 1000,
    reconnectStrategy: false,
  },
});

redis.on("error", (error) => {
  console.error("Redis connection error", error);
});

let redisConnection: Promise<typeof redis> | null = null;

async function getRedis() {
  redisConnection ??= redis.connect().then(() => redis);

  try {
    return await redisConnection;
  } catch (error) {
    redisConnection = null;
    throw error;
  }
}

function sessionKey(sessionId: string) {
  return `retro:session:${sessionId}`;
}

function createDefaultSession(sessionId: string): RetroSession {
  return {
    id: sessionId,
    durationMinutes: DEFAULT_DURATION_MINUTES,
    startedAt: null,
    status: "idle",
    columns: {
      wentWell: [],
      needsImprovement: [],
      actionItems: [],
      kudos: [],
    },
  };
}

function clampDurationMinutes(durationMinutes: number) {
  if (!Number.isFinite(durationMinutes)) {
    return DEFAULT_DURATION_MINUTES;
  }

  return Math.min(Math.max(Math.round(durationMinutes), 1), 120);
}

function normalizeSession(session: RetroSession): RetroSession {
  const normalizedSession: RetroSession = {
    ...session,
    columns: {
      wentWell: session.columns.wentWell.map(normalizeNote),
      needsImprovement: session.columns.needsImprovement.map(normalizeNote),
      actionItems: session.columns.actionItems.map(normalizeNote),
      kudos: session.columns.kudos.map(normalizeNote),
    },
  };

  if (normalizedSession.status !== "running" || !normalizedSession.startedAt) {
    return normalizedSession;
  }

  const endsAt =
    normalizedSession.startedAt + normalizedSession.durationMinutes * 60 * 1000;

  if (Date.now() < endsAt) {
    return normalizedSession;
  }

  return {
    ...normalizedSession,
    status: "ended",
  };
}

function normalizeNote(note: RetroNote): RetroNote {
  return {
    ...note,
    thumbsUpParticipantIds: Array.isArray(note.thumbsUpParticipantIds)
      ? note.thumbsUpParticipantIds
      : [],
  };
}

async function saveSession(session: RetroSession) {
  const client = await getRedis();
  await client.set(sessionKey(session.id), JSON.stringify(session), {
    EX: SESSION_TTL_SECONDS,
  });
  return session;
}

export function getSessionId(value?: string | null) {
  const sessionId = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);

  if (!sessionId) {
    throw new Error("A session id is required.");
  }

  return sessionId;
}

export async function getSession(sessionId: string) {
  const client = await getRedis();
  const rawSession = await client.get(sessionKey(sessionId));
  const session = rawSession
    ? (JSON.parse(rawSession) as RetroSession)
    : createDefaultSession(sessionId);
  const normalizedSession = normalizeSession(session);

  if (normalizedSession.status !== session.status) {
    await saveSession(normalizedSession);
  }

  return normalizedSession;
}

export async function configureSession(
  sessionId: string,
  durationMinutes: number,
) {
  const session = await getSession(sessionId);

  if (session.status === "running") {
    throw new Error("The timer is running, so the duration cannot be changed.");
  }

  return saveSession({
    ...session,
    durationMinutes: clampDurationMinutes(durationMinutes),
  });
}

export async function startSession(sessionId: string, durationMinutes: number) {
  const session = await getSession(sessionId);

  if (session.status === "running") {
    return session;
  }

  return saveSession({
    ...session,
    durationMinutes: clampDurationMinutes(durationMinutes),
    startedAt: Date.now(),
    status: "running",
  });
}

export async function stopSession(sessionId: string) {
  const session = await getSession(sessionId);

  if (session.status !== "running") {
    return session;
  }

  return saveSession({
    ...session,
    status: "ended",
  });
}

export async function resetSession(sessionId: string) {
  return saveSession(createDefaultSession(sessionId));
}

export async function addNote(
  sessionId: string,
  column: RetroColumn,
  noteText: string,
) {
  if (!columnKeys.includes(column)) {
    throw new Error("Unknown retro column.");
  }

  const session = await getSession(sessionId);

  if (column !== "actionItems" && session.status !== "running") {
    throw new Error("Notes can only be added while the timer is running.");
  }

  const text = noteText.trim();

  if (!text) {
    throw new Error("Notes cannot be empty.");
  }

  const note: RetroNote = {
    id: crypto.randomUUID(),
    text: text.slice(0, 280),
    createdAt: Date.now(),
    thumbsUpParticipantIds: [],
  };

  return saveSession({
    ...session,
    columns: {
      ...session.columns,
      [column]: [note, ...session.columns[column]],
    },
  });
}

export async function editNote(
  sessionId: string,
  column: RetroColumn,
  noteId: string,
  noteText: string,
) {
  if (!columnKeys.includes(column)) {
    throw new Error("Unknown retro column.");
  }

  const text = noteText.trim();

  if (!text) {
    throw new Error("Notes cannot be empty.");
  }

  const session = await getSession(sessionId);
  const notes = session.columns[column];
  const noteIndex = notes.findIndex((note) => note.id === noteId);

  if (noteIndex === -1) {
    throw new Error("Note not found.");
  }

  const updatedNotes = notes.map((note, index) =>
    index === noteIndex
      ? {
          ...normalizeNote(note),
          text: text.slice(0, 280),
        }
      : note,
  );

  return saveSession({
    ...session,
    columns: {
      ...session.columns,
      [column]: updatedNotes,
    },
  });
}

export async function deleteNote(
  sessionId: string,
  column: RetroColumn,
  noteId: string,
) {
  if (!columnKeys.includes(column)) {
    throw new Error("Unknown retro column.");
  }

  const session = await getSession(sessionId);
  const notes = session.columns[column];

  if (!notes.some((note) => note.id === noteId)) {
    throw new Error("Note not found.");
  }

  return saveSession({
    ...session,
    columns: {
      ...session.columns,
      [column]: notes.filter((note) => note.id !== noteId),
    },
  });
}

export async function toggleThumbsUp(
  sessionId: string,
  column: RetroColumn,
  noteId: string,
  participantId: string,
) {
  if (!columnKeys.includes(column)) {
    throw new Error("Unknown retro column.");
  }

  const safeParticipantId = participantId.trim().slice(0, 80);

  if (!safeParticipantId) {
    throw new Error("A participant id is required.");
  }

  const session = await getSession(sessionId);
  const notes = session.columns[column];
  const noteIndex = notes.findIndex((note) => note.id === noteId);

  if (noteIndex === -1) {
    throw new Error("Note not found.");
  }

  const note = normalizeNote(notes[noteIndex]);
  const hasThumbsUp = note.thumbsUpParticipantIds.includes(safeParticipantId);
  const thumbsUpParticipantIds = hasThumbsUp
    ? note.thumbsUpParticipantIds.filter((id) => id !== safeParticipantId)
    : [...note.thumbsUpParticipantIds, safeParticipantId];
  const updatedNotes = notes.map((currentNote, index) =>
    index === noteIndex
      ? {
          ...note,
          thumbsUpParticipantIds,
        }
      : currentNote,
  );

  return saveSession({
    ...session,
    columns: {
      ...session.columns,
      [column]: updatedNotes,
    },
  });
}

export async function setRefreshedEpoch(epochSeconds = Math.floor(Date.now() / 1000)) {
  const client = await getRedis();

  await client.set("REFRESHED", epochSeconds.toString());

  return epochSeconds;
}
