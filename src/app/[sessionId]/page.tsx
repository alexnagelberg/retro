import { RetroBoard } from "@/components/retro-board";

type SessionPageProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export default async function SessionPage({ params }: SessionPageProps) {
  const { sessionId } = await params;

  return <RetroBoard initialSessionId={sessionId} />;
}
