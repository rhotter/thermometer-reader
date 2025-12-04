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

  // Reading history for CSV export
  const [readings, setReadings] = useState<Reading[]>([]);

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
        body: JSON.stringify({ image: imageData }),
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
  }, [cropRegion, loading]);

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
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, width, height);

    // Parse values
    const values = readings.map((r) => parseFloat(r.value));
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;

    // Draw grid lines
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartHeight * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();

      // Y-axis labels
      const val = maxVal - (range * i) / 4;
      ctx.fillStyle = "#64748b";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(val.toFixed(1), padding.left - 8, y + 4);
    }

    // Draw line
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.beginPath();

    readings.forEach((reading, i) => {
      const x = padding.left + (i / (readings.length - 1)) * chartWidth;
      const y = padding.top + ((maxVal - parseFloat(reading.value)) / range) * chartHeight;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    // Draw points
    ctx.fillStyle = "#2563eb";
    readings.forEach((reading, i) => {
      const x = padding.left + (i / (readings.length - 1)) * chartWidth;
      const y = padding.top + ((maxVal - parseFloat(reading.value)) / range) * chartHeight;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    // X-axis label
    ctx.fillStyle = "#64748b";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Time", width / 2, height - 5);
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
    <div className="min-h-screen bg-white text-slate-900">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-3">ReadoutCam</h1>
          <p className="text-slate-500">
            Read data from temperature sensors, gauges, meters, or any numeric display
          </p>
        </header>

        <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200">
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-600">
              {error}
            </div>
          )}

          {/* Start button - shown when not streaming */}
          {!streaming && (
            <div className="flex flex-col items-center justify-center h-64">
              <button
                onClick={startCamera}
                className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-lg transition-colors flex items-center gap-3"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Start Camera
              </button>
              <p className="mt-4 text-slate-400 text-sm">
                Click to enable your camera
              </p>
            </div>
          )}

          {/* Video and controls - always in DOM, hidden when not streaming */}
          <div className={streaming ? "space-y-4" : "hidden"}>
            {/* Video container */}
            <div
              ref={containerRef}
              className="relative rounded-lg overflow-hidden bg-black"
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
                  className="absolute border-2 border-green-500 bg-green-500/10 pointer-events-none"
                  style={overlayStyle}
                />
              )}

              {/* Loading indicator */}
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <div className="bg-white/90 px-4 py-2 rounded-lg flex items-center gap-2 text-slate-700">
                    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Reading...
                  </div>
                </div>
              )}

              {/* Result overlay */}
              {result && (
                <div className="absolute bottom-4 right-4 bg-white/90 px-6 py-3 rounded-xl border border-slate-200 shadow-lg">
                  <p className="text-3xl font-bold text-blue-600">{result}</p>
                </div>
              )}
            </div>

            {/* Instructions */}
            <p className="text-sm text-slate-500 text-center">
              {cropRegion
                ? "Crop region set (green box). Drag to select a new region."
                : "Drag on the video to select a crop region for the number display"}
            </p>

            {/* Controls */}
            <div className="flex flex-wrap gap-3 justify-center">
              <button
                onClick={() => setAutoRead(!autoRead)}
                className={`px-6 py-3 rounded-xl font-semibold transition-colors flex items-center gap-2 text-white ${
                  autoRead
                    ? "bg-red-500 hover:bg-red-600"
                    : "bg-green-500 hover:bg-green-600"
                }`}
              >
                {autoRead ? (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                    </svg>
                    Stop Reading
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Start Reading
                  </>
                )}
              </button>

              <div className="flex items-center gap-2 bg-slate-100 border border-slate-200 rounded-xl px-4">
                <label className="text-sm text-slate-600">Interval:</label>
                <select
                  value={interval}
                  onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                  className="bg-transparent py-3 text-slate-900 focus:outline-none"
                >
                  <option value={2}>2s</option>
                  <option value={5}>5s</option>
                  <option value={10}>10s</option>
                  <option value={30}>30s</option>
                </select>
              </div>

              {cropRegion && (
                <button
                  onClick={() => setCropRegion(null)}
                  className="px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-semibold transition-colors"
                >
                  Clear Crop
                </button>
              )}

              {readings.length > 0 && (
                <button
                  onClick={downloadCSV}
                  className="px-6 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-xl font-semibold transition-colors flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download CSV ({readings.length})
                </button>
              )}
            </div>
          </div>

          {/* Hidden canvas for capture */}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Chart section */}
        {readings.length >= 2 && (
          <div className="mt-6 bg-slate-50 rounded-2xl p-6 border border-slate-200">
            <h2 className="text-lg font-semibold mb-4">Readings Over Time</h2>
            <canvas
              ref={chartRef}
              className="w-full h-48 rounded-lg"
            />
          </div>
        )}

        {/* Show message when waiting for readings */}
        {readings.length > 0 && readings.length < 2 && (
          <div className="mt-6 bg-slate-50 rounded-2xl p-6 border border-slate-200">
            <p className="text-slate-500 text-center">
              Chart will appear after 2 readings ({readings.length}/2)
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
