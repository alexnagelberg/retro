import { createClient } from "redis";

export type RetroColumn = "wentWell" | "needsImprovement" | "actionItems" | "kudos";

export type RetroNote = {
  id: string;
  text: string;
  createdAt: number;
};

export type RetroSession = {
  id: string;
  durationMinutes: number;
  startedAt: number | null;
  status: "idle" | "running" | "ended";
  columns: Record<RetroColumn, RetroNote[]>;
};

const SESSION_TTL_SECONDS = 60 * 60 * 24;
const DEFAULT_DURATION_MINUTES = 10;
const DEFAULT_SESSION_ID = "team-retro";

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

function createDefaultSession(sessionId = DEFAULT_SESSION_ID): RetroSession {
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
  if (session.status !== "running" || !session.startedAt) {
    return session;
  }

  const endsAt = session.startedAt + session.durationMinutes * 60 * 1000;

  if (Date.now() < endsAt) {
    return session;
  }

  return {
    ...session,
    status: "ended",
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
  return value?.trim() || DEFAULT_SESSION_ID;
}

export async function getSession(sessionId = DEFAULT_SESSION_ID) {
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

  if (session.status !== "running") {
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
  };

  return saveSession({
    ...session,
    columns: {
      ...session.columns,
      [column]: [note, ...session.columns[column]],
    },
  });
}
