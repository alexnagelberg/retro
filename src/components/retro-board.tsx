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

type EditingNote = {
  column: RetroColumn;
  noteId: string;
  text: string;
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
  const [participantId, setParticipantId] = useState("");
  const [editingNote, setEditingNote] = useState<EditingNote | null>(null);
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
      | { action: "stop" }
      | { action: "reset" }
      | { action: "addNote"; column: RetroColumn; text: string }
      | { action: "editNote"; column: RetroColumn; noteId: string; text: string }
      | { action: "deleteNote"; column: RetroColumn; noteId: string }
      | {
          action: "toggleThumbsUp";
          column: RetroColumn;
          noteId: string;
          participantId: string;
        },
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
        sessionError instanceof Error && sessionError.message
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
                sessionError instanceof Error && sessionError.message
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
          sessionError instanceof Error && sessionError.message
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

  useEffect(() => {
    const participantTimer = window.setTimeout(() => {
      let storedParticipantId = window.localStorage.getItem("retroParticipantId");

      if (!storedParticipantId) {
        storedParticipantId = crypto.randomUUID();
        window.localStorage.setItem("retroParticipantId", storedParticipantId);
      }

      setParticipantId(storedParticipantId);
    }, 0);

    return () => window.clearTimeout(participantTimer);
  }, []);

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
    const canAddToColumn = Boolean(
      session && (canAddNotes || column === "actionItems"),
    );

    if (!text || !canAddToColumn) {
      return;
    }

    setDrafts((currentDrafts) => ({ ...currentDrafts, [column]: "" }));
    updateSession({ action: "addNote", column, text });
  }

  function handleEditNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingNote?.text.trim()) {
      return;
    }

    updateSession({
      action: "editNote",
      column: editingNote.column,
      noteId: editingNote.noteId,
      text: editingNote.text,
    });
    setEditingNote(null);
  }

  function handleDeleteNote(column: RetroColumn, noteId: string) {
    if (editingNote?.column === column && editingNote.noteId === noteId) {
      setEditingNote(null);
    }

    updateSession({ action: "deleteNote", column, noteId });
  }

  function handleToggleThumbsUp(column: RetroColumn, noteId: string) {
    if (!participantId) {
      return;
    }

    updateSession({
      action: "toggleThumbsUp",
      column,
      noteId,
      participantId,
    });
  }

  async function handleExportPdf() {
    if (!sessionId) {
      return;
    }

    setError("");

    try {
      const response = await fetch(
        `/api/session/export?sessionId=${encodeURIComponent(sessionId)}`,
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "Unable to export the retro session.");
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = downloadUrl;
      link.download = `${sessionId}-retro.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (exportError) {
      setError(
        exportError instanceof Error && exportError.message
          ? exportError.message
          : "Unable to export the retro session.",
      );
    }
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

          <div className="no-print grid gap-3 rounded-lg border border-stone-300 bg-white p-4 shadow-sm sm:grid-cols-[auto_auto_auto] sm:items-end">
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
              disabled={isSaving}
              onClick={() =>
                updateSession(
                  session?.status === "running"
                    ? { action: "stop" }
                    : { action: "start", durationMinutes },
                )
              }
              type="button"
            >
              {session?.status === "running" ? "Stop timer" : "Start timer"}
            </button>
            <button
              className="h-10 rounded-md border border-stone-300 px-4 text-sm font-semibold text-stone-800 transition hover:border-stone-950 disabled:cursor-not-allowed disabled:text-stone-400"
              disabled={isSaving}
              onClick={handleExportPdf}
              type="button"
            >
              Export PDF
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
        </div>

        <p className="text-sm font-medium text-stone-600">
          Sessions are stored for 30 days, then expire automatically.
        </p>

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
                className="no-print grid gap-2 border-b border-stone-200 p-3"
                onSubmit={(event) => handleAddNote(event, column.key)}
              >
                {(() => {
                  const canAddToColumn =
                    Boolean(session && (canAddNotes || column.key === "actionItems"));
                  const placeholder = canAddToColumn
                    ? column.key === "actionItems"
                      ? "Add an action item..."
                      : "Add a note..."
                    : "Start the timer to add notes";

                  return (
                    <>
                <textarea
                  className="min-h-24 resize-none rounded-md border border-stone-300 p-3 text-sm leading-6 outline-none transition placeholder:text-stone-400 focus:border-stone-950 disabled:bg-stone-100"
                  disabled={!canAddToColumn || isSaving}
                  maxLength={280}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.value;

                    setDrafts((currentDrafts) => ({
                      ...currentDrafts,
                      [column.key]: nextValue,
                    }));
                  }}
                  placeholder={placeholder}
                  value={drafts[column.key]}
                />
                <button
                  className="h-9 rounded-md bg-stone-950 px-3 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                  disabled={
                    !canAddToColumn || isSaving || !drafts[column.key].trim()
                  }
                  type="submit"
                >
                  Add note
                </button>
                    </>
                  );
                })()}
              </form>

              <div className="grid content-start gap-3 overflow-y-auto p-3">
                {session?.columns[column.key].length ? (
                  session.columns[column.key].map((note) => (
                    <article
                      className="rounded-md border border-stone-200 bg-[#fffdf8] p-3 text-sm leading-6 text-stone-800 shadow-sm"
                      key={note.id}
                    >
                      {editingNote?.column === column.key &&
                      editingNote.noteId === note.id ? (
                        <form className="no-print grid gap-2" onSubmit={handleEditNote}>
                          <textarea
                            className="min-h-24 resize-none rounded-md border border-stone-300 p-3 text-sm leading-6 outline-none transition focus:border-stone-950 disabled:bg-stone-100"
                            disabled={isSaving}
                            maxLength={280}
                            onChange={(event) => {
                              const nextValue = event.currentTarget.value;

                              setEditingNote((currentEdit) =>
                                currentEdit
                                  ? {
                                      ...currentEdit,
                                      text: nextValue,
                                    }
                                  : currentEdit,
                              );
                            }}
                            value={editingNote.text}
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              className="rounded-md bg-stone-950 px-3 py-1 text-xs font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                              disabled={isSaving || !editingNote.text.trim()}
                              type="submit"
                            >
                              Save
                            </button>
                            <button
                              className="rounded-md border border-stone-300 px-3 py-1 text-xs font-semibold text-stone-700 transition hover:border-stone-950 disabled:cursor-not-allowed disabled:text-stone-400"
                              disabled={isSaving}
                              onClick={() => setEditingNote(null)}
                              type="button"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <p>{note.text}</p>
                      )}
                      <div className="no-print mt-3 flex flex-wrap items-center gap-2">
                        <button
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:text-stone-400 ${
                            note.thumbsUpParticipantIds?.includes(participantId)
                              ? "border-sky-600 bg-sky-50 text-sky-700"
                              : "border-stone-300 text-stone-700 hover:border-stone-950"
                          }`}
                          aria-label={`Thumbs up ${note.thumbsUpParticipantIds?.length ?? 0}`}
                          disabled={isSaving || !participantId}
                          onClick={() => handleToggleThumbsUp(column.key, note.id)}
                          type="button"
                        >
                          <svg
                            aria-hidden="true"
                            className="h-4 w-4"
                            fill={
                              note.thumbsUpParticipantIds?.includes(participantId)
                                ? "currentColor"
                                : "none"
                            }
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            viewBox="0 0 24 24"
                          >
                            <path d="M7 10v11" />
                            <path d="M15 6.5 14 10h5.2a2 2 0 0 1 2 2.4l-1.2 6a3 3 0 0 1-3 2.6H7V10h2.3a2 2 0 0 0 1.7-1l3-5a1.7 1.7 0 0 1 3.1 1.3L15 6.5Z" />
                            <path d="M3 10h4v11H3z" />
                          </svg>
                          <span>{note.thumbsUpParticipantIds?.length ?? 0}</span>
                        </button>
                        <button
                          className="rounded-md border border-stone-300 px-2 py-1 text-xs font-semibold text-stone-700 transition hover:border-stone-950 disabled:cursor-not-allowed disabled:text-stone-400"
                          disabled={isSaving}
                          onClick={() =>
                            setEditingNote({
                              column: column.key,
                              noteId: note.id,
                              text: note.text,
                            })
                          }
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="rounded-md border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 transition hover:border-red-500 disabled:cursor-not-allowed disabled:text-red-300"
                          disabled={isSaving}
                          onClick={() => handleDeleteNote(column.key, note.id)}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                      <p className="print-only mt-2 text-xs font-semibold text-stone-600">
                        Thumbs up: {note.thumbsUpParticipantIds?.length ?? 0}
                      </p>
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
