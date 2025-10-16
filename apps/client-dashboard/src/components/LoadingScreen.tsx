export default function LoadingScreen() {
  return (
    <div className="flex h-screen bg-[#f5f5f5]">
      <aside className="h-full w-64 shrink-0 bg-[#f5f5f5]" />
      <main className="flex-1 flex items-start justify-center bg-[#f5f5f5]">
        <div className="flex-1 mr-4 my-2 h-[calc(100vh-1rem)] flex">
          <div
            className="bg-[#fcfcfc] rounded-xl border border-[#ececec] h-full w-full"
            style={{ minWidth: 0 }}
          />
        </div>
      </main>
    </div>
  );
}