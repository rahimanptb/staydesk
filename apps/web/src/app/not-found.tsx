export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-sm text-[var(--text-muted)]">
        The page you are looking for does not exist.
      </p>
    </main>
  );
}
