"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RetroColumn, RetroSession } from "@/lib/retro-session";

const columns: Array<{
  key: RetroColumn;
  title: string;
  accent: string;
}> = [
  { key: "wentWell", title: "Went well", accent: "border-emerald-500" },
  {
    key: "needsImprovement",
    title: "Needs improvement",
    accent: "border-amber-500",
  },
  { key: "actionItems", title: "Action items", accent: "border-sky-500" },
  { key: "kudos", title: "Kudos", accent: "border-fuchsia-500" },
];

function formatRemaining(milliseconds: number) {
  const totalSeconds = Math.max(Math.ceil(milliseconds / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function normalizeSessionId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function createSessionId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

type RetroBoardProps = {
  initialSessionId: string;
};

export function RetroBoard({ initialSessionId }: RetroBoardProps) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState(() =>
    normalizeSessionId(initialSessionId),
  );
  const [sessionInput, setSessionInput] = useState("");
  const [session, setSession] = useState<RetroSession | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(10);
  const [now, setNow] = useState(0);
  const [drafts, setDrafts] = useState<Record<RetroColumn, string>>({
    wentWell: "",
    needsImprovement: "",
    actionItems: "",
    kudos: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const shareUrl = `/${encodeURIComponent(sessionId)}`;

  const loadSession = useCallback(async () => {
    if (!sessionId) {
      return;
    }

    const response = await fetch(
      `/api/session?sessionId=${encodeURIComponent(sessionId)}`,
      {
        cache: "no-store",
      },
    );
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error ?? "Unable to load the retro session.");
    }

    setSession(data.session);
    setDurationMinutes(data.session.durationMinutes);
  }, [sessionId]);

  async function updateSession(
    payload:
      | { action: "configure" | "start"; durationMinutes: number }
      | { action: "reset" }
      | { action: "addNote"; column: RetroColumn; text: string },
  ) {
    if (!sessionId) {
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, ...payload }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to update the retro session.");
      }

      setSession(data.session);
      setDurationMinutes(data.session.durationMinutes);
    } catch (sessionError) {
      setError(
        sessionError instanceof Error
          ? sessionError.message
          : "Unable to update the retro session.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    let poll: number | undefined;
    let isCancelled = false;

    const schedulePoll = (delay: number) => {
      poll = window.setTimeout(() => {
        loadSession()
          .then(() => {
            if (!isCancelled) {
              schedulePoll(2000);
            }
          })
          .catch((sessionError) => {
            if (!isCancelled) {
              setError(
                sessionError instanceof Error
                  ? sessionError.message
                  : "Unable to load the retro session.",
              );
              schedulePoll(10000);
            }
          });
      }, delay);
    };

    const initialLoad = window.setTimeout(() => {
      loadSession().catch((sessionError) => {
        setError(
          sessionError instanceof Error
            ? sessionError.message
            : "Unable to load the retro session.",
        );
      });
    }, 0);

    schedulePoll(2000);

    const clock = window.setInterval(() => setNow(Date.now()), 500);

    return () => {
      isCancelled = true;
      window.clearTimeout(initialLoad);
      window.clearTimeout(poll);
      window.clearInterval(clock);
    };
  }, [loadSession, sessionId]);

  const remainingMs = useMemo(() => {
    if (!session?.startedAt || session.status !== "running") {
      return 0;
    }

    return session.startedAt + session.durationMinutes * 60 * 1000 - now;
  }, [now, session]);

  const canAddNotes = Boolean(session && session.status === "running" && remainingMs > 0);
  const statusText =
    session?.status === "running"
      ? "Collecting notes"
      : session?.status === "ended"
        ? "Timer ended"
        : "Waiting to start";

  function handleDurationChange(nextDuration: number) {
    const safeDuration = Math.min(Math.max(nextDuration, 1), 120);

    setDurationMinutes(safeDuration);

    if (session?.status !== "running") {
      updateSession({ action: "configure", durationMinutes: safeDuration });
    }
  }

  function handleAddNote(event: FormEvent<HTMLFormElement>, column: RetroColumn) {
    event.preventDefault();

    const text = drafts[column].trim();

    if (!text || !canAddNotes) {
      return;
    }

    setDrafts((currentDrafts) => ({ ...currentDrafts, [column]: "" }));
    updateSession({ action: "addNote", column, text });
  }

  function openSession(nextSessionId: string) {
    const safeSessionId = normalizeSessionId(nextSessionId);

    if (!safeSessionId) {
      setError("Enter a session name or create a new one.");
      return;
    }

    setError("");
    setSession(null);
    setDrafts({
      wentWell: "",
      needsImprovement: "",
      actionItems: "",
      kudos: "",
    });
    setSessionId(safeSessionId);
    router.push(`/${encodeURIComponent(safeSessionId)}`);
  }

  function handleJoinSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    openSession(sessionInput);
  }

  if (!sessionId) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f4ee] px-4 text-stone-950">
        <section className="w-full max-w-lg rounded-lg border border-stone-300 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
            Shared sprint retro
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-normal">
            Team retro board
          </h1>

          <div className="mt-6 grid gap-3">
            <button
              className="h-11 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-stone-800"
              onClick={() => openSession(createSessionId())}
              type="button"
            >
              Start session
            </button>

            <form className="grid gap-2" onSubmit={handleJoinSession}>
              <label className="grid gap-1 text-sm font-medium text-stone-700">
                Enter session
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input
                    className="h-11 rounded-md border border-stone-300 px-3 text-base outline-none transition focus:border-stone-950"
                    onChange={(event) => setSessionInput(event.currentTarget.value)}
                    placeholder="team-alpha-retro"
                    value={sessionInput}
                  />
                  <button
                    className="h-11 rounded-md border border-stone-300 px-4 text-sm font-semibold text-stone-800 transition hover:border-stone-950"
                    type="submit"
                  >
                    Open
                  </button>
                </div>
              </label>
            </form>
          </div>

          {error ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
              {error}
            </div>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f4ee] text-stone-950">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-stone-300 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
              Shared sprint retro
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-normal text-stone-950">
              Team retro board
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-stone-600">
              <span className="rounded-md border border-stone-300 bg-white px-2 py-1 font-mono text-stone-800">
                {sessionId}
              </span>
              <a
                className="font-semibold text-stone-800 underline-offset-4 hover:underline"
                href={shareUrl}
              >
                Share link
              </a>
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border border-stone-300 bg-white p-4 shadow-sm sm:grid-cols-[auto_auto_auto] sm:items-end">
            <label className="grid gap-1 text-sm font-medium text-stone-700">
              Timer interval
              <input
                className="h-10 w-28 rounded-md border border-stone-300 px-3 text-base font-semibold outline-none transition focus:border-stone-950 disabled:bg-stone-100"
                disabled={session?.status === "running" || isSaving}
                min={1}
                max={120}
                type="number"
                value={durationMinutes}
                onChange={(event) =>
                  handleDurationChange(Number(event.currentTarget.value))
                }
              />
            </label>
            <button
              className="h-10 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
              disabled={session?.status === "running" || isSaving}
              onClick={() => updateSession({ action: "start", durationMinutes })}
              type="button"
            >
              Start timer
            </button>
            <button
              className="h-10 rounded-md border border-stone-300 px-4 text-sm font-semibold text-stone-800 transition hover:border-stone-950 disabled:cursor-not-allowed disabled:text-stone-400"
              disabled={isSaving}
              onClick={() => updateSession({ action: "reset" })}
              type="button"
            >
              Reset
            </button>
          </div>
        </header>

        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm">
              {statusText}
            </span>
            <span className="font-mono text-5xl font-semibold tabular-nums text-stone-950">
              {session?.status === "running"
                ? formatRemaining(remainingMs)
                : `${durationMinutes}:00`}
            </span>
          </div>

          <p className="text-sm font-medium text-stone-600">
            Notes open only while the timer is running.
          </p>
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}

        <div className="grid flex-1 gap-4 lg:grid-cols-4">
          {columns.map((column) => (
            <section
              className={`flex min-h-[28rem] flex-col rounded-lg border-t-4 ${column.accent} bg-white shadow-sm`}
              key={column.key}
            >
              <div className="border-b border-stone-200 px-4 py-3">
                <h2 className="text-lg font-semibold text-stone-950">
                  {column.title}
                </h2>
                <p className="text-sm text-stone-500">
                  {session?.columns[column.key].length ?? 0} notes
                </p>
              </div>

              <form
                className="grid gap-2 border-b border-stone-200 p-3"
                onSubmit={(event) => handleAddNote(event, column.key)}
              >
                <textarea
                  className="min-h-24 resize-none rounded-md border border-stone-300 p-3 text-sm leading-6 outline-none transition placeholder:text-stone-400 focus:border-stone-950 disabled:bg-stone-100"
                  disabled={!canAddNotes || isSaving}
                  maxLength={280}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.value;

                    setDrafts((currentDrafts) => ({
                      ...currentDrafts,
                      [column.key]: nextValue,
                    }));
                  }}
                  placeholder={
                    canAddNotes ? "Add a note..." : "Start the timer to add notes"
                  }
                  value={drafts[column.key]}
                />
                <button
                  className="h-9 rounded-md bg-stone-950 px-3 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                  disabled={!canAddNotes || isSaving || !drafts[column.key].trim()}
                  type="submit"
                >
                  Add note
                </button>
              </form>

              <div className="grid content-start gap-3 overflow-y-auto p-3">
                {session?.columns[column.key].length ? (
                  session.columns[column.key].map((note) => (
                    <article
                      className="rounded-md border border-stone-200 bg-[#fffdf8] p-3 text-sm leading-6 text-stone-800 shadow-sm"
                      key={note.id}
                    >
                      {note.text}
                    </article>
                  ))
                ) : (
                  <p className="rounded-md border border-dashed border-stone-300 p-4 text-sm text-stone-500">
                    No notes yet.
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}
