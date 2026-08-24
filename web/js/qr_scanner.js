/* qr_scanner.js — scan a Nostr nsec from a QR code using the device camera.
 *
 * Decoding uses the native BarcodeDetector API when present, and falls back to
 * a locally vendored jsQR otherwise. The fallback is imported lazily so the
 * 128KB bundle is only fetched when a device actually needs it.
 *
 * The bundle is vendored rather than loaded from a CDN because this module
 * handles the nsec: a compromised CDN would see the private key directly. The
 * page CSP blocks external script origins, so a CDN import would fail anyway.
 */

const JSQR_URL = "../vendor/jsqr-1.4.0.mjs";

// Nostr uses lowercase bech32 for nsec/npub. This gates obviously-wrong QR
// payloads before the full cryptographic check in nostr_auth.loginNsec.
const NSEC_BECH32_RE = /^nsec1[ac-hj-np-z02-9]+$/;

/**
 * Validate a raw QR payload as a Nostr nsec.
 * Returns the trimmed nsec string, or throws if it is not a plausible nsec.
 * Pure — no camera, safe to unit-test in Node.
 */
export function parseQrResult(text) {
  if (!text || typeof text !== "string") {
    throw new Error("QR vazio ou inválido");
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith("nsec1")) {
    throw new Error("QR não contém um nsec (esperado prefixo nsec1)");
  }
  if (!NSEC_BECH32_RE.test(trimmed)) {
    throw new Error("nsec do QR com formato inválido");
  }
  return trimmed;
}

async function getDecoder() {
  if (typeof window !== "undefined" && "BarcodeDetector" in window) {
    return {
      kind: "native",
      detect: async (canvas) => {
        const results = await window.BarcodeDetector.detect(canvas);
        return results.map((r) => r.rawValue).filter(Boolean);
      },
    };
  }
  const jsQR = (await import(JSQR_URL)).default;
  return {
    kind: "jsqr",
    detect: (imgData, width, height) => {
      const res = jsQR(imgData, width, height);
      return res && res.data ? [res.data] : [];
    },
  };
}

/**
 * Start scanning from a <video> element.
 * @param {object} opts
 * @param {HTMLVideoElement} opts.video
 * @param {(nsec:string)=>void} opts.onResult   called with a validated nsec
 * @param {(msg:string)=>void} [opts.onStatus]  optional status updates
 * @returns {Function} stop() — stops the camera and the scan loop
 */
export async function startScan({ video, onResult, onStatus } = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("Câmera indisponível neste navegador");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  const decoder = await getDecoder();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  let stopped = false;
  let rafId = 0;

  function stop() {
    if (stopped) return;
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }

  async function tick() {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      let candidates = [];
      try {
        if (decoder.kind === "native") {
          candidates = await decoder.detect(canvas);
        } else {
          candidates = decoder.detect(imgData.data, canvas.width, canvas.height);
        }
      } catch (e) {
        if (onStatus) onStatus("Erro ao decodificar: " + e.message);
      }

      for (const raw of candidates) {
        try {
          const nsec = parseQrResult(raw);
          stop();
          onResult(nsec);
          return;
        } catch (e) {
          if (onStatus) onStatus(e.message);
        }
      }
    }
    rafId = requestAnimationFrame(() => tick());
  }

  rafId = requestAnimationFrame(() => tick());
  return stop;
}
