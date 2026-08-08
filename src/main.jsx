import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Camera, Clock, RotateCcw, Square, Target, Trash2, Video } from "lucide-react";
import { drawConnectors, drawLandmarks } from "@mediapipe/drawing_utils";
import { Pose, POSE_CONNECTIONS } from "@mediapipe/pose";
import "./styles.css";

const POSE_LANDMARKS = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftAnkle: 27,
  rightAnkle: 28,
};

const DEFAULT_SETTINGS = {
  targetCount: 20,
  upAngle: 155,
  downAngle: 95,
  minVisibility: 0.55,
  minShoulderHipDistance: 0.08,
  minBodyLineAngle: 150,
};

const SETTINGS_LIMITS = {
  targetCount: { min: 1, max: 500, fallback: DEFAULT_SETTINGS.targetCount },
  downAngle: { min: 60, max: 130, fallback: DEFAULT_SETTINGS.downAngle },
  upAngle: { min: 130, max: 180, fallback: DEFAULT_SETTINGS.upAngle },
  minVisibility: { min: 0.1, max: 1, fallback: DEFAULT_SETTINGS.minVisibility },
  minShoulderHipDistance: {
    min: 0.01,
    max: 0.5,
    fallback: DEFAULT_SETTINGS.minShoulderHipDistance,
  },
  minBodyLineAngle: { min: 90, max: 180, fallback: DEFAULT_SETTINGS.minBodyLineAngle },
};

const initialStats = {
  count: 0,
  phase: "Siap",
  angle: null,
  quality: null,
  side: null,
  bodyLine: null,
  feedback: "Posisikan kamera dari samping, pastikan bahu sampai kaki terlihat.",
  feedbackTone: "normal",
};

function loadJson(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Persistence is optional; counting should still work when storage is unavailable.
  }
}

function clampNumber(value, { min, max, fallback }) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeSettings(value) {
  const input = value && typeof value === "object" ? value : {};
  const normalized = {
    targetCount: Math.round(clampNumber(input.targetCount, SETTINGS_LIMITS.targetCount)),
    downAngle: Math.round(clampNumber(input.downAngle, SETTINGS_LIMITS.downAngle)),
    upAngle: Math.round(clampNumber(input.upAngle, SETTINGS_LIMITS.upAngle)),
    minVisibility: clampNumber(input.minVisibility, SETTINGS_LIMITS.minVisibility),
    minShoulderHipDistance: clampNumber(
      input.minShoulderHipDistance,
      SETTINGS_LIMITS.minShoulderHipDistance,
    ),
    minBodyLineAngle: Math.round(clampNumber(input.minBodyLineAngle, SETTINGS_LIMITS.minBodyLineAngle)),
  };

  if (normalized.upAngle <= normalized.downAngle) {
    normalized.upAngle = Math.min(
      SETTINGS_LIMITS.upAngle.max,
      Math.max(SETTINGS_LIMITS.upAngle.min, normalized.downAngle + 20),
    );
  }

  return normalized;
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getCameraErrorMessage(error) {
  const errorDetail = error?.name ? ` (${error.name})` : "";

  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return `Izin kamera diblokir${errorDetail}. Klik ikon gembok/setting di kiri address bar, ubah Camera ke Allow, lalu tekan Start lagi.`;
  }

  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return `Kamera tidak ditemukan${errorDetail}. Pastikan webcam terpasang dan tidak dimatikan oleh sistem.`;
  }

  if (error?.name === "NotReadableError" || error?.name === "TrackStartError") {
    return `Kamera sedang dipakai aplikasi lain atau diblokir sistem${errorDetail}. Tutup aplikasi kamera/meeting lain lalu coba lagi.`;
  }

  if (error?.name === "OverconstrainedError" || error?.name === "ConstraintNotSatisfiedError") {
    return `Mode kamera yang dipilih tidak tersedia${errorDetail}. Coba ganti Kamera ke Depan atau Belakang.`;
  }

  return `Gagal membuka kamera${errorDetail}. Pastikan halaman HTTPS, izin kamera Allow, dan browser punya akses ke webcam.`;
}

function waitForVideoMetadata(video) {
  if (video.readyState >= 1) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", handleLoaded);
      video.removeEventListener("canplay", handleLoaded);
      video.removeEventListener("error", handleError);
      window.clearTimeout(timeoutId);
    };
    const handleLoaded = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Video metadata gagal dimuat."));
    };
    const timeoutId = window.setTimeout(() => {
      cleanup();
      if (video.videoWidth || video.readyState >= 1) {
        resolve();
      } else {
        reject(new Error("Timeout menunggu kamera aktif."));
      }
    }, 5000);

    video.addEventListener("loadedmetadata", handleLoaded, { once: true });
    video.addEventListener("canplay", handleLoaded, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });
}

async function getCameraStream(cameraMode) {
  const attempts = [
    {
      audio: false,
      video: {
        facingMode: { ideal: cameraMode },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    {
      audio: false,
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    },
    { audio: false, video: true },
  ];

  let lastError = null;

  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
      if (error?.name === "NotAllowedError" || error?.name === "SecurityError") break;
    }
  }

  throw lastError || new Error("Tidak ada kamera yang bisa dibuka.");
}

function calculateAngle(firstPoint, middlePoint, lastPoint) {
  const firstVector = { x: firstPoint.x - middlePoint.x, y: firstPoint.y - middlePoint.y };
  const lastVector = { x: lastPoint.x - middlePoint.x, y: lastPoint.y - middlePoint.y };
  const dot = firstVector.x * lastVector.x + firstVector.y * lastVector.y;
  const cross = firstVector.x * lastVector.y - firstVector.y * lastVector.x;
  return Math.abs((Math.atan2(cross, dot) * 180) / Math.PI);
}

function getContainFrame(image, canvasWidth, canvasHeight) {
  const imageWidth = image.videoWidth || image.naturalWidth || image.width;
  const imageHeight = image.videoHeight || image.naturalHeight || image.height;

  if (!imageWidth || !imageHeight) {
    return { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
  }

  const scale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  const x = (canvasWidth - width) / 2;
  const y = (canvasHeight - height) / 2;

  return { x, y, width, height };
}

function mapLandmarksToFrame(landmarks, frame, canvasWidth, canvasHeight) {
  return landmarks.map((landmark) => ({
    ...landmark,
    x: (frame.x + landmark.x * frame.width) / canvasWidth,
    y: (frame.y + landmark.y * frame.height) / canvasHeight,
  }));
}

function getVisibilityScore(landmarks, side) {
  const prefix = side === "left" ? "left" : "right";
  const indexes = [
    POSE_LANDMARKS[`${prefix}Shoulder`],
    POSE_LANDMARKS[`${prefix}Elbow`],
    POSE_LANDMARKS[`${prefix}Wrist`],
    POSE_LANDMARKS[`${prefix}Hip`],
  ];

  return indexes.reduce((total, index) => total + (landmarks[index]?.visibility ?? 0), 0) / indexes.length;
}

function chooseTrackedSide(landmarks) {
  const leftScore = getVisibilityScore(landmarks, "left");
  const rightScore = getVisibilityScore(landmarks, "right");
  return leftScore >= rightScore
    ? { side: "left", score: leftScore }
    : { side: "right", score: rightScore };
}

function getSidePoints(landmarks, side) {
  const prefix = side === "left" ? "left" : "right";
  return {
    shoulder: landmarks[POSE_LANDMARKS[`${prefix}Shoulder`]],
    elbow: landmarks[POSE_LANDMARKS[`${prefix}Elbow`]],
    wrist: landmarks[POSE_LANDMARKS[`${prefix}Wrist`]],
    hip: landmarks[POSE_LANDMARKS[`${prefix}Hip`]],
    ankle: landmarks[POSE_LANDMARKS[`${prefix}Ankle`]],
  };
}

function getBodyLineAngle(points) {
  if (!points.ankle || (points.ankle.visibility ?? 0) < 0.45) return null;
  return calculateAngle(points.shoulder, points.hip, points.ankle);
}

function usePersistentState(key, fallback, normalize = (value) => value) {
  const [value, setValue] = useState(() => normalize(loadJson(key, fallback)));

  useEffect(() => {
    saveJson(key, value);
  }, [key, value]);

  return [value, setValue];
}

function usePushUpCounter() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const poseRef = useRef(null);
  const frameRequestRef = useRef(null);
  const frameBusyRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);
  const poseErrorCountRef = useRef(0);
  const movementStateRef = useRef("ready");
  const statsRef = useRef(initialStats);
  const elapsedRef = useRef(0);
  const sessionSavedRef = useRef(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [cameraMode, setCameraMode] = useState("user");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [settings, setSettingsState] = usePersistentState(
    "pushup-settings",
    DEFAULT_SETTINGS,
    normalizeSettings,
  );
  const [history, setHistory] = usePersistentState("pushup-history", []);
  const [stats, setStatsState] = useState(initialStats);

  const setSettings = useCallback(
    (updater) => {
      setSettingsState((current) => {
        const next = typeof updater === "function" ? updater(current) : updater;
        return normalizeSettings(next);
      });
    },
    [setSettingsState],
  );

  const setStats = useCallback((updater) => {
    setStatsState((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      statsRef.current = next;
      return next;
    });
  }, []);

  const targetProgress = useMemo(() => {
    if (!settings.targetCount) return 0;
    return Math.min(100, Math.round((stats.count / settings.targetCount) * 100));
  }, [settings.targetCount, stats.count]);

  const saveSession = useCallback(() => {
    const currentStats = statsRef.current;
    if (currentStats.count <= 0 || sessionSavedRef.current) return;

    const session = {
      id: window.crypto?.randomUUID?.() ?? String(Date.now()),
      date: new Date().toISOString(),
      count: currentStats.count,
      target: settings.targetCount,
      duration: elapsedRef.current,
    };

    setHistory((current) => [session, ...current].slice(0, 8));
    sessionSavedRef.current = true;
  }, [setHistory, settings.targetCount]);

  const resetCounter = useCallback(() => {
    saveSession();
    movementStateRef.current = "ready";
    elapsedRef.current = 0;
    sessionSavedRef.current = false;
    setElapsedSeconds(0);
    setStats(initialStats);
  }, [saveSession, setStats]);

  const processPushUp = useCallback(
    (landmarks) => {
      const tracked = chooseTrackedSide(landmarks);
      const points = getSidePoints(landmarks, tracked.side);
      const quality = Math.round(tracked.score * 100);
      const sideLabel = tracked.side === "left" ? "Kiri" : "Kanan";

      if (tracked.score < settings.minVisibility) {
        setStats((current) => ({
          ...current,
          phase: "Cari tubuh",
          angle: null,
          quality,
          side: sideLabel,
          bodyLine: null,
          feedback: "Tubuh belum terbaca jelas. Mundur sedikit dan arahkan kamera dari samping.",
          feedbackTone: "warning",
        }));
        return;
      }

      const elbowAngle = calculateAngle(points.shoulder, points.elbow, points.wrist);
      const shoulderHipDistance = Math.abs(points.shoulder.y - points.hip.y);
      const bodyLineAngle = getBodyLineAngle(points);

      if (shoulderHipDistance < settings.minShoulderHipDistance) {
        setStats((current) => ({
          ...current,
          phase: "Atur kamera",
          angle: Math.round(elbowAngle),
          quality,
          side: sideLabel,
          bodyLine: bodyLineAngle === null ? null : Math.round(bodyLineAngle),
          feedback: "Sudut kamera terlalu datar. Pastikan bahu dan pinggul terlihat jelas.",
          feedbackTone: "warning",
        }));
        return;
      }

      if (bodyLineAngle !== null && bodyLineAngle < settings.minBodyLineAngle) {
        setStats((current) => ({
          ...current,
          phase: current.phase === "Siap" ? "Kalibrasi" : current.phase,
          angle: Math.round(elbowAngle),
          quality,
          side: sideLabel,
          bodyLine: Math.round(bodyLineAngle),
          feedback: "Jaga badan lebih lurus dari bahu sampai kaki.",
          feedbackTone: "warning",
        }));
      }

      if (elbowAngle > settings.upAngle) {
        const wasDown = movementStateRef.current === "down";
        movementStateRef.current = "up";

        setStats((current) => {
          const nextCount = wasDown ? current.count + 1 : current.count;
          const reachedTarget = settings.targetCount > 0 && nextCount >= settings.targetCount;
          const bodyLineWarning = bodyLineAngle !== null && bodyLineAngle < settings.minBodyLineAngle;

          return {
            ...current,
            count: nextCount,
            phase: reachedTarget ? "Target selesai" : "Atas",
            angle: Math.round(elbowAngle),
            quality,
            side: sideLabel,
            bodyLine: bodyLineAngle === null ? null : Math.round(bodyLineAngle),
            feedback: reachedTarget
              ? "Target tercapai. Stop untuk menyimpan sesi."
              : wasDown
                ? "Repetisi tercatat. Turun lagi dengan kontrol."
                : bodyLineWarning
                  ? "Posisi atas terbaca, tapi jaga badan tetap lurus."
                  : "Posisi atas terbaca. Turunkan badan sampai siku menekuk.",
            feedbackTone: bodyLineWarning ? "warning" : "normal",
          };
        });
        return;
      }

      if (elbowAngle < settings.downAngle && movementStateRef.current === "up") {
        movementStateRef.current = "down";

        setStats((current) => ({
          ...current,
          phase: "Bawah",
          angle: Math.round(elbowAngle),
          quality,
          side: sideLabel,
          bodyLine: bodyLineAngle === null ? null : Math.round(bodyLineAngle),
          feedback: "Posisi bawah terbaca. Dorong kembali sampai lengan lurus.",
          feedbackTone: "normal",
        }));
        return;
      }

      setStats((current) => ({
        ...current,
        phase:
          movementStateRef.current === "ready"
            ? "Kalibrasi"
            : movementStateRef.current === "down"
              ? "Naik"
              : "Turun",
        angle: Math.round(elbowAngle),
        quality,
        side: sideLabel,
        bodyLine: bodyLineAngle === null ? null : Math.round(bodyLineAngle),
        feedback:
          movementStateRef.current === "ready"
            ? "Mulai dari posisi atas dengan lengan lurus."
            : current.feedback,
        feedbackTone: movementStateRef.current === "ready" ? "warning" : current.feedbackTone,
      }));
    },
    [setStats, settings],
  );

  const drawResults = useCallback(
    (results) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;

      context.save();
      context.clearRect(0, 0, canvas.width, canvas.height);
      const videoFrame = getContainFrame(results.image, canvas.width, canvas.height);

      if (results.poseLandmarks) {
        const displayLandmarks = mapLandmarksToFrame(
          results.poseLandmarks,
          videoFrame,
          canvas.width,
          canvas.height,
        );

        drawConnectors(context, displayLandmarks, POSE_CONNECTIONS, {
          color: "#37d67a",
          lineWidth: 4,
        });
        drawLandmarks(context, displayLandmarks, {
          color: "#f3f5f2",
          lineWidth: 2,
          radius: 3,
        });
        processPushUp(results.poseLandmarks);
      } else {
        setStats((current) => ({
          ...current,
          phase: "Cari tubuh",
          angle: null,
          quality: null,
          side: null,
          bodyLine: null,
          feedback: "Tidak ada pose terdeteksi. Pastikan tubuh masuk frame.",
          feedbackTone: "warning",
        }));
      }

      context.restore();
    },
    [processPushUp, setStats],
  );

  const createPose = useCallback(() => {
    const poseAssetBase = `${import.meta.env.BASE_URL}mediapipe/pose/`;
    const pose = new Pose({
      locateFile: (file) => `${poseAssetBase}${file}`,
    });

    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });

    pose.onResults(drawResults);
    return pose;
  }, [drawResults]);

  const stopFrameLoop = useCallback(() => {
    if (frameRequestRef.current !== null) {
      window.cancelAnimationFrame(frameRequestRef.current);
      frameRequestRef.current = null;
    }

    frameBusyRef.current = false;
    lastVideoTimeRef.current = -1;
    poseErrorCountRef.current = 0;
  }, []);

  const startFrameLoop = useCallback(() => {
    const tick = async () => {
      const video = videoRef.current;
      const pose = poseRef.current;

      if (!video || !pose || video.paused || video.ended) {
        frameRequestRef.current = window.requestAnimationFrame(tick);
        return;
      }

      if (!frameBusyRef.current && video.currentTime !== lastVideoTimeRef.current) {
        frameBusyRef.current = true;
        lastVideoTimeRef.current = video.currentTime;

        try {
          await pose.send({ image: video });
          poseErrorCountRef.current = 0;
        } catch (error) {
          console.error(error);
          poseErrorCountRef.current += 1;

          if (poseErrorCountRef.current === 1) {
            setStats((current) => ({
              ...current,
              phase: "Kamera aktif",
              feedback:
                "Kamera sudah terbuka, tapi model pose belum bisa dimuat. Preview tetap tampil; counter mulai bekerja setelah model siap.",
              feedbackTone: "warning",
            }));
          }
        } finally {
          frameBusyRef.current = false;
        }
      }

      frameRequestRef.current = window.requestAnimationFrame(tick);
    };

    stopFrameLoop();
    frameRequestRef.current = window.requestAnimationFrame(tick);
  }, [setStats, stopFrameLoop]);

  const stopCamera = useCallback(() => {
    saveSession();
    stopFrameLoop();

    const stream = streamRef.current || videoRef.current?.srcObject;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    context?.clearRect(0, 0, canvas.width, canvas.height);

    setIsRunning(false);
    setIsLoading(false);
    setStats((current) => ({
      ...current,
      feedback: "Kamera berhenti. Sesi tersimpan bila ada repetisi.",
      feedbackTone: "normal",
    }));
  }, [saveSession, setStats, stopFrameLoop]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStats((current) => ({
        ...current,
        feedback: "Browser ini tidak mendukung akses kamera.",
        feedbackTone: "error",
      }));
      return;
    }

    if (sessionSavedRef.current && statsRef.current.count > 0) {
      movementStateRef.current = "ready";
      elapsedRef.current = 0;
      setElapsedSeconds(0);
      setStats(initialStats);
    }

    setIsLoading(true);
    sessionSavedRef.current = false;
    setStats((current) => ({
      ...current,
      feedback: "Meminta izin kamera...",
      feedbackTone: "normal",
    }));

    try {
      stopFrameLoop();

      const stream = await getCameraStream(cameraMode);
      streamRef.current = stream;
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          setIsRunning(false);
          stopFrameLoop();
          setStats((current) => ({
            ...current,
            phase: "Kamera berhenti",
            feedback:
              "Stream kamera dihentikan browser atau sistem. Coba tutup app lain yang memakai kamera lalu tekan Start lagi.",
            feedbackTone: "error",
          }));
        };
      });

      const video = videoRef.current;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;

      await waitForVideoMetadata(video);
      await video.play();

      setIsRunning(true);
      setStats((current) => ({
        ...current,
        feedback: "Kamera aktif. Menyiapkan model pose...",
        feedbackTone: "normal",
      }));
    } catch (error) {
      console.error(error);
      stopFrameLoop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;

      setStats((current) => ({
        ...current,
        feedback: getCameraErrorMessage(error),
        feedbackTone: "error",
      }));
      return;
    } finally {
      setIsLoading(false);
    }

    try {
      poseRef.current = poseRef.current || createPose();
      startFrameLoop();

      setStats((current) => ({
        ...current,
        feedback: "Kamera aktif. Mulai dari posisi atas dengan tubuh terlihat penuh.",
        feedbackTone: "normal",
      }));
    } catch (error) {
      console.error(error);
      setStats((current) => ({
        ...current,
        phase: "Kamera aktif",
        feedback:
          "Kamera aktif, tapi model pose gagal dimuat. Preview tetap menyala; counter belum bisa menghitung sampai model berhasil.",
        feedbackTone: "warning",
      }));
    }
  }, [cameraMode, createPose, setStats, startFrameLoop, stopFrameLoop]);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, [setHistory]);

  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  useEffect(() => {
    elapsedRef.current = elapsedSeconds;
  }, [elapsedSeconds]);

  useEffect(() => {
    if (!isRunning) return undefined;

    const intervalId = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isRunning]);

  useEffect(() => {
    poseRef.current?.onResults(drawResults);
  }, [drawResults]);

  useEffect(
    () => () => {
      stopFrameLoop();
      const stream = streamRef.current || videoRef.current?.srcObject;
      stream?.getTracks().forEach((track) => track.stop());
    },
    [stopFrameLoop],
  );

  return {
    videoRef,
    canvasRef,
    isRunning,
    isLoading,
    cameraMode,
    stats,
    settings,
    history,
    elapsedSeconds,
    targetProgress,
    setCameraMode,
    setSettings,
    startCamera,
    stopCamera,
    resetCounter,
    clearHistory,
  };
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function NumberField({ id, label, min, max, value, onChange }) {
  return (
    <label className="number-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const nextValue = event.target.valueAsNumber;
          if (Number.isFinite(nextValue)) onChange(nextValue);
        }}
      />
    </label>
  );
}

function App() {
  const {
    videoRef,
    canvasRef,
    isRunning,
    isLoading,
    cameraMode,
    stats,
    settings,
    history,
    elapsedSeconds,
    targetProgress,
    setCameraMode,
    setSettings,
    startCamera,
    stopCamera,
    resetCounter,
    clearHistory,
  } = usePushUpCounter();

  const updateSetting = (key, value) => {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Local pose tracking</p>
          <h1>Push-Up Studio</h1>
        </div>
        <div className={`run-chip ${isRunning ? "is-live" : ""}`}>
          <span aria-hidden="true" />
          {isRunning ? "Kamera aktif" : "Siap mulai"}
        </div>
      </header>

      <section className="workspace" aria-label="Kamera penghitung push-up">
        <section className="stage-card" aria-label="Area kamera">
          <div className={`camera-panel ${isRunning ? "is-active" : ""}`}>
            <video ref={videoRef} className="input-video" playsInline muted />
            <canvas ref={canvasRef} className="output-canvas" width="1280" height="720" />
            <div className="camera-placeholder">
              <Camera size={36} aria-hidden="true" />
              <span>Kamera belum aktif</span>
            </div>
            <div className="camera-hud" aria-label="Ringkasan sesi">
              <div>
                <span>Status</span>
                <strong>{stats.phase}</strong>
              </div>
              <div>
                <span>Tracking</span>
                <strong>{stats.quality === null ? "-" : `${stats.quality}%`}</strong>
              </div>
              <div>
                <span>Sisi</span>
                <strong>{stats.side ?? "-"}</strong>
              </div>
            </div>
          </div>

          <div className="stage-dock">
            <div className="rep-meter">
              <span>Repetisi</span>
              <strong>{stats.count}</strong>
            </div>

            <div className="target-panel">
              <div className="target-row">
                <div>
                  <span>Target</span>
                  <strong>{settings.targetCount} reps</strong>
                </div>
                <div>
                  <span>Durasi</span>
                  <strong>{formatDuration(elapsedSeconds)}</strong>
                </div>
              </div>
              <div className="progress-track" aria-label="Progress target">
                <span style={{ width: `${targetProgress}%` }} />
              </div>
            </div>

            <div className="actions">
              <button type="button" onClick={startCamera} disabled={isRunning || isLoading}>
                <Camera size={18} aria-hidden="true" />
                {isLoading ? "Loading" : "Start"}
              </button>
              <button type="button" className="secondary" onClick={stopCamera} disabled={!isRunning}>
                <Square size={18} aria-hidden="true" />
                Stop
              </button>
              <button type="button" className="ghost" onClick={resetCounter}>
                <RotateCcw size={18} aria-hidden="true" />
                Reset
              </button>
            </div>
          </div>

          <p className={`feedback stage-feedback is-${stats.feedbackTone}`}>{stats.feedback}</p>
        </section>

        <aside className="side-stack" aria-label="Panel kontrol">
          <section className="side-card">
            <div className="card-heading">
              <div>
                <span>Ringkasan</span>
                <strong>{targetProgress}% selesai</strong>
              </div>
              <div className="target-pill">
                <Target size={15} aria-hidden="true" />
                <span>{settings.targetCount}</span>
              </div>
            </div>

            <div className="metrics-grid">
              <Metric label="Status" value={stats.phase} />
              <Metric label="Sudut siku" value={stats.angle === null ? "-" : `${stats.angle}°`} />
              <Metric label="Body line" value={stats.bodyLine === null ? "-" : `${stats.bodyLine}°`} />
              <Metric label="Tracking" value={stats.quality === null ? "-" : `${stats.quality}%`} />
            </div>
          </section>

          <section className="side-card settings-card">
            <div className="card-heading">
              <div>
                <span>Kalibrasi</span>
                <strong>Kamera & threshold</strong>
              </div>
            </div>

            <label className="settings" htmlFor="cameraMode">
              <span>Kamera</span>
              <select
                id="cameraMode"
                value={cameraMode}
                disabled={isRunning || isLoading}
                onChange={(event) => setCameraMode(event.target.value)}
              >
                <option value="user">Depan</option>
                <option value="environment">Belakang</option>
              </select>
            </label>

            <div className="tuning-grid">
              <NumberField
                id="targetCount"
                label="Target"
                min="1"
                max="500"
                value={settings.targetCount}
                onChange={(value) => updateSetting("targetCount", value)}
              />
              <NumberField
                id="downAngle"
                label="Bawah"
                min="60"
                max="130"
                value={settings.downAngle}
                onChange={(value) => updateSetting("downAngle", value)}
              />
              <NumberField
                id="upAngle"
                label="Atas"
                min="130"
                max="180"
                value={settings.upAngle}
                onChange={(value) => updateSetting("upAngle", value)}
              />
            </div>
          </section>

          <section className="side-card history-panel" aria-label="Histori sesi">
            <div className="history-header">
              <div>
                <span>Histori</span>
                <strong>{history.length ? `${history.length} sesi` : "Belum ada sesi"}</strong>
              </div>
              <button type="button" className="icon-button" onClick={clearHistory} disabled={!history.length}>
                <Trash2 size={16} aria-hidden="true" />
                <span>Hapus</span>
              </button>
            </div>
            <div className="history-list">
              {history.length === 0 ? (
                <p>Sesi akan tersimpan saat Stop atau Reset setelah ada repetisi.</p>
              ) : (
                history.map((session) => (
                  <article key={session.id}>
                    <div>
                      <strong>{session.count} reps</strong>
                      <span>
                        {new Intl.DateTimeFormat("id-ID", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(session.date))}
                      </span>
                    </div>
                    <div>
                      <Clock size={14} aria-hidden="true" />
                      <span>{formatDuration(session.duration)}</span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <div className="privacy-note side-card">
            <Video size={16} aria-hidden="true" />
            <span>Video diproses lokal di browser.</span>
          </div>
        </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
