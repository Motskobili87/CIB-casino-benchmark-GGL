
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { CasinoData, BenchmarkResult } from './types';
import DashboardHeader from './components/DashboardHeader';
import SummaryCards from './components/SummaryCards';
import Visualizations from './components/Visualizations';
import HistoryChart from './components/HistoryChart';
import EmailModal from './components/EmailModal';
import { 
  Star, 
  StarHalf,
  MapPin, 
  Search, 
  Target,
  Trophy,
  AlertCircle,
  ExternalLink
} from 'lucide-react';

const THEME_KEY = 'batumi_casino_theme';
const SUBJECT_KEY = "international";

const FIXED_MARKET_ENTITIES = [
  { name: "Casino International", placeId: "ChIJr4Sl22uGZ0ARAIlIlZkhxqo" },
  { name: "Casino Iveria Batumi", placeId: "ChIJH42730aGZ0ARsDS-v-Q9FWU" },
  { name: "Casino Peace", placeId: "ChIJ1a-bwkGGZ0ARzveIn7rXwdM" },
  { name: "Princess Casino", placeId: "ChIJyWDgcECGZ0ARdSusE3b96pw" },
  { name: "Eclipse Casino", placeId: "ChIJT7S5CJyFZ0AROGvduE06fIw" },
  { name: "Casino Otium", placeId: "ChIJ7bPMpg2HZ0AR7w95mwJxPfE" },
  { name: "Casino Soho", placeId: "ChIJTR0cAQCHZ0ARE7aWIZhZGuU" },
  { name: "Royal Casino", placeId: "ChIJVQe4payHZ0ARKyGENU8w5OE" },
  { name: "Empire Casino", placeId: "ChIJ0Y4pXKSHZ0ARN7prcblZQ8Q" },
  { name: "Grand Bellagio", placeId: "ChIJCz76Zk-FZ0ARz1T95QGgJA8" },
  { name: "Billionaire Casino", placeId: "ChIJ7fA7A36HZ0AR-HJobLqNnQo" },
  { name: "Casino Colosseum", placeId: "ChIJYYGQeIuFZ0ARmkcRZU1VJOA" }
];

const RenderStars = ({ rating, theme }: { rating: number, theme: 'dark' | 'light' }) => {
  const stars = [];
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.3 && rating % 1 <= 0.7;
  for (let i = 1; i <= 5; i++) {
    if (i <= fullStars) stars.push(<Star key={i} className="w-3 h-3 fill-amber-400 text-amber-400" />);
    else if (i === fullStars + 1 && hasHalfStar) stars.push(<StarHalf key={i} className="w-3 h-3 fill-amber-400 text-amber-400" />);
    else stars.push(<Star key={i} className={`w-3 h-3 ${theme === 'dark' ? 'text-slate-600' : 'text-slate-300'}`} />);
  }
  return <div className="flex items-center gap-0.5 mt-1">{stars}</div>;
};

const App: React.FC = () => {
  const [data, setData] = useState<BenchmarkResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [isExternalReport, setIsExternalReport] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem(THEME_KEY) as any) || 'dark');

  const textColor = theme === 'dark' ? 'text-white' : 'text-slate-900';
  const subTextColor = theme === 'dark' ? 'text-slate-300' : 'text-slate-500';

  const subjectId = useMemo(() => {
    if (!data) return null;
    return data.casinos.find(c => c.name.toLowerCase().includes(SUBJECT_KEY))?.id || null;
  }, [data]);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem(THEME_KEY, newTheme);
  };

  const fetchMarketData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/market');
      if (!res.ok) throw new Error('Failed to fetch global market data');
      const result = await res.json();
      setData(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshData = useCallback(async () => {
    setLoading(true);
    try {
      const syncRes = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets: FIXED_MARKET_ENTITIES })
      });
      if (!syncRes.ok) throw new Error('Sync failed on server');
      await fetchMarketData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchMarketData]);

  useEffect(() => {
    fetchMarketData();
  }, [fetchMarketData]);

  const processedCasinos = useMemo(() => {
    if (!data) return [];
    return data.casinos
      .filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => b.userRatingsTotal - a.userRatingsTotal);
  }, [data, searchTerm]);

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-900'} transition-colors duration-300 pb-12`}>
      <DashboardHeader 
        lastUpdated={data?.lastUpdated || null}
        onRefresh={refreshData}
        isRefreshing={loading}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenEmail={() => setIsEmailModalOpen(true)}
        onCopyLink={async () => { await navigator.clipboard.writeText(window.location.href); return true; }}
      />

      <main className="max-w-7xl mx-auto px-4 md:px-6 py-8" id="dashboard-capture-root">
        {error && (
          <div className="mb-8 p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center gap-3 text-rose-500">
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm font-bold">{error}</p>
            <button onClick={fetchMarketData} className="ml-auto text-xs font-black uppercase bg-rose-500 text-white px-4 py-2 rounded-lg">Retry</button>
          </div>
        )}

        {data ? (
          <>
            <SummaryCards casinos={data.casinos} theme={theme} subjectId={subjectId} />
            <div className="grid grid-cols-1 gap-8 mb-8">
               <Visualizations casinos={data.casinos} theme={theme} subjectId={subjectId} />
               {!isExternalReport && <HistoryChart history={data.history} theme={theme} />}
            </div>

            <div className={`${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} border rounded-3xl overflow-hidden shadow-xl`}>
              <div className="p-6 border-b border-slate-800/10 flex flex-col md:flex-row justify-between items-center gap-4">
                <h3 className={`text-lg font-black uppercase tracking-tight flex items-center gap-2 ${textColor}`}>
                  <Trophy className="w-4 h-4 text-red-500" /> Global Market Registry
                </h3>
                <div className="relative w-full md:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input 
                    type="text"
                    placeholder="Search venues..."
                    className={`w-full pl-10 pr-4 py-2.5 rounded-xl border ${theme === 'dark' ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-200'}`}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className={theme === 'dark' ? 'bg-slate-800' : 'bg-slate-100'}>
                    <tr className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      <th className="p-5">Venue</th>
                      <th className="p-5">Score</th>
                      <th className="p-5 text-right">Volume</th>
                      <th className="p-5 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/10">
                    {processedCasinos.map((c, idx) => {
                      const isSubject = c.name.toLowerCase().includes(SUBJECT_KEY);
                      return (
                        <tr key={c.id} className={`${isSubject ? 'bg-red-500/5' : ''}`}>
                          <td className="p-5">
                            <div className="flex items-center gap-3">
                              <span className="w-6 h-6 flex-shrink-0 rounded bg-slate-800 flex items-center justify-center text-[10px] font-bold">{idx + 1}</span>
                              <div>
                                <span className={`font-bold text-sm block ${isSubject ? 'text-red-500' : textColor}`}>{c.name}</span>
                                <span className="text-[10px] text-slate-500 truncate block max-w-[200px]">{c.vicinity}</span>
                              </div>
                            </div>
                          </td>
                          <td className="p-5">
                            <span className="font-mono font-black text-sm">{c.rating.toFixed(1)}</span>
                            <RenderStars rating={c.rating} theme={theme} />
                          </td>
                          <td className="p-5 text-right font-mono font-bold">{c.userRatingsTotal.toLocaleString()}</td>
                          <td className="p-5 text-center">
                            <a href={c.googleMapsUri} target="_blank" className="p-2 inline-block rounded-lg bg-indigo-500/10 text-indigo-500"><ExternalLink className="w-4 h-4" /></a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="py-24 text-center">
            <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="font-black uppercase tracking-widest text-xs text-slate-500">Connecting to Cloud Database...</p>
          </div>
        )}
      </main>

      {data && (
        <EmailModal 
          isOpen={isEmailModalOpen} 
          onClose={() => setIsEmailModalOpen(false)} 
          theme={theme} 
          defaultSubject={`BATUMI CASINO REPORT`} 
          defaultBody={""} 
          casinos={data.casinos} 
          onCopyLiveLink={async () => { await navigator.clipboard.writeText(window.location.href); return true; }}
          onCopySnapshot={async () => true}
        />
      )}
    </div>
  );
};

export default App;
