import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Inline attachments are stored as base64 in Postgres. Anything larger than this
// (per file) is kept as metadata only — feedback isn't a file store.
const MAX_INLINE_ATTACHMENT_BYTES = 2 * 1024 * 1024; // 2 MB

interface StoredAttachment {
  name: string;
  contentType: string;
  size: number;
  dataBase64: string | null;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const subject = (formData.get("subject") as string | null) ?? null;
    const message = (formData.get("message") as string | null) ?? null;
    const version = (formData.get("version") as string | null) ?? null;
    const files = formData.getAll("attachments").filter((f): f is File => f instanceof File);

    const attachments: StoredAttachment[] = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const tooLarge = buffer.byteLength > MAX_INLINE_ATTACHMENT_BYTES;
      attachments.push({
        name: file.name,
        contentType: file.type || "application/octet-stream",
        size: buffer.byteLength,
        dataBase64: tooLarge ? null : buffer.toString("base64"),
      });
    }

    const reportId = randomUUID();
    await prisma.feedback.create({
      data: {
        id: reportId,
        subject,
        message,
        version,
        attachments: attachments as unknown as Prisma.InputJsonValue,
      },
    });

    console.log(`[BugHunter] New report saved: ${reportId}`);

    return NextResponse.json({ ok: true, reportId });
  } catch (error) {
    console.error("[BugHunter] Failed to save report:", error);
    return NextResponse.json(
      { ok: false, error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
