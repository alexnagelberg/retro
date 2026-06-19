import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getSession, getSessionId, type RetroColumn } from "@/lib/retro-session";

const columnLabels: Record<RetroColumn, string> = {
  wentWell: "Went well",
  needsImprovement: "Needs improvement",
  actionItems: "Action items",
  kudos: "Kudos",
};

const columnOrder: RetroColumn[] = [
  "wentWell",
  "needsImprovement",
  "actionItems",
  "kudos",
];

function sanitizePdfText(text: string) {
  return text.normalize("NFKD").replace(/[^\x20-\x7E]/g, "").trim();
}

function wrapText(text: string, maxLength = 88) {
  const words = sanitizePdfText(text).split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;

    if (nextLine.length > maxLength && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = nextLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length ? lines : [""];
}

export async function GET(request: NextRequest) {
  try {
    const sessionId = getSessionId(request.nextUrl.searchParams.get("sessionId"));
    const session = await getSession(sessionId);
    const pdf = await PDFDocument.create();
    const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
    const margin = 54;
    const lineHeight = 15;
    let page = pdf.addPage([612, 792]);
    let y = 742;

    const drawLine = (text: string, options?: { bold?: boolean; size?: number }) => {
      const size = options?.size ?? 11;

      if (y < 58) {
        page = pdf.addPage([612, 792]);
        y = 742;
      }

      page.drawText(sanitizePdfText(text), {
        x: margin,
        y,
        size,
        font: options?.bold ? boldFont : regularFont,
        color: rgb(0.12, 0.1, 0.09),
      });
      y -= lineHeight;
    };

    drawLine(`Sprint Retro: ${session.id}`, { bold: true, size: 16 });
    y -= 4;
    drawLine(`Status: ${session.status}`);
    drawLine(`Timer interval: ${session.durationMinutes} minutes`);
    drawLine(`Exported: ${new Date().toLocaleString("en-US")}`);
    y -= 10;

    for (const column of columnOrder) {
      drawLine(columnLabels[column], { bold: true, size: 13 });

      if (!session.columns[column].length) {
        drawLine("  No notes.");
      }

      session.columns[column].forEach((note, index) => {
        const noteLines = wrapText(note.text);
        const thumbsUpCount = note.thumbsUpParticipantIds.length;

        drawLine(`  ${index + 1}. ${noteLines[0]}`);
        noteLines.slice(1).forEach((line) => drawLine(`     ${line}`));
        drawLine(`     Thumbs up: ${thumbsUpCount}`);
        y -= 3;
      });

      y -= 9;
    }

    const pdfBytes = await pdf.save({ useObjectStreams: false });
    const pdfBody = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength,
    ) as ArrayBuffer;
    const fileName = `${session.id}-retro.pdf`;

    return new NextResponse(pdfBody, {
      headers: {
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": pdfBytes.byteLength.toString(),
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to export the retro session.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
