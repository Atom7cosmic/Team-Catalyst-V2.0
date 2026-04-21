import os
import io
import tempfile
import logging
import subprocess
import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Speaker Diarization Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

pipeline = None

# ─────────────────────────────────────────────────────────────
# Silero VAD model (loaded once at startup alongside pyannote)
# Uses torch.hub — no separate package needed beyond torch/torchaudio
# ─────────────────────────────────────────────────────────────
vad_model = None
vad_utils = None


def convert_to_wav(input_path: str, output_path: str = None) -> str:
    """Convert any audio format to 16kHz mono WAV required by pyannote and VAD."""
    if output_path is None:
        output_path = input_path.rsplit(".", 1)[0] + "_converted.wav"
    try:
        subprocess.run([
            "ffmpeg", "-y",
            "-i", input_path,
            "-ac", "1",
            "-ar", "16000",
            "-sample_fmt", "s16",
            output_path
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return output_path
    except subprocess.CalledProcessError as e:
        logger.error(f"FFmpeg conversion failed: {e}")
        raise Exception("Audio conversion failed (ffmpeg error)")


# ─────────────────────────────────────────────────────────────
# Startup — load pyannote pipeline AND Silero VAD
# ─────────────────────────────────────────────────────────────
@app.on_event("startup")
async def load_models():
    global pipeline, vad_model, vad_utils

    hf_token = os.environ.get("HF_TOKEN")
    logger.info(f"HF_TOKEN exists: {bool(hf_token)}")

    # ── Load Silero VAD (always, no HF token needed) ──────────
    try:
        import torch
        logger.info("Loading Silero VAD model...")
        vad_model, vad_utils = torch.hub.load(
            repo_or_dir="snakers4/silero-vad",
            model="silero_vad",
            force_reload=False,
            trust_repo=True
        )
        logger.info("Silero VAD loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load Silero VAD: {e}")
        import traceback
        logger.error(traceback.format_exc())
        vad_model = None
        vad_utils = None

    # ── Load Pyannote pipeline (requires HF token) ────────────
    if not hf_token:
        logger.error("HF_TOKEN not set — pyannote diarization will not work")
        return

    try:
        from pyannote.audio import Pipeline
        import torch

        logger.info("Loading pyannote speaker diarization pipeline...")

        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=hf_token
        )
        pipeline = pipeline.to(torch.device("cpu"))
        logger.info("Pyannote pipeline loaded successfully on cpu")

    except Exception as e:
        logger.error(f"Failed to load pyannote pipeline: {e}")
        import traceback
        logger.error(traceback.format_exc())
        pipeline = None


# ─────────────────────────────────────────────────────────────
# Health check
# ─────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status": "ok",
        "pipeline_loaded": pipeline is not None,
        "vad_loaded": vad_model is not None
    }


# ─────────────────────────────────────────────────────────────
# VAD scoring endpoint
#
# Accepts a single WebM audio chunk (10s from one device).
# Returns voiceRatio: fraction of the chunk that contains speech.
#
# voiceRatio close to 1.0 = person was actively speaking
# voiceRatio close to 0.0 = person was silent (ambient noise only)
#
# With earphones this signal is very clean — the mic only picks
# up the nearby speaker so there is minimal bleed from others.
# ─────────────────────────────────────────────────────────────
@app.post("/vad-score")
async def vad_score(file: UploadFile = File(...)):
    if vad_model is None or vad_utils is None:
        # VAD not loaded — return neutral score so caller falls back to
        # timestamp heuristic rather than crashing
        return {"voiceRatio": 0.5, "vad_available": False}

    suffix = os.path.splitext(file.filename or "chunk.webm")[1] or ".webm"
    tmp_path = None
    wav_path = None

    try:
        import torch
        import torchaudio

        # Save uploaded chunk
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        # Convert to 16kHz mono WAV
        wav_path = tmp_path.rsplit(".", 1)[0] + "_vad.wav"
        convert_to_wav(tmp_path, wav_path)

        # Load audio
        wav, sr = torchaudio.load(wav_path)

        # Silero VAD expects 16kHz
        if sr != 16000:
            resampler = torchaudio.transforms.Resample(sr, 16000)
            wav = resampler(wav)

        # Mono
        if wav.shape[0] > 1:
            wav = wav.mean(dim=0, keepdim=True)

        wav = wav.squeeze(0)

        # Run VAD
        (get_speech_timestamps, _, _, _, _) = vad_utils

        speech_timestamps = get_speech_timestamps(
            wav,
            vad_model,
            sampling_rate=16000,
            threshold=0.4,          # speech confidence threshold
            min_speech_duration_ms=150,
            min_silence_duration_ms=100,
        )

        # Compute voice ratio = total speech duration / total chunk duration
        total_samples = len(wav)
        speech_samples = sum(
            ts["end"] - ts["start"] for ts in speech_timestamps
        )
        voice_ratio = float(speech_samples / total_samples) if total_samples > 0 else 0.0

        logger.info(
            f"VAD: {file.filename} — voiceRatio={voice_ratio:.3f}, "
            f"speechSegments={len(speech_timestamps)}"
        )

        return {
            "voiceRatio": round(voice_ratio, 4),
            "speechSegments": len(speech_timestamps),
            "vad_available": True
        }

    except Exception as e:
        logger.error(f"VAD scoring error: {e}")
        # Return neutral score on error — don't crash the upload flow
        return {"voiceRatio": 0.5, "vad_available": False}

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
        if wav_path and os.path.exists(wav_path):
            os.unlink(wav_path)


# ─────────────────────────────────────────────────────────────
# Diarization endpoint
# ─────────────────────────────────────────────────────────────
@app.post("/diarize")
async def diarize(
    file: UploadFile = File(...),
    num_speakers: int = None
):
    if pipeline is None:
        raise HTTPException(
            status_code=503,
            detail="Diarization pipeline not loaded. Check HF_TOKEN and logs."
        )

    suffix = os.path.splitext(file.filename or "audio.webm")[1] or ".webm"
    tmp_path = None
    wav_path = None

    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        logger.info(
            f"Diarizing {file.filename} ({len(content)/1024:.1f}KB), "
            f"num_speakers={num_speakers}"
        )

        wav_path = tmp_path.rsplit(".", 1)[0] + "_diar.wav"
        convert_to_wav(tmp_path, wav_path)

        diarize_kwargs = {}
        if num_speakers and num_speakers > 1:
            diarize_kwargs["num_speakers"] = num_speakers

        diarization = pipeline(wav_path, **diarize_kwargs)

        segments = []
        speakers_seen = set()

        for turn, _, speaker in diarization.itertracks(yield_label=True):
            segments.append({
                "start": round(turn.start, 3),
                "end": round(turn.end, 3),
                "speaker": speaker
            })
            speakers_seen.add(speaker)

        logger.info(f"Done: {len(segments)} segments, {len(speakers_seen)} speakers")

        return {
            "segments": segments,
            "num_speakers_detected": len(speakers_seen)
        }

    except Exception as e:
        logger.error(f"Diarization error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
        if wav_path and os.path.exists(wav_path):
            os.unlink(wav_path)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)