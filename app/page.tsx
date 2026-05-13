import BoardList from "@/components/BoardList";

export default function HomePage() {
  return (
    <main className="min-h-screen p-8 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Miro Style</h1>
          <p className="text-slate-500 mt-1">Shapes &amp; AI mindmaps. Boards live in your browser.</p>
        </div>
      </header>
      <BoardList />
    </main>
  );
}
