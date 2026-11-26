import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { analyzeCanvas, loadFaceLandmarker, type AnalyzedFrame } from './faceAnalysis';
import {
  Activity, ArrowDownToLine, ArrowRight, Check, ChevronDown,
  CircleAlert, Clock3, FileImage, FileVideo2, Fingerprint, FolderOpen, Gauge, Maximize2,
  Image as ImageIcon, LockKeyhole, Menu, RotateCcw, ScanFace, Shield,
  Upload, X,
} from 'lucide-react';

type MediaKind = 'video' | 'image';
type FrameRecord = AnalyzedFrame;
type CaseMedia = { file: File; kind: MediaKind; url: string };
type Verdict = 'FAKE' | 'REAL';
type ExplanationCase = { id: string; title: string; exampleConfidence: number; explanation: string; observations: { name: string; value: string; score: number | null }[] };

const REFERENCE_EXPLANATIONS: Record<Verdict, Omit<ExplanationCase, 'observations'>[]> = {
  FAKE: [
    { id: 'fake-boundary', title: 'Facial boundary inconsistencies', exampleConfidence: 96.4, explanation: 'The video has been classified as FAKE because the analysis indicates inconsistencies around the facial boundaries. The face region appears to have different visual characteristics compared to the surrounding skin and background. Such inconsistencies can occur when a generated or manipulated face is blended into an original video.\n\nThe SHAP-based explanation for this example assigns higher importance to facial boundary and texture-related features. These features contribute positively towards the FAKE prediction. The model’s learned patterns suggest that the facial region does not completely match the natural characteristics expected in an authentic video.' },
    { id: 'fake-texture', title: 'Unnatural facial texture', exampleConfidence: 93.8, explanation: 'The video is classified as FAKE due to unusual facial texture patterns. The face contains areas that appear excessively smooth or have inconsistent skin details compared to surrounding regions.\n\nThe model identifies these texture variations as important indicators. In the SHAP analysis, texture-related features contribute significantly towards the FAKE classification. Deepfake generation techniques may introduce inconsistencies in skin details, pores, and fine facial structures, which can be learned by the detection model.' },
    { id: 'fake-lighting', title: 'Irregular lighting and shadows', exampleConfidence: 91.7, explanation: 'The video has been identified as potentially manipulated because of irregular lighting patterns across the facial region. Certain facial areas may exhibit lighting or shadow characteristics that do not appear consistent with the overall scene.\n\nSHAP highlights lighting-sensitive and spatial image features as contributors to the FAKE prediction. This may indicate that the generated facial region does not perfectly reproduce the lighting conditions of the original environment.' },
    { id: 'fake-features', title: 'Facial feature distortion', exampleConfidence: 97.2, explanation: 'The video is classified as FAKE because the model identifies unusual patterns in facial structures. Certain facial components, such as the eyes, nose, and mouth, may contain subtle distortions or unnatural visual relationships.\n\nThe SHAP explanation indicates that facial structure-related features have a strong influence on the classification. These irregularities may result from face reconstruction or blending processes used during deepfake generation.' },
    { id: 'fake-reconstruction', title: 'Image reconstruction artifacts', exampleConfidence: 95.1, explanation: 'The video has been classified as FAKE based on suspicious image reconstruction patterns. The analysis may reveal irregularities in fine image details, edges, and frequency-related information.\n\nFeatures associated with image noise and reconstruction artifacts contribute towards the FAKE prediction in this example. Deepfake generation models can introduce subtle artifacts that are difficult to identify through ordinary visual inspection but may be recognized by CNN-based detection models.' },
  ],
  REAL: [
    { id: 'real-texture', title: 'Natural facial texture', exampleConfidence: 98.1, explanation: 'The video has been classified as REAL because the facial region demonstrates natural texture characteristics. Skin details, fine facial patterns, and surrounding image structures appear consistent with the visual patterns learned by the model from authentic videos.\n\nSHAP analysis indicates that facial texture-related features contribute towards the REAL prediction. The absence of strong manipulation-associated patterns supports the model’s classification of the video as authentic.' },
    { id: 'real-boundary', title: 'Consistent facial boundaries', exampleConfidence: 96.9, explanation: 'The video is classified as REAL because the facial boundaries appear visually consistent with the surrounding environment. There are no significant indications of unusual blending or inconsistent facial edges in the analyzed image features.\n\nThe SHAP explanation shows that boundary-related features contribute towards the REAL classification. The model recognizes these patterns as being more consistent with authentic facial images than manipulated facial regions.' },
    { id: 'real-lighting', title: 'Consistent lighting distribution', exampleConfidence: 97.5, explanation: 'The video has been classified as REAL because the facial lighting patterns are consistent with the surrounding scene. The distribution of highlights and shadows appears compatible with the overall image characteristics.\n\nSHAP identifies spatial and lighting-related features as important contributors to the REAL prediction. These features suggest that the analyzed face follows patterns commonly observed in authentic video frames.' },
    { id: 'real-details', title: 'Authentic facial details', exampleConfidence: 99.1, explanation: 'The model identifies natural facial details and structural consistency throughout the analyzed region. Important facial components retain realistic visual characteristics without strong indications of artificial reconstruction.\n\nAccording to the illustrative SHAP explanation, facial structure, local texture, and fine-grained image features contribute towards the REAL classification. These characteristics are more aligned with the model’s learned representation of authentic facial content.' },
    { id: 'real-low-indicators', title: 'Low manipulation indicators', exampleConfidence: 94.6, explanation: 'The video has been classified as REAL because the analyzed frame does not exhibit strong patterns commonly associated with manipulated facial content. The image maintains relatively consistent texture, structure, and visual characteristics.\n\nSHAP-based feature attribution indicates that the extracted features collectively support the REAL prediction. The model finds the analyzed content more similar to authentic samples in its training distribution than to manipulated samples.' },
  ],
};

function chooseExplanation(verdict: Verdict, kind: MediaKind, frames: FrameRecord[]): ExplanationCase {
  const detected = frames.filter((frame) => frame.facial.detected);
  const closedEyeFrames = detected.filter((frame) => frame.facial.eyesClosed).length;
  const openMouthFrames = detected.filter((frame) => frame.facial.mouthOpen).length;
  const pixelChanges = kind === 'video' ? frames.slice(1).map((frame) => frame.delta) : [];
  const meanChange = pixelChanges.length ? pixelChanges.reduce((sum, value) => sum + value, 0) / pixelChanges.length : null;
  const peakChange = pixelChanges.length ? Math.max(...pixelChanges) : null;
  const coverage = frames.length ? detected.length / frames.length : 0;
  const eyeRate = detected.length ? closedEyeFrames / detected.length : 0;
  const mouthRate = detected.length ? openMouthFrames / detected.length : 0;
  const options = REFERENCE_EXPLANATIONS[verdict];
  const reference = options[Math.floor(Math.random() * options.length)];
  return {
    id: `${verdict.toLowerCase()}-${kind}-${Math.random().toString(36).slice(2, 8)}`,
    title: reference.title,
    exampleConfidence: reference.exampleConfidence,
    explanation: reference.explanation,
    observations: [
      { name: 'Face landmark coverage', value: `${detected.length}/${frames.length} frames`, score: Math.round(coverage * 100) },
      { name: 'Eye-closure-like samples', value: kind === 'video' ? `${closedEyeFrames}/${detected.length} faces` : 'Single frame', score: kind === 'video' && detected.length ? Math.round(eyeRate * 100) : null },
      { name: 'Open-mouth samples', value: kind === 'video' ? `${openMouthFrames}/${detected.length} faces` : 'Single frame', score: kind === 'video' && detected.length ? Math.round(mouthRate * 100) : null },
      { name: 'Mean pixel difference', value: meanChange === null ? 'N/A' : `${meanChange.toFixed(1)}%`, score: meanChange === null ? null : Math.round(meanChange) },
      { name: 'Peak pixel difference', value: peakChange === null ? 'N/A' : `${peakChange}%`, score: peakChange === null ? null : Math.round(peakChange) },
    ],
  };
}

function scoreForMedia(kind: MediaKind, frames: FrameRecord[]): number {
  if (kind === 'image') {
    const face = frames.find((frame) => frame.facial.detected);
    return face?.facial.mouthAspectRatio == null ? 55 : Math.round(face.facial.mouthAspectRatio * 100);
  }
  return frames.length > 1 ? Math.max(...frames.slice(1).map((frame) => frame.delta)) : 0;
}

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

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<CaseMedia | null>(null);
  const [frames, setFrames] = useState<FrameRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [analysisStage, setAnalysisStage] = useState('Preparing local analysis');
  const [resultReady, setResultReady] = useState(false);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const [selectedExplanation, setSelectedExplanation] = useState<ExplanationCase | null>(null);
  const [frameExpanded, setFrameExpanded] = useState(false);
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
    setSelectedExplanation(null);
    setFrameExpanded(false);
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
    let analyzedFrames: FrameRecord[] = [];
    try {
      const landmarker = await loadFaceLandmarker(setAnalysisStage);
      modelLoaded = true;
      if (media?.kind === 'video') {
        setAnalysisStage('Sampling frames and measuring facial landmarks');
        analyzedFrames = await sampleVideo(media.file, landmarker, setProgress);
        setFrames(analyzedFrames);
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
        analyzedFrames = [analyzeCanvas(canvas, landmarker, 0, 0)];
        setFrames(analyzedFrames);
      }
      if (media) {
        const verdict: Verdict = scoreForMedia(media.kind, analyzedFrames) >= 35 ? 'FAKE' : 'REAL';
        const explanation = chooseExplanation(verdict, media.kind, analyzedFrames);
        setSelectedExplanation(explanation);
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

  const reset = () => {
    if (media?.url) URL.revokeObjectURL(media.url);
    setMedia(null); setFrames([]); setResultReady(false); setResultDialogOpen(false); setFrameExpanded(false); setBusy(false); setProgress(0); setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const detectedFrames = frames.filter((frame) => frame.facial.detected);
  const demoPixelOutlier = frames.length > 1 ? Math.max(...frames.slice(1).map((frame) => frame.delta)) : 0;
  const uploadedStillMouthScore = detectedFrames[0]?.facial.mouthAspectRatio === null || !detectedFrames[0]
    ? 55
    : Math.round(detectedFrames[0].facial.mouthAspectRatio * 100);
  const toyMetric = media?.kind === 'image' ? uploadedStillMouthScore : demoPixelOutlier;
  const demoToyLabel = toyMetric >= 35 ? 'FAKE' : 'REAL';
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
  const nav = <><a className="nav-item active" href="#workspace"><Activity size={17} /> Workspace</a><a className="nav-item" href="#evidence"><FolderOpen size={17} /> Evidence review</a><a className="nav-item" href="#fusion"><Activity size={17} /> Fusion blueprint</a></>;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#workspace" aria-label="DeepTrace home"><span className="brand-mark"><ScanFace size={22} /></span><span>deep<span className="brand-light">trace</span><small>FORENSIC MEDIA LAB</small></span></a>
        <div className="case-select"><span className="case-icon"><Fingerprint size={17} /></span><span><small>ACTIVE CASE</small><strong>CASE-2026-014</strong></span><ChevronDown size={15} /></div>
        <div className="side-label">ANALYSIS</div>
        <nav onClick={() => setMobileNav(false)}>{nav}</nav>
        <div className="sidebar-bottom">
          <div className="profile"><div className="avatar">DT</div><div><strong>DeepTrace</strong><span>Media review</span></div></div>
        </div>
      </aside>

      <main className="main-content" id="workspace">
        <header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMobileNav(!mobileNav)} aria-label="Toggle navigation"><Menu size={19} /></button><div className="crumb">Workspace <span>/</span> <b>New analysis</b></div><div className="topbar-right"><span className="local-indicator"><i /> LOCAL SESSION</span><button className="icon-button" title="Reset workspace" onClick={reset}><RotateCcw size={17} /></button></div></header>
        <div className="page-wrap">
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> DEEPTRACE <span className="version-tag">MEDIA ANALYSIS</span></div><h1>See what the frame sees.</h1><p>Upload a photo or video. Reveal the details.</p></div><div className="case-chip"><Fingerprint size={16} /><span>CASE-2026-014</span></div></section>

          <section className="workspace-grid">
            <div className="left-column">
              <article className="panel intake-panel">
                <div className="panel-heading"><div className="heading-icon"><Upload size={17} /></div><div><h2>Choose your media</h2><p>Video or image</p></div><span className="step-label">01</span></div>
                {!media ? <div className={`drop-zone ${dragging ? 'drop-active' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
                  <div className="upload-symbol"><Upload size={21} /></div><h3>Drop your evidence</h3><p>Video or still image</p><button className="button button-secondary" onClick={() => inputRef.current?.click()}><FolderOpen size={16} /> Browse files</button><input ref={inputRef} className="sr-only" type="file" accept="video/*,image/*" onChange={onInput} /><div className="file-types"><span><FileVideo2 size={14} /> MP4 · MOV · WEBM</span><span><FileImage size={14} /> JPG · PNG · WEBP</span><span>MAX 200 MB</span></div>
                </div> : <div className="media-loaded"><div className="media-file-icon">{media.kind === 'video' ? <FileVideo2 size={20} /> : <FileImage size={20} />}</div><div className="media-meta"><strong>{media.file.name}</strong><span>{media.kind === 'video' ? 'Video' : 'Image'} · {(media.file.size / (1024 * 1024)).toFixed(2)} MB</span></div><button className="icon-button remove-button" onClick={reset} aria-label="Remove media"><X size={17} /></button></div>}
                {error && <div className="error-message"><CircleAlert size={15} />{error}</div>}
                <div className="intake-actions"><button className="button button-primary" disabled={!media || busy} onClick={runAnalysis}>{busy ? <><span className="spinner" /> Analyzing…</> : <><ScanFace size={16} /> Analyze media <ArrowRight size={15} /></>}</button></div>
                {busy && <div className="progress-wrap"><div className="progress-caption"><span>{analysisStage}</span><span>{progress}%</span></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div></div>}
              </article>

              <article className="panel evidence-panel" id="evidence">
                <div className="panel-heading"><div className="heading-icon"><ScanFace size={17} /></div><div><h2>Visual evidence</h2><p>{resultReady ? `${frames.length} ${media?.kind === 'video' ? 'sampled frames' : 'still image'} · face & region analysis` : 'Face, eye, and mouth analysis will appear here'}</p></div><span className="step-label">02 / REVIEW</span></div>
                {!resultReady ? <div className="empty-evidence"><div className="empty-art"><div className="art-frame"><ScanFace size={36} strokeWidth={1} /></div><span className="art-dot dot-one" /><span className="art-dot dot-two" /><span className="art-line" /></div><strong>Ready to analyze</strong><span>Choose an image or video to begin.</span></div> : <>
                  <div className="frame-viewer"><div className="frame-main"><img src={frames[selectedFrame]?.src} alt={`Sampled frame ${selectedFrame + 1}`} /><div className="frame-overlay-label"><span className="rec-dot" /> FRAME {String(selectedFrame + 1).padStart(2, '0')}</div><button className="frame-expand-button" onClick={() => setFrameExpanded(true)} aria-label="Expand full frame" title="View full frame"><Maximize2 size={14} /></button></div><div className="frame-info"><span>FRAME</span><strong>{String(selectedFrame + 1).padStart(2, '0')} <i>/</i> {String(frames.length).padStart(2, '0')}</strong><span className="timecode"><Clock3 size={13} /> {fmtTime(frames[selectedFrame]?.time ?? 0)}</span></div></div>
                  <div className="filmstrip">{frames.map((frame, index) => <button key={`${frame.time}-${index}`} className={`film-frame ${selectedFrame === index ? 'film-selected' : ''}`} onClick={() => setSelectedFrame(index)} aria-label={`Select frame ${index + 1}`}><img src={frame.src} alt="" /><span>{fmtTime(frame.time)}</span></button>)}</div>
                  {media?.kind === 'video' ? <div className="comparison-block"><div className="subheading"><span>FRAME-TO-FRAME CHANGE</span><span className="neutral-key"><i /> Pixel difference · not a face signal</span></div><div className="change-chart">{frames.map((frame, index) => <button key={`bar-${index}`} onClick={() => setSelectedFrame(index)} className={`chart-column ${selectedFrame === index ? 'chart-selected' : ''}`} title={`Frame ${index + 1}: ${frame.delta}% sampled pixel difference`}><span className="bar-value">{frame.delta}%</span><i style={{ height: `${Math.max(4, Math.min(100, frame.delta * 1.65))}%` }} /><small>{String(index + 1).padStart(2, '0')}</small></button>)}</div>{detectedFrames.length > 1 && <div className="signal-chart"><div className="subheading"><span>FACIAL REGION SIGNALS</span><span className="signal-legend"><i className="eye-key" /> Eye ratio <i className="mouth-key" /> Mouth ratio</span></div><svg className="signal-svg" viewBox="0 0 360 96" preserveAspectRatio="none" role="img" aria-label="Eye openness and mouth aperture ratios across sampled frames"><path className="signal-grid" d="M0 18H360 M0 53H360 M0 88H360" /><path className="selected-frame-line" d={`M${frames.length > 1 ? (selectedFrame / (frames.length - 1)) * 360 : 180} 8V90`} /><polyline className="eye-line" points={signalPoints('eyeAspectRatio', 0.4)} /><polyline className="mouth-line" points={signalPoints('mouthAspectRatio', 0.55)} />{frames.map((frame, index) => { if (!frame.facial.detected) return null; const x = frames.length > 1 ? (index / (frames.length - 1)) * 360 : 180; const eyeY = 88 - (Math.min(0.4, frame.facial.eyeAspectRatio ?? 0) / 0.4) * 70; const mouthY = 88 - (Math.min(0.55, frame.facial.mouthAspectRatio ?? 0) / 0.55) * 70; return <g key={`signal-${index}`}><circle className="eye-point" cx={x} cy={eyeY} r="2.7" /><circle className="mouth-point" cx={x} cy={mouthY} r="2.7" /></g>; })}</svg></div>}<div className="chart-footnote">A large pixel change may come from camera motion, lighting, scene cuts, compression, or ordinary movement.</div></div> : <div className="still-note"><ImageIcon size={15} /> A still image has no temporal information. Blink and mouth movement cannot be evaluated from one frame.</div>}
                  <div className="cue-row"><div className="cue-card"><div className="cue-heading"><span className="cue-icon eye-icon">◉</span><strong>Eye openness</strong><span className="cue-status">{frames[selectedFrame]?.facial.detected ? (frames[selectedFrame].facial.eyesClosed ? 'CLOSED' : 'OPEN') : 'NO FACE'}</span></div><p>{frames[selectedFrame]?.facial.detected ? `Ratio ${frames[selectedFrame].facial.eyeAspectRatio} · ${media?.kind === 'video' ? `${eyeClosureSamples} closure-like samples.` : 'Single frame; blink unavailable.'}` : 'No eye landmarks in this frame.'}</p></div><div className="cue-card"><div className="cue-heading"><span className="cue-icon mouth-icon">◡</span><strong>Mouth aperture</strong><span className="cue-status">{frames[selectedFrame]?.facial.detected ? (frames[selectedFrame].facial.mouthOpen ? 'OPEN' : 'CLOSED') : 'NO FACE'}</span></div><p>{frames[selectedFrame]?.facial.detected ? `Ratio ${frames[selectedFrame].facial.mouthAspectRatio} · ${media?.kind === 'video' ? `${mouthOpenSamples} open-mouth samples.` : 'Single frame; motion unavailable.'}` : 'No lip landmarks in this frame.'}</p></div></div>
                </>}
              </article>
            </div>

            <aside className="right-column">
              <article className="panel assessment-panel"><div className="panel-heading compact"><div className="heading-icon"><Gauge size={17} /></div><div><h2>Review summary</h2><p>Face analysis</p></div><span className="step-label">03</span></div>
                {!resultReady ? <div className="summary-empty"><div className="empty-gauge"><Gauge size={24} /></div><strong>Ready when you are</strong><span>Choose media to begin.</span></div> : <><div className="outcome-box"><div className="outcome-top"><span className="outcome-kicker">BASED ON RESULTS</span><span className="demo-chip">RESULT</span></div><div className="outcome-title"><div className={`outcome-icon ${detectedFrames.length ? 'outcome-neutral' : 'outcome-caution'}`}>{detectedFrames.length ? <ScanFace size={19} /> : <CircleAlert size={19} />}</div><div><strong>{assessmentLabel}</strong><span>{`${detectedFrames.length} of ${frames.length} frames`}</span></div></div><div className="score-caption"><span>Landmark coverage</span><strong>{`${detectedFrames.length}/${frames.length}`}</strong></div><div className="score-track"><i style={{ width: `${(detectedFrames.length / Math.max(1, frames.length)) * 100}%` }} /></div><p className="score-help">Review result from analyzed media.</p></div>
                <div className="indicator-list"><div className="indicator-row"><span className="indicator-icon"><Activity size={15} /></span><span><strong>Frames</strong><small>{media?.kind === 'video' ? `${frames.length} sampled` : '1 image'}</small></span><span className="indicator-state"><Check size={14} /> DONE</span></div><div className="indicator-row"><span className="indicator-icon"><ScanFace size={15} /></span><span><strong>Faces</strong><small>{`${detectedFrames.length} detected`}</small></span><span className={detectedFrames.length ? 'indicator-state' : 'state-muted'}>{detectedFrames.length ? <><Check size={14} /> FOUND</> : '—'}</span></div><div className="indicator-row"><span className="indicator-icon"><Shield size={15} /></span><span><strong>Review status</strong><small>{assessmentLabel}</small></span><span className="state-muted">READY</span></div></div>
                <button className="button button-outline download-button" onClick={() => { const report = { caseId: 'CASE-2026-014', fileName: media?.file.name, mediaType: media?.kind, demoOnly: true, model: 'MediaPipe Face Landmarker', warning: 'The displayed label follows a prototype rule, not a deepfake-authenticity model.', explanation: selectedExplanation ? { title: selectedExplanation.title, exampleConfidencePercent: selectedExplanation.exampleConfidence, text: selectedExplanation.explanation, measuredCues: selectedExplanation.observations, note: 'Reference narrative and example confidence from the supplied case descriptions; not generated by this analysis.' } : null, summary: { sampledFrameCount: frames.length, detectedFaceFrames: detectedFrames.length, eyeClosureLikeSamples: eyeClosureSamples, mouthOpenSamples }, sampledFrames: frames.map(({ time, delta, facial }) => ({ timeSeconds: Number(time.toFixed(2)), pixelDifferencePercent: delta, faceDetected: facial.detected, eyeAspectRatio: facial.eyeAspectRatio, eyesClosedInSample: facial.eyesClosed, mouthAspectRatio: facial.mouthAspectRatio, mouthOpenInSample: facial.mouthOpen })) }; const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }); const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(blob); anchor.download = 'deeptrace-demo-review.json'; anchor.click(); URL.revokeObjectURL(anchor.href); }}><ArrowDownToLine size={16} /> Export demo review</button></>}
              </article>
              <article className="panel fusion-panel" id="fusion"><div className="fusion-heading"><div className="heading-icon"><Activity size={17} /></div><div><h2>Multimodal fusion</h2><p>Pipeline blueprint</p></div><span className="fusion-threshold">0.53</span></div><div className="fusion-streams"><div className="fusion-stream"><span className="stream-node original-node">01</span><div><strong>Original stream</strong><small>Frame appearance features</small></div></div><div className="fusion-stream"><span className="stream-node pca-node">02</span><div><strong>PCA features</strong><small>Compact variance patterns</small></div></div><div className="fusion-stream"><span className="stream-node noise-node">03</span><div><strong>Enhanced Noise Analysis</strong><small>Noise-residual inconsistencies</small></div></div></div><div className="fusion-merge"><span /><span /><span /><i /></div><div className="fusion-output"><div><strong>Feature fusion</strong><small>Combine stream signals</small></div><ArrowRight size={16} /><b>REVIEW SCORE</b></div><div className="fusion-foot"><span>FUSION THRESHOLD</span><strong>0.53</strong><span className="fusion-blueprint-tag">BLUEPRINT</span></div></article>
            </aside>
          </section>
          <footer className="page-footer"><span><Shield size={13} /> DEEPTRACE</span><span>MEDIA REVIEW</span></footer>
        </div>
      </main>
      {resultDialogOpen && resultReady && <div className="result-modal-backdrop" onClick={() => setResultDialogOpen(false)}>
        <section className="result-modal" role="dialog" aria-modal="true" aria-labelledby="result-modal-title" onClick={(event) => event.stopPropagation()}>
          <button className="result-modal-close icon-button" aria-label="Close result" onClick={() => setResultDialogOpen(false)}><X size={18} /></button>
          <div className="result-modal-kicker"><span className="modal-kicker-dot" /> PRESENTATION SUMMARY <span>·</span> CASE-2026-014</div>
          <div className={`verdict-stamp ${demoToyLabel === 'FAKE' ? 'verdict-fake' : 'verdict-real'}`}><span>BASED ON RESULTS</span><strong>{demoToyLabel}</strong></div>
          <h2 id="result-modal-title">Analysis complete</h2>
          {selectedExplanation && <article className="random-explanation"><div className="random-explanation-top"><span>REFERENCE CASE</span><span>EXAMPLE CONFIDENCE <b>{selectedExplanation.exampleConfidence.toFixed(1)}%</b></span></div><h3>{selectedExplanation.title}</h3><p className="reference-explanation">{selectedExplanation.explanation}</p><small className="reference-note">Reference explanation and example confidence; not generated by the current analysis.</small><div className="contribution-heading"><strong>MEASURED CUES</strong><span>FROM THIS INPUT</span></div><div className="contribution-list">{selectedExplanation.observations.map((observation) => <div className="contribution-row" key={observation.name}><span className="contribution-name">{observation.name}</span><div className="contribution-track"><i style={{ width: `${observation.score ?? 0}%` }} /></div><strong>{observation.value}</strong></div>)}</div></article>}
          <div className="result-modal-actions"><button className="button button-primary" onClick={() => setResultDialogOpen(false)}>View analysis <ArrowRight size={15} /></button><span><LockKeyhole size={13} /> On-device</span></div>
        </section>
      </div>}
      {frameExpanded && resultReady && <div className="frame-modal-backdrop" onClick={() => setFrameExpanded(false)}><section className="frame-modal" role="dialog" aria-modal="true" aria-label={`Full frame ${selectedFrame + 1}`} onClick={(event) => event.stopPropagation()}><div className="frame-modal-top"><div><strong>ANNOTATED FRAME</strong><span>FRAME {String(selectedFrame + 1).padStart(2, '0')} / {String(frames.length).padStart(2, '0')} · {fmtTime(frames[selectedFrame]?.time ?? 0)}</span></div><button className="icon-button" aria-label="Close full frame" onClick={() => setFrameExpanded(false)}><X size={18} /></button></div><img src={frames[selectedFrame]?.src} alt={`Full annotated frame ${selectedFrame + 1}`} /><p>Landmarks show geometry only.</p></section></div>}
      {mobileNav && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    </div>
  );
}

export default App;
