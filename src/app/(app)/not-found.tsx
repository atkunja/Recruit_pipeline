import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-16">
      <div className="panel p-5">
        <h1 className="mb-1 text-[15px] font-semibold">Not found</h1>
        <p className="mb-4 text-muted">
          That job, application or page doesn&apos;t exist. It may have been
          ignored, collapsed into a duplicate, or removed when its source stopped
          listing it.
        </p>
        <div className="flex items-center gap-2">
          <Link
            href="/discover"
            className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg"
          >
            Back to Discover
          </Link>
          <Link
            href="/"
            className="rounded-md border border-border px-3 py-1.5 text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            Today
          </Link>
        </div>
      </div>
    </div>
  );
}
