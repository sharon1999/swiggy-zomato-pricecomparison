import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { CartContext, useSwiggyCart } from "./cart.js";
import { Addresses } from "./components/Addresses.jsx";
import { CartPanel } from "./components/CartPanel.jsx";
import { Chat } from "./components/Chat.jsx";
import { Header } from "./components/Header.jsx";
import { SearchPanel } from "./components/SearchPanel.jsx";

export default function App() {
  const [status, setStatus] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const toastTimer = useRef(null);

  const toast = useCallback((msg) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 4500);
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api("/api/status"));
    } catch (err) {
      toast(`Couldn't reach the server: ${err.message}`);
    }
  }, [toast]);

  useEffect(() => {
    const msg = new URLSearchParams(location.search).get("auth");
    if (msg) {
      toast(msg);
      history.replaceState(null, "", "/");
    }
    loadStatus();
  }, [loadStatus, toast]);

  const swiggyLive = status?.platforms?.swiggy?.status === "connected";
  const cart = useSwiggyCart({ enabled: swiggyLive, toast });

  // Connecting/disconnecting changes where results come from: reload everything.
  const onConnectionChange = async () => {
    await loadStatus();
    setRefreshKey((k) => k + 1);
  };
  // A new delivery address changes prices, and the Swiggy cart's delivery fee.
  const onAddressChange = (platform) => {
    setRefreshKey((k) => k + 1);
    if (platform === "swiggy") cart.reload();
  };

  return (
    <CartContext.Provider value={cart}>
      <Header status={status} onChanged={onConnectionChange} toast={toast} />
      {toastMsg && (
        <div className="fixed bottom-5 left-1/2 z-10 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-xl bg-ink px-4 py-2.5 text-sm text-panel">
          {toastMsg}
        </div>
      )}
      <main className="mx-auto grid max-w-[1320px] grid-cols-1 gap-5 px-4 pb-10 pt-4 min-[961px]:grid-cols-[minmax(0,1fr)_400px] min-[961px]:px-6 min-[961px]:pt-5">
        {status ? (
          <SearchPanel refreshKey={refreshKey} addresses={<Addresses status={status} onChanged={onAddressChange} toast={toast} />} />
        ) : (
          <div className="py-8 text-center text-muted">Loading…</div>
        )}
        <aside className="flex min-w-0 flex-col gap-3 self-start min-[961px]:sticky min-[961px]:top-4">
          {swiggyLive && <CartPanel />}
          <Chat ai={!!status?.ai} />
        </aside>
      </main>
    </CartContext.Provider>
  );
}
