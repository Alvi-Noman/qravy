/**
 * Dashboard shell.
 * - Dummy inbox removed
 * - Menu UI will be added in the next group
 */
export default function Dashboard() {
  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[#ececec] px-6 py-4">
        <h2 className="text-lg font-semibold text-[#2e2e30]">Dashboard</h2>
      </div>
      <div className="flex-1 p-6 text-[#5b5b5d]">
        {/* Menu items UI coming next */}
      </div>
    </div>
  );
}