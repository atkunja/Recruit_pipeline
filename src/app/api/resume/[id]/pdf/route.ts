import { badRequest, handleError, notFound, numericParam } from "@/lib/api";
import { getResumeVersion } from "@/lib/resume/repository";
import { renderResumePdf } from "@/lib/resume/pdf";

export const runtime = "nodejs";

/** Render a stored resume version to a one-page PDF on demand. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const versionId = numericParam(id);
    if (versionId === null) return badRequest("Invalid resume id");

    const version = await getResumeVersion(versionId);
    if (!version) return notFound("Resume version not found");

    const bytes = await renderResumePdf(version.content);

    const name = version.content.header.name.replace(/[^a-z0-9]+/gi, "_");
    const label = version.label.replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
    const filename = `${name}_Resume_${label}.pdf`;

    // ?download=1 forces a save dialog; the default opens it in the viewer.
    const download = new URL(request.url).searchParams.get("download") === "1";

    return new Response(bytes as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
        "cache-control": "private, max-age=60",
      },
    });
  } catch (error) {
    return handleError(error, "resume.pdf");
  }
}
