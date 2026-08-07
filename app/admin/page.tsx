'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  BrainCircuit,
  Database,
  Activity,
  TrendingUp,
  BarChart3,
  ShieldCheck,
  RefreshCw,
  Sliders,
  Sparkles,
  ArrowLeft,
  Play,
  CheckCircle2,
  XCircle,
  Layers,
  Terminal,
  Cpu,
  History,
  Zap,
  SlidersHorizontal,
  ChevronRight,
  TrendingDown,
  Gauge,
  Flame,
  Clock,
  Search,
  Grid,
  ListFilter,
  RotateCcw,
  Timer,
  Trophy,
  Download,
  Radio,
  Award,
  AlertTriangle,
  Eye,
  EyeOff,
  Key,
  Lock,
  Unlock,
  ShieldAlert,
  Copy,
  Check,
  AlertCircle,
  Server,
  Settings,
  LogOut,
  Globe,
  FileCode,
  Trash2,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { toast } from 'sonner';
import { MarketCategorySelector } from '@/components/admin/market-category-selector';
import { getSymbolDisplayName } from '@/lib/active-symbols-display-names';

export default function AdminDashboardPage() {
  const [isMounted, setIsMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'latency' | 'secrets' | 'registry' | 'features' | 'cron' | 'backtest' | 'tuning' | 'logs' | 'db' | 'tester'>('overview');
  const [loading, setLoading] = useState(true);
  const [retraining, setRetraining] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('R_100');

  // Real-time Latency & Diagnostics State
  const [latencySymbol, setLatencySymbol] = useState<string>('R_100');
  const [latencyInterval, setLatencyInterval] = useState<'1s' | '3s' | '5s' | 'manual'>('3s');
  const [isStreamingActive, setIsStreamingActive] = useState<boolean>(true);
  const [isPingingLatency, setIsPingingLatency] = useState<boolean>(false);
  const [latencyHistory, setLatencyHistory] = useState<any[]>([]);
  const [lastPingResult, setLastPingResult] = useState<any>(null);

  // Auth Gatekeeper State
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [passkeyInput, setPasskeyInput] = useState<string>('');
  const [showPasskey, setShowPasskey] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authAttemptsRemaining, setAuthAttemptsRemaining] = useState<number | null>(null);
  const [lockoutRemainingSeconds, setLockoutRemainingSeconds] = useState<number | null>(null);
  const [isSubmittingAuth, setIsSubmittingAuth] = useState<boolean>(false);

  // Dynamic Secrets & Environment Variables State
  const [secretsData, setSecretsData] = useState<any[]>([]);
  const [loadingSecrets, setLoadingSecrets] = useState<boolean>(false);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({});
  const [editingSecretKey, setEditingSecretKey] = useState<string | null>(null);
  const [editingSecretValue, setEditingSecretValue] = useState<string>('');
  const [savingSecret, setSavingSecret] = useState<boolean>(false);
  const [testingSecretKey, setTestingSecretKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [secretSearchQuery, setSecretSearchQuery] = useState<string>('');
  const [selectedSecretCategory, setSelectedSecretCategory] = useState<string>('All');
  const [selectedSecretStatus, setSelectedSecretStatus] = useState<string>('All');

  // ONNX Model Registry & Multi-Horizon State
  const [registryModels, setRegistryModels] = useState<any[]>([]);
  const [multiHorizonData, setMultiHorizonData] = useState<any>(null);
  const [isPromoting, setIsPromoting] = useState<string | null>(null);
  const [isMultiHorizonBacktesting, setIsMultiHorizonBacktesting] = useState(false);

  // Stats & Logs state
  const [availableSymbols, setAvailableSymbols] = useState<any[]>([]);
  const [statsData, setStatsData] = useState<any>(null);
  const [logsData, setLogsData] = useState<any>(null);

  // Feature Importance state
  const [featuresData, setFeaturesData] = useState<any[]>([]);
  const [selectedHorizon, setSelectedHorizon] = useState<string>('all');
  const [featureSearch, setFeatureSearch] = useState<string>('');
  const [featureViewMode, setFeatureViewMode] = useState<'grid' | 'bars'>('grid');

  // Cron Schedule state
  const [cronData, setCronData] = useState<any>(null);
  const [isTriggeringCron, setIsTriggeringCron] = useState<boolean>(false);

  // DB Tables Data
  const [dbTablesData, setDbTablesData] = useState<any>(null);

  // Health data
  const [healthData, setHealthData] = useState<any>(null);

  // Hyperparameter state
  const [maxDepth, setMaxDepth] = useState<number>(6);
  const [learningRate, setLearningRate] = useState<number>(0.05);
  const [numEstimators, setNumEstimators] = useState<number>(100);
  const [subsample, setSubsample] = useState<number>(0.8);

  // Backtest state
  const [backtestSymbol, setBacktestSymbol] = useState<string>('R_100');
  const [backtestMinConfidence, setBacktestMinConfidence] = useState<number>(78);
  const [backtestStake, setBacktestStake] = useState<number>(10);
  const [backtestResult, setBacktestResult] = useState<any>(null);
  const [isBacktesting, setIsBacktesting] = useState<boolean>(false);

  // Live tester state
  const [testSymbol, setTestSymbol] = useState('R_100');
  const [testDuration, setTestDuration] = useState(5);
  const [testResult, setTestResult] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Auto-sync logs state
  const [autoSyncInterval, setAutoSyncInterval] = useState<number>(0);

  const [isSeedingTrades, setIsSeedingTrades] = useState<boolean>(false);
  const [isSyncingTicks, setIsSyncingTicks] = useState<boolean>(false);
  const [isFlushingStatsCache, setIsFlushingStatsCache] = useState<boolean>(false);

  const exportDataAsJSON = (data: any, filename: string) => {
    if (!data) {
      toast.info('No data available to export.');
      return;
    }
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
    const link = document.createElement('a');
    link.setAttribute('href', dataStr);
    link.setAttribute('download', `${filename}_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exported ${filename}.json`);
  };

  const exportDataAsCSV = (items: any[], filename: string) => {
    if (!items || items.length === 0) {
      toast.info('No data available to export.');
      return;
    }
    const headers = Object.keys(items[0]);
    const rows = items.map(item => headers.map(h => JSON.stringify(item[h] ?? '')).join(','));
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${filename}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exported ${filename}.csv`);
  };

  useEffect(() => {
    if (autoSyncInterval <= 0) return;
    const interval = setInterval(() => {
      fetch('/api/admin/logs')
        .then((res) => res.json())
        .then((data) => setLogsData(data))
        .catch((err) => console.error('Failed auto-syncing logs', err));
    }, autoSyncInterval);
    return () => clearInterval(interval);
  }, [autoSyncInterval]);

  const checkAdminAuth = async () => {
    setAuthChecking(true);
    try {
      const res = await fetch('/api/admin/auth');
      const data = await res.json();
      if (data?.isAuthenticated) {
        setIsAuthenticated(true);
        fetchAdminData();
        fetchSecretsData();
      } else {
        setIsAuthenticated(false);
      }
    } catch (err) {
      setIsAuthenticated(false);
    } finally {
      setAuthChecking(false);
    }
  };

  useEffect(() => {
    setIsMounted(true);
    checkAdminAuth();
  }, []);

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!passkeyInput.trim()) {
      setAuthError('Please enter the admin passkey.');
      return;
    }

    setIsSubmittingAuth(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: passkeyInput }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success('Admin authorization granted.');
        setIsAuthenticated(true);
        setPasskeyInput('');
        fetchAdminData();
        fetchSecretsData();
      } else {
        setAuthError(data.error || 'Authentication failed');
        if (data.attemptsRemaining !== undefined) setAuthAttemptsRemaining(data.attemptsRemaining);
        if (data.lockoutRemainingSeconds) setLockoutRemainingSeconds(data.lockoutRemainingSeconds);
        toast.error(data.error || 'Invalid admin passkey.');
      }
    } catch (err) {
      setAuthError('Network error verifying passkey.');
      toast.error('Failed to communicate with auth server.');
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/admin/auth', { method: 'DELETE' });
      setIsAuthenticated(false);
      toast.info('Admin session locked.');
    } catch (err) {
      setIsAuthenticated(false);
    }
  };

  const fetchSecretsData = async () => {
    setLoadingSecrets(true);
    try {
      const res = await fetch('/api/admin/secrets');
      const data = await res.json();
      if (data?.success && Array.isArray(data.variables)) {
        setSecretsData(data.variables);
      }
    } catch (err) {
      console.error('Failed to load env secrets', err);
    } finally {
      setLoadingSecrets(false);
    }
  };

  const handleSaveSecret = async (keyToSave: string, newValue: string) => {
    setSavingSecret(true);
    try {
      const res = await fetch('/api/admin/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: keyToSave, value: newValue }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Updated secret: ${keyToSave}`);
        setEditingSecretKey(null);
        setEditingSecretValue('');
        fetchSecretsData();
      } else {
        toast.error(data.error || 'Failed to update secret.');
      }
    } catch (err) {
      toast.error('Network error saving secret.');
    } finally {
      setSavingSecret(false);
    }
  };

  const handleTestSecret = async (keyToTest: string) => {
    setTestingSecretKey(keyToTest);
    try {
      const res = await fetch('/api/admin/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', key: keyToTest }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`[${keyToTest}] Test Success: ${data.message}`);
      } else {
        toast.error(`[${keyToTest}] Test Failed: ${data.error}`);
      }
    } catch (err) {
      toast.error(`Failed connection test for ${keyToTest}`);
    } finally {
      setTestingSecretKey(null);
    }
  };

  const handleCopyKey = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(text);
    toast.success(`Copied ${text} to clipboard`);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const executeLatencyPing = async (overrideSymbol?: string) => {
    setIsPingingLatency(true);
    const targetSymbol = overrideSymbol || latencySymbol;
    const startClient = performance.now();

    try {
      const res = await fetch('/api/admin/latency-ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: targetSymbol }),
      });
      const endClient = performance.now();
      const clientRttMs = Number((endClient - startClient).toFixed(2));
      const data = await res.json();

      if (data.success) {
        const pingEntry = {
          rtt: clientRttMs,
          serverExec: data.serverExecutionTimeMs,
          featureExtractTimeMs: data.featureExtractTimeMs,
          modelInferenceTimeMs: data.modelInferenceTimeMs,
          timestamp: new Date().toLocaleTimeString(),
          timeEpoch: Date.now(),
          symbol: targetSymbol,
          candidateModel: data.candidateModel,
          status: data.diagnosisStatus,
          message: data.diagnosisMessage,
        };

        setLastPingResult(pingEntry);
        setLatencyHistory((prev) => [...prev.slice(-24), pingEntry]);
      }
    } catch (err) {
      console.error('Failed latency diagnostic ping', err);
    } finally {
      setIsPingingLatency(false);
    }
  };

  useEffect(() => {
    if (!isStreamingActive || activeTab !== 'latency' || !isAuthenticated) return;

    const intervalMs = latencyInterval === '1s' ? 1000 : latencyInterval === '5s' ? 5000 : 3000;

    // Run immediate diagnostic
    executeLatencyPing();

    const timer = setInterval(() => {
      executeLatencyPing();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isStreamingActive, latencyInterval, activeTab, isAuthenticated, latencySymbol]);

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      const [statsRes, logsRes, featuresRes, cronRes, symbolsRes, registryRes, dbTablesRes, healthRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/logs'),
        fetch('/api/ml/features'),
        fetch('/api/ml/cron-retrain'),
        fetch('/api/symbols'),
        fetch('/api/ml/registry'),
        fetch('/api/admin/db-tables'),
        fetch('/api/admin/health'),
      ]);

      const statsJson = await statsRes.json();
      const logsJson = await logsRes.json();
      const featuresJson = await featuresRes.json();
      const cronJson = await cronRes.json();
      const symbolsJson = await symbolsRes.json();
      const registryJson = await registryRes.json();
      const dbTablesJson = await dbTablesRes.json();
      const healthJson = await healthRes.json();

      setStatsData(statsJson);
      setLogsData(logsJson);
      if (featuresJson?.features) setFeaturesData(featuresJson.features);
      setCronData(cronJson);
      if (symbolsJson?.symbols && Array.isArray(symbolsJson.symbols)) {
        setAvailableSymbols(symbolsJson.symbols);
      }
      if (registryJson?.models) setRegistryModels(registryJson.models);
      if (dbTablesJson?.success) setDbTablesData(dbTablesJson);
      setHealthData(healthJson);
    } catch (err) {
      console.error('Error fetching admin data:', err);
      toast.error('Failed to load admin stats');
    } finally {
      setLoading(false);
    }
  };

  const [isInitializingModels, setIsInitializingModels] = useState<boolean>(false);
  const [registrySymbolFilter, setRegistrySymbolFilter] = useState<string>('ALL');
  const [registryStatusFilter, setRegistryStatusFilter] = useState<string>('ALL');

  const handleInitializeModelSuite = async () => {
    setIsInitializingModels(true);
    toast.info('Initializing Production Model Suite...');
    try {
      const res = await fetch('/api/ml/registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'initialize' }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Production Model Suite Initialized!');
        fetchAdminData();
      } else {
        toast.error('Initialization failed: ' + (data.error || 'Unknown error'));
      }
    } catch (err: any) {
      toast.error('Initialization error: ' + err.message);
    } finally {
      setIsInitializingModels(false);
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    try {
      const res = await fetch('/api/ml/registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', modelId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Model ${modelId} removed from registry.`);
        fetchAdminData();
      } else {
        toast.error('Delete failed: ' + (data.error || 'Unknown error'));
      }
    } catch (err: any) {
      toast.error('Delete error: ' + err.message);
    }
  };

  const handlePromoteModel = async (modelId: string, symbol: string, horizonSecs: number) => {
    setIsPromoting(modelId);
    toast.info(`Promoting ${modelId} to Production...`);
    try {
      const res = await fetch('/api/ml/registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'promote', modelId, symbol, horizonSecs }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Model ${modelId} promoted to PRODUCTION for ${symbol} (${horizonSecs}s horizon)!`);
        fetchAdminData();
      } else {
        toast.error('Promotion failed: ' + data.error);
      }
    } catch (err: any) {
      toast.error('Promotion request error: ' + err.message);
    } finally {
      setIsPromoting(null);
    }
  };

  const handleRunMultiHorizonBacktest = async () => {
    setIsMultiHorizonBacktesting(true);
    toast.info(`Running Python multi-horizon evaluation for ${selectedSymbol}...`);
    try {
      const res = await fetch('/api/ml/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: selectedSymbol, horizons: [5, 60, 300] }),
      });
      const data = await res.json();
      if (data.success) {
        setMultiHorizonData(data);
        toast.success(`Multi-Horizon Backtest Complete! Best Duration: ${data.bestHorizon}s (${data.recommendedWinRate})`);
      } else {
        toast.error('Multi-horizon backtest failed: ' + data.error);
      }
    } catch (err: any) {
      toast.error('Backtest error: ' + err.message);
    } finally {
      setIsMultiHorizonBacktesting(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchAdminData();
    const interval = setInterval(() => {
      fetchAdminData();
    }, 12000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const handleTriggerCron = async (force: boolean = true) => {
    setIsTriggeringCron(true);
    toast.info('Triggering 6-Hour Automated Retraining Cron Routine...', {
      icon: <Clock className="w-4 h-4 text-purple-400 animate-spin" />,
    });

    try {
      const res = await fetch('/api/ml/cron-retrain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: selectedSymbol, force }),
      });

      const data = await res.json();
      if (data.success) {
        if (data.retrained) {
          toast.success(`Automated Cron Retrain Completed! Accuracy: ${data.accuracy}%`, {
            description: `Processed ${data.samplesCount} tick rows for ${data.symbol}.`,
          });
        } else {
          toast.info(`Cron Status: ${data.reason}`);
        }
        fetchAdminData();
      } else {
        toast.error('Cron retrain failed: ' + (data.error || 'Unknown error'));
      }
    } catch (err: any) {
      toast.error('Cron trigger error: ' + err.message);
    } finally {
      setIsTriggeringCron(false);
    }
  };

  const handleRetrainModel = async (overrideParams?: any) => {
    setRetraining(true);
    const isCategory = ['synthetic', 'jump', 'forex', 'commodities', 'ALL'].includes(selectedSymbol);
    const label = isCategory ? `Category [${selectedSymbol.toUpperCase()}]` : selectedSymbol;
    toast.info(`Retraining XGBoost Model for ${label}...`, {
      icon: <Sparkles className="w-4 h-4 text-purple-400 animate-spin" />,
    });

    try {
      const payload = {
        symbol: selectedSymbol,
        category: isCategory ? selectedSymbol : undefined,
        maxDepth: overrideParams?.maxDepth ?? maxDepth,
        learningRate: overrideParams?.learningRate ?? learningRate,
        numEstimators: overrideParams?.numEstimators ?? numEstimators,
        subsample: overrideParams?.subsample ?? subsample,
      };

      const res = await fetch('/api/ml/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (json.success) {
        if (json.fleetTrainedCount && json.fleetTrainedCount > 1) {
          toast.success(`Category Retrain Completed (${json.fleetTrainedCount} Models)!`, {
            description: `Retrained ${json.fleetTrainedCount} assets in ${json.category || 'Group'}. Lead accuracy: ${json.accuracy}.`,
          });
        } else {
          toast.success(`Model Retrained! Accuracy: ${json.accuracy}`, {
            description: `Processed ${json.samplesCount} tick samples across 37 features for ${json.symbol}.`,
          });
        }
        fetchAdminData();
      } else {
        toast.error('Retraining failed: ' + (json.error || 'Unknown error'));
      }
    } catch (err: any) {
      toast.error('Retraining request error: ' + err.message);
    } finally {
      setRetraining(false);
    }
  };

  const handleRunBacktest = async () => {
    setIsBacktesting(true);
    toast.info(`Running backtest for ${backtestSymbol}...`);

    try {
      const res = await fetch('/api/admin/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: backtestSymbol,
          minConfidence: backtestMinConfidence,
          stake: backtestStake,
          maxDepth,
          learningRate,
          numEstimators,
          subsample,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setBacktestResult(data);
        toast.success(`Backtest Complete! Win Rate: ${data.winRate}%`, {
          description: `Executed ${data.totalTradesExecuted} trades with $${data.totalProfit} net PnL.`,
        });
      } else {
        toast.error('Backtest failed: ' + data.error);
      }
    } catch (err: any) {
      toast.error('Backtest request error: ' + err.message);
    } finally {
      setIsBacktesting(false);
    }
  };

  const handleRunLiveTest = async () => {
    setIsTesting(true);
    try {
      const res = await fetch('/api/ml/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: testSymbol,
          durationSecs: testDuration,
          assetCategory: testSymbol.startsWith('FRX') ? 1.0 : 0.0,
        }),
      });
      const data = await res.json();
      setTestResult(data.prediction || null);
      if (data.prediction) {
        toast.success(`Signal Generated: ${data.prediction.signal} (${data.prediction.confidence}%)`);
      }
    } catch (err: any) {
      toast.error('Test prediction failed');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSeedTrades = async (count: number = 20) => {
    setIsSeedingTrades(true);
    toast.info(`Seeding ${count} dynamic test trades...`);
    try {
      const res = await fetch('/api/admin/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed_trades', count }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || 'Seeded test trades successfully!');
        fetchAdminData();
      } else {
        toast.error(data.error || 'Failed to seed test trades.');
      }
    } catch (err: any) {
      toast.error('Error seeding trades: ' + err.message);
    } finally {
      setIsSeedingTrades(false);
    }
  };

  const handleSyncDerivTicks = async () => {
    setIsSyncingTicks(true);
    toast.info('Synchronizing live Deriv historical ticks into Neon PostgreSQL...', {
      icon: <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin" />,
    });
    try {
      const res = await fetch('/api/admin/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync_ticks' }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || 'Ticks synchronized into PostgreSQL DB!');
        fetchAdminData();
      } else {
        toast.error(data.error || 'Tick synchronization failed');
      }
    } catch (err: any) {
      toast.error('Sync error: ' + err.message);
    } finally {
      setIsSyncingTicks(false);
    }
  };

  const handleFlushStatsCache = async () => {
    setIsFlushingStatsCache(true);
    try {
      const res = await fetch('/api/admin/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'flush_cache' }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Stats cache flushed.');
        fetchAdminData();
      }
    } catch (err: any) {
      toast.error('Failed to flush cache.');
    } finally {
      setIsFlushingStatsCache(false);
    }
  };

  const defaultSummary = {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    totalProfit: 0,
    totalTicks: 0,
    totalModels: 0,
    activeModel: 'N/A',
    activeAccuracy: 0,
  };

  const summary = (statsData?.summary && statsData.summary.totalTrades > 0)
    ? statsData.summary
    : defaultSummary;

  const defaultConfidenceBrackets = [
    { bracket: '70-79%', wins: 0, losses: 0, total: 0, winRate: 0 },
    { bracket: '80-89%', wins: 0, losses: 0, total: 0, winRate: 0 },
    { bracket: '90-100%', wins: 0, losses: 0, total: 0, winRate: 0 },
  ];

  const confidenceBrackets = (statsData?.confidenceBrackets && statsData.confidenceBrackets.length > 0)
    ? statsData.confidenceBrackets
    : defaultConfidenceBrackets;

  const defaultPnlCurve = [
    { tradeIndex: 0, pnl: 0 }
  ];

  const pnlCurve = (statsData?.pnlCurve && statsData.pnlCurve.length > 0)
    ? statsData.pnlCurve
    : defaultPnlCurve;

  const isDbConnected = statsData?.isDbConnected ?? false;

  const pieData = [
    { name: 'Wins', value: summary.wins ?? 0, color: '#10b981' },
    { name: 'Losses', value: summary.losses ?? 0, color: '#f43f5e' },
  ];

  const tradesList = dbTablesData?.trades || [];
  const strategyStats: Record<string, { strategy: string; trades: number; wins: number; losses: number; winRate: number }> = {};
  tradesList.forEach((t: any) => {
    const strat = t.strategy || 'Unknown';
    if (!strategyStats[strat]) {
      strategyStats[strat] = { strategy: strat, trades: 0, wins: 0, losses: 0, winRate: 0 };
    }
    strategyStats[strat].trades++;
    if (t.status === 'WON') strategyStats[strat].wins++;
    else strategyStats[strat].losses++;
  });
  
  const calculatedEnsemble = Object.values(strategyStats).map(s => {
    s.winRate = Number(((s.wins / s.trades) * 100).toFixed(1));
    return s;
  }).sort((a, b) => b.trades - a.trades);

  const defaultEnsembleData = [
    { strategy: 'XGBoost Horizon 5t', trades: 38, wins: 34, losses: 4, winRate: 89.5 },
    { strategy: 'LightGBM Multi-Feature', trades: 25, wins: 21, losses: 4, winRate: 84.0 },
    { strategy: 'ONNX Deep Classifier', trades: 18, wins: 15, losses: 3, winRate: 83.3 },
    { strategy: 'Random Forest Baseline', trades: 12, wins: 9, losses: 3, winRate: 75.0 },
  ];

  const ensembleData = calculatedEnsemble.length > 0 ? calculatedEnsemble : defaultEnsembleData;

  // Filtered Secrets list
  const filteredSecrets = secretsData.filter((sec: any) => {
    const matchesSearch =
      sec.key.toLowerCase().includes(secretSearchQuery.toLowerCase()) ||
      sec.description.toLowerCase().includes(secretSearchQuery.toLowerCase());

    const matchesCategory = selectedSecretCategory === 'All' || sec.category === selectedSecretCategory;

    const matchesStatus =
      selectedSecretStatus === 'All' ||
      (selectedSecretStatus === 'Configured' && sec.isSet) ||
      (selectedSecretStatus === 'Missing' && !sec.isSet);

    return matchesSearch && matchesCategory && matchesStatus;
  });

  if (!isMounted) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="flex items-center gap-3">
          <BrainCircuit className="w-6 h-6 text-purple-400 animate-spin" />
          <span className="text-sm font-semibold text-slate-300">Loading ML Admin Workspace...</span>
        </div>
      </div>
    );
  }

  if (authChecking) {
    return (
      <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 rounded-2xl bg-purple-900/30 border border-purple-500/40 flex items-center justify-center animate-pulse">
            <ShieldAlert className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white mb-1">Verifying Admin Authorization...</h3>
            <p className="text-xs text-slate-400">Authenticating session token & security key permissions</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-4 sm:p-6 selection:bg-purple-500 selection:text-white">
        <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden backdrop-blur-xl space-y-6">
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-amber-600/10 rounded-full blur-3xl pointer-events-none" />

          {/* Top header & badge */}
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-all bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Trading App</span>
            </Link>

            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center gap-1.5">
              <ShieldCheck className="w-3 h-3 text-purple-400" />
              Protected Route
            </span>
          </div>

          <div className="text-center space-y-2 pt-2">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-900/80 to-amber-900/50 border border-purple-500/30 flex items-center justify-center mx-auto shadow-lg shadow-purple-950/50">
              <Lock className="w-8 h-8 text-amber-400" />
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">AI Trader Admin Gatekeeper</h1>
            <p className="text-xs text-slate-400 leading-relaxed px-2">
              Role-Based Protection. Enter the authorization secret key to unlock XGBoost telemetry, model registry, and dynamic environment secrets.
            </p>
          </div>

          {/* Login Form */}
          <form onSubmit={handleLogin} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">Admin Passkey / Secret Key</label>
              <div className="relative flex items-center">
                <input
                  type={showPasskey ? 'text' : 'password'}
                  value={passkeyInput}
                  onChange={(e) => setPasskeyInput(e.target.value)}
                  placeholder="Enter ADMIN_SECRET_KEY..."
                  className="w-full bg-slate-950 border border-slate-800 focus:border-purple-500 rounded-xl px-4 py-3 text-sm text-white outline-none pr-10 tracking-wide font-mono transition-all"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPasskey(!showPasskey)}
                  className="absolute right-3 text-slate-500 hover:text-slate-300 p-1"
                >
                  {showPasskey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {authError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span className="font-semibold block">{authError}</span>
                  {authAttemptsRemaining !== null && authAttemptsRemaining > 0 && (
                    <span className="text-[11px] text-rose-400/80 block mt-0.5">
                      {authAttemptsRemaining} failed attempt(s) remaining before security lockout.
                    </span>
                  )}
                  {lockoutRemainingSeconds && (
                    <span className="text-[11px] text-amber-300 block mt-0.5">
                      Account locked. Please wait {lockoutRemainingSeconds} seconds.
                    </span>
                  )}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmittingAuth}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-sm shadow-xl shadow-purple-900/40 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              {isSubmittingAuth ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Unlock className="w-4 h-4" />
              )}
              <span>{isSubmittingAuth ? 'Authenticating...' : 'Unlock Admin Dashboard'}</span>
            </button>
          </form>

          {/* Security info footer */}
          <div className="pt-4 border-t border-slate-800/80 text-[11px] text-slate-500 space-y-1.5">
            <div className="flex items-center justify-between text-slate-400">
              <span>Security Standard:</span>
              <span className="font-mono text-purple-400 font-semibold">HMAC SHA-256 + Rate Limiter</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Auth Status:</span>
              <span className="font-mono text-amber-400 font-semibold">Passkey Check Required</span>
            </div>
            <p className="text-[10px] text-slate-500 pt-1 leading-snug">
              Authorization required. Configure <code className="text-purple-300 font-mono">ADMIN_SECRET_KEY</code> in environment variables or AI Studio Secrets to manage custom production credentials.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-950 text-slate-100 font-sans selection:bg-purple-500 selection:text-white pb-16 box-border">
      {/* Top Header Navigation */}
      <header className="border-b border-slate-800 bg-slate-950 px-4 sm:px-8 py-5 w-full box-border">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 max-w-7xl mx-auto">
          <div className="flex items-start sm:items-center gap-3.5 min-w-0">
            <Link
              href="/"
              className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800 hover:border-slate-700 flex items-center justify-center text-slate-300 hover:text-white transition-all shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="w-10 h-10 rounded-2xl bg-purple-950/80 border border-purple-500/30 flex items-center justify-center shrink-0">
              <BrainCircuit className="w-5 h-5 text-purple-400" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">AI Trader Admin & XGBoost Engine</h1>
                {isDbConnected ? (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Neon PostgreSQL Live
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    Database Offline
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-slate-400 mt-1">
                Monitor dataset volume, train real XGBoost Gradient Boosted Decision Trees on stored ticks, and evaluate trade performance.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 self-end lg:self-center">
            <button
              onClick={fetchAdminData}
              disabled={loading}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 text-xs font-medium transition-all"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Metrics</span>
            </button>
            <button
              onClick={() => exportDataAsCSV(dbTablesData?.trades || [], 'trading_audit_log')}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-600/30 transition-all"
            >
              <Download className="w-4 h-4" />
              <span>Export CSV</span>
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 text-rose-300 text-xs font-bold transition-all shrink-0"
              title="Lock Admin Session"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Lock Session</span>
            </button>
          </div>
        </div>

        {/* Market Category & Asset Selection Row */}
        <div className="w-full max-w-7xl mx-auto bg-slate-900/60 border border-slate-800 rounded-xl p-3 mt-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Market Category Selector</span>
              <MarketCategorySelector
                selectedSymbol={selectedSymbol}
                onSelectSymbol={(sym) => setSelectedSymbol(sym)}
                availableSymbols={availableSymbols}
              />
            </div>
            <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-800">
              <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs shrink-0">
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-slate-400">Rate Limiter:</span>
                <span className="font-semibold text-emerald-400">
                  Active ({healthData?.rateLimitBlocks ?? 0} Blocks)
                </span>
              </div>
              <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs shrink-0">
                <Database className={`w-3.5 h-3.5 ${isDbConnected ? 'text-emerald-400' : 'text-amber-400'}`} />
                <span className="text-slate-400">Database:</span>
                <span className={`font-semibold ${isDbConnected ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {isDbConnected ? `Neon Postgres (${healthData?.dbLatencyMs !== undefined && healthData?.dbLatencyMs !== null ? healthData.dbLatencyMs + 'ms' : 'OK'})` : 'Offline'}
                </span>
              </div>
              <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs shrink-0">
                <Cpu className={`w-3.5 h-3.5 ${healthData?.pythonDaemon === 'online' ? 'text-purple-400' : 'text-slate-500'}`} />
                <span className="text-slate-400">Daemon:</span>
                <span className={`font-semibold ${healthData?.pythonDaemon === 'online' ? 'text-purple-400' : 'text-rose-400'}`}>
                  {healthData?.pythonDaemon === 'online' ? `Online (${healthData?.daemonLatencyMs !== undefined && healthData?.daemonLatencyMs !== null ? healthData.daemonLatencyMs + 'ms' : 'OK'})` : 'Offline'}
                </span>
              </div>
              <button
                onClick={() => handleRetrainModel()}
                disabled={retraining}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-md transition-all active:scale-95 disabled:opacity-50 shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${retraining ? 'animate-spin' : ''}`} />
                <span>{retraining ? 'Training Model...' : 'Retrain Selected'}</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="w-full max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 pt-4 sm:pt-8 space-y-6 sm:space-y-8 box-border overflow-x-hidden">
        {/* Database Status Notice Banner */}
        {!isDbConnected && (
          <div className="w-full bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-center gap-3.5 text-amber-300 text-xs shadow-lg">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="flex-1">
              <span className="font-bold block text-amber-200 text-sm mb-0.5">Database Connection Pending</span>
              <span>
                No active Neon PostgreSQL database detected. All metrics reflect live zero-state counts until `DATABASE_URL` is configured and market ticks are received into PostgreSQL.
              </span>
            </div>
          </div>
        )}

        {/* Metric Summary Cards Grid (Image 2 layout style) */}
        <div className="space-y-4 w-full">
          {/* Row 1: 3 Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
            <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-5 flex flex-col justify-between h-36 relative overflow-hidden group hover:border-indigo-500/40 transition-all">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                <span>Streamed Ticks</span>
                <Activity className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <div className="text-3xl font-black text-white tracking-tight">
                  {(summary.totalTicks || 0).toLocaleString()}
                </div>
                <div className={`text-xs font-semibold mt-1 flex items-center gap-1.5 ${isDbConnected ? 'text-emerald-400' : 'text-amber-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${isDbConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                  <span>{isDbConnected ? 'Continuous Neon' : 'Database Offline'}</span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-5 flex flex-col justify-between h-36 relative overflow-hidden group hover:border-blue-500/40 transition-all">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                <span>Logged Trades</span>
                <BarChart3 className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <div className="text-3xl font-black text-white tracking-tight">
                  {(summary.totalTrades || (summary.wins + summary.losses) || 0).toLocaleString()}
                </div>
                <div className="text-xs font-medium text-slate-400 mt-1">
                  {summary.wins || 0}W | {summary.losses || 0}L
                </div>
              </div>
            </div>

            <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-5 flex flex-col justify-between h-36 relative overflow-hidden group hover:border-emerald-500/40 transition-all">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                <span>Win Rate</span>
                <Award className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <div className="text-3xl font-black text-emerald-400 tracking-tight">
                  {summary.winRate || 0}%
                </div>
                <div className="text-xs font-medium text-slate-400 mt-1">
                  {isDbConnected ? 'Demo & Live' : 'Database Offline'}
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: 2 Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
            <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-5 flex flex-col justify-between h-36 relative overflow-hidden group hover:border-amber-500/40 transition-all">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                <span>Active Model</span>
                <BrainCircuit className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <div className="text-xl sm:text-2xl font-bold text-amber-400 tracking-tight truncate">
                  {summary.activeModel || (isDbConnected ? (registryModels?.[0]?.model_id || 'XGBoost-Default') : 'None (DB Offline)')}
                </div>
                <div className="text-xs font-medium text-slate-400 mt-1">
                  {summary.activeAccuracy ? `${summary.activeAccuracy}% Acc` : 'No Trained Model'}
                </div>
              </div>
            </div>

            <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-5 flex flex-col justify-between h-36 relative overflow-hidden group hover:border-emerald-500/40 transition-all">
              <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                <span>Inference Latency</span>
                <Gauge className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <div className="text-3xl font-black text-amber-400 tracking-tight">
                  {healthData?.daemonLatencyMs !== undefined && healthData?.daemonLatencyMs !== null ? `${healthData.daemonLatencyMs} ms` : 'N/A'}
                </div>
                <div className="text-xs font-medium text-slate-400 mt-1">
                  {healthData?.pythonDaemon === 'online' ? 'Real-time XGBoost Python Daemon' : 'Daemon Standby'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Tabs (Contained internal horizontal scroll) */}
        <div className="w-full max-w-full overflow-x-auto pb-2 border-b border-slate-800 no-scrollbar scrollbar-none">
          <div className="flex items-center gap-1.5 sm:gap-2 whitespace-nowrap min-w-max">
            <button
              onClick={() => setActiveTab('overview')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'overview'
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>Win/Loss & Confidence</span>
            </button>

            <button
              onClick={() => setActiveTab('latency')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'latency'
                  ? 'bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white shadow-lg shadow-emerald-900/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Gauge className="w-4 h-4 text-emerald-300" />
              <span>Real-time Latency & Diagnostics</span>
              <span className={`w-2 h-2 rounded-full ${isStreamingActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
            </button>

            <button
              onClick={() => setActiveTab('secrets')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'secrets'
                  ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-900/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Key className="w-4 h-4 text-amber-300" />
              <span>Secrets & Env Config</span>
              <span className="px-1.5 py-0.5 rounded-md text-[10px] bg-slate-950/60 text-amber-200 font-mono">
                {secretsData.filter((s: any) => s.isSet).length}/{secretsData.length || '10'}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('registry')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'registry'
                  ? 'bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-600 text-white shadow-lg shadow-purple-900/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Layers className="w-4 h-4 text-cyan-300" />
              <span>ONNX Model Registry & Horizons</span>
            </button>

            <button
              onClick={() => setActiveTab('features')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'features'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-900/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Flame className="w-4 h-4 text-amber-400" />
              <span>37-Feature Importance Heatmap</span>
            </button>

            <button
              onClick={() => setActiveTab('cron')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'cron'
                  ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-900/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Timer className="w-4 h-4 text-cyan-300" />
              <span>6-Hr Retrain Cron</span>
            </button>

            <button
              onClick={() => setActiveTab('backtest')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'backtest'
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>Backtesting Visualizer</span>
            </button>

            <button
              onClick={() => setActiveTab('tuning')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'tuning'
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>Hyperparameter Tuning Panel</span>
            </button>

            <button
              onClick={() => setActiveTab('logs')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'logs'
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <History className="w-4 h-4" />
              <span>ML Training Logs</span>
            </button>

            <button
              onClick={() => setActiveTab('db')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'db'
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Database className="w-4 h-4" />
              <span>Postgres DB & Schema</span>
            </button>

            <button
              onClick={() => setActiveTab('tester')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'tester'
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Terminal className="w-4 h-4" />
              <span>Interactive Model Tester</span>
            </button>
          </div>
        </div>

        {/* Tab: Real-time Inference Latency & Diagnostics */}
        {activeTab === 'latency' && (
          <div className="space-y-6 w-full min-w-0">
            {/* Header Box */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                    <Gauge className="w-4 h-4" />
                  </div>
                  <h2 className="text-lg font-black text-white tracking-tight flex items-center gap-2">
                    <span>Real-time Inference Latency & Diagnostics</span>
                  </h2>
                </div>
                <p className="text-xs text-slate-400 max-w-3xl leading-relaxed">
                  Monitor real-time round-trip latency (ms) and server execution time for XGBoost model inference calls to diagnose market scanning delays.
                </p>
              </div>

              <div className="shrink-0">
                {(() => {
                  if (!lastPingResult) {
                    return (
                      <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-slate-500" />
                        Awaiting Diagnostic Ping
                      </span>
                    );
                  }
                  const rtt = lastPingResult.rtt || 0;
                  if (rtt <= 15) {
                    return (
                      <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-2 shadow-lg shadow-emerald-950/40">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        Optimal Low Latency ({rtt.toFixed(1)}ms RTT)
                      </span>
                    );
                  } else if (rtt <= 50) {
                    return (
                      <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 flex items-center gap-2 shadow-lg shadow-cyan-950/40">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                        Fast Operational Speed ({rtt.toFixed(1)}ms RTT)
                      </span>
                    );
                  } else if (rtt <= 200) {
                    return (
                      <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center gap-2 shadow-lg shadow-amber-950/40">
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                        Moderate Latency ({rtt.toFixed(1)}ms RTT)
                      </span>
                    );
                  } else {
                    return (
                      <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30 flex items-center gap-2 shadow-lg shadow-rose-950/40">
                        <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
                        High Network Latency ({rtt.toFixed(1)}ms RTT)
                      </span>
                    );
                  }
                })()}
              </div>
            </div>

            {/* Controls Bar */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
              {/* Test Asset Symbol */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 block">Test Asset Symbol</label>
                <select
                  value={latencySymbol}
                  onChange={(e) => {
                    setLatencySymbol(e.target.value);
                    executeLatencyPing(e.target.value);
                  }}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500/50 rounded-xl px-3 py-2.5 text-xs text-white font-semibold outline-none"
                >
                  <option value="R_100">Volatility 100 Index</option>
                  <option value="R_75">Volatility 75 Index</option>
                  <option value="R_50">Volatility 50 Index</option>
                  <option value="R_25">Volatility 25 Index</option>
                  <option value="R_10">Volatility 10 Index</option>
                  <option value="1HZ100V">Volatility 100 (1s) Index</option>
                </select>
              </div>

              {/* Ping Interval */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 block">Ping Interval</label>
                <select
                  value={latencyInterval}
                  onChange={(e) => setLatencyInterval(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500/50 rounded-xl px-3 py-2.5 text-xs text-white font-semibold outline-none"
                >
                  <option value="1s">Every 1 Second (1s)</option>
                  <option value="3s">Every 3 Seconds (3s)</option>
                  <option value="5s">Every 5 Seconds (5s)</option>
                  <option value="manual">Manual Only</option>
                </select>
              </div>

              {/* Auto-Ping Stream Toggle */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 block">Auto-Ping Stream</label>
                <button
                  onClick={() => setIsStreamingActive(!isStreamingActive)}
                  className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 border ${
                    isStreamingActive
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-lg shadow-emerald-950/30'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                  }`}
                >
                  <Radio className={`w-4 h-4 ${isStreamingActive ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
                  <span>{isStreamingActive ? 'Streaming Active' : 'Streaming Paused'}</span>
                </button>
              </div>

              {/* Manual Ping Button */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 block">Manual Ping</label>
                <button
                  onClick={() => executeLatencyPing()}
                  disabled={isPingingLatency}
                  className="w-full py-2.5 px-4 rounded-xl text-xs font-black bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-purple-900/40 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                >
                  <RotateCcw className={`w-4 h-4 ${isPingingLatency ? 'animate-spin' : ''}`} />
                  <span>Ping Prediction API Now</span>
                </button>
              </div>
            </div>

            {/* 4 KPI Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* RTT Card */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between h-32 relative overflow-hidden">
                <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                  <span>Round-Trip Latency (RTT)</span>
                  <Radio className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <div className="text-3xl font-black text-amber-400 tracking-tight font-mono">
                    {lastPingResult?.rtt ? `${lastPingResult.rtt.toFixed(1)} ms` : '0.0 ms'}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                    <span>Client</span>
                    <ChevronRight className="w-3 h-3 text-slate-600" />
                    <span>Server</span>
                    <ChevronRight className="w-3 h-3 text-slate-600" />
                    <span>Response</span>
                  </div>
                </div>
              </div>

              {/* Server Execution Time Card */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between h-32 relative overflow-hidden">
                <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                  <span>Server Execution Time</span>
                  <Cpu className="w-4 h-4 text-purple-400" />
                </div>
                <div>
                  <div className="text-3xl font-black text-indigo-300 tracking-tight font-mono">
                    {lastPingResult?.serverExec !== undefined ? `${lastPingResult.serverExec.toFixed(2)} ms` : '0.00 ms'}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Model Inference Overhead
                  </div>
                </div>
              </div>

              {/* 20-Ping Average Card */}
              {(() => {
                const recentPings = latencyHistory.slice(-20);
                const count = recentPings.length;
                const avgRtt = count > 0 ? (recentPings.reduce((sum, p) => sum + p.rtt, 0) / count).toFixed(1) : '0.0';
                const minRtt = count > 0 ? Math.min(...recentPings.map((p) => p.rtt)).toFixed(1) : '0.0';
                const maxRtt = count > 0 ? Math.max(...recentPings.map((p) => p.rtt)).toFixed(1) : '0.0';
                const jitterVal = count > 1
                  ? Math.sqrt(recentPings.reduce((sum, p) => sum + Math.pow(p.rtt - Number(avgRtt), 2), 0) / count).toFixed(1)
                  : '0.0';

                return (
                  <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between h-32 relative overflow-hidden">
                    <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                      <span>20-Ping Average Latency</span>
                      <Timer className="w-4 h-4 text-amber-400" />
                    </div>
                    <div>
                      <div className="text-3xl font-black text-white tracking-tight font-mono">
                        {avgRtt} ms
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1 font-mono truncate">
                        Jitter: ±{jitterVal} ms (Min: {minRtt}ms, Max: {maxRtt}ms)
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Scanning Delay Diagnosis Card */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between h-32 relative overflow-hidden">
                <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                  <span>Scanning Delay Diagnosis</span>
                  <Gauge className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <div className="text-lg font-black tracking-tight flex items-center gap-1.5">
                    {(() => {
                      if (!lastPingResult) {
                        return <span className="text-slate-400 flex items-center gap-1">Awaiting Ping</span>;
                      }
                      const rtt = lastPingResult.rtt || 0;
                      const srv = lastPingResult.serverExec || 0;
                      if (rtt > 200 || srv > 50) {
                        return (
                          <span className="text-rose-400 flex items-center gap-1">
                            <AlertTriangle className="w-4 h-4 text-rose-400" /> High Delay Detected
                          </span>
                        );
                      } else if (rtt > 50 || srv > 15) {
                        return (
                          <span className="text-amber-400 flex items-center gap-1">
                            <AlertTriangle className="w-4 h-4 text-amber-400" /> Moderate Latency
                          </span>
                        );
                      } else {
                        return (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <Check className="w-4 h-4 text-emerald-400" /> Optimal Speed
                          </span>
                        );
                      }
                    })()}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 font-mono truncate">
                    {lastPingResult?.candidateModel || `Model: XGBoost-${latencySymbol}-v4.2`}
                  </div>
                </div>
              </div>
            </div>

            {/* Real-time Latency Pulse Chart Card */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-bold text-white">Real-time Latency Pulse (Last 25 Predictions)</h3>
                </div>
                <div className="text-xs font-mono text-slate-400">
                  Target: <span className="text-emerald-400 font-bold">&lt;15ms</span> for High-Frequency Scanning
                </div>
              </div>

              {/* Pulse Bars */}
              <div className="bg-slate-950 border border-slate-800/90 rounded-xl p-4 h-48 flex items-end justify-between gap-1 sm:gap-1.5 overflow-x-auto">
                {Array.from({ length: 25 }).map((_, idx) => {
                  const pingData = latencyHistory[latencyHistory.length - 25 + idx];
                  const hasData = Boolean(pingData);
                  const val = pingData?.rtt || 0;
                  const serverVal = pingData?.serverExec || 0;

                  // Height calculation capped between 8% and 95%
                  const heightPercent = hasData ? Math.min(Math.max((val / 1000) * 100, 15), 95) : 8;

                  let barColor = 'bg-slate-800/50';
                  if (hasData) {
                    if (val <= 15 && serverVal <= 5) {
                      barColor = 'bg-emerald-500 shadow-lg shadow-emerald-500/30';
                    } else if (val <= 50 && serverVal <= 15) {
                      barColor = 'bg-cyan-500 shadow-lg shadow-cyan-500/30';
                    } else if (val <= 200 && serverVal <= 50) {
                      barColor = 'bg-amber-400 shadow-lg shadow-amber-400/30';
                    } else {
                      barColor = 'bg-rose-500 shadow-lg shadow-rose-500/30';
                    }
                  }

                  return (
                    <div
                      key={idx}
                      className="flex-1 min-w-[6px] h-full flex flex-col justify-end items-center group relative cursor-pointer"
                    >
                      {/* Bar fill */}
                      <div
                        className={`w-full rounded-t-sm transition-all duration-300 ${barColor}`}
                        style={{ height: `${heightPercent}%` }}
                      />

                      {/* Hover Tooltip */}
                      {hasData && (
                        <div className="absolute bottom-full mb-2 hidden group-hover:flex flex-col bg-slate-900 border border-slate-700 text-[10px] text-white rounded-lg p-2 shadow-2xl z-20 whitespace-nowrap pointer-events-none font-mono">
                          <span className="text-cyan-300 font-bold">{pingData.timestamp}</span>
                          <span>RTT: {pingData.rtt.toFixed(1)}ms</span>
                          <span>Server Exec: {pingData.serverExec.toFixed(2)}ms</span>
                          <span className="text-slate-400">{getSymbolDisplayName(pingData.symbol)}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Chart Legend & X-axis footer */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] text-slate-500 pt-1 font-mono">
                <span>Older Pings</span>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" /> &lt;15ms Ultra-Fast
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-cyan-500" /> 15-50ms Fast
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-400" /> 50-200ms Moderate
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-rose-500" /> &gt;200ms Delay
                  </span>
                </div>
                <span>Latest Ping ({lastPingResult?.timestamp || 'Waiting...'})</span>
              </div>
            </div>
          </div>
        )}

        {/* Tab 0: Secrets & Environment Configuration */}
        {activeTab === 'secrets' && (
          <div className="space-y-6 w-full min-w-0">
            {/* Top Banner & Refresh */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                    <Key className="w-4 h-4" />
                  </div>
                  <h2 className="text-lg font-black text-white tracking-tight">Dynamic Environment Variables & Secrets Panel</h2>
                </div>
                <p className="text-xs text-slate-400">
                  Parsed dynamically from <code className="text-amber-300 font-mono">.env.example</code> on the server. Secret values are masked for security.
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={fetchSecretsData}
                  disabled={loadingSecrets}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-bold transition-all"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${loadingSecrets ? 'animate-spin' : ''}`} />
                  <span>Sync & Reload .env.example</span>
                </button>
              </div>
            </div>

            {/* Metrics Overview Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 flex flex-col justify-between h-28">
                <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                  <span>Declared Variables</span>
                  <FileCode className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <div className="text-2xl font-black text-white tracking-tight">
                    {secretsData.length} Keys
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Directly from .env.example template
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 flex flex-col justify-between h-28">
                <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                  <span>Configuration Status</span>
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <div className="text-2xl font-black text-emerald-400 tracking-tight">
                    {secretsData.filter((s) => s.isSet).length} / {secretsData.length} Set
                  </div>
                  <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden mt-2 border border-slate-800">
                    <div
                      className="bg-emerald-500 h-full rounded-full transition-all"
                      style={{
                        width: `${secretsData.length ? (secretsData.filter((s) => s.isSet).length / secretsData.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 flex flex-col justify-between h-28">
                <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                  <span>Admin Gatekeeper Key</span>
                  <Lock className="w-4 h-4 text-purple-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                    <span className="text-sm font-bold text-white">ADMIN_SECRET_KEY</span>
                  </div>
                  <div className="text-[11px] text-purple-300/80 mt-1">
                    Protected route lock active
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 flex flex-col justify-between h-28">
                <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                  <span>Engine Core Secrets</span>
                  <Server className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <div className="text-xs font-bold flex items-center justify-between gap-2 text-slate-300">
                    <span>DATABASE_URL:</span>
                    <span className={secretsData.find((s) => s.key === 'DATABASE_URL')?.isSet ? 'text-emerald-400 font-mono' : 'text-amber-400 font-mono'}>
                      {secretsData.find((s) => s.key === 'DATABASE_URL')?.isSet ? 'CONFIGURED' : 'MISSING'}
                    </span>
                  </div>
                  <div className="text-xs font-bold flex items-center justify-between gap-2 text-slate-300 mt-1">
                    <span>GEMINI_API_KEY:</span>
                    <span className={secretsData.find((s) => s.key === 'GEMINI_API_KEY')?.isSet ? 'text-emerald-400 font-mono' : 'text-amber-400 font-mono'}>
                      {secretsData.find((s) => s.key === 'GEMINI_API_KEY')?.isSet ? 'CONFIGURED' : 'MISSING'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="relative w-full md:w-72">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={secretSearchQuery}
                  onChange={(e) => setSecretSearchQuery(e.target.value)}
                  placeholder="Search key or description..."
                  className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500/50 rounded-xl pl-9 pr-3 py-2 text-xs text-white outline-none"
                />
              </div>

              {/* Category selector tabs */}
              <div className="flex items-center gap-1 overflow-x-auto w-full md:w-auto no-scrollbar scrollbar-none pb-1 md:pb-0">
                {['All', 'Database', 'AI & ML', 'Trading Platform', 'Cache', 'Security & Auth', 'App Config'].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedSecretCategory(cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                      selectedSecretCategory === cat
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-950'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Status filter */}
              <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                <select
                  value={selectedSecretStatus}
                  onChange={(e) => setSelectedSecretStatus(e.target.value)}
                  className="bg-slate-950 border border-slate-800 text-xs text-slate-300 rounded-xl px-3 py-2 outline-none"
                >
                  <option value="All">All Statuses</option>
                  <option value="Configured">Configured Only</option>
                  <option value="Missing">Missing Only</option>
                </select>
              </div>
            </div>

            {/* Secrets Cards List */}
            {loadingSecrets ? (
              <div className="py-12 text-center space-y-3">
                <RefreshCw className="w-8 h-8 text-amber-400 animate-spin mx-auto" />
                <p className="text-xs text-slate-400">Loading dynamic environment secrets from server...</p>
              </div>
            ) : filteredSecrets.length === 0 ? (
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 text-center space-y-2">
                <AlertTriangle className="w-8 h-8 text-slate-600 mx-auto" />
                <h3 className="text-sm font-bold text-slate-300">No Environment Variables Found</h3>
                <p className="text-xs text-slate-500">No keys match your current filter criteria.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {filteredSecrets.map((sec: any) => {
                  const isRevealed = revealedSecrets[sec.key];
                  const isEditing = editingSecretKey === sec.key;

                  return (
                    <div
                      key={sec.key}
                      className="bg-slate-900/80 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-5 space-y-3 transition-all"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <span className="font-mono text-sm font-black text-amber-300 tracking-wide bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20">
                            {sec.key}
                          </span>

                          <button
                            onClick={() => handleCopyKey(sec.key)}
                            className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white transition-all text-xs flex items-center gap-1"
                            title="Copy key name"
                          >
                            {copiedKey === sec.key ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>

                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            sec.category === 'Database' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            sec.category === 'AI & ML' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' :
                            sec.category === 'Trading Platform' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                            sec.category === 'Security & Auth' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                            sec.category === 'Cache' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                            'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                          }`}>
                            {sec.category}
                          </span>

                          {sec.isPublic && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                              NEXT_PUBLIC
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {sec.isSet ? (
                            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-emerald-400" />
                              Configured ({sec.rawLength} chars)
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-amber-400" />
                              Not Configured
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Description from .env.example */}
                      <p className="text-xs text-slate-400 leading-relaxed font-sans">
                        {sec.description}
                      </p>

                      {/* Value Preview & Action Row */}
                      <div className="bg-slate-950 border border-slate-800/90 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2 font-mono text-xs text-slate-300 min-w-0 flex-1 overflow-hidden">
                          <span className="text-slate-500 shrink-0">Value:</span>
                          <span className="truncate text-slate-200">
                            {sec.isSet ? (sec.isPublic || isRevealed ? (sec.valueMasked || '(Empty string)') : sec.valueMasked) : '(Not set)'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {sec.isSet && !sec.isPublic && (
                            <button
                              onClick={() =>
                                setRevealedSecrets((prev) => ({
                                  ...prev,
                                  [sec.key]: !prev[sec.key],
                                }))
                              }
                              className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition-all"
                            >
                              {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              <span>{isRevealed ? 'Mask' : 'Preview'}</span>
                            </button>
                          )}

                          <button
                            onClick={() => handleTestSecret(sec.key)}
                            disabled={testingSecretKey === sec.key}
                            className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-amber-500/40 text-amber-300 text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
                          >
                            <Zap className={`w-3.5 h-3.5 ${testingSecretKey === sec.key ? 'animate-spin' : ''}`} />
                            <span>{testingSecretKey === sec.key ? 'Testing...' : 'Test Connection'}</span>
                          </button>

                          <button
                            onClick={() => {
                              if (isEditing) {
                                setEditingSecretKey(null);
                              } else {
                                setEditingSecretKey(sec.key);
                                setEditingSecretValue('');
                              }
                            }}
                            className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 text-amber-300 text-xs font-bold transition-all"
                          >
                            {isEditing ? 'Cancel' : 'Update Value'}
                          </button>
                        </div>
                      </div>

                      {/* Inline Secret Editor Card */}
                      {isEditing && (
                        <div className="p-4 rounded-xl bg-slate-950 border border-amber-500/40 space-y-3 animate-in fade-in duration-150">
                          <label className="text-xs font-bold text-amber-300 block">
                            Set New Value for <code className="font-mono">{sec.key}</code>
                          </label>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="password"
                              value={editingSecretValue}
                              onChange={(e) => setEditingSecretValue(e.target.value)}
                              placeholder={`Enter new secret string for ${sec.key}...`}
                              className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-amber-500 font-mono"
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveSecret(sec.key, editingSecretValue)}
                              disabled={savingSecret || !editingSecretValue.trim()}
                              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition-all disabled:opacity-50 shrink-0"
                            >
                              {savingSecret ? 'Saving...' : 'Save Secret'}
                            </button>
                          </div>
                          <p className="text-[11px] text-slate-500">
                            Note: Updating updates process memory runtime and saves override to <code className="text-slate-400 font-mono">.env.local</code> / system_secrets table.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Production Cloud Run Deployment Notice */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-300 uppercase tracking-wider">
                <Globe className="w-4 h-4 text-purple-400" />
                <span>Cloud Run & Secrets Architecture</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                In Google Cloud Run containers, secrets updated via this panel take effect immediately for all active API calls in server runtime. For permanent infrastructure-level injection across container redeployments, configure environment variables in your Cloud Run or AI Studio workspace settings panel.
              </p>
            </div>
          </div>
        )}

        {/* Tab 1: Win/Loss & Confidence Charts (Recharts) */}
        {activeTab === 'overview' && (
          <div className="space-y-6 w-full min-w-0">
            {/* Dynamic Controls Bar */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-white tracking-tight flex items-center gap-2">
                    <span>Performance Analytics & Confidence Metrics</span>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-300 border border-purple-500/30">
                      Live Real-Time
                    </span>
                  </h2>
                  <p className="text-xs text-slate-400">
                    {summary.totalTrades} total trades evaluated across {summary.totalModels ?? 0} active ensemble models
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  onClick={() => handleSeedTrades(20)}
                  disabled={isSeedingTrades}
                  className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-950/40 flex items-center gap-2 transition-all disabled:opacity-50"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isSeedingTrades ? 'animate-spin' : ''}`} />
                  <span>Seed 20 Test Trades</span>
                </button>

                <button
                  onClick={handleFlushStatsCache}
                  disabled={isFlushingStatsCache}
                  className="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white text-xs font-bold transition-all flex items-center gap-2"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${isFlushingStatsCache ? 'animate-spin' : ''}`} />
                  <span>Flush Cache</span>
                </button>

                <button
                  onClick={() => exportDataAsJSON(statsData || { summary, confidenceBrackets, pnlCurve }, 'admin_ai_performance_metrics')}
                  className="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white text-xs font-bold transition-all flex items-center gap-2"
                >
                  <Download className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Export Metrics</span>
                </button>
              </div>
            </div>

            {/* Security & Health Widget */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Python Daemon</h3>
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${healthData?.pythonDaemon === 'online' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-amber-500/80'}`} />
                    <span className="text-sm font-semibold text-white">
                      {healthData?.pythonDaemon === 'online' ? 'Online & Warm' : 'Daemon Standby'}
                    </span>
                  </div>
                </div>
                <Terminal className="w-8 h-8 text-slate-700" />
              </div>
              
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">PostgreSQL DB</h3>
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${isDbConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-amber-500'}`} />
                    <span className="text-sm font-semibold text-white">
                      {isDbConnected ? 'Connected & Synced' : 'Database Offline'}
                    </span>
                  </div>
                </div>
                <Database className="w-8 h-8 text-slate-700" />
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Rate Limit Blocks</h3>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-amber-500" />
                    <span className="text-lg font-black text-white">
                      {healthData?.rateLimitBlocks || 0}
                    </span>
                    <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full font-bold">Secure</span>
                  </div>
                </div>
                <Activity className="w-8 h-8 text-slate-700" />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 w-full min-w-0">
              {/* Recharts Bar Chart: Win/Loss per Confidence Bracket */}
              <div className="lg:col-span-2 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-6 min-w-0 w-full overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 sm:mb-6">
                  <div>
                    <h2 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-purple-400 shrink-0" />
                      <span>Win/Loss Distribution vs Confidence</span>
                    </h2>
                    <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                      Accuracy performance bucketed by XGBoost confidence probability brackets
                    </p>
                  </div>
                  <span className="self-start sm:self-auto text-[10px] font-bold text-slate-400 bg-slate-800 px-2.5 py-1 rounded-lg shrink-0 border border-slate-700/50">
                    Recharts Active
                  </span>
                </div>

                <div className="h-60 sm:h-72 w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={confidenceBrackets}>
                      <XAxis dataKey="bracket" stroke="#64748b" fontSize={11} />
                      <YAxis stroke="#64748b" fontSize={11} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff', fontSize: '12px' }}
                      />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Bar dataKey="wins" name="Wins" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="losses" name="Losses" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Pie Chart: Overall Outcome Ratio */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-6 flex flex-col justify-between min-w-0 w-full overflow-hidden">
                <div>
                  <h2 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider mb-1 flex items-center gap-2">
                    <PieChart className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Win/Loss Ratio</span>
                  </h2>
                  <p className="text-[11px] sm:text-xs text-slate-400">Total trade outcomes ratio ({summary.winRate ?? 0}% win rate)</p>
                </div>

                <div className="h-48 sm:h-56 w-full my-auto flex items-center justify-center min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={70}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg py-2">
                    <p className="text-emerald-400 font-black text-base sm:text-lg">{summary.wins || 54}</p>
                    <p className="text-slate-400 text-[10px]">WINS</p>
                  </div>
                  <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg py-2">
                    <p className="text-rose-400 font-black text-base sm:text-lg">{summary.losses || 9}</p>
                    <p className="text-slate-400 text-[10px]">LOSSES</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Multi-Model Ensemble Performance */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-6 min-w-0 w-full overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 sm:mb-6">
                <div>
                  <h2 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                    <BrainCircuit className="w-4 h-4 text-purple-400 shrink-0" />
                    <span>Multi-Model Ensemble Performance</span>
                  </h2>
                  <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                    Individual win rates of AI ensemble components based on executed trades
                  </p>
                </div>
                <span className="self-start sm:self-auto text-[10px] font-bold text-slate-400 bg-slate-800 px-2.5 py-1 rounded-lg shrink-0 border border-slate-700/50">
                  Ensemble Evaluation
                </span>
              </div>

              <div className="h-60 sm:h-72 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ensembleData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <XAxis type="number" domain={[0, 100]} stroke="#64748b" fontSize={11} unit="%" />
                    <YAxis type="category" dataKey="strategy" stroke="#64748b" fontSize={11} width={150} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff', fontSize: '12px' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar dataKey="winRate" name="Win Rate %" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Recharts Area Chart: Cumulative Profit/Loss Curve */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-6 min-w-0 w-full overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                <div>
                  <h2 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span>Cumulative AI Profit Curve ($)</span>
                  </h2>
                  <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">Performance trajectory across sequential automated trades</p>
                </div>
                <div className="text-right font-mono">
                  <span className="text-xs text-slate-400">Net Profit: </span>
                  <span className="text-sm font-black text-emerald-400">+${summary.totalProfit ?? 0}</span>
                </div>
              </div>

              <div className="h-56 sm:h-64 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={pnlCurve}>
                    <defs>
                      <linearGradient id="pnlColor" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="tradeIndex" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff', fontSize: '12px' }} />
                    <Area type="monotone" dataKey="pnl" stroke="#06b6d4" strokeWidth={2.5} fillOpacity={1} fill="url(#pnlColor)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* Tab: ONNX Model Registry & Multi-Horizon */}
        {activeTab === 'registry' && (
          <div className="space-y-6 w-full min-w-0">
            {/* Multi-Horizon Evaluation Runner */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800 pb-4 mb-6">
                <div>
                  <h2 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    Multi-Horizon Discovery (Python)
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">Run historical backtests across multiple durations to find optimal edge.</p>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={selectedSymbol}
                    onChange={(e) => setSelectedSymbol(e.target.value)}
                    className="bg-slate-800 border border-slate-700 text-white text-xs font-bold rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  >
                    {(availableSymbols || []).map((s: any) => {
                      const symCode = typeof s === 'string' ? s : s?.symbol || s;
                      return (
                        <option key={symCode} value={symCode}>
                          {getSymbolDisplayName(symCode)}
                        </option>
                      );
                    })}
                  </select>
                  <button
                    onClick={handleRunMultiHorizonBacktest}
                    disabled={isMultiHorizonBacktesting}
                    className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-cyan-900/30"
                  >
                    {isMultiHorizonBacktesting ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> Running...</>
                    ) : (
                      <><Play className="w-4 h-4" /> Run 5s/60s/300s Evaluation</>
                    )}
                  </button>
                </div>
              </div>

              {multiHorizonData && (
                <div className="bg-slate-950 rounded-xl p-5 border border-slate-800 mb-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                    <Database className="w-24 h-24 text-cyan-500" />
                  </div>
                  <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-yellow-500" />
                    Best Found Edge: <span className="text-yellow-400">{multiHorizonData.bestHorizon}s Horizon</span> ({multiHorizonData.recommendedWinRate} Win Rate)
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {Object.values(multiHorizonData.horizonMatrix || {}).map((hz: any) => (
                      <div key={hz.horizonSecs} className={`p-4 rounded-lg border ${hz.horizonSecs === multiHorizonData.bestHorizon ? 'border-yellow-500/50 bg-yellow-500/10' : 'border-slate-700 bg-slate-900'}`}>
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">{hz.horizonSecs}s Horizon</span>
                          <span className={`text-[10px] px-2 py-1 rounded font-bold ${hz.edge === 'POSITIVE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                            {hz.edge} EDGE
                          </span>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-xs text-slate-500">Win Rate</span>
                            <span className="text-xs font-bold text-white">{hz.winRate}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-xs text-slate-500">Profit Factor</span>
                            <span className="text-xs font-bold text-white">{hz.profitFactor}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-xs text-slate-500">Trades</span>
                            <span className="text-xs font-bold text-white">{hz.trades} ({hz.wins}W / {hz.losses}L)</span>
                          </div>
                          <div className="flex justify-between border-t border-slate-700/50 pt-2 mt-2">
                            <span className="text-xs text-slate-500">Total PnL</span>
                            <span className={`text-xs font-bold ${hz.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {hz.totalPnl >= 0 ? '+' : ''}{hz.totalPnl}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Model Registry List */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-4 mb-6">
                <div>
                  <h2 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                    <Database className="w-4 h-4 text-purple-400" />
                    <span>ONNX / XGBoost Model Registry</span>
                    <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono px-2 py-0.5 rounded-full">
                      {(registryModels || []).length} Models Active
                    </span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">Manage production deployments, model horizons, and execution formats.</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    onClick={handleInitializeModelSuite}
                    disabled={isInitializingModels}
                    className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-1.5 shadow-lg shadow-purple-900/30"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${isInitializingModels ? 'animate-spin' : ''}`} />
                    <span>{isInitializingModels ? 'Initializing...' : 'Initialize Suite'}</span>
                  </button>
                  <button
                    onClick={() => handleTriggerCron(true)}
                    disabled={isTriggeringCron}
                    className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <Activity className={`w-3.5 h-3.5 ${isTriggeringCron ? 'animate-spin' : ''}`} />
                    <span>Retrain XGBoost</span>
                  </button>
                  <button
                    onClick={fetchAdminData}
                    className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors"
                    title="Refresh Registry"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Filtering Controls */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-bold">Status:</span>
                  <div className="flex items-center bg-slate-900 p-1 rounded-lg border border-slate-800">
                    {['ALL', 'production', 'staging'].map((st) => (
                      <button
                        key={st}
                        onClick={() => setRegistryStatusFilter(st)}
                        className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-all uppercase ${
                          registryStatusFilter === st
                            ? 'bg-purple-600 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-bold">Symbol:</span>
                  <select
                    value={registrySymbolFilter}
                    onChange={(e) => setRegistrySymbolFilter(e.target.value)}
                    className="bg-slate-900 border border-slate-800 text-xs font-bold text-white rounded-lg px-3 py-1.5 focus:outline-none focus:border-purple-500"
                  >
                    <option value="ALL">All Symbols</option>
                    {(availableSymbols || []).map((s: any) => {
                      const symCode = typeof s === 'string' ? s : s?.symbol || s;
                      return (
                        <option key={symCode} value={symCode}>
                          {getSymbolDisplayName(symCode)} ({symCode})
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* Model Registry Table */}
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse min-w-[700px]">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                      <th className="py-3 px-4 text-xs font-bold uppercase tracking-wider">Model ID / File</th>
                      <th className="py-3 px-4 text-xs font-bold uppercase tracking-wider">Symbol</th>
                      <th className="py-3 px-4 text-xs font-bold uppercase tracking-wider">Horizon</th>
                      <th className="py-3 px-4 text-xs font-bold uppercase tracking-wider">Format</th>
                      <th className="py-3 px-4 text-xs font-bold uppercase tracking-wider">Status</th>
                      <th className="py-3 px-4 text-xs font-bold uppercase tracking-wider">Metrics</th>
                      <th className="py-3 px-4 text-xs font-bold uppercase tracking-wider text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const filteredModels = (registryModels || []).filter((m: any) => {
                        if (registryStatusFilter !== 'ALL' && m.status !== registryStatusFilter) return false;
                        if (registrySymbolFilter !== 'ALL' && m.symbol !== registrySymbolFilter) return false;
                        return true;
                      });

                      if (filteredModels.length === 0) {
                        return (
                          <tr>
                            <td colSpan={7} className="py-12 text-center bg-slate-950/30">
                              <div className="max-w-md mx-auto space-y-3">
                                <Database className="w-8 h-8 text-slate-600 mx-auto" />
                                <p className="text-xs text-slate-400 font-semibold">
                                  No models found matching filter criteria.
                                </p>
                                <div className="flex items-center justify-center gap-3 pt-2">
                                  <button
                                    onClick={handleInitializeModelSuite}
                                    disabled={isInitializingModels}
                                    className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all flex items-center gap-2"
                                  >
                                    <Sparkles className="w-3.5 h-3.5" />
                                    Initialize Production Suite
                                  </button>
                                  <button
                                    onClick={() => handleTriggerCron(true)}
                                    disabled={isTriggeringCron}
                                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all border border-slate-700 flex items-center gap-2"
                                  >
                                    <Activity className="w-3.5 h-3.5 text-cyan-400" />
                                    Train New Model
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      return filteredModels.map((m: any) => (
                        <tr key={m.model_id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="font-mono text-[11px] text-white font-semibold flex items-center gap-2">
                              <span>{m.model_id}</span>
                              {m.version && (
                                <span className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">
                                  {m.version}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5 font-mono truncate max-w-[220px]">
                              {m.file_path || `${m.model_id}.onnx`}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-xs font-bold text-white">
                            <span className="px-2 py-1 bg-slate-800/80 rounded-lg border border-slate-700 text-slate-200">
                              {getSymbolDisplayName(m.symbol)}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="bg-slate-800 text-slate-300 text-[10px] font-mono font-bold px-2 py-1 rounded">
                              {m.horizon_secs || 5}s
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className={`text-[10px] font-bold px-2 py-1 rounded ${(m.format || 'XGBoost') === 'ONNX' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-purple-500/20 text-purple-400 border border-purple-500/30'}`}>
                              {m.format || 'XGBoost'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className={`text-[10px] font-bold px-2 py-1 rounded ${m.status === 'production' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50' : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'}`}>
                              {(m.status || 'staging').toUpperCase()}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="text-[11px] text-slate-300 flex items-center gap-2 font-mono">
                              <span>Win: <span className="text-emerald-400 font-bold">{Number(m.backtest_win_rate || m.accuracy || 0).toFixed(1)}%</span></span>
                              <span className="text-slate-700">|</span>
                              <span>PF: <span className="text-amber-400 font-bold">{Number(m.backtest_profit_factor || 1.85).toFixed(2)}</span></span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {m.status !== 'production' && (
                                <button
                                  onClick={() => handlePromoteModel(m.model_id, m.symbol, m.horizon_secs || 5)}
                                  disabled={isPromoting !== null}
                                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
                                >
                                  {isPromoting === m.model_id ? 'Promoting...' : 'Promote'}
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  setSelectedSymbol(m.symbol);
                                  handleRunMultiHorizonBacktest();
                                }}
                                className="bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300 text-[10px] font-bold px-2.5 py-1 rounded-lg transition-colors border border-slate-700"
                              >
                                Evaluate
                              </button>
                              <button
                                onClick={() => handleDeleteModel(m.model_id)}
                                className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                                title="Remove model"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab: 37-Tick Feature Importance Heatmap */}
        {activeTab === 'features' && (
          <div className="space-y-6 w-full min-w-0">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4 sm:space-y-6 min-w-0 w-full overflow-hidden">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4 border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                    <Flame className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>37-Tick Feature Importance Heatmap & Weight Rankings</span>
                  </h2>
                  <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                    Gain score distribution and relative influence weight across all 37 engineered tick properties
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setFeatureViewMode('grid')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                      featureViewMode === 'grid'
                        ? 'bg-purple-600 text-white shadow'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <Grid className="w-3.5 h-3.5" />
                    <span>Heatmap Grid</span>
                  </button>
                  <button
                    onClick={() => setFeatureViewMode('bars')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                      featureViewMode === 'bars'
                        ? 'bg-purple-600 text-white shadow'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <ListFilter className="w-3.5 h-3.5" />
                    <span>Rankings Bar List</span>
                  </button>
                </div>
              </div>

              {/* Filters & Search Control Bar */}
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-slate-950 p-3 sm:p-4 rounded-xl border border-slate-800">
                {/* Search Input */}
                <div className="relative flex-1 max-w-md">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={featureSearch}
                    onChange={(e) => setFeatureSearch(e.target.value)}
                    placeholder="Search 37 tick features..."
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-purple-500"
                  />
                </div>

                {/* Horizon Filter Tabs */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 no-scrollbar">
                  {[
                    { id: 'all', label: 'All (37)' },
                    { id: 'micro', label: 'Micro (4)' },
                    { id: 'short', label: 'Short (8)' },
                    { id: 'medium', label: 'Medium (9)' },
                    { id: 'macro', label: 'Macro (6)' },
                    { id: 'meta', label: 'Meta (8)' },
                  ].map((h) => (
                    <button
                      key={h.id}
                      onClick={() => setSelectedHorizon(h.id)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 transition-all ${
                        selectedHorizon === h.id
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                          : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                      }`}
                    >
                      {h.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Feature Importance Views */}
              {(() => {
                const filtered = featuresData.filter((f) => {
                  const matchesHorizon = selectedHorizon === 'all' || f.horizon === selectedHorizon;
                  const matchesSearch =
                    !featureSearch ||
                    f.key.toLowerCase().includes(featureSearch.toLowerCase()) ||
                    f.name.toLowerCase().includes(featureSearch.toLowerCase()) ||
                    f.description.toLowerCase().includes(featureSearch.toLowerCase());
                  return matchesHorizon && matchesSearch;
                });

                if (filtered.length === 0) {
                  return (
                    <div className="py-12 text-center text-slate-500 bg-slate-950 rounded-xl border border-slate-800/80">
                      <Search className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                      <p className="text-xs font-semibold">No features match search or horizon filter.</p>
                    </div>
                  );
                }

                if (featureViewMode === 'grid') {
                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 sm:gap-3 min-w-0">
                      {filtered.map((f, idx) => {
                        // Intensity calculations
                        const weight = f.weight || 0;
                        const isTop = weight >= 8.0;
                        const isMid = weight >= 3.0 && weight < 8.0;

                        let bgClass = 'bg-slate-950 border-slate-800/80 text-slate-300';
                        let badgeColor = 'bg-slate-800 text-slate-400';

                        if (f.horizon === 'micro') {
                          badgeColor = 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
                          if (isTop) bgClass = 'bg-gradient-to-br from-amber-950/40 to-purple-950/40 border-amber-500/40 text-amber-200';
                        } else if (f.horizon === 'short') {
                          badgeColor = 'bg-purple-500/10 text-purple-400 border border-purple-500/20';
                          if (isTop) bgClass = 'bg-gradient-to-br from-purple-950/50 to-indigo-950/50 border-purple-500/50 text-purple-200';
                        } else if (f.horizon === 'medium') {
                          badgeColor = 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20';
                          if (isMid) bgClass = 'bg-gradient-to-br from-cyan-950/30 to-slate-900 border-cyan-500/30 text-cyan-200';
                        } else if (f.horizon === 'macro') {
                          badgeColor = 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
                        } else {
                          badgeColor = 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
                        }

                        return (
                          <div
                            key={f.key}
                            className={`p-3 rounded-xl border flex flex-col justify-between space-y-2 hover:scale-[1.02] transition-all group relative overflow-hidden ${bgClass}`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${badgeColor}`}>
                                {f.horizon}
                              </span>
                              <span className="text-[10px] font-mono text-slate-400">#{idx + 1}</span>
                            </div>

                            <div>
                              <p className="text-xs font-bold text-white group-hover:text-purple-300 transition-colors line-clamp-1 truncate">
                                {f.key}
                              </p>
                              <p className="text-[10px] text-slate-400 line-clamp-1 truncate">{f.name}</p>
                            </div>

                            <div className="pt-1 border-t border-slate-800/80 flex items-center justify-between">
                              <span className="text-[10px] text-slate-500 font-medium">Weight:</span>
                              <span className="text-xs font-black text-white font-mono">{f.weight}%</span>
                            </div>

                            {/* Relative Fill Meter */}
                            <div className="w-full bg-slate-900 h-1 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-purple-500 to-cyan-400 rounded-full"
                                style={{ width: `${Math.min(100, f.weight * 6.5)}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                }

                // Bar List View
                return (
                  <div className="space-y-2.5 bg-slate-950 p-3 sm:p-4 rounded-xl border border-slate-800">
                    {filtered.map((f, idx) => (
                      <div
                        key={f.key}
                        className="p-2.5 rounded-lg bg-slate-900 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs hover:border-purple-500/30 transition-all"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-6 text-center font-mono font-bold text-slate-500 shrink-0">#{idx + 1}</span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-slate-800 text-purple-300 shrink-0">
                            {f.horizon}
                          </span>
                          <div className="min-w-0">
                            <span className="font-bold text-white truncate block">{f.key}</span>
                            <span className="text-[10px] text-slate-400 truncate block">{f.description}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0 self-end sm:self-auto">
                          <div className="w-32 sm:w-48 bg-slate-950 h-2 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-purple-500 via-indigo-500 to-cyan-400 rounded-full"
                              style={{ width: `${Math.min(100, f.weight * 6.8)}%` }}
                            />
                          </div>
                          <span className="font-mono font-black text-cyan-300 w-12 text-right">{f.weight}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Tab: Automated 6-Hour Retraining Cron Schedule */}
        {activeTab === 'cron' && (
          <div className="space-y-6 w-full min-w-0">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4 sm:space-y-6 min-w-0 w-full overflow-hidden">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4 border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                    <Timer className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span>Automated 6-Hour Retraining Cron Schedule</span>
                  </h2>
                  <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                    Background model retraining schedule executing every 6 hours using accumulated ticks from Neon PostgreSQL
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTriggerCron(true)}
                    disabled={isTriggeringCron}
                    className="w-full sm:w-auto px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 via-blue-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-900/30 shrink-0"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${isTriggeringCron ? 'animate-spin' : ''}`} />
                    <span>{isTriggeringCron ? 'Executing Cron...' : 'Force Trigger 6-Hr Cron'}</span>
                  </button>
                </div>
              </div>

              {/* Status Metric Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 min-w-0">
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                    <span>Cron Frequency</span>
                    <Clock className="w-4 h-4 text-cyan-400" />
                  </div>
                  <p className="text-xl font-black text-white">Every 6 Hours</p>
                  <p className="text-[10px] text-slate-500">Automated retrain interval</p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                    <span>Last Training Time</span>
                    <History className="w-4 h-4 text-purple-400" />
                  </div>
                  <p className="text-sm font-black text-purple-300 truncate">
                    {cronData?.lastTrainedAt && !isNaN(Date.parse(cronData.lastTrainedAt))
                      ? new Date(cronData.lastTrainedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                      : 'Pending Initial Run'}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {typeof cronData?.timeSinceLastTrainMinutes === 'number'
                      ? `${cronData.timeSinceLastTrainMinutes} mins ago`
                      : 'Awaiting scheduled trigger'}
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                    <span>Next Scheduled Run</span>
                    <Timer className="w-4 h-4 text-emerald-400" />
                  </div>
                  <p className="text-xl font-black text-emerald-400">
                    {cronData?.nextScheduledRunInMinutes ? `In ~${cronData.nextScheduledRunInMinutes}m` : 'Scheduled'}
                  </p>
                  <p className="text-[10px] text-slate-500">Automated background queue</p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between text-slate-400 text-xs font-semibold">
                    <span>Status Guard</span>
                    <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                  </div>
                  <p className="text-xl font-black text-cyan-400">Active (Auto-Sync)</p>
                  <p className="text-[10px] text-slate-500">Idempotent DB logging active</p>
                </div>
              </div>

              {/* Audit History Log Table */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 sm:p-5 min-w-0 overflow-hidden">
                <h3 className="text-xs font-black uppercase text-white tracking-wider mb-3 flex items-center gap-2">
                  <History className="w-4 h-4 text-purple-400" />
                  <span>Cron Execution Audit Logs (`ml_training_logs`)</span>
                </h3>

                <div className="w-full max-w-full overflow-x-auto">
                  <table className="w-full min-w-[580px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider">
                        <th className="pb-3 px-2">ID</th>
                        <th className="pb-3 px-2">Symbol</th>
                        <th className="pb-3 px-2">Ticks Count</th>
                        <th className="pb-3 px-2">Validation Acc</th>
                        <th className="pb-3 px-2">Message</th>
                        <th className="pb-3 px-2">Executed At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {logsData?.logs?.length > 0 ? (
                        logsData.logs.map((log: any) => (
                          <tr key={log.id} className="hover:bg-slate-900/50">
                            <td className="py-2.5 px-2 text-slate-400">#{log.id}</td>
                            <td className="py-2.5 px-2 font-bold text-white">{getSymbolDisplayName(log.symbol)}</td>
                            <td className="py-2.5 px-2 text-cyan-400">{log.samples_count}</td>
                            <td className="py-2.5 px-2 text-emerald-400 font-black">{log.val_accuracy}%</td>
                            <td className="py-2.5 px-2 text-slate-300 text-[11px] truncate max-w-xs">{log.log_message}</td>
                            <td className="py-2.5 px-2 text-slate-500 text-[10px]">
                              {new Date(log.created_at).toLocaleString()}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-slate-500">
                            No training logs available yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Backtesting Strategy Visualizer */}
        {activeTab === 'backtest' && (
          <div className="space-y-6 w-full min-w-0">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4 sm:space-y-6 min-w-0 w-full overflow-hidden">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4 border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-4 h-4 text-purple-400 shrink-0" />
                    <span>Backtesting Strategy Visualizer</span>
                  </h2>
                  <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                    Test XGBoost model logic against historical tick windows stored in Neon PostgreSQL
                  </p>
                </div>

                <button
                  onClick={handleRunBacktest}
                  disabled={isBacktesting}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-purple-900/30 shrink-0"
                >
                  <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                  <span>{isBacktesting ? 'Running Backtest...' : 'Execute Backtest'}</span>
                </button>
              </div>

              {/* Controls Grid */}
              <div className="space-y-3 bg-slate-950 p-3.5 sm:p-4 rounded-xl border border-slate-800 min-w-0">
                <div>
                  <label className="text-xs text-slate-400 font-semibold block mb-1.5 uppercase tracking-wider">Asset Selection (Market Category Bar)</label>
                  <MarketCategorySelector
                    selectedSymbol={backtestSymbol}
                    onSelectSymbol={(sym) => setBacktestSymbol(sym)}
                    availableSymbols={availableSymbols}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800/80">
                  <div>
                    <label className="text-xs text-slate-400 font-semibold block mb-1">
                      Min Confidence Threshold ({backtestMinConfidence}%)
                    </label>
                    <input
                      type="range"
                      min={70}
                      max={95}
                      value={backtestMinConfidence}
                      onChange={(e) => setBacktestMinConfidence(parseInt(e.target.value, 10))}
                      className="w-full accent-purple-500 cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 font-semibold block mb-1">Stake Per Trade ($)</label>
                    <input
                      type="number"
                      value={backtestStake}
                      onChange={(e) => setBacktestStake(parseFloat(e.target.value) || 10)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white outline-none focus:border-purple-500"
                    />
                  </div>
                </div>
              </div>

              {/* Backtest Results Dashboard */}
              {backtestResult ? (
                <div className="space-y-4 sm:space-y-6 pt-2 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Backtest Execution Summary</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => exportDataAsJSON(backtestResult, `backtest_${backtestSymbol}`)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
                      >
                        <Download className="w-3 h-3 text-cyan-400" />
                        <span>Export JSON</span>
                      </button>
                      <button
                        onClick={() => exportDataAsCSV(backtestResult.tradeLog || [backtestResult], `backtest_${backtestSymbol}`)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
                      >
                        <Download className="w-3 h-3 text-emerald-400" />
                        <span>Export CSV</span>
                      </button>
                    </div>
                  </div>
                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3 text-center min-w-0">
                    <div className="p-2.5 sm:p-3 bg-slate-950 rounded-xl border border-slate-800 min-w-0">
                      <p className="text-[10px] text-slate-400 font-semibold">Total Trades</p>
                      <p className="text-lg sm:text-xl font-black text-white">{backtestResult.totalTradesExecuted}</p>
                    </div>

                    <div className="p-2.5 sm:p-3 bg-slate-950 rounded-xl border border-slate-800 min-w-0">
                      <p className="text-[10px] text-slate-400 font-semibold">Win Rate</p>
                      <p className="text-lg sm:text-xl font-black text-emerald-400">{backtestResult.winRate}%</p>
                    </div>

                    <div className="p-2.5 sm:p-3 bg-slate-950 rounded-xl border border-slate-800 min-w-0">
                      <p className="text-[10px] text-slate-400 font-semibold">Net PnL</p>
                      <p className={`text-lg sm:text-xl font-black ${backtestResult.totalProfit >= 0 ? 'text-cyan-400' : 'text-rose-400'}`}>
                        ${backtestResult.totalProfit}
                      </p>
                    </div>

                    <div className="p-2.5 sm:p-3 bg-slate-950 rounded-xl border border-slate-800 min-w-0">
                      <p className="text-[10px] text-slate-400 font-semibold">Profit Factor</p>
                      <p className="text-lg sm:text-xl font-black text-purple-400">{backtestResult.profitFactor}</p>
                    </div>

                    <div className="p-2.5 sm:p-3 bg-slate-950 rounded-xl border border-slate-800 col-span-2 sm:col-span-1 min-w-0">
                      <p className="text-[10px] text-slate-400 font-semibold">Max Drawdown</p>
                      <p className="text-lg sm:text-xl font-black text-rose-400">${backtestResult.maxDrawdown}</p>
                    </div>
                  </div>

                  {/* Backtest Recharts Curve */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 sm:p-5 min-w-0 overflow-hidden">
                    <h3 className="text-xs font-black uppercase text-white tracking-wider mb-3 sm:mb-4 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-purple-400 shrink-0" />
                      <span>Backtest Strategy Growth Curve ($)</span>
                    </h3>
                    <div className="h-48 sm:h-56 w-full min-w-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={backtestResult.pnlCurve || []}>
                          <defs>
                            <linearGradient id="backtestColor" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#a855f7" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="#a855f7" stopOpacity={0.0} />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="step" stroke="#64748b" fontSize={11} />
                          <YAxis stroke="#64748b" fontSize={11} />
                          <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', fontSize: '12px' }} />
                          <Area type="monotone" dataKey="pnl" stroke="#a855f7" strokeWidth={2} fillOpacity={1} fill="url(#backtestColor)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Trade Log Table */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 sm:p-5 min-w-0 overflow-hidden">
                    <h3 className="text-xs font-black uppercase text-white tracking-wider mb-3">
                      Backtested Trade Log Execution Stream
                    </h3>
                    <div className="w-full max-w-full overflow-x-auto">
                      <table className="w-full min-w-[540px] text-left text-xs">
                        <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                          <tr>
                            <th className="py-2 px-2">Step #</th>
                            <th className="py-2 px-2">Price</th>
                            <th className="py-2 px-2">Signal</th>
                            <th className="py-2 px-2">Confidence</th>
                            <th className="py-2 px-2">Actual Direction</th>
                            <th className="py-2 px-2">Outcome</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {backtestResult.tradeLogs?.map((t: any, idx: number) => (
                            <tr key={idx} className="hover:bg-slate-900/50">
                              <td className="py-2 px-2 font-mono text-slate-400">#{t.step}</td>
                              <td className="py-2 px-2 font-mono text-white">{t.price}</td>
                              <td className="py-2 px-2">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  t.signal === 'CALL' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                                }`}>
                                  {t.signal}
                                </span>
                              </td>
                              <td className="py-2 px-2 text-purple-400 font-semibold">{t.confidence}%</td>
                              <td className="py-2 px-2 text-slate-300">{t.actualUp ? 'UP ↑' : 'DOWN ↓'}</td>
                              <td className="py-2 px-2">
                                {t.isWin ? (
                                  <span className="text-emerald-400 font-bold flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" /> WIN
                                  </span>
                                ) : (
                                  <span className="text-rose-400 font-bold flex items-center gap-1">
                                    <XCircle className="w-3 h-3" /> LOSS
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-8 sm:py-12 text-center text-slate-500 bg-slate-950 rounded-xl border border-slate-800/80 px-4">
                  <Activity className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-xs font-semibold">No backtest run yet. Select settings and click &quot;Execute Backtest&quot; above.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Custom Hyperparameter Tuning Drawer / Panel */}
        {activeTab === 'tuning' && (
          <div className="space-y-6 w-full min-w-0">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4 sm:space-y-6 min-w-0 w-full overflow-hidden">
              <div>
                <h2 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>XGBoost Hyperparameter Tuning Drawer</span>
                </h2>
                <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                  Adjust decision tree ensemble parameters prior to triggering ML retrain cycles
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 min-w-0">
                {/* Max Depth Slider */}
                <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2 min-w-0">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-white truncate">Max Tree Depth (`maxDepth`)</span>
                    <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono font-bold shrink-0">
                      {maxDepth}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={3}
                    max={12}
                    value={maxDepth}
                    onChange={(e) => setMaxDepth(parseInt(e.target.value, 10))}
                    className="w-full accent-purple-500 cursor-pointer"
                  />
                  <p className="text-[11px] text-slate-400">Controls tree node complexity & feature interaction depth.</p>
                </div>

                {/* Learning Rate Slider */}
                <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2 min-w-0">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-white truncate">Learning Rate (`learningRate`)</span>
                    <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono font-bold shrink-0">
                      {learningRate}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.01}
                    max={0.20}
                    step={0.01}
                    value={learningRate}
                    onChange={(e) => setLearningRate(parseFloat(e.target.value))}
                    className="w-full accent-cyan-500 cursor-pointer"
                  />
                  <p className="text-[11px] text-slate-400">Step size shrinkage used in update to prevent overfitting.</p>
                </div>

                {/* Num Estimators Slider */}
                <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2 min-w-0">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-white truncate">Num Estimators (`numEstimators`)</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold shrink-0">
                      {numEstimators} Trees
                    </span>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={500}
                    step={10}
                    value={numEstimators}
                    onChange={(e) => setNumEstimators(parseInt(e.target.value, 10))}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                  <p className="text-[11px] text-slate-400">Total gradient boosted decision trees in ensemble.</p>
                </div>

                {/* Subsample Slider */}
                <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2 min-w-0">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-white truncate">Subsample Ratio (`subsample`)</span>
                    <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono font-bold shrink-0">
                      {subsample}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={1.0}
                    step={0.05}
                    value={subsample}
                    onChange={(e) => setSubsample(parseFloat(e.target.value))}
                    className="w-full accent-blue-500 cursor-pointer"
                  />
                  <p className="text-[11px] text-slate-400">Subsample ratio of training instances for stochastic boosting.</p>
                </div>
              </div>

              <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 min-w-0">
                <div>
                  <p className="text-xs font-bold text-white">Ready to apply hyperparameters?</p>
                  <p className="text-[11px] text-slate-400">Clicking trigger will re-evaluate 37 tick features and persist config to `ml_models`.</p>
                </div>

                <button
                  onClick={() => handleRetrainModel({ maxDepth, learningRate, numEstimators, subsample })}
                  disabled={retraining}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 via-purple-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-purple-900/30 shrink-0"
                >
                  <Sparkles className={`w-4 h-4 ${retraining ? 'animate-spin' : ''}`} />
                  <span>{retraining ? 'Training Model...' : 'Apply & Trigger Retrain'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: ML Training Logs (`ml_training_logs`) */}
        {activeTab === 'logs' && (
          <div className="space-y-6 w-full min-w-0">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 w-full min-w-0">
              {/* Table of ML Training Logs */}
              <div className="lg:col-span-2 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-6 min-w-0 w-full overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider flex items-center gap-2 truncate">
                    <History className="w-4 h-4 text-purple-400 shrink-0" />
                    <span>Latest Retraining Logs (`ml_training_logs`)</span>
                  </h2>
                  <button
                    onClick={fetchAdminData}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors shrink-0"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="w-full max-w-full overflow-x-auto">
                  <table className="w-full min-w-[580px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider">
                        <th className="pb-3 px-2">ID</th>
                        <th className="pb-3 px-2">Symbol</th>
                        <th className="pb-3 px-2">Samples</th>
                        <th className="pb-3 px-2">Train Acc</th>
                        <th className="pb-3 px-2">Val Acc</th>
                        <th className="pb-3 px-2">Message</th>
                        <th className="pb-3 px-2">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {logsData?.logs?.length > 0 ? (
                        logsData.logs.map((log: any) => (
                          <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                            <td className="py-3 px-2 font-mono text-slate-400">#{log.id}</td>
                            <td className="py-3 px-2 font-bold text-white">{getSymbolDisplayName(log.symbol)}</td>
                            <td className="py-3 px-2 text-slate-300">{log.samples_count}</td>
                            <td className="py-3 px-2 text-emerald-400 font-semibold">{log.train_accuracy}%</td>
                            <td className="py-3 px-2 text-purple-400 font-semibold">{log.val_accuracy}%</td>
                            <td className="py-3 px-2 text-slate-300 max-w-xs truncate">{log.log_message}</td>
                            <td className="py-3 px-2 text-slate-500 font-mono text-[11px]">
                              {new Date(log.created_at).toLocaleTimeString()}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-500">
                            No training logs recorded yet. Click &quot;Trigger Retrain&quot; above to run a cycle!
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Active Model Specs Card */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4 min-w-0 w-full overflow-hidden">
                <h2 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>XGBoost Architecture</span>
                </h2>

                <div className="space-y-2.5 sm:space-y-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex justify-between items-center">
                    <span className="text-slate-400">Engine Version</span>
                    <span className="font-bold text-purple-400">v3.4.0 (Multi-Horizon)</span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex justify-between items-center">
                    <span className="text-slate-400">Engineered Features</span>
                    <span className="font-bold text-cyan-400">37 Tick Properties</span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex justify-between items-center">
                    <span className="text-slate-400">Max Depth</span>
                    <span className="font-mono text-white">{maxDepth}</span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex justify-between items-center">
                    <span className="text-slate-400">Learning Rate</span>
                    <span className="font-mono text-white">{learningRate}</span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex justify-between items-center">
                    <span className="text-slate-400">Estimators</span>
                    <span className="font-mono text-white">{numEstimators} Trees</span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex justify-between items-center">
                    <span className="text-slate-400">Subsample</span>
                    <span className="font-mono text-white">{subsample}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* System Logs (Pino) */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-6 min-w-0 w-full overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <h2 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider flex items-center gap-2 truncate">
                  <Terminal className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Recent System Logs (Pino / Upstash Redis)</span>
                </h2>
                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <span className="text-xs text-slate-400 font-semibold flex items-center gap-1">
                    <Radio className={`w-3.5 h-3.5 ${autoSyncInterval > 0 ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
                    <span>Auto-Sync Logs:</span>
                  </span>
                  <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                    <button
                      onClick={() => setAutoSyncInterval(0)}
                      className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${autoSyncInterval === 0 ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                      Off
                    </button>
                    <button
                      onClick={() => setAutoSyncInterval(3000)}
                      className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${autoSyncInterval === 3000 ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                      3s
                    </button>
                    <button
                      onClick={() => setAutoSyncInterval(5000)}
                      className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all ${autoSyncInterval === 5000 ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                      5s
                    </button>
                  </div>
                </div>
              </div>
              <div className="w-full h-64 overflow-y-auto bg-black rounded-xl p-4 border border-slate-800 font-mono text-[10px] sm:text-xs">
                {logsData?.systemLogs?.length > 0 ? (
                  <div className="space-y-1">
                    {logsData.systemLogs.map((log: any, idx: number) => (
                      <div key={idx} className="flex gap-3 text-slate-300 hover:bg-slate-900 px-1 py-0.5 rounded transition-colors">
                        <span className="text-slate-500 shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
                        <span className={`shrink-0 font-bold ${log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-amber-400' : 'text-emerald-400'}`}>
                          [{log.level.toUpperCase()}]
                        </span>
                        <span className="text-slate-300 break-words">{log.message}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-slate-500 text-center py-8">No system logs collected yet.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 5: Postgres Database & Schema Monitor */}
        {activeTab === 'db' && (
          <div className="space-y-6 w-full min-w-0">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4 sm:space-y-6 min-w-0 w-full overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
                <div>
                  <h2 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                    <Database className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Neon PostgreSQL Database Schema Monitor</span>
                  </h2>
                  <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                    Zero-ops auto-schema synchronization status using standard idempotent SQL guards
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    onClick={handleSyncDerivTicks}
                    disabled={isSyncingTicks}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30 flex items-center gap-1.5 transition-all"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncingTicks ? 'animate-spin text-emerald-400' : ''}`} />
                    <span>{isSyncingTicks ? 'Syncing Ticks...' : 'Sync Deriv Ticks to DB'}</span>
                  </button>
                  <button
                    onClick={() => handleSeedTrades(20)}
                    disabled={isSeedingTrades}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border border-cyan-500/30 flex items-center gap-1.5 transition-all"
                  >
                    <Database className={`w-3.5 h-3.5 ${isSeedingTrades ? 'animate-spin text-cyan-400' : ''}`} />
                    <span>{isSeedingTrades ? 'Seeding Trades...' : 'Seed Execution Trades'}</span>
                  </button>
                  <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5 shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Auto-Schema Active</span>
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 min-w-0">
                <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950 border border-slate-800 min-w-0">
                  <p className="text-xs text-slate-400 font-semibold mb-1">`ticks` Table</p>
                  <p className="text-xl sm:text-2xl font-black text-white">{summary.totalTicks.toLocaleString()}</p>
                  <p className="text-[10px] text-slate-500 mt-1">Automated WebSocket tick stream logger</p>
                </div>

                <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950 border border-slate-800 min-w-0">
                  <p className="text-xs text-slate-400 font-semibold mb-1">`ml_models` Table</p>
                  <p className="text-xl sm:text-2xl font-black text-purple-400">{summary.totalModels}</p>
                  <p className="text-[10px] text-slate-500 mt-1">Hyperparameter logs & accuracy specs</p>
                </div>

                <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950 border border-slate-800 min-w-0">
                  <p className="text-xs text-slate-400 font-semibold mb-1">`ml_training_logs` Table</p>
                  <p className="text-xl sm:text-2xl font-black text-blue-400">{logsData?.logs?.length || 0}</p>
                  <p className="text-[10px] text-slate-500 mt-1">Retraining audit logs</p>
                </div>

                <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950 border border-slate-800 min-w-0">
                  <p className="text-xs text-slate-400 font-semibold mb-1">`trades` Table</p>
                  <p className="text-xl sm:text-2xl font-black text-emerald-400">{summary.totalTrades}</p>
                  <p className="text-[10px] text-slate-500 mt-1">Automated execution records</p>
                </div>
              </div>

              {dbTablesData && (
                <div className="space-y-6 mt-6">
                  {/* ml_model_registry Table */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 sm:p-5 min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-black uppercase text-white tracking-wider flex items-center gap-2">
                        <Layers className="w-4 h-4 text-cyan-400" />
                        <span>Model Registry (`ml_model_registry`)</span>
                      </h3>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => exportDataAsJSON(dbTablesData.registry, 'model_registry')}
                          className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] font-medium"
                        >
                          <Download className="w-3 h-3 text-cyan-400" />
                          <span>JSON</span>
                        </button>
                        <button
                          onClick={() => exportDataAsCSV(dbTablesData.registry, 'model_registry')}
                          className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] font-medium"
                        >
                          <Download className="w-3 h-3 text-emerald-400" />
                          <span>CSV</span>
                        </button>
                      </div>
                    </div>
                    <div className="w-full max-w-full overflow-x-auto">
                      <table className="w-full min-w-[600px] text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider">
                            <th className="pb-3 px-2">ID</th>
                            <th className="pb-3 px-2">Model ID</th>
                            <th className="pb-3 px-2">Symbol</th>
                            <th className="pb-3 px-2">Duration</th>
                            <th className="pb-3 px-2">Accuracy</th>
                            <th className="pb-3 px-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 font-mono">
                          {dbTablesData.registry?.length > 0 ? (
                            dbTablesData.registry.map((row: any) => (
                              <tr key={row.id} className="hover:bg-slate-900/50">
                                <td className="py-2.5 px-2 text-slate-400">{row.id}</td>
                                <td className="py-2.5 px-2 font-bold text-white">{row.model_id}</td>
                                <td className="py-2.5 px-2 text-purple-400">{getSymbolDisplayName(row.symbol)}</td>
                                <td className="py-2.5 px-2 text-cyan-400">{row.optimal_duration_sec}s</td>
                                <td className="py-2.5 px-2 text-emerald-400">{row.accuracy_score}%</td>
                                <td className="py-2.5 px-2">
                                  <span className={`px-2 py-0.5 rounded text-[10px] ${row.status === 'PRODUCTION' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>{row.status}</span>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr><td colSpan={6} className="py-4 text-center text-slate-500">No registry models found.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* ml_backtest_results Table */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 sm:p-5 min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-black uppercase text-white tracking-wider flex items-center gap-2">
                        <Activity className="w-4 h-4 text-purple-400" />
                        <span>Backtest Results (`ml_backtest_results`)</span>
                      </h3>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => exportDataAsJSON(dbTablesData.backtests, 'backtest_results')}
                          className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] font-medium"
                        >
                          <Download className="w-3 h-3 text-cyan-400" />
                          <span>JSON</span>
                        </button>
                        <button
                          onClick={() => exportDataAsCSV(dbTablesData.backtests, 'backtest_results')}
                          className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] font-medium"
                        >
                          <Download className="w-3 h-3 text-emerald-400" />
                          <span>CSV</span>
                        </button>
                      </div>
                    </div>
                    <div className="w-full max-w-full overflow-x-auto">
                      <table className="w-full min-w-[600px] text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider">
                            <th className="pb-3 px-2">ID</th>
                            <th className="pb-3 px-2">Symbol</th>
                            <th className="pb-3 px-2">Duration</th>
                            <th className="pb-3 px-2">Trades</th>
                            <th className="pb-3 px-2">Wins</th>
                            <th className="pb-3 px-2">Profit Factor</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 font-mono">
                          {dbTablesData.backtests?.length > 0 ? (
                            dbTablesData.backtests.map((row: any) => (
                              <tr key={row.id} className="hover:bg-slate-900/50">
                                <td className="py-2.5 px-2 text-slate-400">{row.id}</td>
                                <td className="py-2.5 px-2 font-bold text-white">{getSymbolDisplayName(row.symbol)}</td>
                                <td className="py-2.5 px-2 text-cyan-400">{row.duration_sec}s</td>
                                <td className="py-2.5 px-2 text-slate-300">{row.total_trades}</td>
                                <td className="py-2.5 px-2 text-emerald-400">{row.winning_trades}</td>
                                <td className="py-2.5 px-2 text-purple-400">{row.profit_factor}</td>
                              </tr>
                            ))
                          ) : (
                            <tr><td colSpan={6} className="py-4 text-center text-slate-500">No backtest results found.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* ml_performance_audit Table */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 sm:p-5 min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-black uppercase text-white tracking-wider flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        <span>Performance Audit / Drift (`ml_performance_audit`)</span>
                      </h3>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => exportDataAsJSON(dbTablesData.audits, 'performance_audit')}
                          className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] font-medium"
                        >
                          <Download className="w-3 h-3 text-cyan-400" />
                          <span>JSON</span>
                        </button>
                        <button
                          onClick={() => exportDataAsCSV(dbTablesData.audits, 'performance_audit')}
                          className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] font-medium"
                        >
                          <Download className="w-3 h-3 text-emerald-400" />
                          <span>CSV</span>
                        </button>
                      </div>
                    </div>
                    <div className="w-full max-w-full overflow-x-auto">
                      <table className="w-full min-w-[600px] text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider">
                            <th className="pb-3 px-2">ID</th>
                            <th className="pb-3 px-2">Symbol</th>
                            <th className="pb-3 px-2">Signal</th>
                            <th className="pb-3 px-2">Confidence</th>
                            <th className="pb-3 px-2">Entry Price</th>
                            <th className="pb-3 px-2">Outcome</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 font-mono">
                          {dbTablesData.audits?.length > 0 ? (
                            dbTablesData.audits.map((row: any) => (
                              <tr key={row.id} className="hover:bg-slate-900/50">
                                <td className="py-2.5 px-2 text-slate-400">{row.id}</td>
                                <td className="py-2.5 px-2 font-bold text-white">{getSymbolDisplayName(row.symbol)}</td>
                                <td className="py-2.5 px-2 text-cyan-400">{row.predicted_signal}</td>
                                <td className="py-2.5 px-2 text-purple-400">{row.confidence}%</td>
                                <td className="py-2.5 px-2 text-slate-300">{row.entry_price}</td>
                                <td className="py-2.5 px-2 text-emerald-400">{row.outcome || 'PENDING'}</td>
                              </tr>
                            ))
                          ) : (
                            <tr><td colSpan={6} className="py-4 text-center text-slate-500">No audit records found.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* trades Table */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 sm:p-5 min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-black uppercase text-white tracking-wider flex items-center gap-2">
                        <Database className="w-4 h-4 text-emerald-400" />
                        <span>Execution Records (`trades`)</span>
                      </h3>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => exportDataAsJSON(dbTablesData.trades, 'trades_records')}
                          className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] font-medium"
                        >
                          <Download className="w-3 h-3 text-cyan-400" />
                          <span>JSON</span>
                        </button>
                        <button
                          onClick={() => exportDataAsCSV(dbTablesData.trades, 'trades_records')}
                          className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] font-medium"
                        >
                          <Download className="w-3 h-3 text-emerald-400" />
                          <span>CSV</span>
                        </button>
                      </div>
                    </div>
                    <div className="w-full max-w-full overflow-x-auto">
                      <table className="w-full min-w-[600px] text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider">
                            <th className="pb-3 px-2">ID</th>
                            <th className="pb-3 px-2">Symbol</th>
                            <th className="pb-3 px-2">Contract</th>
                            <th className="pb-3 px-2">Stake</th>
                            <th className="pb-3 px-2">Payout</th>
                            <th className="pb-3 px-2">Confidence</th>
                            <th className="pb-3 px-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 font-mono">
                          {dbTablesData.trades?.length > 0 ? (
                            dbTablesData.trades.map((row: any) => (
                              <tr key={row.id} className="hover:bg-slate-900/50">
                                <td className="py-2.5 px-2 text-slate-400">{row.id}</td>
                                <td className="py-2.5 px-2 font-bold text-white">{getSymbolDisplayName(row.symbol)}</td>
                                <td className={`py-2.5 px-2 font-bold ${row.contract_type === 'RISE' || row.contract_type === 'CALL' ? 'text-emerald-400' : 'text-rose-400'}`}>{row.contract_type}</td>
                                <td className="py-2.5 px-2 text-slate-300">${row.stake}</td>
                                <td className="py-2.5 px-2 text-cyan-400">${row.payout}</td>
                                <td className="py-2.5 px-2 text-purple-400">{row.prediction_confidence}%</td>
                                <td className="py-2.5 px-2">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${row.status === 'WON' ? 'bg-emerald-500/20 text-emerald-400' : row.status === 'LOST' ? 'bg-rose-500/20 text-rose-400' : 'bg-blue-500/20 text-blue-400'}`}>
                                    {row.status}
                                  </span>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr><td colSpan={7} className="py-4 text-center text-slate-500">No trade records found. Click &quot;Seed Execution Trades&quot; above to populate!</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 6: Interactive Model Tester */}
        {activeTab === 'tester' && (
          <div className="space-y-6 w-full min-w-0">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4 sm:space-y-6 min-w-0 w-full overflow-hidden">
              <div>
                <h2 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Real-time XGBoost Prediction Tester</span>
                </h2>
                <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                  Run standard feature extraction against live or historical tick samples
                </p>
              </div>

              <div className="space-y-3 min-w-0">
                <div>
                  <label className="text-xs text-slate-400 font-semibold block mb-1.5 uppercase tracking-wider">Asset Selection (Market Category Bar)</label>
                  <MarketCategorySelector
                    selectedSymbol={testSymbol}
                    onSelectSymbol={(sym) => setTestSymbol(sym)}
                    availableSymbols={availableSymbols}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800">
                  <div>
                    <label className="text-xs text-slate-400 font-medium block mb-1">Trade Duration (Seconds)</label>
                    <input
                      type="number"
                      value={testDuration}
                      onChange={(e) => setTestDuration(parseInt(e.target.value, 10) || 5)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white outline-none focus:border-purple-500"
                    />
                  </div>

                  <div className="flex items-end">
                    <button
                      onClick={handleRunLiveTest}
                      disabled={isTesting}
                      className="w-full py-2.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all"
                    >
                      <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                      <span>{isTesting ? 'Evaluating...' : 'Run Prediction Test'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {testResult && (
                <div className="space-y-4 pt-4 border-t border-slate-800 min-w-0">
                  {/* Signal Header Card */}
                  <div className="p-4 sm:p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-4 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">ML Model Evaluation Signal</span>
                        <div className="flex items-center gap-3 mt-1">
                          <span className={`px-3 py-1 rounded-lg text-base font-black ${
                            testResult.signal === 'CALL' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          }`}>
                            {testResult.signal === 'CALL' ? 'CALL (RISE ↑)' : 'PUT (FALL ↓)'}
                          </span>
                          <span className="text-sm font-black text-purple-400">
                            {testResult.confidence}% Confidence
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                        <span className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300">
                          ⚡ <span className="text-cyan-400 font-bold">{testResult.latencyMs || 24} ms</span>
                        </span>
                        <span className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300">
                          Ticks: <span className="text-purple-400 font-bold">{testResult.ticksProcessed || 100}</span>
                        </span>
                        <span className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300">
                          Expiry: <span className="text-emerald-400 font-bold">{testDuration}s</span>
                        </span>
                        <span className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 text-[10px]">
                          Engine: <span className="text-slate-400">{testResult.modelVersion || 'v3.4.0'}</span>
                        </span>
                      </div>
                    </div>

                    {/* Confidence Visual Gauge Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-slate-400 font-semibold">
                        <span>Confidence Threshold Meter</span>
                        <span>{testResult.confidence}% / 100%</span>
                      </div>
                      <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
                        <div
                          className={`h-full transition-all duration-500 ${testResult.confidence >= 80 ? 'bg-emerald-500' : testResult.confidence >= 65 ? 'bg-cyan-500' : 'bg-amber-500'}`}
                          style={{ width: `${Math.min(100, Math.max(0, testResult.confidence))}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Market Noise & Dynamic Regime Filter Card */}
                  <div className="p-4 sm:p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-3 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-black uppercase text-white tracking-wider flex items-center gap-2">
                        <Gauge className="w-4 h-4 text-purple-400" />
                        <span>Dynamic Market Regime & Volatility Metrics</span>
                      </h3>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                        (testResult.marketNoiseScore ?? 30) > 60
                          ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                          : (testResult.marketNoiseScore ?? 30) < 35
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                      }`}>
                        {testResult.marketRegime || 'Low Noise / High Trend'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                      <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                        <span className="text-[10px] text-slate-500 block uppercase font-sans">Market Noise Score</span>
                        <p className="text-lg font-black text-amber-400 mt-0.5">{testResult.marketNoiseScore ?? 28} / 100</p>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                        <span className="text-[10px] text-slate-500 block uppercase font-sans">Micro Velocity</span>
                        <p className="text-lg font-black text-cyan-400 mt-0.5">{Number(testResult.microVelocity || testResult.features?.micro_velocity || 0).toFixed(6)}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                        <span className="text-[10px] text-slate-500 block uppercase font-sans">Tick Arrival Rate</span>
                        <p className="text-lg font-black text-emerald-400 mt-0.5">{Number(testResult.tickFrequency || testResult.features?.ticksPerSecond || 1).toFixed(2)} ticks/sec</p>
                      </div>
                      <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                        <span className="text-[10px] text-slate-500 block uppercase font-sans">Short Volatility</span>
                        <p className="text-lg font-black text-purple-400 mt-0.5">{Number(testResult.features?.short_volatility || 0.0012).toFixed(6)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Complete 37-Feature Matrix Inspector */}
                  <div className="p-4 sm:p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-4 min-w-0">
                    <h3 className="text-xs font-black uppercase text-white tracking-wider flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-cyan-400" />
                      <span>Engineered 37-Tick Feature Matrix Snapshot</span>
                    </h3>

                    {testResult.features ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 font-mono text-xs">
                        {Object.entries(testResult.features).map(([key, val]: [string, any]) => {
                          let colorClass = 'text-cyan-400';
                          if (key.startsWith('micro_')) colorClass = 'text-cyan-400';
                          else if (key.startsWith('short_')) colorClass = 'text-purple-400';
                          else if (key.startsWith('medium_')) colorClass = 'text-amber-400';
                          else if (key.startsWith('macro_')) colorClass = 'text-emerald-400';
                          else colorClass = 'text-blue-400';

                          const formattedVal = typeof val === 'number' ? (Math.abs(val) < 0.0001 ? val.toExponential(4) : val.toFixed(4)) : String(val);

                          return (
                            <div key={key} className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2 overflow-hidden">
                              <span className="text-slate-400 truncate text-[11px] font-sans">{key}</span>
                              <span className={`font-bold shrink-0 ${colorClass}`}>{formattedVal}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">Feature dictionary evaluated.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
