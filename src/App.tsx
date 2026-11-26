import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { analyzeCanvas, loadFaceLandmarker, type AnalyzedFrame } from './faceAnalysis';
import {
  Activity, ArrowDownToLine, ArrowRight, Check, ChevronDown,
  CircleAlert, Clock3, FileImage, FileVideo2, Fingerprint, FolderOpen, Gauge, Maximize2,
  Image as ImageIcon, LockKeyhole, Menu, Play, RotateCcw, ScanFace, Shield,
  Sparkles, Upload, X,
} from 'lucide-react';

type MediaKind = 'video' | 'image';
type FrameRecord = AnalyzedFrame;
type CaseMedia = { file: File; kind: MediaKind; url: string };

const fmtTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

function waitFor(target: HTMLMediaElement, event: string) {
  return new Promise<void>((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('This media could not be decoded by the browser.')); };
    const cleanup = () => { target.removeEventListener(event, done); target.removeEventListener('error', fail); };
    target.addEventListener(event, done, { once: true });
    target.addEventListener('error', fail, { once: true });
  });
}

async function sampleVideo(file: File, landmarker: Awaited<ReturnType<typeof loadFaceLandmarker>>, onProgress: (progress: number) => void): Promise<FrameRecord[]> {
  const video = document.createElement('video');
  const url = URL.createObjectURL(file);
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await waitFor(video, 'loadedmetadata');
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('Video duration could not be read.');
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas sampling is unavailable in this browser.');
    const count = Math.min(24, Math.max(12, Math.ceil(video.duration * 2)));
    const frames: FrameRecord[] = [];
    let previous: Uint8ClampedArray | null = null;
    for (let index = 0; index < count; index += 1) {
      const time = Math.min(Math.max(0, video.duration * (index / count)), Math.max(0, video.duration - 0.08));
      if (video.readyState < 2) await waitFor(video, 'loadeddata');
      if (Math.abs(video.currentTime - time) > 0.01) {
        const seeked = waitFor(video, 'seeked');
        video.currentTime = time;
        await seeked;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let delta = 0;
      if (previous) {
        let samples = 0;
        for (let p = 0; p < pixels.length; p += 48) {
          delta += Math.abs(pixels[p] - previous[p]) + Math.abs(pixels[p + 1] - previous[p + 1]) + Math.abs(pixels[p + 2] - previous[p + 2]);
          samples += 3;
        }
        delta = Math.round((delta / Math.max(1, samples) / 255) * 100);
      }
      frames.push(analyzeCanvas(canvas, landmarker, time, delta));
      previous = new Uint8ClampedArray(pixels);
      onProgress(Math.round(((index + 1) / count) * 88));
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}

function makeDemoFrames(): FrameRecord[] {
  return Array.from({ length: 8 }, (_, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 300;
    const context = canvas.getContext('2d')!;
    const gradient = context.createLinearGradient(0, 0, 480, 300);
    gradient.addColorStop(0, '#172b30');
    gradient.addColorStop(1, '#091214');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 480, 300);
    context.fillStyle = '#294247';
    context.beginPath();
    context.ellipse(240, 150, 88, 112, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#9bc4b2';
    context.beginPath();
    context.ellipse(207, 135, 9, index === 3 ? 2 : 5, 0, 0, Math.PI * 2);
    context.ellipse(273, 135, 9, index === 3 ? 2 : 5, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#c77a75';
    context.lineWidth = 4;
    context.beginPath();
    context.ellipse(240, 190, 18 + (index % 3) * 4, 4 + (index % 2) * 4, 0, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = '#b7c8c0';
    context.font = '12px monospace';
    context.fillText(`SYNTHETIC SAMPLE  /  ${String(index + 1).padStart(2, '0')}`, 16, 280);
    return { time: index * 0.8, src: canvas.toDataURL('image/jpeg', 0.78), delta: index === 4 ? 47 : [0, 8, 11, 6, 47, 13, 9, 15][index], facial: { detected: false, eyeAspectRatio: null, mouthAspectRatio: null, eyesClosed: null, mouthOpen: null } };
  });
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<CaseMedia | null>(null);
  const [frames, setFrames] = useState<FrameRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [analysisStage, setAnalysisStage] = useState('Preparing local analysis');
  const [resultReady, setResultReady] = useState(false);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const [frameExpanded, setFrameExpanded] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedFrame, setSelectedFrame] = useState(0);
  const [error, setError] = useState('');
  const [mobileNav, setMobileNav] = useState(false);

  const acceptFile = (file?: File) => {
    if (!file) return;
    const kind: MediaKind | null = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null;
    if (!kind) { setError('Choose a supported video or image file.'); return; }
    if (file.size > 200 * 1024 * 1024) { setError('For this local demo, media must be under 200 MB.'); return; }
    if (media?.url) URL.revokeObjectURL(media.url);
    setMedia({ file, kind, url: URL.createObjectURL(file) });
    setFrames([]);
    setResultReady(false);
    setResultDialogOpen(false);
    setFrameExpanded(false);
    setDemoMode(false);
    setSelectedFrame(0);
    setProgress(0);
    setError('');
  };

  const onInput = (event: ChangeEvent<HTMLInputElement>) => acceptFile(event.target.files?.[0]);
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files[0]);
  };

  const runAnalysis = async () => {
    setError('');
    setBusy(true);
    setProgress(14);
    setAnalysisStage('Loading on-device face landmark model');
    setResultReady(false);
    let modelLoaded = false;
    try {
      const landmarker = await loadFaceLandmarker(setAnalysisStage);
      modelLoaded = true;
      if (media?.kind === 'video') {
        setAnalysisStage('Sampling frames and measuring facial landmarks');
        const sampled = await sampleVideo(media.file, landmarker, setProgress);
        setFrames(sampled);
      } else if (media?.kind === 'image') {
        setAnalysisStage('Finding face landmarks in still image');
        const image = new Image();
        image.src = media.url;
        await image.decode();
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 900 / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
        setFrames([analyzeCanvas(canvas, landmarker, 0, 0)]);
      }
      setProgress(100);
      setAnalysisStage('Analysis complete');
      window.setTimeout(() => { setBusy(false); setResultReady(true); setResultDialogOpen(true); }, 450);
    } catch (reason) {
      setBusy(false);
      setProgress(0);
      const message = reason instanceof Error ? reason.message : 'Analysis could not be completed.';
      setError(`${message}${modelLoaded ? '' : ' Check your internet connection for the first model download, then try again.'}`);
    }
  };

  const loadDemo = () => {
    if (media?.url) URL.revokeObjectURL(media.url);
    setMedia({ file: new File(['Synthetic sample generated in browser'], 'DEMO-EXHIBIT-014.mp4', { type: 'video/mp4' }), kind: 'video', url: '' });
    setFrames(makeDemoFrames());
    setResultReady(true);
    setResultDialogOpen(true);
    setDemoMode(true);
    setProgress(100);
    setSelectedFrame(0);
    setError('');
  };

  const reset = () => {
    if (media?.url) URL.revokeObjectURL(media.url);
    setMedia(null); setFrames([]); setResultReady(false); setResultDialogOpen(false); setFrameExpanded(false); setBusy(false); setProgress(0); setDemoMode(false); setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const detectedFrames = frames.filter((frame) => frame.facial.detected);
  const demoPixelOutlier = frames.length > 1 ? Math.max(...frames.slice(1).map((frame) => frame.delta)) : 0;
  const uploadedStillMouthScore = detectedFrames[0]?.facial.mouthAspectRatio === null || !detectedFrames[0]
    ? 55
    : Math.round(detectedFrames[0].facial.mouthAspectRatio * 100);
  const toyMetric = media?.kind === 'image' && !demoMode ? uploadedStillMouthScore : demoPixelOutlier;
  const toyMetricName = media?.kind === 'image' && !demoMode ? 'mouth aperture × 100' : 'peak sampled pixel difference';
  const toyReason = media?.kind === 'image' && !demoMode
    ? detectedFrames.length ? `Still-image mouth aperture ratio: ${detectedFrames[0].facial.mouthAspectRatio} × 100 = ${toyMetric}.` : 'No face landmarks detected; the toy rule assigns 55 points.'
    : `Peak sampled frame-to-frame pixel difference: ${toyMetric}%.`;
  const demoToyLabel = toyMetric >= 35 ? 'FAKE' : 'REAL';
  const toyRuleDescription = `The UI assigns FAKE when this value is at least 35; otherwise it assigns REAL.`;
  const eyeClosureSamples = detectedFrames.filter((frame) => frame.facial.eyesClosed).length;
  const mouthOpenSamples = detectedFrames.filter((frame) => frame.facial.mouthOpen).length;
  const assessmentLabel = detectedFrames.length ? 'Facial landmarks detected' : 'No face landmarks detected';
  const signalPoints = (metric: 'eyeAspectRatio' | 'mouthAspectRatio', maxValue: number) => frames.flatMap((frame, index) => {
    const value = frame.facial[metric];
    if (!frame.facial.detected || value === null) return [];
    const x = frames.length > 1 ? (index / (frames.length - 1)) * 360 : 180;
    const y = 88 - (Math.min(maxValue, value) / maxValue) * 70;
    return [`${x},${y}`];
  }).join(' ');
  const nav = <><a className="nav-item active" href="#workspace"><Activity size={17} /> Workspace</a><a className="nav-item" href="#evidence"><FolderOpen size={17} /> Evidence review</a><a className="nav-item" href="#method"><Shield size={17} /> Method & limits</a></>;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#workspace" aria-label="DeepTrace home"><span className="brand-mark"><ScanFace size={22} /></span><span>deep<span className="brand-light">trace</span><small>FORENSIC MEDIA LAB</small></span></a>
        <div className="case-select"><span className="case-icon"><Fingerprint size={17} /></span><span><small>ACTIVE CASE</small><strong>CASE-2026-014</strong></span><ChevronDown size={15} /></div>
        <div className="side-label">ANALYSIS</div>
        <nav onClick={() => setMobileNav(false)}>{nav}</nav>
        <div className="sidebar-bottom">
          <div className="privacy-card"><LockKeyhole size={16} /><div><strong>On-device analysis</strong><p>Media stays in this browser; model files load online.</p></div></div>
          <div className="profile"><div className="avatar">AR</div><div><strong>Analyst review</strong><span>Presentation workspace</span></div><ChevronDown size={15} /></div>
        </div>
      </aside>

      <main className="main-content" id="workspace">
        <header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMobileNav(!mobileNav)} aria-label="Toggle navigation"><Menu size={19} /></button><div className="crumb">Workspace <span>/</span> <b>New analysis</b></div><div className="topbar-right"><span className="local-indicator"><i /> LOCAL SESSION</span><button className="icon-button" title="Reset workspace" onClick={reset}><RotateCcw size={17} /></button></div></header>
        <div className="page-wrap">
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> FORENSIC MEDIA REVIEW <span className="version-tag">DEMO BUILD</span></div><h1>Examine the evidence.</h1><p>Inspect frame-level visual changes and prepare an explainable review summary.</p></div><div className="case-chip"><Fingerprint size={16} /><span>CASE-2026-014</span><i /> <span>UNASSIGNED</span></div></section>

          <section className="disclaimer" id="method"><div className="disclaimer-icon"><CircleAlert size={18} /></div><div><strong>Landmark measurements are not a deepfake verdict</strong><p>MediaPipe Face Landmarker locates face regions and measures sampled eye/mouth geometry. A separate popup applies an arbitrary toy rule to display a simulated FAKE/REAL label for the prototype; no authenticity classifier is used. This output is not validated and must not be used as evidence or for legal decisions.</p></div><span className="disclaimer-tag">SIMULATED LABEL</span></section>

          <section className="workspace-grid">
            <div className="left-column">
              <article className="panel intake-panel">
                <div className="panel-heading"><div className="heading-icon"><Upload size={17} /></div><div><h2>Exhibit intake</h2><p>Import source media for a local review session</p></div><span className="step-label">01 / INTAKE</span></div>
                {!media ? <div className={`drop-zone ${dragging ? 'drop-active' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
                  <div className="upload-symbol"><Upload size={21} /></div><h3>Drop an exhibit to begin</h3><p>Video or still image · processed locally in your browser</p><button className="button button-secondary" onClick={() => inputRef.current?.click()}><FolderOpen size={16} /> Browse files</button><input ref={inputRef} className="sr-only" type="file" accept="video/*,image/*" onChange={onInput} /><div className="file-types"><span><FileVideo2 size={14} /> MP4 · MOV · WEBM</span><span><FileImage size={14} /> JPG · PNG · WEBP</span><span>MAX 200 MB</span></div>
                </div> : <div className="media-loaded"><div className="media-file-icon">{media.kind === 'video' ? <FileVideo2 size={20} /> : <FileImage size={20} />}</div><div className="media-meta"><strong>{media.file.name}</strong><span>{demoMode ? 'Synthetic sample · generated in browser' : `${media.kind === 'video' ? 'Video exhibit' : 'Image exhibit'} · ${(media.file.size / (1024 * 1024)).toFixed(2)} MB`}</span></div><button className="icon-button remove-button" onClick={reset} aria-label="Remove media"><X size={17} /></button></div>}
                {error && <div className="error-message"><CircleAlert size={15} />{error}</div>}
                <div className="intake-actions"><button className="button button-primary" disabled={!media || busy || demoMode} onClick={runAnalysis}>{busy ? <><span className="spinner" /> Sampling frames…</> : <><Sparkles size={16} /> Run demo analysis <ArrowRight size={15} /></>}</button><button className="text-button" onClick={loadDemo}><Play size={14} /> Load sample case</button></div>
                {busy && <div className="progress-wrap"><div className="progress-caption"><span>{analysisStage}</span><span>{progress}%</span></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div></div>}
              </article>

              <article className="panel evidence-panel" id="evidence">
                <div className="panel-heading"><div className="heading-icon"><ScanFace size={17} /></div><div><h2>Visual evidence</h2><p>{resultReady ? `${frames.length} ${media?.kind === 'video' ? 'sampled frames' : 'still image'} · face & region analysis` : 'Face, eye, and mouth analysis will appear here'}</p></div><span className="step-label">02 / REVIEW</span></div>
                {!resultReady ? <div className="empty-evidence"><div className="empty-art"><div className="art-frame"><ScanFace size={36} strokeWidth={1} /></div><span className="art-dot dot-one" /><span className="art-dot dot-two" /><span className="art-line" /></div><strong>Evidence view is waiting</strong><span>Import media or load the sample case to inspect frames.</span></div> : <>
                  {demoMode && <div className="simulated-banner"><Sparkles size={14} /> SIMULATED SAMPLE · cues and scores below are illustrative, not computed from real media</div>}
                  <div className="frame-viewer"><div className="frame-main"><img src={frames[selectedFrame]?.src} alt={`Sampled frame ${selectedFrame + 1}`} /><div className="frame-overlay-label"><span className="rec-dot" /> {demoMode ? 'SYNTHETIC FRAME' : `FRAME ${String(selectedFrame + 1).padStart(2, '0')}`}</div><button className="frame-expand-button" onClick={() => setFrameExpanded(true)} aria-label="Expand full frame" title="View full frame"><Maximize2 size={14} /></button>{demoMode && <><div className="roi roi-eyes"><span>EYE REGION · ILLUSTRATIVE</span></div><div className="roi roi-mouth"><span>MOUTH · ILLUSTRATIVE</span></div></>}</div><div className="frame-info"><span>SELECTED FRAME</span><strong>{String(selectedFrame + 1).padStart(2, '0')} <i>/</i> {String(frames.length).padStart(2, '0')}</strong><span className="timecode"><Clock3 size={13} /> {fmtTime(frames[selectedFrame]?.time ?? 0)}</span></div></div>
                  <div className="filmstrip">{frames.map((frame, index) => <button key={`${frame.time}-${index}`} className={`film-frame ${selectedFrame === index ? 'film-selected' : ''}`} onClick={() => setSelectedFrame(index)} aria-label={`Select frame ${index + 1}`}><img src={frame.src} alt="" /><span>{fmtTime(frame.time)}</span></button>)}</div>
                  {media?.kind === 'video' ? <div className="comparison-block"><div className="subheading"><span>FRAME-TO-FRAME CHANGE</span><span className="neutral-key"><i /> Pixel difference · not a face signal</span></div><div className="change-chart">{frames.map((frame, index) => <button key={`bar-${index}`} onClick={() => setSelectedFrame(index)} className={`chart-column ${selectedFrame === index ? 'chart-selected' : ''}`} title={`Frame ${index + 1}: ${frame.delta}% sampled pixel difference`}><span className="bar-value">{frame.delta}%</span><i style={{ height: `${Math.max(4, Math.min(100, frame.delta * 1.65))}%` }} /><small>{String(index + 1).padStart(2, '0')}</small></button>)}</div>{detectedFrames.length > 1 && <div className="signal-chart"><div className="subheading"><span>FACIAL REGION SIGNALS</span><span className="signal-legend"><i className="eye-key" /> Eye ratio <i className="mouth-key" /> Mouth ratio</span></div><svg className="signal-svg" viewBox="0 0 360 96" preserveAspectRatio="none" role="img" aria-label="Eye openness and mouth aperture ratios across sampled frames"><path className="signal-grid" d="M0 18H360 M0 53H360 M0 88H360" /><path className="selected-frame-line" d={`M${frames.length > 1 ? (selectedFrame / (frames.length - 1)) * 360 : 180} 8V90`} /><polyline className="eye-line" points={signalPoints('eyeAspectRatio', 0.4)} /><polyline className="mouth-line" points={signalPoints('mouthAspectRatio', 0.55)} />{frames.map((frame, index) => { if (!frame.facial.detected) return null; const x = frames.length > 1 ? (index / (frames.length - 1)) * 360 : 180; const eyeY = 88 - (Math.min(0.4, frame.facial.eyeAspectRatio ?? 0) / 0.4) * 70; const mouthY = 88 - (Math.min(0.55, frame.facial.mouthAspectRatio ?? 0) / 0.55) * 70; return <g key={`signal-${index}`}><circle className="eye-point" cx={x} cy={eyeY} r="2.7" /><circle className="mouth-point" cx={x} cy={mouthY} r="2.7" /></g>; })}</svg><div className="signal-footnote">Normalized geometry ratios per detected frame · not emotion or authenticity scores.</div></div>}<div className="chart-footnote">A large pixel change may come from camera motion, lighting, scene cuts, compression, or ordinary movement.</div></div> : <div className="still-note"><ImageIcon size={15} /> A still image has no temporal information. Blink and mouth movement cannot be evaluated from one frame.</div>}
                  <div className="cue-row"><div className="cue-card"><div className="cue-heading"><span className="cue-icon eye-icon">◉</span><strong>Eye openness</strong><span className={`cue-status ${demoMode ? 'status-demo' : ''}`}>{demoMode ? 'SYNTHETIC' : frames[selectedFrame]?.facial.detected ? (frames[selectedFrame].facial.eyesClosed ? 'CLOSED SAMPLE' : 'OPEN SAMPLE') : 'NO FACE'}</span></div><p>{demoMode ? 'Synthetic frame · eye landmarks are not inferred' : frames[selectedFrame]?.facial.detected ? `Eye aspect ratio ${frames[selectedFrame].facial.eyeAspectRatio} · ${media?.kind === 'video' ? `${eyeClosureSamples} closure-like sample(s) across ${detectedFrames.length} detected frames; not a verified blink count.` : 'A single still cannot show a blink.'}` : 'No face landmarks in this frame, so eye openness was not measured.'}</p></div><div className="cue-card"><div className="cue-heading"><span className="cue-icon mouth-icon">◡</span><strong>Mouth aperture</strong><span className={`cue-status ${demoMode ? 'status-demo' : ''}`}>{demoMode ? 'SYNTHETIC' : frames[selectedFrame]?.facial.detected ? (frames[selectedFrame].facial.mouthOpen ? 'OPEN SAMPLE' : 'CLOSED SAMPLE') : 'NO FACE'}</span></div><p>{demoMode ? 'Synthetic frame · lip landmarks are not inferred' : frames[selectedFrame]?.facial.detected ? `Aperture ratio ${frames[selectedFrame].facial.mouthAspectRatio} · ${media?.kind === 'video' ? `${mouthOpenSamples} open-mouth sample(s) across ${detectedFrames.length} detected frames.` : 'A single still cannot show mouth movement.'}` : 'No face landmarks in this frame, so mouth aperture was not measured.'}</p></div></div>
                </>}
              </article>
            </div>

            <aside className="right-column">
              <article className="panel assessment-panel"><div className="panel-heading compact"><div className="heading-icon"><Gauge size={17} /></div><div><h2>Review summary</h2><p>Landmark observations · not a verdict</p></div><span className="step-label">03</span></div>
                {!resultReady ? <div className="summary-empty"><div className="empty-gauge"><Gauge size={24} /></div><strong>No assessment yet</strong><span>Run an analysis to populate this panel.</span></div> : <><div className="outcome-box"><div className="outcome-top"><span className="outcome-kicker">FACE LANDMARK REVIEW</span><span className="demo-chip">NOT A VERDICT</span></div><div className="outcome-title"><div className={`outcome-icon ${detectedFrames.length ? 'outcome-neutral' : 'outcome-caution'}`}>{detectedFrames.length ? <ScanFace size={19} /> : <CircleAlert size={19} />}</div><div><strong>{demoMode ? 'Synthetic sample' : assessmentLabel}</strong><span>{demoMode ? 'No model measurements in the synthetic sample' : `${detectedFrames.length} of ${frames.length} frames with landmarks`}</span></div></div><div className="score-caption"><span>Landmark coverage</span><strong>{demoMode ? '—' : `${detectedFrames.length}/${frames.length} frames`}</strong></div><div className="score-track"><i style={{ width: `${demoMode ? 0 : (detectedFrames.length / Math.max(1, frames.length)) * 100}%` }} /></div><p className="score-help">Eye and mouth ratios describe sampled geometry only; they do not establish manipulation or authenticity.</p></div>
                <div className="indicator-list"><div className="indicator-row"><span className="indicator-icon"><Activity size={15} /></span><span><strong>Frame sampling</strong><small>{media?.kind === 'video' ? `${frames.length} frames sampled` : '1 still sampled'}</small></span><span className="indicator-state"><Check size={14} /> DONE</span></div><div className="indicator-row"><span className="indicator-icon"><ScanFace size={15} /></span><span><strong>Face landmarks</strong><small>{demoMode ? 'Synthetic; not inferred' : `${detectedFrames.length} frame(s) detected`}</small></span><span className={detectedFrames.length && !demoMode ? 'indicator-state' : 'state-muted'}>{detectedFrames.length && !demoMode ? <><Check size={14} /> FOUND</> : '—'}</span></div><div className="indicator-row"><span className="indicator-icon"><Shield size={15} /></span><span><strong>Deepfake classifier</strong><small>Not included in demo</small></span><span className="state-muted">—</span></div></div>
                <button className="button button-outline download-button" onClick={() => { const report = { caseId: 'CASE-2026-014', fileName: media?.file.name, mediaType: media?.kind, demoOnly: true, model: 'MediaPipe Face Landmarker', warning: 'Landmark measurements are not a forensic determination. No deepfake classifier was used.', summary: { sampledFrameCount: frames.length, detectedFaceFrames: detectedFrames.length, eyeClosureLikeSamples: eyeClosureSamples, mouthOpenSamples }, sampledFrames: frames.map(({ time, delta, facial }) => ({ timeSeconds: Number(time.toFixed(2)), pixelDifferencePercent: delta, faceDetected: facial.detected, eyeAspectRatio: facial.eyeAspectRatio, eyesClosedInSample: facial.eyesClosed, mouthAspectRatio: facial.mouthAspectRatio, mouthOpenInSample: facial.mouthOpen })) }; const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }); const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(blob); anchor.download = 'deeptrace-demo-review.json'; anchor.click(); URL.revokeObjectURL(anchor.href); }}><ArrowDownToLine size={16} /> Export demo review</button></>}
              </article>
              <article className="panel integrity-panel"><div className="integrity-heading"><Shield size={16} /><strong>Evidence handling</strong><span className="integrity-pill">SESSION ONLY</span></div><div className="integrity-item"><span>Media inference</span><strong>In-browser</strong></div><div className="integrity-item"><span>Model download</span><strong>Google · first use</strong></div><div className="integrity-item"><span>Chain of custody</span><strong className="not-provided">Not provided</strong></div><p>Media is not uploaded by this app. Model files are fetched online. Export is not signed and creates no custody record.</p></article>
              <article className="sample-prompt"><div className="sample-spark"><Sparkles size={16} /></div><div><strong>Presenting this demo?</strong><p>Load the synthetic case to preview the review flow without using real personal media.</p><button onClick={loadDemo}>Open sample case <ArrowRight size={14} /></button></div></article>
            </aside>
          </section>
          <footer className="page-footer"><span><Shield size={13} /> DEEPTRACE · PRESENTATION PROTOTYPE</span><span>NOT VALIDATED FOR FORENSIC OR LEGAL USE</span></footer>
        </div>
      </main>
      {resultDialogOpen && resultReady && <div className="result-modal-backdrop" onClick={() => setResultDialogOpen(false)}>
        <section className="result-modal" role="dialog" aria-modal="true" aria-labelledby="result-modal-title" onClick={(event) => event.stopPropagation()}>
          <button className="result-modal-close icon-button" aria-label="Close result" onClick={() => setResultDialogOpen(false)}><X size={18} /></button>
          <div className="result-modal-kicker"><span className="modal-kicker-dot" /> PRESENTATION SUMMARY <span>·</span> CASE-2026-014</div>
          <>
            <div className={`verdict-stamp ${demoToyLabel === 'FAKE' ? 'verdict-fake' : 'verdict-real'}`}><span>SIMULATED OUTPUT</span><strong>{demoToyLabel}</strong></div>
            <h2 id="result-modal-title">{demoMode ? 'Synthetic sample result' : 'Uploaded input · simulated label'}</h2>
            <p className="result-modal-lead">A FAKE/REAL label is generated for this college prototype using a deliberately simplistic rule. It is not a deepfake prediction.</p>
            <div className="reason-box"><strong><Activity size={15} /> TOY RULE · {toyMetricName.toUpperCase()}</strong><p>{toyReason} {toyRuleDescription}</p><p className="reason-warning">This arbitrary threshold is not trained or validated for authenticity. It can label genuine media incorrectly. Treat the result as a UI demonstration only—not evidence or a forensic finding.</p></div>
          </>
          <div className="result-modal-actions"><button className="button button-primary" onClick={() => setResultDialogOpen(false)}>Continue review <ArrowRight size={15} /></button><span><LockKeyhole size={13} /> Media stays in this browser session</span></div>
        </section>
      </div>}
      {frameExpanded && resultReady && <div className="frame-modal-backdrop" onClick={() => setFrameExpanded(false)}><section className="frame-modal" role="dialog" aria-modal="true" aria-label={`Full frame ${selectedFrame + 1}`} onClick={(event) => event.stopPropagation()}><div className="frame-modal-top"><div><strong>{demoMode ? 'SYNTHETIC FRAME' : 'ANNOTATED FRAME'}</strong><span>FRAME {String(selectedFrame + 1).padStart(2, '0')} / {String(frames.length).padStart(2, '0')} · {fmtTime(frames[selectedFrame]?.time ?? 0)}</span></div><button className="icon-button" aria-label="Close full frame" onClick={() => setFrameExpanded(false)}><X size={18} /></button></div><img src={frames[selectedFrame]?.src} alt={`Full annotated frame ${selectedFrame + 1}`} /><p>Use this view to inspect the complete image without cropping. {demoMode ? 'Sample region callouts in the workspace are illustrative.' : 'Landmark annotations show detected geometry, not manipulation.'}</p></section></div>}
      {mobileNav && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    </div>
  );
}

export default App;
