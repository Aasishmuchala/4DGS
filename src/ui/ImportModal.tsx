import { useState, useRef } from 'react';
import { getViewer } from '../engine/viewerRef';
import { parseSplatPly } from '../engine/loaders/splatPly';

// Backend API configuration
const API_BASE = 'http://localhost:8000';

interface VideoFile {
  file: File;
  id: string;
  url: string;
  resolution: { width: number; height: number };
  duration: number;
  fps: number;
}

interface ValidationState {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

interface LogEntry {
  time: string;
  message: string;
  type: 'info' | 'error' | 'success';
}

export default function ImportModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<string>('Ready');
  const [validation, setValidation] = useState<ValidationState | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const supportedFormats = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
  const videoSelectRef = useRef<HTMLInputElement>(null);

  const addLog = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { time, message, type }].slice(-20)); // Keep last 20 logs
  };

  const clearLogs = () => setLogs([]);

  const handleFileSelect = async (files: FileList) => {
    const newVideos: VideoFile[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const extension = '.' + file.name.split('.').pop()?.toLowerCase();

      if (!supportedFormats.includes(extension)) {
        addLog(`Unsupported format: ${file.name}`, 'error');
        continue;
      }

      const url = URL.createObjectURL(file);

      const video = document.createElement('video');
      video.preload = 'metadata';

      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = reject;
        video.src = url;
      });

      const videoFile: VideoFile = {
        file,
        id: `${Date.now()}-${i}`,
        url,
        resolution: { width: video.videoWidth, height: video.videoHeight },
        duration: video.duration,
        fps: 30,
      };

      newVideos.push(videoFile);
    }

    const allVideos = [...videos, ...newVideos];
    setVideos(allVideos);
    validateVideos(allVideos);
    addLog(`Added ${newVideos.length} video(s)`, 'success');
  };

  const validateVideos = (videosToValidate: VideoFile[]) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (videosToValidate.length < 1) {
      errors.push('Please select at least 1 video');
    }

    if (videosToValidate.length > 8) {
      warnings.push('Using more than 8 videos may slow down processing');
    }

    const firstResolution = videosToValidate[0]?.resolution;
    const firstDuration = videosToValidate[0]?.duration;

    videosToValidate.forEach((video, index) => {
      if (index === 0) return;

      if (video.resolution.width !== firstResolution?.width ||
          video.resolution.height !== firstResolution?.height) {
        errors.push(`Video ${index + 1}: Resolution mismatch`);
      }

      if (Math.abs(video.duration - firstDuration!) > 0.1) {
        errors.push(`Video ${index + 1}: Duration differs`);
      }
    });

    setValidation({
      isValid: errors.length === 0,
      errors,
      warnings,
    });
  };

  const removeVideo = (id: string) => {
    const video = videos.find(v => v.id === id);
    if (video) {
      URL.revokeObjectURL(video.url);
    }
    const newVideos = videos.filter(v => v.id !== id);
    setVideos(newVideos);
    validateVideos(newVideos);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files);
    }
  };

  const generateGaussianSplat = async () => {
    if (!validation?.isValid) return;

    setIsUploading(true);
    setIsProcessing(true);
    setUploadProgress(0);
    setStatus('Starting...');
    clearLogs();

    try {
      // Stage 1: Check backend
      addLog('Checking backend server...', 'info');
      setStatus('Checking backend...');

      const healthResponse = await fetch(`${API_BASE}/health`, {
        method: 'GET',
        mode: 'cors'
      }).catch((err) => {
        addLog(`Backend not reachable: ${err.message}`, 'error');
        throw err;
      });

      if (!healthResponse.ok) {
        addLog(`Backend error: ${healthResponse.status}`, 'error');
        throw new Error('Backend not available');
      }

      const healthData = await healthResponse.json();
      addLog(`Backend ready. Device: ${healthData.device}`, 'success');
      setUploadProgress(10);

      // Stage 2: Upload videos
      addLog(`Uploading ${videos.length} video(s)...`, 'info');
      setStatus('Uploading videos...');

      const formData = new FormData();
      videos.forEach(video => {
        formData.append('files', video.file);
      });

      const uploadResponse = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData,
        mode: 'cors'
      });

      if (!uploadResponse.ok) {
        const error = await uploadResponse.text();
        addLog(`Upload failed: ${error}`, 'error');
        throw new Error(`Upload failed: ${error}`);
      }

      const uploadResult = await uploadResponse.json();
      addLog(`Uploaded ${uploadResult.files} video(s)`, 'success');
      setUploadProgress(30);

      const jobId = uploadResult.job_id;
      addLog(`Job ID: ${jobId}`, 'info');

      // Stage 3: Start processing
      addLog('Starting 3D reconstruction...', 'info');
      setStatus('Processing...');

      const processResponse = await fetch(`${API_BASE}/process/${jobId}`, {
        method: 'POST',
        mode: 'cors'
      });

      if (!processResponse.ok) {
        const error = await processResponse.text();
        addLog(`Process start failed: ${error}`, 'error');
        throw new Error('Failed to start processing');
      }

      addLog('Reconstructing (polling for status)...', 'info');
      setUploadProgress(40);

      // Poll for status
      let jobStatus = await pollJobStatus(jobId, 40, 85);

      if (jobStatus.status === 'failed') {
        addLog(`Processing failed: ${jobStatus.message}`, 'error');
        throw new Error(jobStatus.message || 'Processing failed');
      }

      if (jobStatus.status === 'timeout') {
        addLog('Processing timed out', 'error');
        throw new Error('Processing timed out');
      }

      // Stage 4: Download result
      addLog('Downloading result...', 'info');
      setUploadProgress(90);
      setStatus('Downloading...');

      const downloadResponse = await fetch(`${API_BASE}/download/${jobId}`, {
        mode: 'cors'
      });

      if (!downloadResponse.ok) {
        addLog(`Download failed: ${downloadResponse.status}`, 'error');
        throw new Error('Failed to download result');
      }

      const arrayBuffer = await downloadResponse.arrayBuffer();
      addLog(`Received ${arrayBuffer.byteLength} bytes`, 'success');
      setUploadProgress(95);
      setStatus('Loading in viewer...');

      // Load the PLY file
      const data = parseSplatPly(arrayBuffer);
      const viewer = getViewer();

      if (viewer) {
        viewer.loadGaussianData(data);
        addLog(`Loaded ${data.count} splats`, 'success');
        setUploadProgress(100);
        setStatus('Done!');
        setIsOpen(false);
        setVideos([]);
        setValidation(null);
      }

    } catch (error) {
      console.error('Reconstruction failed:', error);
      addLog(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      setStatus('Failed');
    } finally {
      setIsUploading(false);
      setIsProcessing(false);
    }
  };

  const pollJobStatus = async (jobId: string, minProgress: number, maxProgress: number): Promise<any> => {
    let attempts = 0;
    const maxAttempts = 180; // 3 minutes max

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(`${API_BASE}/status/${jobId}`, {
          mode: 'cors'
        });

        if (!response.ok) {
          throw new Error('Status check failed');
        }

        const status = await response.json();
        addLog(`Status: ${status.status} - ${status.message}`, 'info');

        const mappedProgress = minProgress + (status.progress / 100) * (maxProgress - minProgress);
        setUploadProgress(Math.floor(mappedProgress));
        setStatus(status.message || `${status.progress}%`);

        if (status.status === 'completed') {
          addLog('Reconstruction complete!', 'success');
          return status;
        }

        if (status.status === 'failed') {
          return status;
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;

      } catch (e) {
        addLog(`Poll error: ${e}`, 'error');
        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;
      }
    }

    return { status: 'timeout' };
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="glass pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition hover:bg-white/10 hover:text-ink-100"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
        Import Videos
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-auto">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={() => setIsOpen(false)}
      ></div>

      <div className="relative max-w-3xl w-full max-h-[90vh] overflow-y-auto rounded-xl bg-gray-900/95 backdrop-blur glass">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-ink-100 text-xl font-bold">Import Videos to 4DGS</h2>
            <button
              onClick={() => setIsOpen(false)}
              className="grid h-8 w-8 place-items-center rounded-full text-ink-300 transition hover:bg-white/10 hover:text-ink-100"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <button
              onClick={() => videoSelectRef.current?.click()}
              className="flex flex-col items-center justify-center p-6 rounded-xl bg-lav-300/10 border border-lav-300/30 text-lav-100 hover:bg-lav-300/20"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mb-3">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="12" y1="9" x2="12" y2="15"></line>
                <line x1="9" y1="12" x2="15" y2="12"></line>
              </svg>
              <span className="font-medium">Select Videos</span>
              <span className="text-xs text-lav-200/70 mt-1">From folders</span>
            </button>
            <div
              className="flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed border-white/20 hover:border-white/40 cursor-pointer"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mb-3">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              <span className="font-medium">Drop Videos</span>
              <span className="text-xs text-ink-400 mt-1">Drag & drop</span>
            </div>
          </div>

          <input
            ref={videoSelectRef}
            type="file"
            accept=".mp4,.webm,.mov,.avi,.mkv"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) {
                handleFileSelect(e.target.files);
              }
            }}
          />

          {/* Selected Videos */}
          {videos.length > 0 && (
            <div className="mb-6">
              <h3 className="text-ink-100 font-medium mb-3">Selected Videos ({videos.length})</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {videos.map((video) => (
                  <div key={video.id} className="relative group">
                    <video src={video.url} className="w-full aspect-video rounded-lg object-cover" muted />
                    <button
                      onClick={() => removeVideo(video.id)}
                      className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100"
                    >
                      ×
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-1.5 rounded-b-lg">
                      <p className="text-xs text-white truncate">{video.file.name}</p>
                      <p className="text-xs text-gray-400">{video.resolution.width}×{video.resolution.height}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Validation */}
          {validation && (
            <div className="mb-4 p-3 rounded-lg bg-rose-900/30 border border-rose-500/30">
              {validation.errors.map((error, i) => (
                <p key={i} className="text-rose-400 text-sm">• {error}</p>
              ))}
              {validation.warnings.map((warning, i) => (
                <p key={i} className="text-amber-400 text-sm">• {warning}</p>
              ))}
            </div>
          )}

          {/* Progress */}
          {isUploading && (
            <div className="mb-4">
              <p className="text-sm text-ink-200 mb-2">{status}</p>
              <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-lav-400 to-lav-600 h-full transition-all"
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
              <p className="text-xs text-ink-400 mt-1 text-right">{uploadProgress}%</p>
            </div>
          )}

          {/* Log Window */}
          <div className="mb-4 p-3 rounded-lg bg-black/50 border border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-ink-400 uppercase">Logs</span>
              <button onClick={clearLogs} className="text-xs text-ink-500 hover:text-ink-300">Clear</button>
            </div>
            <div className="h-32 overflow-y-auto font-mono text-xs space-y-1">
              {logs.length === 0 && <p className="text-ink-600">No logs yet...</p>}
              {logs.map((log, i) => (
                <p key={i} className={
                  log.type === 'error' ? 'text-rose-400' :
                  log.type === 'success' ? 'text-emerald-400' :
                  'text-ink-400'
                }>
                  <span className="text-ink-600">[{log.time}]</span> {log.message}
                </p>
              ))}
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={generateGaussianSplat}
            disabled={!validation?.isValid || isUploading}
            className={`w-full py-3 rounded-lg font-medium ${
              !validation?.isValid || isUploading
                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                : 'bg-lav-300 text-gray-900 hover:bg-lav-200'
            }`}
          >
            {isUploading ? 'Processing...' : 'Generate 4DGS Scene'}
          </button>
        </div>
      </div>
    </div>
  );
}