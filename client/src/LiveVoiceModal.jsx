import { useEffect, useRef, useState } from 'react';
import { startRecording } from './recorder.js';

export default function LiveVoiceModal({ isOpen, onClose, onDraftGenerated, onError, onSwitchToManual }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState('idle'); // 'encoding' | 'uploading' | 'interpreting' | 'preparing' | 'ready'
  const [processingSeconds, setProcessingSeconds] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [voiceDetected, setVoiceDetected] = useState(false);
  const [volumePercent, setVolumePercent] = useState(0);

  const recorderRef = useRef(null);
  const timerRef = useRef(null);
  const procTimerRef = useRef(null);
  const abortCtrlRef = useRef(null);
  const canvasRef = useRef(null);
  const barHeightsRef = useRef(new Array(24).fill(4));
  const animFrameRef = useRef(null);
  const phaseRef = useRef(0);

  // 60 FPS Canvas audio visualizer
  const drawVisualizer = (data) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // Dark sleek background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    phaseRef.current += 0.05;
    const phase = phaseRef.current;

    const numBars = 24;
    const barSpacing = 4;
    const totalSpacing = (numBars - 1) * barSpacing;
    const barWidth = Math.max(3, (width - 40 - totalSpacing) / numBars);
    const startX = (width - (numBars * barWidth + totalSpacing)) / 2;

    const freqData = data?.freqData;
    const timeData = data?.timeData;
    const volume = data?.volumeLevel || 0;

    const currentBars = barHeightsRef.current;

    for (let i = 0; i < numBars; i++) {
      let targetHeight = 4;

      if (freqData && freqData.length > 0) {
        // Map bar i to voice frequency range (bins 1 to 28)
        const binIndex = Math.min(freqData.length - 1, Math.floor(1 + (i / numBars) * 24));
        const val = freqData[binIndex] || 0;
        targetHeight = Math.max(4, Math.round((val / 255) * (height - 18)));
      } else {
        // Ambient sine wave when waiting for speech
        targetHeight = 4 + Math.sin(phase + i * 0.35) * 3;
      }

      // Smooth interpolation
      if (targetHeight > currentBars[i]) {
        currentBars[i] = currentBars[i] * 0.3 + targetHeight * 0.7;
      } else {
        currentBars[i] = Math.max(4, currentBars[i] * 0.82);
      }

      const barH = currentBars[i];
      const x = startX + i * (barWidth + barSpacing);
      const y = (height - barH) / 2;

      // Dynamic studio gradient
      const grad = ctx.createLinearGradient(0, y, 0, y + barH);
      if (volume > 8) {
        grad.addColorStop(0, '#f97316');
        grad.addColorStop(0.5, '#ef4444');
        grad.addColorStop(1, '#ec4899');
      } else {
        grad.addColorStop(0, '#0284c7');
        grad.addColorStop(0.6, '#38bdf8');
        grad.addColorStop(1, '#818cf8');
      }

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barH, 2);
      ctx.fill();
    }

    // Oscilloscope waveform line across the middle
    if (timeData && timeData.length > 0 && volume > 3) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
      ctx.beginPath();
      const sliceWidth = width / timeData.length;
      let x = 0;
      for (let i = 0; i < timeData.length; i += 2) {
        const v = timeData[i] / 128.0;
        const y = (v * height) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth * 2;
      }
      ctx.stroke();
    }
  };

  const startLiveSession = async () => {
    try {
      setSeconds(0);
      setIsProcessing(false);
      setProcessingStage('idle');
      setProcessingSeconds(0);
      setVoiceDetected(false);
      setVolumePercent(0);

      const rec = await startRecording((audioMetrics) => {
        drawVisualizer(audioMetrics);
        const vol = audioMetrics.volumeLevel || 0;
        setVolumePercent(vol);
        setVoiceDetected(vol > 6);
      });

      recorderRef.current = rec;
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      onError?.(err.message || 'Microphone access denied. Please allow microphone permissions.');
      handleClose();
    }
  };

  const stopLiveSession = async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (recorderRef.current) {
      const rec = recorderRef.current;
      recorderRef.current = null;
      setIsRecording(false);
      const wav = await rec.stop();
      return wav;
    }
    return null;
  };

  const handleDone = async () => {
    setIsProcessing(true);
    setProcessingStage('encoding');
    setProcessingSeconds(0);

    // Track processing seconds for reassurance message if network/AI is busy
    procTimerRef.current = setInterval(() => {
      setProcessingSeconds((s) => s + 1);
    }, 1000);

    const abortCtrl = new AbortController();
    abortCtrlRef.current = abortCtrl;
    const tEncodingStart = Date.now();

    try {
      const wav = await stopLiveSession();
      if (!wav) throw new Error('No audio recorded');
      const encodingDurationMs = Date.now() - tEncodingStart;

      setProcessingStage('uploading');

      // Transition to interpreting indicator once upload has shipped
      const interpretingTimer = setTimeout(() => {
        setProcessingStage('interpreting');
      }, 300);

      await onDraftGenerated(wav, {
        encodingDurationMs,
        signal: abortCtrl.signal
      });

      clearTimeout(interpretingTimer);
      setProcessingStage('ready');
      handleClose();
    } catch (err) {
      if (err.name === 'AbortError') {
        console.info('[LiveVoiceModal] User cancelled voice processing.');
        return;
      }
      onError?.(err.message || 'Failed to process voice note');
      setIsProcessing(false);
      setProcessingStage('idle');
    } finally {
      if (procTimerRef.current) {
        clearInterval(procTimerRef.current);
        procTimerRef.current = null;
      }
    }
  };

  const handleCancelProcessing = () => {
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
    }
    if (procTimerRef.current) {
      clearInterval(procTimerRef.current);
      procTimerRef.current = null;
    }
    handleClose();
  };

  const handleSwitchToManual = () => {
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
    }
    if (procTimerRef.current) {
      clearInterval(procTimerRef.current);
      procTimerRef.current = null;
    }
    handleClose();
    onSwitchToManual?.();
  };

  const handleClose = async () => {
    await stopLiveSession();
    if (procTimerRef.current) {
      clearInterval(procTimerRef.current);
      procTimerRef.current = null;
    }
    setIsRecording(false);
    setIsProcessing(false);
    setProcessingStage('idle');
    setSeconds(0);
    setProcessingSeconds(0);
    setVoiceDetected(false);
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const runIdle = () => {
      if (!recorderRef.current) {
        drawVisualizer(null);
      }
      animFrameRef.current = requestAnimationFrame(runIdle);
    };
    runIdle();
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      startLiveSession();
    } else {
      stopLiveSession();
    }
    return () => {
      stopLiveSession();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const formatTime = (sec) => {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  const getStageLabel = () => {
    switch (processingStage) {
      case 'encoding': return 'OPTIMIZING AUDIO...';
      case 'uploading': return 'UPLOADING NOTE...';
      case 'interpreting': return 'GEMINI AI EXTRACTING...';
      case 'preparing': return 'PREPARING DRAFT...';
      case 'ready': return 'DRAFT READY!';
      default: return isRecording ? 'RECORDING VOICE NOTE' : 'PAUSED';
    }
  };

  const isLongProcessing = isProcessing && processingSeconds >= 5;

  return (
    <div className="voice-modal-backdrop" onClick={!isProcessing ? handleClose : undefined}>
      <div className="voice-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="voice-header">
          <div className="voice-title-box">
            <div className={`live-pulse-badge ${isRecording ? 'active' : isProcessing ? 'processing' : ''}`}>
              <span className="live-dot" />
              <span>{getStageLabel()}</span>
            </div>
            <span className="voice-timer">
              {isProcessing ? `${processingSeconds}s` : formatTime(seconds)}
            </span>
          </div>

          <div className="voice-header-right">
            {voiceDetected && !isProcessing && <span className="voice-detected-tag">Voice Active</span>}
            <button
              className="voice-close-btn"
              onClick={isProcessing ? handleCancelProcessing : handleClose}
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Live Canvas Audio Equalizer & Waveform Visualizer */}
        <div className="voice-waveform-container">
          <canvas
            ref={canvasRef}
            width={480}
            height={72}
            className="voice-canvas"
          />
        </div>

        {/* Real-time Voice Volume Activity Meter */}
        <div className="voice-meter-row">
          <span className="voice-meter-label">
            {isProcessing ? 'Status Pipeline:' : 'Microphone Activity:'}
          </span>
          <div className="voice-meter-track">
            {isProcessing ? (
              <div
                className="voice-meter-fill active processing-pulse"
                style={{
                  width:
                    processingStage === 'encoding' ? '25%' :
                    processingStage === 'uploading' ? '50%' :
                    processingStage === 'interpreting' ? '75%' :
                    processingStage === 'preparing' ? '90%' : '100%'
                }}
              />
            ) : (
              <div
                className={`voice-meter-fill ${voiceDetected ? 'active' : ''}`}
                style={{ width: `${Math.min(100, Math.max(voiceDetected ? 18 : 3, volumePercent))}%` }}
              />
            )}
          </div>
          <span className="voice-meter-val">
            {isProcessing ? processingStage : voiceDetected ? 'Speaking' : 'Listening'}
          </span>
        </div>

        {/* Reassurance Message if network or AI latency takes longer than 5 seconds */}
        {isLongProcessing ? (
          <div className="voice-reassurance-card">
            <div className="reassurance-header">
              <span className="reassurance-icon">⏱</span>
              <span className="reassurance-title">Taking a few seconds longer</span>
            </div>
            <p className="reassurance-text">
              High Gemini AI traffic detected. CredYazh is processing your note with fallback models. You can wait or switch to manual entry anytime.
            </p>
            <div className="reassurance-actions">
              <button
                type="button"
                className="btn-reassurance-cancel"
                onClick={handleCancelProcessing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-reassurance-manual"
                onClick={handleSwitchToManual}
              >
                Enter Manually
              </button>
            </div>
          </div>
        ) : (
          /* Natural Language Guidance Card */
          <div className="voice-guide-card">
            <div className="voice-guide-header">
              <span className="voice-guide-badge">Multi-Language AI</span>
              <span>Tamil • Tanglish • English</span>
            </div>
            <p className="voice-guide-text">
              Speak naturally without switching languages. CredYazh AI will automatically transcribe what you said and extract customer, items, and amounts.
            </p>
            <div className="voice-hints">
              <span className="hint-label">Example note:</span>
              <span className="hint-text">"Kumar account-la 1 kg sakkarai, rendu packet paal, total 140 rupees"</span>
            </div>
          </div>
        )}

        {/* Action Controls */}
        <div className="voice-actions">
          <button
            type="button"
            className="voice-btn-cancel"
            onClick={isProcessing ? handleCancelProcessing : handleClose}
          >
            {isProcessing ? 'Cancel' : 'Cancel'}
          </button>
          {!isProcessing ? (
            <button
              type="button"
              className="voice-btn-submit"
              onClick={handleDone}
              disabled={seconds < 1}
            >
              <span>Finish &amp; Process Note</span>
            </button>
          ) : (
            <button
              type="button"
              className="voice-btn-submit"
              disabled={true}
            >
              <span className="spinner-text">
                {processingStage === 'encoding' ? 'Optimizing...' :
                 processingStage === 'uploading' ? 'Uploading...' :
                 processingStage === 'interpreting' ? 'Gemini Extracting...' :
                 'Preparing Draft...'}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
