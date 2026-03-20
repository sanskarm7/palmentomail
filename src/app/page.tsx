'use client';

import { useEffect, useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import Image from "next/image";

type Item = {
  id: number;
  deliveryDate: string | null;
  rawSenderText: string | null;
  imgHash: string | null;
  llmSenderName: string | null;
  llmRecipientName: string | null;
  llmMailType: string | null;
  llmSummary: string | null;
  llmIsImportant: boolean | null;
  llmImportanceReason: string | null;
};

export default function Home() {
  const { data: session, status } = useSession();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);

  async function ingest() {
    setLoading(true);
    await fetch('/api/ingest');
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
    }
  }, [session]);

  if (status === "loading") {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 animate-pulse text-lg tracking-wide">Loading workspace...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-[#15263a]">
        <div className="mb-8 flex items-center gap-4">
          <Image src="/mailwolf_logo.png" alt="MailWolf Logo" width={80} height={80} className="rounded-2xl shadow-xl" />
          <h1 className="text-6xl font-extrabold text-white tracking-tight">MailWolf</h1>
        </div>
        <p className="mb-10 text-blue-200 text-lg tracking-wide font-light">Intelligent USPS Physical Mail Processing</p>
        <button 
          onClick={() => signIn('google')} 
          className="px-8 py-3.5 rounded-full bg-white text-[#15263a] font-bold text-lg hover:bg-gray-100 shadow-[0_0_20px_rgba(255,255,255,0.15)] transition-transform hover:scale-105 active:scale-95 flex items-center gap-3"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex overflow-hidden bg-gray-100 font-sans">
      {/* SIDEBAR */}
      <aside className="w-64 bg-[#15263a] text-white flex flex-col shrink-0">
        <div className="p-6 flex items-center gap-4">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center p-1 shrink-0 shadow-sm">
            <Image src="/mailwolf_logo.png" alt="Logo" width={40} height={40} className="object-contain" />
          </div>
          <span className="text-xl font-bold tracking-tight">MailWolf</span>
        </div>

        <div className="px-5 mb-8 mt-2">
          <button 
            onClick={ingest} 
            disabled={loading}
            className="w-full py-3.5 px-4 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 disabled:bg-[#1f3653] disabled:text-gray-400 rounded-xl font-semibold transition-colors flex items-center justify-center shadow-lg shadow-blue-500/20"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                Processing...
              </span>
            ) : "Fetch Digests"}
          </button>
        </div>

        <nav className="flex-1 px-3 space-y-1.5 font-medium">
          <button className="w-full flex items-center gap-3 px-4 py-2.5 bg-[#1f3653] text-white rounded-lg">
             <svg className="w-5 h-5 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
             Total Mail
          </button>
        </nav>

        <div className="p-5 bg-[#0f1d2c] border-t border-[#1f3653]">
          <div className="text-[13px] text-blue-200 font-medium truncate mb-3 px-1">
            {session.user?.email}
          </div>
          <button 
            onClick={() => signOut()} 
            className="w-full px-3 py-2 text-sm font-medium text-gray-300 hover:text-white border border-[#233f61] hover:bg-[#1f3653] rounded-lg transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* MAIN INBOX PANELS */}
      <main className="flex-1 flex flex-col min-w-0 bg-white shadow-2xl z-10 my-3 mr-3 rounded-2xl overflow-hidden border border-gray-100">
        
        {/* HEADER */}
        <header className="h-16 border-b border-gray-100 flex items-center justify-between px-6 shrink-0 bg-white">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-gray-800 tracking-tight">Inbox</h2>
            <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-xs font-bold tracking-wide uppercase text-blue-600">
              {items.length} pieces
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
        <div className="flex-1 overflow-y-auto bg-white">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <svg className="w-16 h-16 mb-4 opacity-20" fill="currentColor" viewBox="0 0 20 20"><path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" /><path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" /></svg>
              <p className="text-lg font-medium text-gray-500">No mail pieces found.</p>
              <p className="text-sm mt-1 text-gray-400">Click &quot;Fetch Digests&quot; to scan your recent USPS emails.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {items.map((it) => {
                const senderName = it.llmSenderName || it.rawSenderText || "Unknown Sender";
                const isImportant = it.llmIsImportant;
                const recipient = it.llmRecipientName && it.llmRecipientName.toLowerCase() !== "null" ? it.llmRecipientName : "Current Resident";
                
                // Format date cleanly e.g., "2026-03-19" -> "Mar 19"
                let dateStr = it.deliveryDate || "";
                if (dateStr.length === 10) {
                   const parts = dateStr.split('-');
                   if (parts.length === 3) {
                     const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                     dateStr = `${months[parseInt(parts[1])-1]} ${parseInt(parts[2])}`;
                   }
                }

                return (
                  <div 
                    key={it.id} 
                    className={`group flex items-center px-4 py-3.5 cursor-pointer hover:bg-gray-50 hover:shadow-[inset_4px_0_0_0_rgba(59,130,246,0.6)] transition-all ${isImportant ? 'bg-orange-50/20 hover:bg-orange-50/60 hover:shadow-[inset_4px_0_0_0_rgba(249,115,22,0.6)]' : ''}`}
                  >
                    {/* Left: Indicator & Sender */}
                    <div className="w-56 shrink-0 flex items-start gap-4 pr-3">
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
                          <span className="text-[10px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded bg-gray-100/80 text-gray-500 truncate max-w-[140px] border border-gray-200/60">
                            To: {recipient}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Middle: Subject & Snippet */}
                    <div className="flex-1 min-w-0 flex items-center gap-2 pr-6 pl-4 border-l border-gray-100">
                      {it.llmMailType ? (
                        <span className="font-semibold text-[15px] text-gray-800 whitespace-nowrap">
                          {it.llmMailType}
                        </span>
                      ) : (
                        <span className="font-medium text-[15px] text-gray-400 italic whitespace-nowrap">
                          Uncategorized
                        </span>
                      )}
                      
                      <span className="text-gray-300 shrink-0 font-medium">-</span>
                      
                      <span className="text-[15px] text-gray-500 truncate font-normal">
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
    </div>
  );
}
