import { motion } from 'framer-motion';

export default function AuthSuccessScreen() {
  return (
    <div className="flex h-screen bg-[#f5f5f5]">
      {/* Sidebar shape only */}
      <aside className="h-full w-64 bg-[#f5f5f5] rounded-none shadow-none" />
      {/* Main dashboard box shape only */}
      <main className="flex-1 flex items-start justify-center bg-[#f5f5f5]">
        <div className="flex-1 mr-4 my-2 h-[calc(100vh-1rem)] flex">
          <motion.div
            initial={{ width: '100vw' }}
            animate={{ width: '100%' }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            className="bg-[#fcfcfc] rounded-xl border border-[#ececec] h-full"
            style={{ minWidth: 0 }}
          />
        </div>
      </main>
    </div>
  );
}