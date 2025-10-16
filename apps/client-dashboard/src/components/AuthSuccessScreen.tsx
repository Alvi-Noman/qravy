import { motion } from 'framer-motion';

/** Auth success scaffold with animation ending at current content width and Sidebar width (w-64). */
export default function AuthSuccessScreen() {
  return (
    <div className="flex h-screen bg-[#f5f5f5]">
      <aside className="h-full w-64 shrink-0 bg-[#f5f5f5] rounded-none shadow-none" />
      <main className="flex-1 flex items-start justify-center bg-[#f5f5f5]">
        <div className="flex-1 mr-4 my-2 h-[calc(100vh-1rem)] flex">
          <motion.div
            initial={{ scaleX: 0.96, opacity: 0.85 }}
            animate={{ scaleX: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
            className="origin-left w-full bg-[#fcfcfc] rounded-xl border border-[#ececec] h-full"
            style={{ minWidth: 0 }}
          />
        </div>
      </main>
    </div>
  );
}