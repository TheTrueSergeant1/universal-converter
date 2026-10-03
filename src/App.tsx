import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
    FileVideo, FileAudio, Image as ImageIcon, FileText, CheckCircle,
    UploadCloud, Settings, X, Play, TerminalSquare, ShieldCheck,
    Sun, Moon, Minus, Trash2, Cpu
} from "lucide-react";

// --- Constants & Types ---

const FORMATS = [
    { id: "mp4", label: "MP4", type: "video", icon: FileVideo },
    { id: "mp3", label: "MP3", type: "audio", icon: FileAudio },
    { id: "wav", label: "WAV", type: "audio", icon: FileAudio },
    { id: "gif", label: "GIF", type: "image", icon: ImageIcon },
    { id: "png", label: "PNG", type: "image", icon: ImageIcon },
    { id: "jpg", label: "JPG", type: "image", icon: ImageIcon },
    { id: "pdf", label: "PDF", type: "document", icon: FileText },
    { id: "txt", label: "TXT", type: "document", icon: FileText },
];

const getCompatibleFormats = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (['mp4', 'mov', 'avi', 'mkv'].includes(ext)) return FORMATS.filter(f => ['mp4', 'mp3', 'wav', 'gif'].includes(f.id));
    if (['mp3', 'wav', 'aac', 'm4a', 'flac'].includes(ext)) return FORMATS.filter(f => ['mp3', 'wav'].includes(f.id));
    if (['jpg', 'jpeg', 'png', 'heic', 'webp', 'raw', 'tiff'].includes(ext)) return FORMATS.filter(f => ['png', 'jpg', 'pdf'].includes(f.id));
    if (['docx', 'md', 'txt', 'rtf'].includes(ext)) return FORMATS.filter(f => ['pdf', 'txt'].includes(f.id));
    return FORMATS;
};

type QueueItem = {
    id: string;
    name: string;
    path: string;
    status: "idle" | "verifying" | "converting" | "success" | "error";
    progress: number;
    targetFormat: string;
    allowedFormats: typeof FORMATS;
    resultMessage?: string;
};

// --- Main Application ---

export default function App() {
    // App State
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const [quality, setQuality] = useState<"high" | "medium" | "low">("high");
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isConsoleOpen, setIsConsoleOpen] = useState(false);
    const [isProcessingBatch, setIsProcessingBatch] = useState(false);
    const [isGlobalDragging, setIsGlobalDragging] = useState(false);
    const [isDarkMode, setIsDarkMode] = useState(true);

    // Developer Console Logs
    const [logs, setLogs] = useState<string[]>(["[SYSTEM] Engine initialized. Awaiting files..."]);
    const logsEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll console
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [logs]);

    // Event Listeners (Tauri Backend <-> React Frontend)
    useEffect(() => {
        let unlistenProgress: () => void;
        let unlistenLog: () => void;
        let unlistenDrop: () => void;

        const setupListeners = async () => {
            // 1. Listen for FFmpeg progress updates
            unlistenProgress = await listen<string>("conversion-progress", (event) => {
                const [id, progStr] = event.payload.split('|');
                const progressNum = Math.max(0, Math.min(parseFloat(progStr), 100));
                setQueue(prev => prev.map(item =>
                    item.id === id ? { ...item, status: "converting", progress: progressNum } : item
                ));
            });

            // 2. Listen for security & engine logs
            unlistenLog = await listen<string>("engine-log", (event) => {
                setLogs(prev => [...prev, event.payload]);
            });

            // 3. Listen for native OS file drops (bypasses browser security)
            const win = getCurrentWebviewWindow();
            unlistenDrop = await win.onFileDropEvent((event) => {
                setIsGlobalDragging(false);
                if (event.payload.type === 'drop') addFilesToQueue(event.payload.paths);
                if (event.payload.type === 'hover') setIsGlobalDragging(true);
                if (event.payload.type === 'cancel') setIsGlobalDragging(false);
            });
        };

        setupListeners();
        return () => {
            if (unlistenProgress) unlistenProgress();
            if (unlistenLog) unlistenLog();
            if (unlistenDrop) unlistenDrop();
        };
    }, []);

    // --- Handlers ---

    const addFilesToQueue = (paths: string[]) => {
        const newItems: QueueItem[] = paths.map(path => {
            const name = path.split(/[/\\]/).pop() || "file";
            const allowed = getCompatibleFormats(name);
            return {
                id: crypto.randomUUID(),
                name,
                path,
                status: "idle",
                progress: 0,
                targetFormat: allowed[0]?.id || "mp4",
                allowedFormats: allowed
            };
        });
        setQueue(prev => [...prev, ...newItems]);
    };

    const handleBrowseClick = async () => {
        const selectedPaths = await open({ multiple: true, directory: false });
        if (selectedPaths) addFilesToQueue(Array.isArray(selectedPaths) ? selectedPaths : [selectedPaths]);
    };

    const processQueue = async () => {
        setIsProcessingBatch(true);

        for (const item of queue) {
            if (item.status !== "idle" && item.status !== "error") continue;

            // Enter Security Verification Stage
            setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "verifying" } : q));

            try {
                const response: string = await invoke('process_file', {
                    fileId: item.id,
                    fileName: item.name,
                    filePath: item.path,
                    targetFormat: item.targetFormat,
                    quality: quality
                });

                // Finalize Success
                setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "success", progress: 100, resultMessage: response } : q));
            } catch (error) {
                // Handle Security/Engine Rejection
                setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "error", resultMessage: String(error) } : q));
            }
        }
        setIsProcessingBatch(false);
    };

    // Window Controls
    const minimizeWindow = () => getCurrentWebviewWindow().minimize();
    const closeWindow = () => getCurrentWebviewWindow().close();

    // --- Theme Configuration (iOS/macOS aesthetic) ---
    const t = isDarkMode ? {
        bg: 'radial-gradient(circle at 50% -20%, #1a1a2e 0%, #000000 80%)',
        base: '#000000',
        text: '#ffffff',
        textMuted: '#8E8E93',
        glass: 'rgba(255, 255, 255, 0.04)',
        glassBorder: 'rgba(255, 255, 255, 0.08)',
        queueBg: 'rgba(20, 20, 25, 0.6)',
        accent: '#0A84FF',
        consoleBg: 'rgba(10, 10, 15, 0.9)',
        consoleText: '#a1a1aa'
    } : {
        bg: 'radial-gradient(circle at 50% -20%, #ffffff 0%, #e2e8f0 80%)',
        base: '#f8fafc',
        text: '#1c1c1e',
        textMuted: '#64748b',
        glass: 'rgba(255, 255, 255, 0.7)',
        glassBorder: 'rgba(255, 255, 255, 1)',
        queueBg: 'rgba(255, 255, 255, 0.9)',
        accent: '#007AFF',
        consoleBg: 'rgba(240, 240, 245, 0.9)',
        consoleText: '#3f3f46'
    };

    return (
        <div style={{
            backgroundColor: t.base, backgroundImage: t.bg, minHeight: '100vh',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '24px 40px 40px 40px', color: t.text,
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
            userSelect: 'none', WebkitUserSelect: 'none', transition: 'background 0.5s ease'
        }}>

            {/* Global Drag Overlay */}
            <AnimatePresence>
                {isGlobalDragging && (
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(10, 132, 255, 0.15)', backdropFilter: 'blur(8px)', zIndex: 100, border: '4px dashed #0A84FF', pointerEvents: 'none' }}
                    />
                )}
            </AnimatePresence>

            {/* Title Bar (Native Drag Handle) */}
            <div style={{ width: '100%', maxWidth: '800px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>

                {/* DRAG REGION */}
                <div onMouseDown={() => getCurrentWebviewWindow().startDragging()} style={{ flexGrow: 1, cursor: 'grab', display: 'flex', alignItems: 'center', height: '40px' }}>
                    <h1 style={{ margin: 0, fontSize: '1.5rem', letterSpacing: '-0.5px', fontWeight: 700 }}>
                        Universal<span style={{ color: t.accent }}>.</span>
                    </h1>
                </div>

                {/* BUTTON REGION */}
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', zIndex: 50 }}>
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setIsDarkMode(!isDarkMode)} style={{ background: 'none', border: 'none', color: t.textMuted, cursor: 'pointer' }}>
                        {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
                    </motion.button>
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setIsConsoleOpen(!isConsoleOpen)} style={{ background: 'none', border: 'none', color: isConsoleOpen ? t.accent : t.textMuted, cursor: 'pointer' }}>
                        <TerminalSquare size={20} />
                    </motion.button>
                    <motion.button whileHover={{ scale: 1.1, rotate: 45 }} whileTap={{ scale: 0.9 }} onClick={() => setIsSettingsOpen(true)} style={{ background: 'none', border: 'none', color: t.textMuted, cursor: 'pointer' }}>
                        <Settings size={20} />
                    </motion.button>

                    <div style={{ width: '1px', height: '16px', background: t.glassBorder, margin: '0 8px' }} />

                    <motion.button whileHover={{ color: t.accent }} onClick={minimizeWindow} style={{ background: 'none', border: 'none', color: t.textMuted, cursor: 'pointer' }}><Minus size={20} /></motion.button>
                    <motion.button whileHover={{ color: '#FF3B30' }} onClick={closeWindow} style={{ background: 'none', border: 'none', color: t.textMuted, cursor: 'pointer' }}><X size={20} /></motion.button>
                </div>
            </div>

            <div style={{ width: '100%', maxWidth: '800px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

                {/* Main Interface / Dropzone */}
                <motion.div layout style={{ background: t.glass, backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)', border: `1px solid ${t.glassBorder}`, borderRadius: '24px', padding: '24px', boxShadow: '0 24px 48px rgba(0,0,0,0.1)' }}>
                    {queue.length === 0 ? (
                        <motion.div
                            onClick={handleBrowseClick}
                            whileHover={{ scale: 1.01, backgroundColor: isDarkMode ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }}
                            whileTap={{ scale: 0.99 }}
                            style={{ height: '320px', borderRadius: '16px', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden' }}
                        >
                            <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                                <rect width="100%" height="100%" fill="none" rx="16" ry="16" stroke={t.glassBorder} strokeWidth="3" strokeDasharray="8 8" />
                            </svg>
                            <motion.div animate={{ y: [0, -10, 0] }} transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}>
                                <UploadCloud size={64} color={t.accent} style={{ marginBottom: '16px', filter: `drop-shadow(0 4px 12px ${t.accent}40)` }} />
                            </motion.div>
                            <h3 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-0.5px' }}>Drop files to begin</h3>
                            <p style={{ margin: '8px 0 0', color: t.textMuted, fontSize: '0.95rem' }}>Secure Multi-Engine Conversion Router</p>
                        </motion.div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <AnimatePresence>
                                {queue.map((item) => (
                                    <motion.div
                                        key={item.id} layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                                        style={{ background: t.queueBg, border: `1px solid ${item.status === 'success' ? 'rgba(48, 209, 88, 0.4)' : t.glassBorder}`, borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', position: 'relative', overflow: 'hidden', boxShadow: item.status === 'success' ? '0 4px 20px rgba(48, 209, 88, 0.1)' : 'none' }}
                                    >

                                        {/* Security Scanner Laser Effect */}
                                        {item.status === "verifying" && (
                                            <motion.div initial={{ top: 0 }} animate={{ top: '100%' }} transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }} style={{ position: 'absolute', left: 0, right: 0, height: '1px', background: t.accent, boxShadow: `0 0 15px 2px ${t.accent}`, zIndex: 5 }} />
                                        )}

                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', overflow: 'hidden' }}>
                                                {item.status === "verifying" ? <ShieldCheck size={22} color={t.accent} /> : item.status === "success" ? <CheckCircle size={22} color="#30D158" /> : item.status === "error" ? <X size={22} color="#FF3B30" /> : <FileText size={22} color={t.textMuted} />}
                                                <span style={{ fontWeight: 500, fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '280px' }}>{item.name}</span>
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                {item.status === "success" ? (
                                                    <span style={{ color: '#30D158', fontWeight: 600, fontSize: '0.9rem', padding: '4px 12px', background: 'rgba(48,209,88,0.1)', borderRadius: '12px' }}>
                                                        COMPLETED
                                                    </span>
                                                ) : (
                                                    <>
                                                        <span style={{ color: t.textMuted, fontSize: '0.9rem' }}>→</span>
                                                        <select
                                                            value={item.targetFormat}
                                                            onChange={(e) => setQueue(prev => prev.map(q => q.id === item.id ? { ...q, targetFormat: e.target.value } : q))}
                                                            disabled={item.status !== "idle"}
                                                            style={{ padding: '6px 12px', borderRadius: '10px', background: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', color: t.text, border: 'none', outline: 'none', fontWeight: 600, cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none' }}
                                                        >
                                                            {item.allowedFormats.map(f => <option key={f.id} value={f.id}>{f.label.toUpperCase()}</option>)}
                                                        </select>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {/* Progress / Status Indicators */}
                                        {item.status === "verifying" && <p style={{ margin: 0, fontSize: '0.8rem', color: t.accent, fontWeight: 500 }}>Scanning binary signature...</p>}
                                        {item.status === "error" && <p style={{ margin: 0, fontSize: '0.8rem', color: '#FF3B30', fontWeight: 500 }}>{item.resultMessage}</p>}

                                        {item.status === "converting" && (
                                            <div style={{ width: '100%', height: '6px', background: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                                                <motion.div style={{ height: '100%', background: `linear-gradient(90deg, ${t.accent}, #5E5CE6)` }} animate={{ width: `${item.progress}%` }} transition={{ ease: "easeOut", duration: 0.2 }} />
                                            </div>
                                        )}
                                    </motion.div>
                                ))}
                            </AnimatePresence>

                            {/* Action Buttons */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px' }}>
                                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setQueue([])} disabled={isProcessingBatch} style={{ padding: '12px 24px', borderRadius: '14px', background: 'transparent', border: `1px solid ${t.glassBorder}`, color: t.text, fontWeight: 600, cursor: isProcessingBatch ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Trash2 size={16} /> Clear
                                </motion.button>
                                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={processQueue} disabled={isProcessingBatch} style={{ padding: '12px 32px', borderRadius: '14px', background: t.accent, border: 'none', color: 'white', fontWeight: 600, cursor: isProcessingBatch ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: `0 4px 14px ${t.accent}60` }}>
                                    {isProcessingBatch ? "Processing Queue..." : "Start Engine"} <Cpu size={18} />
                                </motion.button>
                            </div>
                        </div>
                    )}
                </motion.div>

                {/* Developer Console (Integrated Terminal) */}
                <AnimatePresence>
                    {isConsoleOpen && (
                        <motion.div initial={{ opacity: 0, height: 0, y: -20 }} animate={{ opacity: 1, height: '240px', y: 0 }} exit={{ opacity: 0, height: 0, y: -20 }} style={{ width: '100%', background: t.consoleBg, backdropFilter: 'blur(20px)', border: `1px solid ${t.glassBorder}`, borderRadius: '20px', padding: '16px', overflowY: 'auto', fontFamily: "'Fira Code', 'JetBrains Mono', 'Courier New', monospace", fontSize: '0.8rem', color: t.consoleText, boxShadow: 'inset 0 4px 12px rgba(0,0,0,0.2)' }}>
                            {logs.map((log, i) => (
                                <div key={i} style={{ marginBottom: '6px', lineHeight: '1.4', color: log.includes('ERROR') || log.includes('FATAL') ? '#FF3B30' : log.includes('SUCCESS') ? '#34C759' : log.includes('SECURITY') ? t.accent : t.consoleText }}>
                                    {log}
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </motion.div>
                    )}
                </AnimatePresence>

            </div>

            {/* Settings Modal (iOS Segmented Control Style) */}
            <AnimatePresence>
                {isSettingsOpen && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)', zIndex: 150, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setIsSettingsOpen(false)}>
                        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e) => e.stopPropagation()} style={{ width: '320px', background: t.base, border: `1px solid ${t.glassBorder}`, borderRadius: '24px', padding: '24px', boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600, letterSpacing: '-0.5px' }}>Encoding Quality</h3>
                                <motion.button whileHover={{ scale: 1.1 }} onClick={() => setIsSettingsOpen(false)} style={{ background: 'none', border: 'none', color: t.textMuted, cursor: 'pointer', padding: 0 }}><X size={20} /></motion.button>
                            </div>

                            {/* Custom Segmented Control */}
                            <div style={{ display: 'flex', background: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: '12px', padding: '4px', position: 'relative' }}>
                                {['low', 'medium', 'high'].map((q) => (
                                    <div key={q} onClick={() => setQuality(q as any)} style={{ flex: 1, textAlign: 'center', padding: '10px 0', fontSize: '0.9rem', fontWeight: 600, color: quality === q ? (isDarkMode ? '#000' : '#fff') : t.textMuted, cursor: 'pointer', textTransform: 'capitalize', zIndex: 10, transition: 'color 0.2s' }}>
                                        {q}
                                    </div>
                                ))}
                                {/* Sliding active background pill */}
                                <motion.div layout transition={{ type: "spring", stiffness: 400, damping: 30 }} style={{ position: 'absolute', top: 4, bottom: 4, width: 'calc(33.33% - 2.6px)', background: isDarkMode ? '#fff' : '#000', borderRadius: '8px', zIndex: 1, left: quality === 'low' ? '4px' : quality === 'medium' ? '33.33%' : 'calc(66.66% - 4px)' }} />
                            </div>
                            <p style={{ margin: '16px 0 0', fontSize: '0.8rem', color: t.textMuted, textAlign: 'center' }}>
                                Higher quality increases file size and encoding time via FFmpeg CRF settings.
                            </p>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}