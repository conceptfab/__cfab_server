import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DATA_DIR = process.env.SYNC_DATA_DIR?.trim() || path.join(process.cwd(), "data");
const FEEDBACK_DIR = path.join(DATA_DIR, "feedback");

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const subject = formData.get("subject") as string;
    const message = formData.get("message") as string;
    const version = formData.get("version") as string;
    const attachments = formData.getAll("attachments") as File[];

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const reportId = `report-${timestamp}`;
    const reportPath = path.join(FEEDBACK_DIR, reportId);

    await mkdir(reportPath, { recursive: true });

    const metadata = {
      subject,
      message,
      version,
      timestamp,
      attachmentCount: attachments.length,
      attachments: attachments.map(f => f.name),
    };

    await writeFile(
      path.join(reportPath, "metadata.json"),
      JSON.stringify(metadata, null, 2)
    );

    for (const file of attachments) {
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      await writeFile(path.join(reportPath, file.name), buffer);
    }

    console.log(`[BugHunter] New report saved: ${reportId}`);

    return NextResponse.json({ ok: true, reportId });
  } catch (error) {
    console.error("[BugHunter] Failed to save report:", error);
    return NextResponse.json(
      { ok: false, error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
