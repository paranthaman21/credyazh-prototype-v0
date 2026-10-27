// Gemini accepts WAV, MP3, AAC, OGG, FLAC. Browsers record WebM, so we convert to 16 kHz mono WAV here.
export async function startRecording(onVolume) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (!window.isSecureContext) {
      throw new Error(
        'Microphone access is blocked because the site is not running on a secure origin (HTTPS or localhost). ' +
        'Browsers disable microphone APIs on network HTTP URLs (like http://192.168.x.x). ' +
        'Please access via http://localhost:5173.'
      );
    }
    throw new Error('Microphone recording is not supported in this browser.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let animId = null;
  let audioCtx = null;
  let analyser = null;

  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);

    if (onVolume) {
      const freqData = new Uint8Array(analyser.frequencyBinCount);
      const timeData = new Uint8Array(analyser.fftSize);

      const poll = () => {
        analyser.getByteFrequencyData(freqData);
        analyser.getByteTimeDomainData(timeData);

        // Calculate root-mean-square (RMS) volume
        let sum = 0;
        for (let i = 0; i < timeData.length; i++) {
          const v = (timeData[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / timeData.length);
        const volumeLevel = Math.min(100, Math.round(rms * 350));

        onVolume({ freqData, timeData, volumeLevel, analyser });
        animId = requestAnimationFrame(poll);
      };
      poll();
    }
  } catch (err) {
    console.warn('AudioContext visualization setup warning:', err);
  }

  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.start();
  return {
    stream,
    analyser,
    audioCtx,
    stop: () => new Promise((resolve) => {
      if (animId) cancelAnimationFrame(animId);
      if (audioCtx) {
        audioCtx.close().catch(() => {});
      }
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        resolve(await toWav(new Blob(chunks, { type: rec.mimeType })));
      };
      rec.stop();
    })
  };
}

async function toWav(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const samples = (await off.startRendering()).getChannelData(0);

  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return new Blob([view], { type: 'audio/wav' });
}
