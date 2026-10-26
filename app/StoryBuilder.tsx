"use client";

import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { SharedPhoto, TripDay, TripHighlightElement, TripMember, TripStory, TripStorySlide } from "../lib/googleDrive";
import { canSaveDirectlyToPhotos, saveBlobToNativePhotos } from "../lib/nativePhotos";

type StoryBuilderProps = {
  days: TripDay[];
  highlights: TripStory[];
  currentMember?: TripMember;
  photos: SharedPhoto[];
  photoUrls: Record<string, string>;
  onChange: (highlights: TripStory[]) => void;
};

const backgrounds = ["#173e54", "#d98973", "#8fae9a", "#ad98bd", "#e7b967", "#f7efe3"];
const elementColours = ["#ffffff", "#243945", "#ef8c78", "#f0c45f", "#9fd3df", "#bca5cf"];
const layouts: Array<{ value: TripStorySlide["layout"]; label: string }> = [
  { value: "full", label: "Full photo" },
  { value: "caption", label: "Photo + caption" },
  { value: "quote", label: "Quote card" },
  { value: "split", label: "Split" },
];
type HighlightMusic = "none" | "baroque" | "waltz" | "nocturne" | "sunrise" | "roadtrip" | "indie" | "celebration";
const musicChoices: Array<{ value: HighlightMusic; label: string; description: string }> = [
  { value: "none", label: "No Music", description: "Keep the slideshow quiet" },
  { value: "baroque", label: "Baroque Promenade", description: "Counterpoint and a lively chamber-string ensemble" },
  { value: "waltz", label: "Vienna Waltz", description: "Piano and lyrical cello dancing in three-quarter time" },
  { value: "nocturne", label: "Moonlit Nocturne", description: "Romantic solo piano with flowing arpeggios" },
  { value: "sunrise", label: "Acoustic Sunrise", description: "Spacious piano with a hopeful, hymn-like rise" },
  { value: "roadtrip", label: "Electric Road Trip", description: "Bright electronic pop, pulsing bass and clean dance beat" },
  { value: "indie", label: "Indie Postcard", description: "Dreamy modern indie-pop with a softer pulse" },
  { value: "celebration", label: "Golden Hour", description: "A joyful, rolling piano riff with a gentle lift" },
];
const musicIcons: Record<HighlightMusic, string> = { none: "◯", baroque: "♬", waltz: "♩", nocturne: "☾", sunrise: "☀", roadtrip: "⚡", indie: "✦", celebration: "♪" };
const musicAssetUrl = (music: Exclude<HighlightMusic, "none">) => new URL(`music/${music}.wav`, document.baseURI).toString();

const note = (midi: number) => 440 * (2 ** ((midi - 69) / 12));

function addTone(context: AudioContext, output: AudioNode, frequency: number, at: number, length: number, volume: number, wave: OscillatorType, pluck = false) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(frequency, at);
  if (pluck) oscillator.detune.setValueAtTime(-4, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + (pluck ? 0.018 : 0.07));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  oscillator.connect(gain).connect(output);
  oscillator.start(at);
  oscillator.stop(at + length + 0.03);
}

function addDrum(context: AudioContext, output: AudioNode, at: number, kind: "kick" | "snare" | "hat", volume: number) {
  if (kind === "kick") {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(115, at);
    oscillator.frequency.exponentialRampToValueAtTime(48, at + 0.16);
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    oscillator.connect(gain).connect(output);
    oscillator.start(at);
    oscillator.stop(at + 0.21);
    return;
  }
  const length = kind === "snare" ? 0.14 : 0.045;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * length), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = ((index * 16807) % 127 / 63.5 - 1) * (1 - index / data.length);
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = "highpass";
  filter.frequency.value = kind === "snare" ? 900 : 5200;
  gain.gain.setValueAtTime(volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  source.connect(filter).connect(gain).connect(output);
  source.start(at);
}

function addString(context: AudioContext, output: AudioNode, midi: number, at: number, length: number, volume = 0.014) {
  addTone(context, output, note(midi), at, length, volume, "sawtooth");
  addTone(context, output, note(midi) * 1.0023, at + 0.012, length * 0.98, volume * 0.65, "triangle");
}

function addPiano(context: AudioContext, output: AudioNode, midi: number, at: number, length: number, volume = 0.024) {
  addTone(context, output, note(midi), at, length, volume, "triangle", true);
  addTone(context, output, note(midi) * 2, at, length * 0.48, volume * 0.22, "sine", true);
}

function addGuitar(context: AudioContext, output: AudioNode, midi: number, at: number, length: number, volume = 0.018, electric = false) {
  addTone(context, output, note(midi), at, length, volume, electric ? "sawtooth" : "triangle", true);
  addTone(context, output, note(midi) * 2, at + 0.008, length * 0.58, volume * 0.18, "sine", true);
}

function scheduleGeneratedMusic(context: AudioContext, output: AudioNode, music: Exclude<HighlightMusic, "none">, duration: number) {
  const start = context.currentTime + 0.05;
  if (music === "baroque") {
    const step = 0.28, upper = [76, 79, 81, 83, 84, 81, 79, 76, 77, 81, 84, 86, 84, 81, 77, 74], lower = [52, 55, 57, 59, 60, 57, 55, 52, 53, 57, 60, 62, 60, 57, 53, 50];
    for (let i = 0, time = 0; time < duration + 0.5; i += 1, time += step) {
      addString(context, output, upper[i % upper.length], start + time, step * 0.92, 0.012);
      addString(context, output, lower[(i + 4) % lower.length], start + time, step * 0.9, 0.009);
      if (i % 4 === 0) addString(context, output, lower[i % lower.length] - 12, start + time, step * 3.8, 0.012);
    }
    return;
  }
  if (music === "waltz") {
    const beat = 0.52, roots = [48, 55, 53, 50], cello = [60, 64, 67, 65, 64, 72, 69, 67, 62, 65, 69, 67];
    for (let i = 0, time = 0; time < duration + 0.5; i += 1, time += beat) {
      const at = start + time, root = roots[Math.floor(i / 3) % roots.length], position = i % 3;
      if (position === 0) addString(context, output, root, at, beat * 2.8, 0.018);
      else [root + 12, root + 16, root + 19].forEach((midi) => addPiano(context, output, midi, at, beat * 0.78, 0.011));
      addString(context, output, cello[i % cello.length], at, beat * 0.86, 0.01);
    }
    return;
  }
  if (music === "nocturne") {
    const step = 0.42, roots = [45, 41, 48, 43], melody = [69, 72, 76, 81, 79, 76, 74, 72, 71, 74, 79, 77, 74, 71, 69, 68], arp = [0, 12, 15, 19, 24, 19, 15, 12];
    for (let i = 0, time = 0; time < duration + 0.5; i += 1, time += step) {
      const root = roots[Math.floor(i / 8) % roots.length], at = start + time;
      addPiano(context, output, root + arp[i % arp.length], at, step * 1.7, 0.014);
      if (i % 2 === 0) addPiano(context, output, melody[Math.floor(i / 2) % melody.length], at, step * 2.9, 0.025);
    }
    return;
  }
  if (music === "sunrise") {
    const step = 0.48, roots = [48, 43, 45, 41], melody = [64, 67, 69, 72, 71, 69, 67, 64, 69, 72, 76, 74, 72, 71, 69, 67];
    for (let i = 0, time = 0; time < duration + 0.5; i += 1, time += step) {
      const at = start + time, root = roots[Math.floor(i / 4) % roots.length];
      if (i % 4 === 0) {
        addPiano(context, output, root, at, step * 3.8, 0.024);
        [root + 12, root + 16, root + 19].forEach((midi) => addPiano(context, output, midi, at, step * 3.6, 0.011));
      }
      if (i % 2 === 0) addPiano(context, output, melody[(i / 2) % melody.length], at, step * 2.05, 0.027);
    }
    return;
  }
  if (music === "celebration") {
    const step = 0.3, roots = [48, 45, 53, 55], riff = [0, 4, 7, 12, 7, 4, 9, 7, 0, 4, 9, 12, 9, 7, 4, 2];
    for (let i = 0, time = 0; time < duration + 0.5; i += 1, time += step) {
      const at = start + time, root = roots[Math.floor(i / 8) % roots.length];
      addPiano(context, output, root + 12 + riff[i % riff.length], at, step * 1.45, 0.021);
      if (i % 4 === 0) addPiano(context, output, root, at, step * 3.8, 0.022);
      if (i % 8 === 4) addString(context, output, root + 19, at, step * 3.6, 0.006);
    }
    return;
  }
  if (music === "roadtrip") {
    const step = 0.25, roots = [40, 36, 43, 45], hook = [76, 76, 79, 83, 81, 79, 76, 74, 76, 79, 81, 84, 83, 81, 79, 76];
    for (let i = 0, time = 0; time < duration + 0.5; i += 1, time += step) {
      const at = start + time, root = roots[Math.floor(i / 8) % roots.length];
      if (i % 2 === 0) {
        addTone(context, output, note(hook[i % hook.length]), at, step * 1.65, 0.014, "sawtooth", true);
        addTone(context, output, note(hook[i % hook.length] - 12), at, step * 1.55, 0.008, "triangle", true);
      }
      addTone(context, output, note(root), at, step * 0.82, 0.027, "square", true);
      if (i % 8 === 0) [root + 12, root + 16, root + 19].forEach((midi) => addTone(context, output, note(midi), at, step * 7.5, 0.006, "sawtooth"));
      if (i % 2 === 0) addDrum(context, output, at, "kick", 0.048);
      if (i % 4 === 2) addDrum(context, output, at, "snare", 0.023);
      if (i % 2 === 1) addDrum(context, output, at, "hat", 0.01);
    }
    return;
  }
  const step = 0.4;
  const roots = [47, 43, 50, 45];
  const melody = [71, 74, 78, 74, 69, 73, 76, 73, 67, 71, 74, 71, 66, 69, 73, 69];
  for (let i = 0, time = 0; time < duration + 0.5; i += 1, time += step) {
    const at = start + time, root = roots[Math.floor(i / 8) % roots.length];
    addGuitar(context, output, melody[i % melody.length], at, step * 1.45, 0.013, true);
    if (i % 2 === 0) addGuitar(context, output, root + 12 + (i % 4 ? 7 : 0), at, step * 1.55, 0.009, true);
    if (i % 4 === 0) { addTone(context, output, note(root), at, step * 3.7, 0.028, "sine"); addDrum(context, output, at, "kick", 0.035); }
    if (i % 4 === 2) addDrum(context, output, at, "snare", 0.014);
    if (i % 4 === 3) addDrum(context, output, at, "hat", 0.009);
  }
}

function newSlide(photoId = ""): TripStorySlide {
  return { id: crypto.randomUUID(), photoId: photoId || undefined, layout: photoId ? "full" : "quote", text: "", emoji: "", background: backgrounds[0], duration: 3, elements: [] };
}
const slideDuration = (slide: TripStorySlide) => Math.min(5, Math.max(1, slide.duration || 3));

function coverUrl(story: TripStory, urls: Record<string, string>): string {
  const slide = story.slides.find((item) => item.photoId && urls[item.photoId]);
  return slide?.photoId ? urls[slide.photoId] : "";
}

function loadStoryImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("One highlight photo could not be prepared."));
    image.src = url;
  });
}

function drawStoryPhoto(context: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function storyTextLines(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) { lines.push(line); line = word; }
    else line = candidate;
  });
  if (line) lines.push(line);
  return lines;
}

async function renderSavedHighlight(
  story: TripStory,
  photoUrls: Record<string, string>,
  music: HighlightMusic,
  onProgress: (progress: number) => void,
): Promise<{ blob: Blob; extension: "mp4" | "webm" }> {
  if (typeof MediaRecorder === "undefined") throw new Error("Video creation is unavailable on this device.");
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 1280;
  const context = canvas.getContext("2d");
  if (!context || typeof canvas.captureStream !== "function") throw new Error("Video creation is unavailable on this device.");
  const mimeCandidates = music === "none"
    ? ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm"]
    : ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
  const mimeType = mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type));
  const stream = canvas.captureStream(15);
  const AudioContextClass = window.AudioContext;
  const audioContext = music !== "none" && AudioContextClass ? new AudioContextClass() : null;
  let soundtrackSource: AudioBufferSourceNode | null = null;
  if (audioContext) {
    await audioContext.resume();
    const destination = audioContext.createMediaStreamDestination();
    const duration = story.slides.reduce((total, slide) => total + slideDuration(slide), 0);
    try {
      const soundtrack = await fetch(musicAssetUrl(music as Exclude<HighlightMusic, "none">)).then((response) => {
        if (!response.ok) throw new Error("Soundtrack unavailable");
        return response.arrayBuffer();
      });
      soundtrackSource = audioContext.createBufferSource();
      soundtrackSource.buffer = await audioContext.decodeAudioData(soundtrack);
      soundtrackSource.loop = duration > soundtrackSource.buffer.duration;
      soundtrackSource.loopEnd = Math.min(24, soundtrackSource.buffer.duration);
      soundtrackSource.connect(destination);
      soundtrackSource.start();
    } catch {
      scheduleGeneratedMusic(audioContext, destination, music as Exclude<HighlightMusic, "none">, duration);
    }
    const audioTrack = destination.stream.getAudioTracks()[0];
    if (audioTrack) stream.addTrack(audioTrack);
  }
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 }) : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise<void>((resolve, reject) => { recorder.onstop = () => resolve(); recorder.onerror = () => reject(new Error("Video creation stopped unexpectedly.")); });
  recorder.start(1000);
  const fps = 15;
  const totalFrames = story.slides.reduce((total, slide) => total + slideDuration(slide) * fps, 0);
  let completedFrames = 0;
  try {
    for (const slide of story.slides) {
      const image = slide.photoId && photoUrls[slide.photoId] ? await loadStoryImage(photoUrls[slide.photoId]) : null;
      const frames = slideDuration(slide) * fps;
      for (let frame = 0; frame < frames; frame += 1) {
        const progress = frame / Math.max(1, frames - 1);
        const fade = Math.min(1, progress / 0.12, (1 - progress) / 0.12);
        context.save();
        context.fillStyle = slide.background || "#173e54";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.globalAlpha = Math.max(0, fade);
        if (image && slide.layout !== "quote") {
          if (slide.layout === "split") {
            context.save();
            context.beginPath();
            context.rect(0, 0, canvas.width, canvas.height * 0.58);
            context.clip();
            drawStoryPhoto(context, image, canvas.width, canvas.height * 0.58);
            context.restore();
          } else drawStoryPhoto(context, image, canvas.width, canvas.height);
        }
        if (slide.layout === "caption" && image) {
          const gradient = context.createLinearGradient(0, canvas.height * 0.5, 0, canvas.height);
          gradient.addColorStop(0, "rgba(5,14,19,0)");
          gradient.addColorStop(1, "rgba(5,14,19,.7)");
          context.fillStyle = gradient;
          context.fillRect(0, canvas.height * 0.5, canvas.width, canvas.height * 0.5);
        }
        if (slide.layout !== "full" && (slide.text.trim() || slide.emoji.trim())) {
          const panelTop = slide.layout === "split" ? canvas.height * 0.58 : slide.layout === "caption" ? canvas.height * 0.69 : 0;
          const panelHeight = slide.layout === "quote" ? canvas.height : canvas.height - panelTop;
          if (slide.layout === "split") {
            context.fillStyle = slide.background || "#173e54";
            context.fillRect(0, panelTop, canvas.width, panelHeight);
          }
          context.fillStyle = "#fffdf8";
          context.textAlign = "center";
          context.textBaseline = "middle";
          if (slide.emoji.trim()) {
            context.font = "72px -apple-system, BlinkMacSystemFont, sans-serif";
            context.fillText(slide.emoji, canvas.width / 2, panelTop + panelHeight * 0.3);
          }
          context.font = "500 44px Georgia";
          const lines = storyTextLines(context, slide.text || "Add a caption", canvas.width * 0.78).slice(0, 5);
          lines.forEach((line, index) => context.fillText(line, canvas.width / 2, panelTop + panelHeight * 0.55 + (index - (lines.length - 1) / 2) * 54));
        }
        for (const element of slide.elements ?? []) {
          context.save();
          context.translate(canvas.width * element.x / 100, canvas.height * element.y / 100);
          context.rotate(element.rotation * Math.PI / 180);
          context.scale(element.scale, element.scale);
          context.textAlign = "center";
          context.textBaseline = "middle";
          const fontSize = element.kind === "text" ? 42 : 74;
          context.font = element.kind === "text" ? `500 ${fontSize}px Georgia` : `${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
          const lines = storyTextLines(context, element.value, canvas.width * 0.72);
          const lineHeight = fontSize * 1.12;
          const boxWidth = Math.min(canvas.width * 0.78, Math.max(70, ...lines.map((line) => context.measureText(line).width)) + 30);
          if (element.background && element.background !== "transparent") {
            context.fillStyle = element.background;
            context.fillRect(-boxWidth / 2, -(lines.length * lineHeight) / 2 - 10, boxWidth, lines.length * lineHeight + 20);
          }
          context.fillStyle = element.color || "#ffffff";
          lines.forEach((line, index) => context.fillText(line, 0, (index - (lines.length - 1) / 2) * lineHeight));
          context.restore();
        }
        context.restore();
        completedFrames += 1;
        onProgress(completedFrames / Math.max(1, totalFrames));
        await new Promise((resolve) => window.setTimeout(resolve, 1000 / fps));
      }
    }
    recorder.stop();
    await stopped;
  } catch (error) {
    if (recorder.state !== "inactive") recorder.stop();
    await stopped.catch(() => undefined);
    throw error;
  } finally { try { soundtrackSource?.stop(); } catch {} stream.getTracks().forEach((track) => track.stop()); await audioContext?.close(); }
  const outputType = recorder.mimeType || mimeType || "video/webm";
  return { blob: new Blob(chunks, { type: outputType }), extension: outputType.includes("mp4") ? "mp4" : "webm" };
}

export default function StoryBuilder({ days, highlights, currentMember, photos, photoUrls, onChange }: StoryBuilderProps) {
  const stories = highlights;
  const [draft, setDraft] = useState<TripStory | null>(null);
  const [showTitlePrompt, setShowTitlePrompt] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [selectedSlideId, setSelectedSlideId] = useState("");
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [playing, setPlaying] = useState<TripStory | null>(null);
  const [playIndex, setPlayIndex] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState("");
  const [exportingStoryId, setExportingStoryId] = useState("");
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMessage, setExportMessage] = useState("");
  const [videoExportStory, setVideoExportStory] = useState<TripStory | null>(null);
  const [musicChoice, setMusicChoice] = useState<HighlightMusic>("baroque");
  const [previewingMusic, setPreviewingMusic] = useState(false);
  const musicPreviewRef = useRef<{ audio: HTMLAudioElement; timer: number } | null>(null);
  const selectedSlide = draft?.slides.find((slide) => slide.id === selectedSlideId) ?? draft?.slides[0];
  const selectedElement = selectedSlide?.elements?.find((element) => element.id === selectedElementId);
  const availablePhotos = useMemo(() => photos.filter((photo) => photoUrls[photo.fileId]), [photoUrls, photos]);

  useEffect(() => {
    if (!playing?.slides.length) return;
    const slide = playing.slides[playIndex] ?? playing.slides[0];
    const timer = window.setTimeout(() => {
      if (playIndex >= playing.slides.length - 1) setPlaying(null);
      else setPlayIndex((index) => index + 1);
    }, slideDuration(slide) * 1000);
    return () => window.clearTimeout(timer);
  }, [playIndex, playing]);

  useEffect(() => () => {
    if (musicPreviewRef.current) {
      window.clearTimeout(musicPreviewRef.current.timer);
      musicPreviewRef.current.audio.pause();
    }
  }, []);

  function startStory() {
    if (!currentMember) return;
    setTitleDraft("");
    setShowTitlePrompt(true);
  }

  function beginHighlight() {
    if (!currentMember) return;
    const now = new Date().toISOString();
    setDraft({ id: crypto.randomUUID(), title: titleDraft.trim() || "My Trip Highlight", memberId: currentMember.id, memberName: currentMember.name, status: "draft", slides: [], createdAt: now, updatedAt: now });
    setSelectedSlideId("");
    setShowTitlePrompt(false);
    setSelectedPhotoIds([]);
    setShowPhotoPicker(true);
  }

  function editStory(story: TripStory) {
    setDraft(structuredClone(story));
    setSelectedSlideId(story.slides[0]?.id ?? "");
  }

  function updateSlide(changes: Partial<TripStorySlide>) {
    if (!draft || !selectedSlide) return;
    setDraft({ ...draft, slides: draft.slides.map((slide) => slide.id === selectedSlide.id ? { ...slide, ...changes } : slide) });
  }

  function addElement(kind: TripHighlightElement["kind"]) {
    if (!selectedSlide) return;
    const element: TripHighlightElement = {
      id: crypto.randomUUID(), kind, value: kind === "text" ? "Tap to edit" : kind === "emoji" ? "✨" : "♡",
      x: 50, y: kind === "text" ? 72 : 32, scale: 1, rotation: 0, color: "#ffffff", background: kind === "text" ? "rgba(8,22,29,.35)" : "transparent",
    };
    updateSlide({ elements: [...(selectedSlide.elements ?? []), element] });
    setSelectedElementId(element.id);
  }

  function updateElement(changes: Partial<TripHighlightElement>) {
    if (!selectedSlide || !selectedElementId) return;
    updateSlide({ elements: (selectedSlide.elements ?? []).map((element) => element.id === selectedElementId ? { ...element, ...changes } : element) });
  }

  function beginElementDrag(event: ReactPointerEvent, element: TripHighlightElement) {
    const canvas = event.currentTarget.parentElement;
    if (!canvas) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedElementId(element.id);
    const move = (pointer: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(4, Math.min(96, ((pointer.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(4, Math.min(96, ((pointer.clientY - rect.top) / rect.height) * 100));
      setDraft((current) => current ? { ...current, slides: current.slides.map((slide) => slide.id === selectedSlide.id ? { ...slide, elements: (slide.elements ?? []).map((item) => item.id === element.id ? { ...item, x, y } : item) } : slide) } : current);
    };
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  function addSlides(photoIds: string[]) {
    if (!draft) return;
    const additions = photoIds.map((id) => newSlide(id));
    setDraft({ ...draft, slides: [...draft.slides, ...additions] });
    if (additions[0]) setSelectedSlideId(additions[0].id);
    setShowPhotoPicker(false);
  }

  function moveSlide(index: number, direction: -1 | 1) {
    if (!draft) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draft.slides.length) return;
    const slides = [...draft.slides];
    [slides[index], slides[nextIndex]] = [slides[nextIndex], slides[index]];
    setDraft({ ...draft, slides });
  }

  function saveStory(status: TripStory["status"]) {
    if (!draft || !draft.slides.length) return;
    const saved = { ...draft, title: draft.title.trim() || "My Trip Highlight", status, updatedAt: new Date().toISOString() };
    onChange([...stories.filter((story) => story.id !== saved.id), saved]);
    setDraft(null);
  }

  function deleteStory(story: TripStory) {
    if (story.memberId !== currentMember?.id || !window.confirm(`Delete “${story.title}”?`)) return;
    onChange(stories.filter((item) => item.id !== story.id));
  }

  function stopMusicPreview() {
    const preview = musicPreviewRef.current;
    if (preview) {
      window.clearTimeout(preview.timer);
      preview.audio.pause();
      preview.audio.currentTime = 0;
      musicPreviewRef.current = null;
    }
    setPreviewingMusic(false);
  }

  async function toggleMusicPreview() {
    if (previewingMusic) { stopMusicPreview(); return; }
    if (musicChoice === "none") return;
    stopMusicPreview();
    const audio = new Audio(musicAssetUrl(musicChoice));
    audio.preload = "auto";
    try {
      await audio.play();
      const timer = window.setTimeout(() => { audio.pause(); audio.currentTime = 0; musicPreviewRef.current = null; setPreviewingMusic(false); }, 10_000);
      musicPreviewRef.current = { audio, timer };
      setPreviewingMusic(true);
    } catch {
      setExportMessage("This soundtrack could not be previewed. Please try again.");
    }
  }

  async function saveHighlightVideo(story: TripStory, music: HighlightMusic) {
    if (!story.slides.length || exportingStoryId) return;
    setExportingStoryId(story.id);
    setExportProgress(0);
    setExportMessage("");
    try {
      stopMusicPreview();
      setVideoExportStory(null);
      const result = await renderSavedHighlight(story, photoUrls, music, setExportProgress);
      if (!result.blob.size) throw new Error("The downloaded video was empty. Please try again.");
      if (canSaveDirectlyToPhotos()) {
        setExportMessage("Saving video to Photos…");
        await saveBlobToNativePhotos(result.blob, result.blob.type || `video/${result.extension}`);
      }
      else {
        const url = URL.createObjectURL(result.blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${story.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "Zora-Highlight"}.${result.extension}`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setExportMessage(canSaveDirectlyToPhotos() ? "Highlight saved to Photos" : "Highlight downloaded");
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "The highlight video could not be created.");
    } finally {
      setExportingStoryId("");
      window.setTimeout(() => setExportMessage(""), 3500);
    }
  }

  return <>
    <section className="story-studio" aria-labelledby="story-studio-title">
      <header><div><p className="eyebrow">Made from the whole adventure</p><h2 id="story-studio-title">Highlights</h2><p>Mix moments from any day, then decorate every slide your way.</p></div><button className="primary-button" onClick={startStory} disabled={!currentMember}>＋ Create Highlight</button></header>
      {stories.length === 0 ? <button className="story-empty" onClick={startStory} disabled={!currentMember}><span>✦</span><strong>Your first highlight starts here</strong><small>Choose snapshots from across the trip and make them your own.</small></button> : <div className="story-library">{stories.map((story) => {
        const cover = coverUrl(story, photoUrls);
        const mine = story.memberId === currentMember?.id;
        return <article key={story.id} className="story-library-card" style={cover ? { backgroundImage: `linear-gradient(rgba(8,22,29,.16), rgba(8,22,29,.76)), url(${cover})` } : undefined}>
          <button className="story-library-open" onClick={() => { setPlaying(story); setPlayIndex(0); }}><small>{story.status === "draft" ? "Draft" : `${story.slides.length} slides`}</small><strong>{story.title}</strong><span>by {story.memberName}</span></button>
          <div><button onClick={() => { setVideoExportStory(story); setMusicChoice("baroque"); }} disabled={Boolean(exportingStoryId)}>{exportingStoryId === story.id ? `Preparing ${Math.round(exportProgress * 100)}%` : "Download as Video"}</button>{mine && <><button onClick={() => editStory(story)}>Edit</button><button onClick={() => deleteStory(story)}>Delete</button></>}</div>
        </article>;
      })}</div>}
      {exportMessage && <p className="story-export-message" role="status">{exportMessage}</p>}
    </section>

    {videoExportStory && <div className="modal-backdrop highlight-music-backdrop" role="presentation" onMouseDown={() => { stopMusicPreview(); setVideoExportStory(null); }}><section className="modal highlight-music-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><p className="eyebrow">Download as Video</p><h2>Choose your soundtrack</h2><p className="modal-copy">Preview a royalty-free instrumental, then download the finished highlight video.</p><div className="highlight-music-options">{musicChoices.map((choice) => <button className={musicChoice === choice.value ? "active" : ""} onClick={() => { stopMusicPreview(); setMusicChoice(choice.value); }} key={choice.value}><span>{musicIcons[choice.value]}</span><div><strong>{choice.label}</strong><small>{choice.description}</small></div><i>{musicChoice === choice.value ? "✓" : ""}</i></button>)}</div><div className="modal-actions"><button className="secondary-button" onClick={() => { stopMusicPreview(); setVideoExportStory(null); }}>Cancel</button><button className="secondary-button" onClick={() => void toggleMusicPreview()} disabled={musicChoice === "none"}>{previewingMusic ? "■ Stop Preview" : "▶ Preview Music"}</button><button className="primary-button" onClick={() => void saveHighlightVideo(videoExportStory, musicChoice)}>Download Video</button></div></section></div>}

    {showTitlePrompt && <div className="modal-backdrop story-title-backdrop" role="presentation" onMouseDown={() => setShowTitlePrompt(false)}><section className="modal story-title-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><p className="eyebrow">New Highlight</p><h2>Give it a title</h2><p className="modal-copy">You can use moments from any day in this trip.</p><input value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} placeholder="e.g. Our Vienna favourites" autoFocus maxLength={80} onKeyDown={(event) => { if (event.key === "Enter" && titleDraft.trim()) beginHighlight(); }} /><div className="modal-actions"><button className="secondary-button" onClick={() => setShowTitlePrompt(false)}>Cancel</button><button className="primary-button" onClick={beginHighlight} disabled={!titleDraft.trim()}>Choose photos</button></div></section></div>}

    {draft && <div className="story-builder-backdrop" role="presentation"><section className="story-builder" role="dialog" aria-modal="true" aria-labelledby="story-builder-title">
      <header><button className="story-builder-close" onClick={() => setDraft(null)} aria-label="Close">×</button><div><p className="eyebrow">Highlight Editor</p><input id="story-builder-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} aria-label="Highlight title" /></div><button className="text-button" onClick={() => saveStory("draft")}>Save draft</button></header>
      <div className="story-builder-body">
        <aside className="story-slide-rail"><button className="story-add-slide" onClick={() => setShowPhotoPicker(true)}>＋</button>{draft.slides.map((slide, index) => <div className={slide.id === selectedSlide?.id ? "active" : ""} key={slide.id}><button onClick={() => setSelectedSlideId(slide.id)}><small>{index + 1}</small>{slide.photoId && photoUrls[slide.photoId] ? <img src={photoUrls[slide.photoId]} alt="" /> : <span style={{ background: slide.background }}>{slide.emoji}</span>}</button><nav><button onClick={() => moveSlide(index, -1)} disabled={index === 0}>↑</button><button onClick={() => moveSlide(index, 1)} disabled={index === draft.slides.length - 1}>↓</button></nav></div>)}</aside>
        {selectedSlide ? <main className="story-editing-area">
          <div className={`story-phone-preview freeform layout-${selectedSlide.layout}`} style={{ background: selectedSlide.background }} onClick={() => setSelectedElementId("")}>
            {selectedSlide.photoId && photoUrls[selectedSlide.photoId] && <img src={photoUrls[selectedSlide.photoId]} alt="Story preview" />}
            {selectedSlide.layout !== "full" && <div className="story-layout-copy"><b>{selectedSlide.emoji}</b><p>{selectedSlide.text || (selectedSlide.layout === "quote" ? "Write a quote to remember…" : "Add a caption…")}</p></div>}
            {(selectedSlide.elements ?? []).map((element) => <button className={`highlight-canvas-element ${element.kind} ${element.id === selectedElementId ? "selected" : ""}`} style={{ left: `${element.x}%`, top: `${element.y}%`, color: element.color, background: element.background, transform: `translate(-50%,-50%) rotate(${element.rotation}deg) scale(${element.scale})` }} onPointerDown={(event) => beginElementDrag(event, element)} key={element.id}>{element.value}</button>)}
          </div>
          <div className="story-controls">
            {selectedSlide.layout !== "full" && <div className="story-layout-fields"><label><span>{selectedSlide.layout === "quote" ? "Quote" : "Caption"}</span><textarea value={selectedSlide.text} onChange={(event) => updateSlide({ text: event.target.value })} maxLength={180} placeholder={selectedSlide.layout === "quote" ? "Write a quote to remember…" : "Add a caption…"} /></label><label><span>Emoji (optional)</span><input value={selectedSlide.emoji} onChange={(event) => updateSlide({ emoji: event.target.value })} maxLength={8} placeholder="✨" /></label></div>}
            <div className="highlight-add-elements"><button onClick={() => addElement("text")}>＋ Text</button><button onClick={() => addElement("emoji")}>＋ Emoji</button><button onClick={() => addElement("sticker")}>＋ Sticker</button></div>
            {selectedElement ? <div className="highlight-element-controls"><label><span>{selectedElement.kind === "text" ? "Text" : selectedElement.kind === "emoji" ? "Emoji" : "Sticker"}</span><input value={selectedElement.value} onChange={(event) => updateElement({ value: event.target.value })} maxLength={selectedElement.kind === "text" ? 120 : 16} /></label><fieldset><legend>Colour</legend><div className="story-colours">{elementColours.map((colour) => <button className={selectedElement.color === colour ? "active" : ""} style={{ background: colour }} onClick={() => updateElement({ color: colour })} key={colour} aria-label={`Use ${colour}`} />)}</div></fieldset><label><span>Size</span><input type="range" min="0.5" max="2.5" step="0.1" value={selectedElement.scale} onChange={(event) => updateElement({ scale: Number(event.target.value) })} /></label><label><span>Rotation</span><input type="range" min="-30" max="30" value={selectedElement.rotation} onChange={(event) => updateElement({ rotation: Number(event.target.value) })} /></label><button className="danger-button" onClick={() => { updateSlide({ elements: (selectedSlide.elements ?? []).filter((item) => item.id !== selectedElement.id) }); setSelectedElementId(""); }}>Remove element</button></div> : <p className="highlight-drag-hint">Add text, emoji or stickers, then drag them anywhere on the photo.</p>}
            <label><span>Photo layout</span><select value={selectedSlide.layout} onChange={(event) => updateSlide({ layout: event.target.value as TripStorySlide["layout"] })}>{layouts.map((layout) => <option value={layout.value} key={layout.value}>{layout.label}</option>)}</select></label>
            <fieldset><legend>Background</legend><div className="story-colours">{backgrounds.map((colour) => <button className={selectedSlide.background === colour ? "active" : ""} style={{ background: colour }} onClick={() => updateSlide({ background: colour })} key={colour} aria-label={`Use ${colour}`} />)}</div></fieldset>
            <label><span>{selectedSlide.photoId ? "Photo duration" : "Slide duration"}</span><select value={slideDuration(selectedSlide)} onChange={(event) => updateSlide({ duration: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((seconds) => <option value={seconds} key={seconds}>{seconds} second{seconds === 1 ? "" : "s"}</option>)}</select></label>
            <div className="story-control-actions"><button className="secondary-button" onClick={() => setShowPhotoPicker(true)}>Change/Add photos</button><button className="danger-button" disabled={draft.slides.length === 1} onClick={() => { const remaining = draft.slides.filter((slide) => slide.id !== selectedSlide.id); setDraft({ ...draft, slides: remaining }); setSelectedSlideId(remaining[0]?.id ?? ""); }}>Delete slide</button></div>
          </div>
        </main> : <main className="story-builder-welcome"><span>✦</span><h2>Choose how your highlight begins</h2><p>Add a snapshot from anywhere in the trip, or begin with a blank canvas.</p><div><button className="primary-button" onClick={() => setShowPhotoPicker(true)}>Choose a photo</button><button className="secondary-button" onClick={() => { const slide = newSlide(); setDraft({ ...draft, slides: [slide] }); setSelectedSlideId(slide.id); }}>Add blank slide</button></div></main>}
      </div>
      <footer><span>{draft.slides.length} slide{draft.slides.length === 1 ? "" : "s"}</span><div><button className="secondary-button" onClick={() => { setPlaying(draft); setPlayIndex(0); }} disabled={!draft.slides.length}>Preview</button><button className="primary-button" onClick={() => saveStory("finished")} disabled={!draft.slides.length}>Finish Highlight</button></div></footer>
    </section></div>}

    {showPhotoPicker && draft && <div className="modal-backdrop story-photo-picker-backdrop" role="presentation" onMouseDown={() => setShowPhotoPicker(false)}><section className="modal story-photo-picker" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><h2>Choose trip moments</h2><p className="modal-copy">Select one or several photos from any day. Each becomes a slide you can decorate.</p>{availablePhotos.length ? <div>{availablePhotos.map((photo) => { const day = days.find((item) => item.id === photo.dayId); const stop = day?.stops.find((item) => item.id === photo.stopId); const selected = selectedPhotoIds.includes(photo.fileId); return <button className={selected ? "selected" : ""} onClick={() => setSelectedPhotoIds((ids) => selected ? ids.filter((id) => id !== photo.fileId) : [...ids, photo.fileId])} key={photo.fileId}><img src={photoUrls[photo.fileId]} alt={photo.name} /><small>{day?.label}{stop ? ` · ${stop.title}` : ""}</small><span>{selected ? "✓" : "＋"}</span></button>; })}</div> : <p className="story-picker-empty">There are no shared snapshots in this trip yet. You can still make a blank highlight.</p>}<div className="modal-actions"><button className="secondary-button" onClick={() => setShowPhotoPicker(false)}>Cancel</button><button className="secondary-button" onClick={() => { const slide = newSlide(); setDraft({ ...draft, slides: [...draft.slides, slide] }); setSelectedSlideId(slide.id); setShowPhotoPicker(false); }}>Blank slide</button>{availablePhotos.length > 0 && <button className="primary-button" disabled={!selectedPhotoIds.length} onClick={() => { addSlides(selectedPhotoIds); setSelectedPhotoIds([]); }}>Add {selectedPhotoIds.length || ""} photo{selectedPhotoIds.length === 1 ? "" : "s"}</button>}</div></section></div>}

    {playing && playing.slides[playIndex] && (() => { const slide = playing.slides[playIndex]; return <div className={`story-player layout-${slide.layout}`} role="dialog" aria-modal="true" style={{ background: slide.background }} onClick={() => playIndex < playing.slides.length - 1 ? setPlayIndex(playIndex + 1) : setPlaying(null)}>
      <div className="story-progress">{playing.slides.map((_, index) => <i className={index <= playIndex ? "active" : ""} key={index} />)}</div><header><strong>{playing.title}</strong><button onClick={(event) => { event.stopPropagation(); setPlaying(null); }}>×</button></header>
      {slide.photoId && photoUrls[slide.photoId] && <img src={photoUrls[slide.photoId]} alt="" />}
      {slide.layout !== "full" && <div className="story-layout-copy"><b>{slide.emoji}</b><p>{slide.text}</p></div>}
      <main>{(slide.elements ?? []).map((element) => <span className={`highlight-play-element ${element.kind}`} style={{ left: `${element.x}%`, top: `${element.y}%`, color: element.color, background: element.background, transform: `translate(-50%,-50%) rotate(${element.rotation}deg) scale(${element.scale})` }} key={element.id}>{element.value}</span>)}</main><small>{playIndex + 1} / {playing.slides.length}</small>
    </div>; })()}
  </>;
}
