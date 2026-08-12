/**
 * Route-level loading state.
 *
 * Pages are `force-dynamic` and query on every request, so without this the
 * browser shows the previous page until the new one is ready and a slow query
 * looks like a frozen app.
 */
export default function AppLoading() {
  return (
    <div className="animate-pulse">
      <div className="mb-4 h-6 w-48 rounded bg-surface" />
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="h-16 rounded-lg bg-surface" />
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="h-16 rounded-lg bg-surface" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
