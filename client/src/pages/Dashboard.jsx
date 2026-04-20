import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';

const ROLE_LABELS = { employee: 'Employee', manager: 'Manager', boss: 'Boss' };

export default function Dashboard() {
  const { user, logout } = useAuth();

  return (
    <div className="flex items-center justify-center min-h-screen px-4">
      <motion.div
        className="glass p-8 w-full max-w-lg text-center"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35 }}
      >
        <div className="w-14 h-14 rounded-full bg-violet-600/40 border border-violet-400/40 flex items-center justify-center text-2xl font-bold mx-auto mb-4">
          {user?.name?.[0]?.toUpperCase()}
        </div>
        <h2 className="text-xl font-bold">{user?.name}</h2>
        <p className="text-white/50 text-sm mt-1">{user?.email}</p>
        <span className="inline-block mt-3 px-3 py-1 text-xs font-semibold rounded-full bg-violet-500/20 border border-violet-500/40 text-violet-300">
          {ROLE_LABELS[user?.role]}
        </span>

        <p className="text-white/30 text-sm mt-8 mb-6">
          Dashboard shells coming in Phase 2.
        </p>

        <button
          onClick={logout}
          className="px-6 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm transition"
        >
          Sign Out
        </button>
      </motion.div>
    </div>
  );
}
