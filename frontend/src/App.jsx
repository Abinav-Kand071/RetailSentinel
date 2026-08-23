import React, { useState, useRef, useEffect, useCallback } from "react";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

export default function App() {
  // Navigation tab
  const [activeTab, setActiveTab] = useState("scan"); // "scan" | "history"

  // Webcam states
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [capturedImageBlob, setCapturedImageBlob] = useState(null);
  const [capturedImagePreview, setCapturedImagePreview] = useState(null);

  // Auto/Live Scanner state & refs
  const [isLiveScanning, setIsLiveScanning] = useState(false);
  const isScanningRef = useRef(false); // Lock guard to prevent overlapping in-flight scans
  const lastScannedItemRef = useRef(null); // Deduplication tracking: brand + item_name combo

  // Audio recording states (optional)
  const mediaRecorderRef = useRef(null);
  const audioStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const timerRef = useRef(null);

  // API Call states
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isMockFallback, setIsMockFallback] = useState(false);

  // History states
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Start webcam feed
  const startCamera = async () => {
    try {
      setErrorMessage("");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
      }
    } catch (err) {
      console.error("Webcam access error:", err);
      setErrorMessage("Could not access webcam. Please verify camera permissions in your browser.");
    }
  };

  // Stop webcam feed
  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setIsLiveScanning(false);
  };

  // Capture frame from webcam
  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            setCapturedImageBlob(blob);
            setCapturedImagePreview(URL.createObjectURL(blob));
            resolve(blob);
          } else {
            resolve(null);
          }
        },
        "image/jpeg",
        0.9
      );
    });
  }, []);

  // Trigger POST /api/analyze (pure image, no audio required)
  const handleScanAndTranslate = async (imageOverride = null) => {
    // Guard against concurrent/overlapping scans
    if (isScanningRef.current) {
      return;
    }

    const targetBlob = imageOverride || capturedImageBlob;

    if (!targetBlob) {
      setErrorMessage("Please capture an image using the webcam first.");
      return;
    }

    isScanningRef.current = true;
    setLoading(true);
    setErrorMessage("");

    try {
      const formData = new FormData();
      formData.append("image", targetBlob, "inventory_frame.jpg");

      // Optional audio if recorded manually
      if (audioBlob) {
        formData.append("audio", audioBlob, "supplier_audio.webm");
      }

      const response = await fetch(`${BACKEND_URL}/api/analyze`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Server error: ${response.status}`);
      }

      const data = await response.json();

      // Check for mock fallback status from backend
      setIsMockFallback(data.status === "mock_fallback");

      // Deduplication: track brand + item_name combo
      const brandKey = (data.brand || "").trim().toLowerCase();
      const itemKey = (data.item_name || "").trim().toLowerCase();
      const currentCombo = `${brandKey}|${itemKey}`;

      if (lastScannedItemRef.current === currentCombo && currentCombo !== "|") {
        // Same item as last scan - update on-screen UI without creating new persistence state
        setResults({ ...data, isDuplicate: true });
      } else {
        if (currentCombo !== "|") {
          lastScannedItemRef.current = currentCombo;
        }
        setResults({ ...data, isDuplicate: false });
      }
    } catch (err) {
      console.error("Analysis request failed:", err);
      setErrorMessage(err.message || "Failed to communicate with Backend.");
    } finally {
      isScanningRef.current = false;
      setLoading(false);
    }
  };

  // The Free-Flowing Auto Scanner with 15s cooldown and in-flight request lock
  useEffect(() => {
    let scanInterval;

    if (isLiveScanning && cameraActive) {
      scanInterval = setInterval(async () => {
        // Skip tick if a scan is already in-flight
        if (isScanningRef.current) {
          return;
        }

        const freshBlob = await captureFrame();
        // Give it a split second to save the frame, then fire the API
        setTimeout(() => {
          if (isScanningRef.current) return;
          if (freshBlob) {
            handleScanAndTranslate(freshBlob);
          } else {
            handleScanAndTranslate();
          }
        }, 500);
      }, 15000); // Scans every 15 seconds (15s cooldown)
    }

    return () => {
      if (scanInterval) clearInterval(scanInterval);
    };
  }, [isLiveScanning, cameraActive, capturedImageBlob, captureFrame]);

  // Pause Live Scan Mode when browser tab is hidden to avoid burning API quota
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setIsLiveScanning(false);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Start microphone recording (optional)
  const startRecording = async () => {
    try {
      setErrorMessage("");
      audioChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const recordedBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setAudioBlob(recordedBlob);
        setAudioUrl(URL.createObjectURL(recordedBlob));
        if (audioStreamRef.current) {
          audioStreamRef.current.getTracks().forEach(track => track.stop());
          audioStreamRef.current = null;
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access error:", err);
      setErrorMessage("Could not access microphone.");
    }
  };

  // Stop microphone recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  // Fetch recent history from Supabase via backend
  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/history?limit=15`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data.scans || []);
      }
    } catch (err) {
      console.error("Failed to load history:", err);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Helper function to format & assess expiry date status
  const getExpiryBadge = (expiryDate) => {
    if (!expiryDate || String(expiryDate).toUpperCase() === "N/A") {
      return { text: "Non-Perishable (N/A)", color: "bg-slate-800 text-slate-300 border-slate-700" };
    }
    const exp = new Date(expiryDate);
    if (isNaN(exp.getTime())) {
      return { text: expiryDate, color: "bg-slate-800 text-slate-300 border-slate-700" };
    }

    const now = new Date();
    const diffDays = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { text: "Expired", color: "bg-rose-950 text-rose-400 border-rose-800" };
    } else if (diffDays <= 30) {
      return { text: `Expiring Soon (${diffDays}d)`, color: "bg-amber-950 text-amber-400 border-amber-800" };
    } else {
      return { text: `Valid (${diffDays}d left)`, color: "bg-emerald-950 text-emerald-400 border-emerald-800" };
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Mock Fallback Warning Banner */}
      {isMockFallback && (
        <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center px-4 py-2.5 bg-gradient-to-r from-amber-950/95 via-amber-900/95 to-amber-950/95 border-b border-amber-700/60 backdrop-blur-md shadow-lg shadow-amber-900/30">
          <div className="flex items-center space-x-3 text-amber-200 text-xs font-medium">
            <span className="text-base">⚠️</span>
            <span>Live AI unavailable — showing fallback data. Gemini Vision API may be down or misconfigured.</span>
          </div>
          <button
            onClick={() => setIsMockFallback(false)}
            className="ml-4 px-2 py-0.5 rounded-md text-amber-400 hover:text-amber-200 hover:bg-amber-800/50 text-xs font-semibold transition"
            aria-label="Dismiss fallback warning"
          >
            ✕
          </button>
        </div>
      )}

      {/* Header */}
      <header className={`border-b border-slate-800 bg-slate-900/70 backdrop-blur-md sticky top-0 z-30 px-6 py-4 ${isMockFallback ? 'mt-9' : ''}`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 font-bold text-xl">
              ⚡
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                RetailSentinel
              </h1>
              <p className="text-xs text-indigo-400 font-medium">AI Inventory Tracker & Auto-Scanner</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Live Scan Status Indicator */}
            {isLiveScanning && (
              <span
                className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-mono font-medium shadow-lg transition-all ${
                  loading
                    ? "bg-indigo-950/90 text-indigo-300 border border-indigo-700 shadow-indigo-500/20 animate-pulse"
                    : "bg-emerald-950/90 text-emerald-400 border border-emerald-700 shadow-emerald-500/10"
                }`}
              >
                <span
                  className={`w-2 h-2 mr-2 rounded-full ${
                    loading ? "bg-indigo-400 animate-ping" : "bg-emerald-400"
                  }`}
                ></span>
                {loading ? "SCANNING..." : "LIVE SCANNER (15s)"}
              </span>
            )}

            {/* Tabs Toggle */}
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setActiveTab("scan")}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${activeTab === "scan"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
                  }`}
              >
                Scan Product
              </button>
              <button
                onClick={() => {
                  setActiveTab("history");
                  fetchHistory();
                }}
                className={`px-3 py-1.5 rounded-lg font-medium transition ${activeTab === "history"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
                  }`}
              >
                Supabase Inventory
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto w-full p-6 flex-1 flex flex-col">

        {activeTab === "scan" ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1">
            {/* Left Section: Inputs & Capture (7 Cols) */}
            <section className="lg:col-span-7 flex flex-col space-y-6">

              {/* Webcam Card */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-2">
                    <span className="text-lg">📷</span>
                    <h2 className="font-semibold text-slate-200">Product Camera Stream</h2>
                  </div>

                  <div className="flex items-center space-x-2">
                    {/* Auto Scanner Toggle Button */}
                    <button
                      onClick={async () => {
                        if (!cameraActive) await startCamera();
                        setIsLiveScanning((prev) => !prev);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition ${isLiveScanning
                        ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/30"
                        : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                        }`}
                    >
                      <span>{isLiveScanning ? (loading ? "⚡" : "⏸") : "🔄"}</span>
                      <span>
                        {isLiveScanning
                          ? loading
                            ? "Scanning..."
                            : "Stop Auto-Scan"
                          : "Auto-Scan (15s)"}
                      </span>
                    </button>

                    {!cameraActive ? (
                      <button
                        onClick={startCamera}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold transition"
                      >
                        Start Camera
                      </button>
                    ) : (
                      <button
                        onClick={stopCamera}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-rose-400 transition"
                      >
                        Stop Camera
                      </button>
                    )}
                  </div>
                </div>

                {/* Video Viewport */}
                <div className="relative aspect-video bg-slate-950 rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`w-full h-full object-cover ${!cameraActive && "hidden"}`}
                  />
                  {!cameraActive && (
                    <div className="text-center p-6 text-slate-500">
                      <p className="text-sm">Camera inactive. Click "Start Camera" or "Auto-Scan" to point at retail items.</p>
                    </div>
                  )}

                  {/* Auto-Scan Overlay Radar & In-flight Scanning Indicator */}
                  {cameraActive && isLiveScanning && (
                    <div
                      className={`absolute inset-0 pointer-events-none transition-all flex flex-col justify-between p-3 ${
                        loading
                          ? "border-2 border-indigo-500/70 bg-indigo-950/20"
                          : "border-2 border-emerald-500/40"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-[10px] font-mono px-2.5 py-1 rounded-md border backdrop-blur flex items-center space-x-1.5 ${
                            loading
                              ? "bg-indigo-950/90 text-indigo-300 border-indigo-600 shadow-md shadow-indigo-500/20 animate-pulse"
                              : "bg-emerald-950/80 text-emerald-400 border-emerald-700"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              loading ? "bg-indigo-400 animate-ping" : "bg-emerald-400"
                            }`}
                          ></span>
                          <span>{loading ? "SCANNING IN-FLIGHT..." : "LIVE SENTINEL ACTIVE (15s)"}</span>
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-950/80 text-slate-400 border border-slate-800">
                          {loading ? "Analyzing Frame" : "Idle"}
                        </span>
                      </div>

                      {loading && (
                        <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-indigo-400 to-transparent shadow-[0_0_10px_rgba(99,102,241,0.9)] animate-pulse"></div>
                      )}
                    </div>
                  )}

                  {/* Live Manual Snapshot Button */}
                  {cameraActive && !isLiveScanning && (
                    <button
                      onClick={captureFrame}
                      className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-indigo-600/90 hover:bg-indigo-500 text-white font-medium text-xs flex items-center space-x-2 backdrop-blur shadow-lg shadow-indigo-600/30 transition transform active:scale-95"
                    >
                      <span>📸</span>
                      <span>Capture Product Frame</span>
                    </button>
                  )}
                </div>
                <canvas ref={canvasRef} className="hidden" />

                {/* Captured Image Preview */}
                {capturedImagePreview && (
                  <div className="mt-4 p-3 bg-slate-950/60 rounded-xl border border-slate-800 flex items-center space-x-4">
                    <img
                      src={capturedImagePreview}
                      alt="Captured Product"
                      className="h-16 w-24 object-cover rounded-lg border border-slate-700"
                    />
                    <div className="flex-1 text-xs">
                      <p className="font-semibold text-emerald-400">✓ Product Snapshot Buffered</p>
                      <p className="text-slate-400 mt-0.5">Frame extracted for retail recognition & expiry analysis.</p>
                    </div>
                    <button
                      onClick={() => {
                        setCapturedImageBlob(null);
                        setCapturedImagePreview(null);
                      }}
                      className="text-xs text-rose-400 hover:underline px-2"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>

              {/* Optional Voice Note Card */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-2">
                    <span className="text-lg">🎙️</span>
                    <h2 className="font-semibold text-slate-200">Optional Audio / Supplier Remark</h2>
                  </div>
                  {isRecording && (
                    <span className="flex items-center space-x-1 text-xs font-mono text-rose-400 bg-rose-950/50 px-2.5 py-1 rounded-full border border-rose-800">
                      <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
                      <span>REC {recordingSeconds}s</span>
                    </span>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-4">
                  {!isRecording ? (
                    <button
                      onClick={startRecording}
                      className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold flex items-center justify-center space-x-2 text-slate-200 transition"
                    >
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                      <span>Record Voice Remark</span>
                    </button>
                  ) : (
                    <button
                      onClick={stopRecording}
                      className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold flex items-center justify-center space-x-2 text-white shadow-lg shadow-rose-600/30 transition animate-pulse"
                    >
                      <span>⏹</span>
                      <span>Stop Recording</span>
                    </button>
                  )}

                  {audioUrl && (
                    <div className="flex-1 w-full flex items-center space-x-3 bg-slate-950 p-2 rounded-xl border border-slate-800">
                      <audio src={audioUrl} controls className="h-8 w-full accent-indigo-500" />
                      <button
                        onClick={() => {
                          setAudioBlob(null);
                          setAudioUrl(null);
                        }}
                        className="text-xs text-rose-400 hover:underline px-2"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Trigger Button */}
              <button
                onClick={() => handleScanAndTranslate()}
                disabled={loading || !capturedImageBlob}
                className={`w-full py-4 rounded-xl font-bold text-sm tracking-wide uppercase transition duration-200 flex items-center justify-center space-x-3 shadow-xl ${loading || !capturedImageBlob
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-800"
                  : "bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 text-white hover:opacity-95 shadow-indigo-600/25 active:scale-[0.99]"
                  }`}
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>Processing Product Analysis...</span>
                  </>
                ) : (
                  <>
                    <span>⚡</span>
                    <span>Identify Product & Log to Supabase</span>
                  </>
                )}
              </button>

              {/* Error Notice */}
              {errorMessage && (
                <div className="p-4 bg-rose-950/60 border border-rose-800/80 rounded-xl text-rose-300 text-xs flex items-start space-x-2">
                  <span className="text-base leading-none">⚠️</span>
                  <p className="flex-1">{errorMessage}</p>
                </div>
              )}
            </section>

            {/* Right Section: Results & AI Insights (5 Cols) */}
            <section className="lg:col-span-5 flex flex-col">
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl flex-1 flex flex-col">
                <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-6">
                  <h2 className="font-semibold text-slate-200 flex items-center space-x-2">
                    <span>🏷️</span>
                    <span>Product Intelligence Output</span>
                  </h2>
                  {results && (
                    <div className="flex items-center space-x-2">
                      {results.isDuplicate && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950/90 text-amber-400 border border-amber-800 flex items-center space-x-1">
                          <span>Identical Product (Deduped)</span>
                        </span>
                      )}
                      <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-400 border border-indigo-800">
                        {results.status || "Identified"}
                      </span>
                    </div>
                  )}
                </div>

                {/* When No Results Yet */}
                {!results && !loading && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-slate-500">
                    <div className="w-16 h-16 rounded-full bg-slate-800/60 flex items-center justify-center text-2xl mb-4 border border-slate-700">
                      🔍
                    </div>
                    <p className="text-sm font-medium text-slate-400">No product scanned yet</p>
                    <p className="text-xs text-slate-500 mt-1 max-w-xs">
                      Capture a snapshot or enable <strong>Auto-Scan</strong> to track items in real-time.
                    </p>
                  </div>
                )}

                {/* When Loading */}
                {loading && (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-4 text-center">
                    <div className="relative">
                      <div className="w-14 h-14 rounded-full border-4 border-indigo-500/20 border-t-indigo-500 animate-spin"></div>
                      <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-indigo-400">
                        AI
                      </div>
                    </div>
                    <p className="text-sm text-slate-300 font-medium">Extracting brand, product name & expiration date...</p>
                  </div>
                )}

                {/* Results Cards Display */}
                {results && !loading && (
                  <div className="space-y-4 flex-1 flex flex-col">

                    {/* Item Name Card */}
                    <div className="bg-gradient-to-br from-slate-950 to-slate-900 border border-slate-800 p-4 rounded-xl">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">ITEM NAME</span>
                      <p className="text-xl font-bold text-white mt-1">
                        {results.item_name || "Unknown Product"}
                      </p>
                    </div>

                    {/* Brand Card */}
                    <div className="bg-gradient-to-br from-slate-950 to-slate-900 border border-slate-800 p-4 rounded-xl">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">BRAND</span>
                      <p className="text-lg font-semibold text-indigo-300 mt-1">
                        {results.brand || "Unspecified"}
                      </p>
                    </div>

                    {/* Expiry Date Card */}
                    <div className="bg-gradient-to-br from-slate-950 to-slate-900 border border-slate-800 p-4 rounded-xl">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">EXPIRATION DATE</span>
                        {(() => {
                          const badge = getExpiryBadge(results.expiry_date);
                          return (
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badge.color}`}>
                              {badge.text}
                            </span>
                          );
                        })()}
                      </div>
                      <p className="text-2xl font-extrabold text-white mt-1 font-mono">
                        {results.expiry_date || "N/A"}
                      </p>
                    </div>

                    {/* Raw JSON Inspect */}
                    <div className="mt-auto pt-4 border-t border-slate-800">
                      <details className="text-xs text-slate-400 cursor-pointer">
                        <summary className="hover:text-slate-200 transition font-medium">View Raw JSON Response</summary>
                        <pre className="mt-2 p-3 bg-slate-950 rounded-lg text-[11px] font-mono text-emerald-400 overflow-x-auto border border-slate-800">
                          {JSON.stringify(results, null, 2)}
                        </pre>
                      </details>
                    </div>

                  </div>
                )}
              </div>
            </section>
          </div>
        ) : (
          /* History View (Supabase Logged Audits) */
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl flex-1 flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-6">
              <div>
                <h2 className="font-semibold text-lg text-slate-200 flex items-center space-x-2">
                  <span>🗄️</span>
                  <span>Supabase Inventory Records</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">Scanned products, brands, and expiry dates persisted in Supabase.</p>
              </div>
              <button
                onClick={fetchHistory}
                disabled={historyLoading}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-lg border border-slate-700 transition"
              >
                {historyLoading ? "Refreshing..." : "↻ Refresh"}
              </button>
            </div>

            {historyLoading ? (
              <div className="flex-1 flex items-center justify-center p-12 text-slate-400 text-sm">
                Loading inventory from Supabase...
              </div>
            ) : history.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-12 text-slate-500">
                <div className="text-3xl mb-3">📁</div>
                <p className="text-sm font-medium text-slate-400">No product records in Supabase yet</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm">
                  Run the SQL in `backend/supabase_schema.sql` on Supabase to start persisting scanned items.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto">
                {history.map((scan) => {
                  const badge = getExpiryBadge(scan.expiry_date);
                  return (
                    <div
                      key={scan.id || Math.random()}
                      className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between space-y-3"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-indigo-400">{scan.brand || "Brand"}</span>
                        <span className={`px-2 py-0.5 rounded-full border text-[10px] ${badge.color}`}>
                          {badge.text}
                        </span>
                      </div>

                      <div>
                        <h3 className="font-bold text-white text-base leading-snug">{scan.item_name || "Product Item"}</h3>
                        <p className="text-xs text-slate-400 mt-1 font-mono">
                          Expires: <span className="text-slate-200">{scan.expiry_date || "N/A"}</span>
                        </p>
                      </div>

                      <div className="pt-2 border-t border-slate-900 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                        <span>{scan.created_at ? new Date(scan.created_at).toLocaleDateString() : "Recent"}</span>
                        <span className="text-emerald-400">✓ Supabase</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
}