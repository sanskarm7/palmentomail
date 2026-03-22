'use client';

import { useEffect, useState, useRef, useMemo } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import Image from "next/image";

interface Item {
  id: number;
  emailId: string;
  userId: string;
  deliveryDate: string | null;
  rawSenderText: string | null;
  imgHash: string | null;
  imgStoragePath: string | null;
  llmSenderName: string | null;
  llmRecipientName: string | null;
  llmMailType: string | null;
  llmSummary: string | null;
  llmIsImportant: boolean | null;
  llmImportanceReason: string | null;
}

export default function Home() {
  const { data: session, status } = useSession();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [ingestLogs, setIngestLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [isRescanning, setIsRescanning] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [activeRecipient, setActiveRecipient] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [guestCode, setGuestCode] = useState("");
  const [guestError, setGuestError] = useState("");

  const stats = useMemo(() => {
    const uniqueMap = new Map<string, { name: string; count: number; pinned: boolean }>();
    
    // 1. Pre-register pinned inbox names from the environment wrapper
    let pinnedEnv = process.env.NEXT_PUBLIC_PINNED_RECIPIENTS || "";
    pinnedEnv = pinnedEnv.replace(/"/g, ""); // Strip any Webpack/Next.js escaped literal quotes
    if (pinnedEnv) {
      pinnedEnv.split(",").forEach(name => {
        const trimmed = name.trim();
        if (trimmed) {
          uniqueMap.set(trimmed.toLowerCase(), { name: trimmed, count: 0, pinned: true });
        }
      });
    }

    let unnamedCount = 0;

    // 2. Tally existing mail piece distributions
    items.forEach(it => {
      const raw = it.llmRecipientName?.trim() || "";
      const lower = raw.toLowerCase();
      if (lower === "" || lower === "null" || lower === "current resident") {
        unnamedCount++;
      } else {
        if (!uniqueMap.has(lower)) {
          uniqueMap.set(lower, { name: raw, count: 0, pinned: false });
        }
        uniqueMap.get(lower)!.count++;
      }
    });

    // 3. Sort logic: Pinned inboxes stay exactly in their .env.local declaration order, followed by guests sorted by volume descending
    const envOrder = pinnedEnv.split(",").map(n => n.trim().toLowerCase());
    
    return Array.from(uniqueMap.values()).sort((a, b) => {
      // Pinned vs Non-Pinned
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      
      // Both Pinned: Enforce static environment declaration order
      if (a.pinned && b.pinned) {
        return envOrder.indexOf(a.name.toLowerCase()) - envOrder.indexOf(b.name.toLowerCase());
      }
      
      // Both Non-Pinned: Sort by raw mail count descending
      return b.count - a.count;
    });
  }, [items]);

  const filteredItems = useMemo(() => {
    if (!activeRecipient) return items;
    return items.filter(it => {
      const lower = (it.llmRecipientName?.trim() || "").toLowerCase();
      return lower === activeRecipient.toLowerCase();
    });
  }, [items, activeRecipient]);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [ingestLogs]);

  async function handleRescan(id: number) {
    if (!selectedItem || isRescanning) return;
    setIsRescanning(true);
    try {
      const res = await fetch(`/api/mail/${id}/rescan`, { method: "POST" });
      if (!res.ok) throw new Error("Rescan failed");
      const { item } = await res.json();

      // Update global list dynamically
      setItems(prev => prev.map(it => it.id === id ? item : it));
      // Update modal view recursively
      setSelectedItem(item);
    } catch (err) {
      console.error(err);
      alert("Failed to rescan mail piece. See console for details.");
    } finally {
      setIsRescanning(false);
    }
  }

  async function ingest() {
    if (loading) return;
    setLoading(true);
    setShowLogs(true);
    setIngestLogs(["Initializing secure connection to USPS & Gemini..."]);

    try {
      const response = await fetch('/api/ingest');
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || "";

          for (const msg of parts) {
            if (msg.startsWith('data: ')) {
              try {
                const data = JSON.parse(msg.slice(6));
                if (data.type === 'log') {
                  setIngestLogs(prev => [...prev, data.message]);
                } else if (data.type === 'error') {
                  setIngestLogs(prev => [...prev, `❌ Error: ${data.error}`]);
                }
              } catch (e) { }
            }
          }
        }
      }
    } catch (e) {
      setIngestLogs(prev => [...prev, `❌ Network connection failed.`]);
    }

    setLoading(false);
    await loadQueue();
  }

  async function loadQueue() {
    const res = await fetch('/api/queue');
    if (res.ok) {
      const data = await res.json();
      setItems(data.items || []);
    }
  }

  useEffect(() => {
    if (session) {
      loadQueue();
    } else {
      const match = document.cookie.split('; ').find(row => row.startsWith('guest_active='));
      if (match && match.split('=')[1] === 'true') {
        setIsGuest(true);
        loadQueue();
      }
    }
  }, [session]);

  if (status === "loading") {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 animate-pulse text-lg tracking-wide">Loading workspace...</div>
      </div>
    );
  }

  if (!session && !isGuest) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-[#15263a]">
        <div className="mb-8 flex items-center gap-4">
          <Image src="/palmentomail_logo.png" alt="palmentomail Logo" width={80} height={80} className="rounded-2xl shadow-xl" />
          <h1 className="text-6xl font-extrabold text-white tracking-tight">palmentomail</h1>
        </div>
        <p className="mb-10 text-blue-200 text-lg tracking-wide font-light">Intelligent USPS Physical Mail Processing</p>

        <button
          onClick={() => signIn('google')}
          className="px-8 py-3.5 rounded-full bg-white text-[#15263a] font-bold text-lg hover:bg-gray-100 shadow-[0_0_20px_rgba(255,255,255,0.15)] transition-transform hover:scale-105 active:scale-95 flex items-center gap-3"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
          Sign in with Google
        </button>

        <div className="mt-10 pt-8 border-t border-white/10 w-full max-w-xs flex flex-col items-center gap-3">
          <input
            type="text"
            placeholder="Enter Guest Code"
            value={guestCode}
            onChange={(e) => setGuestCode(e.target.value.toUpperCase())}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && guestCode) {
                setGuestError("");
                const res = await fetch('/api/auth/guest', { method: 'POST', body: JSON.stringify({ code: guestCode }) });
                if (res.ok) { setIsGuest(true); loadQueue(); } else { setGuestError("Invalid or inactive code."); }
              }
            }}
            className="w-full px-5 py-3 rounded-xl bg-[#0a1526] text-white border border-[#2a4566] text-center uppercase tracking-widest font-bold placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
          />
          {guestError && <p className="text-red-400 text-sm font-medium">{guestError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex overflow-hidden bg-[#15263a] font-sans">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* SIDEBAR */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-[#15263a] text-white flex flex-col shrink-0 transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}>
        <div className="p-6 flex items-center gap-3">
          <Image src="/palmentomail_logo.png" alt="Logo" width={52} height={52} className="object-contain shrink-0 drop-shadow-md" />
          <span className="text-2xl font-bold tracking-tight">palmentomail</span>
        </div>

        <div className="px-5 mb-8 mt-2 flex flex-col gap-3">
          {!isGuest && (
            <button
              onClick={ingest}
              disabled={loading}
              className="w-full py-3.5 px-4 bg-[#1f3653] hover:bg-[#2a4566] active:bg-[#1f3653] disabled:opacity-50 disabled:text-gray-400 text-white rounded-xl font-semibold transition-colors flex items-center justify-center shadow-lg shrink-0"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  Processing...
                </span>
              ) : "Fetch Mail"}
            </button>
          )}

          {/* LOGS WINDOW */}
          {showLogs && (
            <div className="bg-[#0a121d] rounded-xl flex flex-col h-64 border border-[#1f3653] shadow-inner transition-all relative group overflow-hidden">
              {/* Close Button */}
              <button
                onClick={() => setShowLogs(false)}
                className="absolute top-2 right-2 text-gray-400 hover:text-white p-1.5 rounded-md hover:bg-gray-800 transition-colors z-10"
                title="Close logs"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>

              {/* Scrollable Context */}
              <div className="p-4 overflow-y-auto text-[11px] font-mono text-gray-300 flex flex-col gap-1.5 flex-1">
                {ingestLogs.map((log, i) => (
                  <div key={i} className="animate-fade-in-up flex items-start gap-2 pr-6">
                    <span className="text-blue-500 font-bold shrink-0">❯</span>
                    <span className="break-words font-medium leading-relaxed">{log}</span>
                  </div>
                ))}
                {loading && (
                  <div className="animate-pulse flex items-center gap-2 mt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
                    <span className="text-gray-500 italic">Awaiting response...</span>
                  </div>
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}
        </div>

        <nav className="flex-1 px-3 space-y-1.5 font-medium overflow-y-auto">
          <button
            onClick={() => { setActiveRecipient(null); setIsSidebarOpen(false); }}
            className={`w-full flex items-center justify-between px-4 py-2.5 rounded-lg transition-colors ${!activeRecipient ? 'bg-[#1f3653] text-white' : 'text-gray-400 hover:bg-[#1f3653]/50 hover:text-gray-200'}`}
          >
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              Total Mail
            </div>
          </button>

          {stats.map(stat => (
            <button
              key={stat.name}
              onClick={() => { setActiveRecipient(stat.name); setIsSidebarOpen(false); }}
              className={`w-full flex items-start text-left justify-between px-4 py-2.5 rounded-lg transition-colors ${activeRecipient?.toLowerCase() === stat.name.toLowerCase() ? 'bg-[#1f3653] text-white' : 'text-gray-400 hover:bg-[#1f3653]/50 hover:text-gray-200'}`}
            >
              <span className="truncate text-sm">{stat.name}</span>
            </button>
          ))}
        </nav>

        <div className="p-5 bg-[#0f1d2c] border-t border-[#1f3653]">
          <div className="text-[13px] text-blue-200 font-medium truncate mb-3 px-1">
            {isGuest ? "Guest Viewer" : session?.user?.email}
          </div>
          <button
            onClick={() => {
              if (isGuest) {
                document.cookie = "guest_active=; max-age=0; path=/;";
                setIsGuest(false);
                setItems([]);
              } else {
                signOut();
              }
            }}
            className="w-full px-3 py-2 text-sm font-medium text-gray-300 hover:text-white border border-[#233f61] hover:bg-[#1f3653] rounded-lg transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* MAIN INBOX PANELS */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#606c78] z-10 md:my-3 md:mr-3 md:max-h-[calc(100vh-24px)] md:rounded-2xl overflow-hidden border-0 md:border md:border-[#15263a] md:shadow-2xl">

        {/* HEADER */}
        <header className="h-16 border-b border-[#15263a]/30 flex items-center justify-between px-6 shrink-0 bg-[#D3D3D3]">
          <div className="flex items-center gap-4">
            {/* Hamburger Button for Mobile */}
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden p-2 -ml-2 text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <h2 className="text-xl font-bold text-gray-800 tracking-tight">
              {activeRecipient ? activeRecipient : "Total Inbox"}
            </h2>
            <span className="px-2.5 py-0.5 rounded-full bg-[#15263a]/10 text-xs font-bold tracking-wide uppercase text-[#15263a] border border-[#15263a]/20">
              {filteredItems.length} pieces
            </span>
          </div>
          <button
            onClick={loadQueue}
            title="Refresh Inbox"
            className="p-2 text-gray-400 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
        </header>

        {/* MAIL LIST */}
        <div className="flex-1 overflow-y-auto bg-[#D3D3D3]">
          {filteredItems.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <svg className="w-16 h-16 mb-4 opacity-20" fill="currentColor" viewBox="0 0 20 20"><path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" /><path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" /></svg>
              <p className="text-lg font-medium text-gray-500">No mail pieces found.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#15263a]/20">
              {filteredItems.map((it) => {
                const senderName = it.llmSenderName || it.rawSenderText || "Unknown Sender";
                const isImportant = it.llmIsImportant;
                const recipient = it.llmRecipientName && it.llmRecipientName.toLowerCase() !== "null" ? it.llmRecipientName : "Current Resident";

                // Format date cleanly e.g., "2026-03-19" -> "Mar 19"
                let dateStr = it.deliveryDate || "";
                if (dateStr.length === 10) {
                  const parts = dateStr.split('-');
                  if (parts.length === 3) {
                    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                    dateStr = `${months[parseInt(parts[1]) - 1]} ${parseInt(parts[2])}`;
                  }
                }

                return (
                  <div
                    key={it.id}
                    onClick={() => setSelectedItem(it)}
                    className={`group flex items-center px-4 py-3.5 cursor-pointer hover:bg-gray-50 hover:shadow-[inset_4px_0_0_0_rgba(59,130,246,0.6)] transition-all ${isImportant ? 'bg-orange-50/20 hover:bg-orange-50/60 hover:shadow-[inset_4px_0_0_0_rgba(249,115,22,0.6)]' : ''}`}
                  >
                    {/* Left: Indicator & Sender */}
                    <div className="w-40 sm:w-56 shrink-0 flex items-start gap-3 sm:gap-4 pr-3">
                      <div className="pt-1.5 shrink-0">
                        {isImportant ? (
                          <div title={it.llmImportanceReason || "Marked Important"} className="w-2.5 h-2.5 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)] animate-pulse"></div>
                        ) : (
                          <div className="w-2.5 h-2.5 rounded-full bg-transparent"></div>
                        )}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className={`font-bold truncate text-[15px] ${isImportant ? 'text-gray-900' : 'text-gray-800'}`}>
                          {senderName}
                        </span>
                        <div className="flex items-center mt-1">
                          <span className="text-[10px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded bg-[#15263a]/10 text-gray-700 truncate max-w-[100px] sm:max-w-[140px] border border-[#15263a]/20">
                            To: {recipient}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Middle: Subject & Snippet */}
                    <div className="flex-1 min-w-0 flex items-center gap-2 pr-6 pl-4 border-l border-[#15263a]/20">
                      {it.llmMailType ? (
                        <span className="font-semibold text-[14px] sm:text-[15px] text-gray-800 truncate">
                          {it.llmMailType}
                        </span>
                      ) : (
                        <span className="font-medium text-[14px] sm:text-[15px] text-gray-400 italic truncate">
                          Uncategorized
                        </span>
                      )}

                      <span className="text-gray-300 shrink-0 font-medium hidden sm:block">-</span>

                      <span className="text-[14px] sm:text-[15px] text-gray-500 truncate font-normal hidden sm:block">
                        {it.llmSummary || "No snippet available for this piece."}
                      </span>
                    </div>

                    {/* Right: Date */}
                    <div className="w-16 shrink-0 text-right pr-2">
                      <span className={`text-[13px] font-bold ${isImportant ? 'text-orange-600' : 'text-gray-400 group-hover:text-gray-600'}`}>
                        {dateStr}
                      </span>
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* MAIL VIEW MODAL */}
      {selectedItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm transition-opacity"
          onClick={() => setSelectedItem(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl md:h-[85vh] max-h-[90vh] flex flex-col md:flex-row overflow-y-auto md:overflow-hidden animate-fade-in-up"
            onClick={e => e.stopPropagation()}
          >
            {/* Left Column: Metadata */}
            <div className="w-full md:w-[350px] shrink-0 bg-gray-50 border-b md:border-b-0 md:border-r border-[#15263a]/20 flex flex-col overflow-visible md:overflow-y-auto">
              <div className="p-6 border-b border-[#15263a]/20 flex items-center justify-between sticky top-0 bg-gray-50/95 backdrop-blur z-10">
                <h3 className="text-lg font-bold text-gray-800 tracking-tight flex items-center gap-2">
                  <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  Analysis
                </h3>
                <div className="flex items-center gap-3">
                  {!isGuest && (
                    <button
                      onClick={() => handleRescan(selectedItem.id)}
                      disabled={isRescanning}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isRescanning ? (
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                      )}
                      {isRescanning ? "Scanning..." : "Re-scan AI"}
                    </button>
                  )}
                  <button onClick={() => setSelectedItem(null)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-full transition-colors">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                <div>
                  <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Sender</h4>
                  <p className="font-bold text-gray-900 text-lg">{selectedItem.llmSenderName || selectedItem.rawSenderText || "Unknown Sender"}</p>
                </div>

                <div>
                  <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Recipient</h4>
                  <p className="font-medium text-gray-700">{selectedItem.llmRecipientName && selectedItem.llmRecipientName.toLowerCase() !== "null" ? selectedItem.llmRecipientName : "Current Resident"}</p>
                </div>

                <div>
                  <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Mail Type</h4>
                  <span className="inline-flex items-center px-2.5 py-1 rounded-md text-sm font-semibold bg-blue-50 text-blue-700">
                    {selectedItem.llmMailType || "Uncategorized"}
                  </span>
                </div>

                {selectedItem.llmIsImportant ? (
                  <div className="bg-orange-50 border border-orange-100 rounded-xl p-4">
                    <h4 className="text-[11px] font-bold text-orange-600 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)] animate-pulse"></div>
                      Important Mail
                    </h4>
                    <p className="text-sm font-medium text-orange-900 leading-snug">
                      {selectedItem.llmImportanceReason}
                    </p>
                  </div>
                ) : null}

                <div>
                  <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">AI Summary</h4>
                  <p className="text-gray-600 text-sm leading-relaxed">
                    {selectedItem.llmSummary || "No detailed summary available."}
                  </p>
                </div>
              </div>
            </div>

            {/* Right Column: Image Viewer */}
            <div className="flex-1 bg-gray-100 relative flex items-center justify-center p-6 min-h-[350px] md:min-h-0 overflow-y-auto">
              {selectedItem.imgStoragePath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/mail-images/${selectedItem.imgStoragePath}`}
                  alt="Mail Piece Scan"
                  className="max-w-full max-h-full object-contain rounded-xl shadow-md border border-gray-200/50"
                  loading="lazy"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-gray-400">
                  <svg className="w-16 h-16 mb-4 opacity-20" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" /></svg>
                  <p className="font-medium">No Image Uploaded</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
