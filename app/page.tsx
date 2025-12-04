"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Reading {
  timestamp: string;
  value: string;
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);

  const [streaming, setStreaming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRead, setAutoRead] = useState(false);
  const [interval, setIntervalSeconds] = useState(5);
  const [showSettings, setShowSettings] = useState(false);

  const DEFAULT_PROMPT = "This image contains a number (could be a digital display, meter, gauge, thermometer, scale, or any numeric display). Please read and extract the number shown. Respond with ONLY the numeric value (e.g., '37.5' or '123'). Include decimal points if present. If you cannot read the number clearly, respond with 'Unable to read'.";

  // Custom prompt - initialize from localStorage
  const [prompt, setPrompt] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("readoutcam-prompt");
      if (saved) {
        return saved;
      }
    }
    return DEFAULT_PROMPT;
  });

  // Save prompt to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("readoutcam-prompt", prompt);
  }, [prompt]);

  // Reading history for CSV export - initialize from localStorage
  const [readings, setReadings] = useState<Reading[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("readoutcam-readings");
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          return [];
        }
      }
    }
    return [];
  });

  // Save readings to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem("readoutcam-readings", JSON.stringify(readings));
  }, [readings]);

  // Reset readings
  const resetReadings = () => {
    setReadings([]);
    setResult(null);
  };

  // Crop region state
  const [cropRegion, setCropRegion] = useState<CropRegion | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null);

  // Start webcam
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStreaming(true);
        setError(null);
      }
    } catch (err) {
      setError("Could not access camera. Please allow camera permissions.");
      console.error(err);
    }
  };

  // Stop webcam
  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach((track) => track.stop());
      videoRef.current.srcObject = null;
      setStreaming(false);
      setAutoRead(false);
    }
  };

  // Get mouse position relative to video
  const getRelativePosition = (e: React.MouseEvent) => {
    if (!videoRef.current) return { x: 0, y: 0 };
    const rect = videoRef.current.getBoundingClientRect();
    const scaleX = videoRef.current.videoWidth / rect.width;
    const scaleY = videoRef.current.videoHeight / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  // Mouse handlers for crop selection
  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = getRelativePosition(e);
    setIsSelecting(true);
    setSelectionStart(pos);
    setSelectionEnd(pos);
    setCropRegion(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isSelecting) return;
    setSelectionEnd(getRelativePosition(e));
  };

  const handleMouseUp = () => {
    if (!isSelecting || !selectionStart || !selectionEnd) return;
    setIsSelecting(false);

    const x = Math.min(selectionStart.x, selectionEnd.x);
    const y = Math.min(selectionStart.y, selectionEnd.y);
    const width = Math.abs(selectionEnd.x - selectionStart.x);
    const height = Math.abs(selectionEnd.y - selectionStart.y);

    if (width > 20 && height > 20) {
      setCropRegion({ x, y, width, height });
    }
    setSelectionStart(null);
    setSelectionEnd(null);
  };

  // Capture frame and send to API
  const captureAndRead = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || loading) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size based on crop or full video
    if (cropRegion) {
      canvas.width = cropRegion.width;
      canvas.height = cropRegion.height;
      ctx.drawImage(
        video,
        cropRegion.x,
        cropRegion.y,
        cropRegion.width,
        cropRegion.height,
        0,
        0,
        cropRegion.width,
        cropRegion.height
      );
    } else {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
    }

    const imageData = canvas.toDataURL("image/jpeg", 0.9);

    setLoading(true);
    try {
      const response = await fetch("/api/read-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageData, prompt }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to read number");
      }
      setResult(data.number);

      // Save reading to history
      const numericValue = parseFloat(data.number);
      if (!isNaN(numericValue)) {
        setReadings((prev) => [
          ...prev,
          { timestamp: new Date().toISOString(), value: data.number },
        ]);
      }
    } catch (err) {
      setResult(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  }, [cropRegion, loading, prompt]);

  // Start camera on mount
  useEffect(() => {
    startCamera();
  }, []);

  // Auto-read interval
  useEffect(() => {
    if (!autoRead || !streaming) return;

    const id = window.setInterval(() => {
      captureAndRead();
    }, interval * 1000);

    return () => clearInterval(id);
  }, [autoRead, streaming, interval, captureAndRead]);

  // Draw chart when readings change
  useEffect(() => {
    if (!chartRef.current || readings.length < 2) return;

    const canvas = chartRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const width = rect.width;
    const height = rect.height;
    const padding = { top: 20, right: 20, bottom: 30, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Clear canvas
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, width, height);

    // Parse values and times
    const values = readings.map((r) => parseFloat(r.value));
    const times = readings.map((r) => new Date(r.timestamp).getTime());
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;

    const startTime = times[0];
    const endTime = times[times.length - 1];
    const timeRange = endTime - startTime || 1;
    const maxMinutes = (endTime - startTime) / 60000;

    // Draw grid lines
    ctx.strokeStyle = "#e5e5e5";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartHeight * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();

      // Y-axis labels
      const val = maxVal - (range * i) / 4;
      ctx.fillStyle = "#737373";
      ctx.font = "12px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(val.toFixed(1), padding.left - 8, y + 4);
    }

    // Draw line
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    readings.forEach((reading, i) => {
      const timeOffset = times[i] - startTime;
      const x = padding.left + (timeOffset / timeRange) * chartWidth;
      const y = padding.top + ((maxVal - parseFloat(reading.value)) / range) * chartHeight;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    // Draw points
    ctx.fillStyle = "#000";
    readings.forEach((reading, i) => {
      const timeOffset = times[i] - startTime;
      const x = padding.left + (timeOffset / timeRange) * chartWidth;
      const y = padding.top + ((maxVal - parseFloat(reading.value)) / range) * chartHeight;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // X-axis labels (time in minutes)
    ctx.fillStyle = "#737373";
    ctx.font = "12px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";

    // Draw a few time labels
    const numLabels = Math.min(5, Math.ceil(maxMinutes) + 1);
    for (let i = 0; i < numLabels; i++) {
      const minutes = (maxMinutes * i) / (numLabels - 1);
      const x = padding.left + (i / (numLabels - 1)) * chartWidth;
      ctx.fillText(`${minutes.toFixed(1)}m`, x, height - 8);
    }
  }, [readings]);

  // Calculate overlay rectangle style
  const getOverlayStyle = () => {
    if (!videoRef.current) return {};
    const video = videoRef.current;
    const rect = video.getBoundingClientRect();
    const scaleX = rect.width / video.videoWidth;
    const scaleY = rect.height / video.videoHeight;

    if (isSelecting && selectionStart && selectionEnd) {
      const x = Math.min(selectionStart.x, selectionEnd.x) * scaleX;
      const y = Math.min(selectionStart.y, selectionEnd.y) * scaleY;
      const width = Math.abs(selectionEnd.x - selectionStart.x) * scaleX;
      const height = Math.abs(selectionEnd.y - selectionStart.y) * scaleY;
      return { left: x, top: y, width, height };
    }

    if (cropRegion) {
      return {
        left: cropRegion.x * scaleX,
        top: cropRegion.y * scaleY,
        width: cropRegion.width * scaleX,
        height: cropRegion.height * scaleY,
      };
    }

    return null;
  };

  const overlayStyle = getOverlayStyle();

  // Download readings as CSV
  const downloadCSV = () => {
    if (readings.length === 0) return;

    const csvContent = [
      "timestamp,value",
      ...readings.map((r) => `${r.timestamp},${r.value}`),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `readings_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <header className="mb-10 flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight mb-2">ReadoutCam</h1>
            <p className="text-neutral-500 text-sm">
              Read data from temperature sensors, gauges, meters, or any numeric display
            </p>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 rounded-md transition-colors"
            title="Settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </header>

        {/* Settings modal */}
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setShowSettings(false)}
            />
            <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold">Settings</h2>
                <button
                  onClick={() => setShowSettings(false)}
                  className="p-1 text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium text-neutral-700">AI Prompt</label>
                  <button
                    onClick={() => setPrompt(DEFAULT_PROMPT)}
                    className="text-xs text-neutral-500 hover:text-neutral-700"
                  >
                    Reset to default
                  </button>
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="w-full h-40 p-3 text-sm border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none"
                  placeholder="Enter instructions for the AI..."
                />
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded-md hover:bg-neutral-800 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="border border-neutral-200 rounded-lg overflow-hidden">
          {error && (
            <div className="p-4 bg-red-50 border-b border-red-100 text-red-600 text-sm">
              {error}
            </div>
          )}

          {/* Start button - shown when not streaming */}
          {!streaming && (
            <div className="flex flex-col items-center justify-center h-80 bg-neutral-50">
              <button
                onClick={startCamera}
                className="px-5 py-2.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-md text-sm font-medium transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Start Camera
              </button>
              <p className="mt-3 text-neutral-400 text-xs">
                Click to enable your camera
              </p>
            </div>
          )}

          {/* Video and controls - always in DOM, hidden when not streaming */}
          <div className={streaming ? "" : "hidden"}>
            {/* Video container */}
            <div
              ref={containerRef}
              className="relative bg-black"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-auto min-h-[300px] max-h-[60vh] object-contain cursor-crosshair"
              />

              {/* Crop region overlay */}
              {overlayStyle && (
                <div
                  className="absolute border-2 border-white bg-white/20 pointer-events-none"
                  style={overlayStyle}
                />
              )}

              {/* Loading indicator */}
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <div className="bg-white px-3 py-1.5 rounded text-sm flex items-center gap-2 text-neutral-700">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Reading...
                  </div>
                </div>
              )}

              {/* Result overlay */}
              {result && (
                <div className="absolute bottom-3 right-3 bg-white px-4 py-2 rounded shadow-sm">
                  <p className="text-2xl font-semibold tabular-nums">{result}</p>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="p-4 border-t border-neutral-200 bg-neutral-50">
              <p className="text-xs text-neutral-500 text-center mb-4">
                {cropRegion
                  ? "Crop region set. Drag to select a new region."
                  : "Drag on the video to select a crop region"}
              </p>

              <div className="flex flex-wrap gap-2 justify-center">
                <button
                  onClick={() => setAutoRead(!autoRead)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    autoRead
                      ? "bg-red-500 text-white hover:bg-red-600"
                      : "bg-neutral-900 text-white hover:bg-neutral-800"
                  }`}
                >
                  {autoRead ? "Stop" : "Start Reading"}
                </button>

                <div className="flex items-center gap-1.5 bg-white border border-neutral-200 rounded-md px-3">
                  <label className="text-xs text-neutral-500">Interval</label>
                  <select
                    value={interval}
                    onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                    className="bg-transparent py-2 text-sm text-neutral-900 focus:outline-none"
                  >
                    <option value={2}>2s</option>
                    <option value={5}>5s</option>
                    <option value={10}>10s</option>
                    <option value={30}>30s</option>
                    <option value={60}>1m</option>
                    <option value={300}>5m</option>
                    <option value={600}>10m</option>
                  </select>
                </div>

                {cropRegion && (
                  <button
                    onClick={() => setCropRegion(null)}
                    className="px-4 py-2 bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50 rounded-md text-sm font-medium transition-colors"
                  >
                    Clear Crop
                  </button>
                )}

                {readings.length > 0 && (
                  <>
                    <button
                      onClick={downloadCSV}
                      className="px-4 py-2 bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      CSV ({readings.length})
                    </button>
                    <button
                      onClick={resetReadings}
                      className="px-4 py-2 bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50 rounded-md text-sm font-medium transition-colors"
                    >
                      Reset
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Hidden canvas for capture */}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Chart section */}
        {readings.length >= 2 && (
          <div className="mt-6 border border-neutral-200 rounded-lg p-4">
            <h2 className="text-sm font-medium mb-4">Readings Over Time</h2>
            <canvas
              ref={chartRef}
              className="w-full h-40"
            />
          </div>
        )}

        {/* Show message when waiting for readings */}
        {readings.length > 0 && readings.length < 2 && (
          <div className="mt-6 border border-neutral-200 rounded-lg p-4">
            <p className="text-neutral-500 text-sm text-center">
              Chart will appear after 2 readings ({readings.length}/2)
            </p>
          </div>
        )}

        {/* Data table */}
        {readings.length > 0 && (
          <div className="mt-6 border border-neutral-200 rounded-lg overflow-hidden">
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 sticky top-0">
                  <tr>
                    <th className="text-left py-2 px-4 font-medium text-neutral-600 border-b border-neutral-200">Timestamp</th>
                    <th className="text-right py-2 px-4 font-medium text-neutral-600 border-b border-neutral-200">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {[...readings].reverse().map((reading, i) => (
                    <tr key={i} className="border-b border-neutral-100 last:border-0">
                      <td className="py-2 px-4 text-neutral-500 tabular-nums">
                        {new Date(reading.timestamp).toLocaleString()}
                      </td>
                      <td className="py-2 px-4 text-right font-medium tabular-nums">
                        {reading.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
