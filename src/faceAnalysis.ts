import { FaceLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';

export type FacialMetrics = {
  detected: boolean;
  eyeAspectRatio: number | null;
  mouthAspectRatio: number | null;
  eyesClosed: boolean | null;
  mouthOpen: boolean | null;
};

export type AnalyzedFrame = {
  time: number;
  src: string;
  delta: number;
  facial: FacialMetrics;
};

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
let landmarkerPromise: Promise<FaceLandmarker> | null = null;

export function loadFaceLandmarker(onProgress?: (label: string) => void): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      onProgress?.('Loading on-device face landmark model');
      const fileset = { wasmLoaderPath, wasmBinaryPath };
      const options = {
        runningMode: 'IMAGE',
        numFaces: 1,
        minFaceDetectionConfidence: 0.45,
        minFacePresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      } as const;
      try {
        return await FaceLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        });
      } catch {
        return FaceLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
        });
      }
    })().catch((error: unknown) => {
      landmarkerPromise = null;
      throw error;
    });
  }
  return landmarkerPromise;
}

const distance = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot(a.x - b.x, a.y - b.y);
const ratio = (points: NormalizedLandmark[], vertical: [number, number], horizontal: [number, number]) => {
  const width = distance(points[horizontal[0]], points[horizontal[1]]);
  return width > 0 ? distance(points[vertical[0]], points[vertical[1]]) / width : 0;
};

function paintFaceOverlay(context: CanvasRenderingContext2D, points: NormalizedLandmark[], width: number, height: number) {
  const drawConnections = (connections: { start: number; end: number }[], color: string, lineWidth: number) => {
    context.beginPath();
    for (const connection of connections) {
      const start = points[connection.start];
      const end = points[connection.end];
      if (!start || !end) continue;
      context.moveTo(start.x * width, start.y * height);
      context.lineTo(end.x * width, end.y * height);
    }
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.stroke();
  };

  drawConnections(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, 'rgba(126, 238, 190, 0.82)', Math.max(1.3, width / 380));
  drawConnections(FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, '#9de9ca', Math.max(1.5, width / 290));
  drawConnections(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, '#9de9ca', Math.max(1.5, width / 290));
  drawConnections(FaceLandmarker.FACE_LANDMARKS_LIPS, '#ffb57d', Math.max(1.7, width / 250));

  const minX = Math.min(...points.map((point) => point.x)) * width;
  const maxX = Math.max(...points.map((point) => point.x)) * width;
  const minY = Math.min(...points.map((point) => point.y)) * height;
  const maxY = Math.max(...points.map((point) => point.y)) * height;
  const padX = Math.max(4, (maxX - minX) * 0.035);
  const padY = Math.max(4, (maxY - minY) * 0.025);
  context.setLineDash([6, 4]);
  context.strokeStyle = 'rgba(142, 229, 187, 0.9)';
  context.lineWidth = Math.max(1, width / 500);
  context.strokeRect(minX - padX, minY - padY, maxX - minX + padX * 2, maxY - minY + padY * 2);
  context.setLineDash([]);

  for (const landmarkIndex of [33, 133, 159, 145, 362, 263, 386, 374, 61, 291, 13, 14]) {
    const point = points[landmarkIndex];
    if (!point) continue;
    context.beginPath();
    context.arc(point.x * width, point.y * height, Math.max(2, width / 220), 0, Math.PI * 2);
    context.fillStyle = landmarkIndex === 13 || landmarkIndex === 14 || landmarkIndex === 61 || landmarkIndex === 291 ? '#ffb57d' : '#c4ffe1';
    context.fill();
  }

  const labelY = Math.max(14, minY - padY - 5);
  context.font = `bold ${Math.max(10, Math.round(width / 52))}px monospace`;
  context.fillStyle = '#b7f4d0';
  context.fillText('FACE LANDMARKS', minX - padX, labelY);
}

export function analyzeCanvas(canvas: HTMLCanvasElement, landmarker: FaceLandmarker, time: number, delta: number): AnalyzedFrame {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas analysis is unavailable in this browser.');
  const result = landmarker.detect(canvas);
  const points = result.faceLandmarks[0];
  if (!points) {
    return { time, src: canvas.toDataURL('image/jpeg', 0.82), delta, facial: { detected: false, eyeAspectRatio: null, mouthAspectRatio: null, eyesClosed: null, mouthOpen: null } };
  }

  const eyeAspectRatio = (ratio(points, [159, 145], [33, 133]) + ratio(points, [386, 374], [362, 263])) / 2;
  const mouthAspectRatio = ratio(points, [13, 14], [78, 308]);
  const facial: FacialMetrics = {
    detected: true,
    eyeAspectRatio: Number(eyeAspectRatio.toFixed(3)),
    mouthAspectRatio: Number(mouthAspectRatio.toFixed(3)),
    eyesClosed: eyeAspectRatio < 0.14,
    mouthOpen: mouthAspectRatio > 0.16,
  };
  paintFaceOverlay(context, points, canvas.width, canvas.height);
  return { time, src: canvas.toDataURL('image/jpeg', 0.82), delta, facial };
}
