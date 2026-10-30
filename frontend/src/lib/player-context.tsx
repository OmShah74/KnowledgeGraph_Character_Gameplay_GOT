"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

const KEY = "got.activePlayer";

type Ctx = { playerId: string | null; setPlayerId: (id: string | null) => void; ready: boolean };

const PlayerContext = createContext<Ctx>({ playerId: null, setPlayerId: () => {}, ready: false });

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [playerId, setState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setState(window.localStorage.getItem(KEY));
    } catch {
      /* storage unavailable (private mode) — keep in memory only */
    }
    setReady(true);
  }, []);

  const setPlayerId = useCallback((id: string | null) => {
    setState(id);
    try {
      if (id) window.localStorage.setItem(KEY, id);
      else window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return <PlayerContext.Provider value={{ playerId, setPlayerId, ready }}>{children}</PlayerContext.Provider>;
}

export const usePlayer = () => useContext(PlayerContext);
