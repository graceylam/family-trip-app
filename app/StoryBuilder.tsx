"use client";

import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useState } from "react";
import type { SharedPhoto, TripDay, TripHighlightElement, TripMember, TripStory, TripStorySlide } from "../lib/googleDrive";

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

function newSlide(photoId = ""): TripStorySlide {
  return { id: crypto.randomUUID(), photoId: photoId || undefined, layout: photoId ? "full" : "quote", text: "", emoji: "", background: backgrounds[0], duration: 4, elements: [] };
}

function coverUrl(story: TripStory, urls: Record<string, string>): string {
  const slide = story.slides.find((item) => item.photoId && urls[item.photoId]);
  return slide?.photoId ? urls[slide.photoId] : "";
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
  const selectedSlide = draft?.slides.find((slide) => slide.id === selectedSlideId) ?? draft?.slides[0];
  const selectedElement = selectedSlide?.elements?.find((element) => element.id === selectedElementId);
  const availablePhotos = useMemo(() => photos.filter((photo) => photoUrls[photo.fileId]), [photoUrls, photos]);

  useEffect(() => {
    if (!playing?.slides.length) return;
    const slide = playing.slides[playIndex] ?? playing.slides[0];
    const timer = window.setTimeout(() => {
      if (playIndex >= playing.slides.length - 1) setPlaying(null);
      else setPlayIndex((index) => index + 1);
    }, Math.max(2, slide.duration) * 1000);
    return () => window.clearTimeout(timer);
  }, [playIndex, playing]);

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

  return <>
    <section className="story-studio" aria-labelledby="story-studio-title">
      <header><div><p className="eyebrow">Made from the whole adventure</p><h2 id="story-studio-title">Highlights</h2><p>Mix moments from any day, then decorate every slide your way.</p></div><button className="primary-button" onClick={startStory} disabled={!currentMember}>＋ Create Highlight</button></header>
      {stories.length === 0 ? <button className="story-empty" onClick={startStory} disabled={!currentMember}><span>✦</span><strong>Your first highlight starts here</strong><small>Choose snapshots from across the trip and make them your own.</small></button> : <div className="story-library">{stories.map((story) => {
        const cover = coverUrl(story, photoUrls);
        const mine = story.memberId === currentMember?.id;
        return <article key={story.id} className="story-library-card" style={cover ? { backgroundImage: `linear-gradient(rgba(8,22,29,.16), rgba(8,22,29,.76)), url(${cover})` } : undefined}>
          <button className="story-library-open" onClick={() => { setPlaying(story); setPlayIndex(0); }}><small>{story.status === "draft" ? "Draft" : `${story.slides.length} slides`}</small><strong>{story.title}</strong><span>by {story.memberName}</span></button>
          {mine && <div><button onClick={() => editStory(story)}>Edit</button><button onClick={() => deleteStory(story)}>Delete</button></div>}
        </article>;
      })}</div>}
    </section>

    {showTitlePrompt && <div className="modal-backdrop story-title-backdrop" role="presentation" onMouseDown={() => setShowTitlePrompt(false)}><section className="modal story-title-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><p className="eyebrow">New Highlight</p><h2>Give it a title</h2><p className="modal-copy">You can use moments from any day in this trip.</p><input value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} placeholder="e.g. Our Vienna favourites" autoFocus maxLength={80} onKeyDown={(event) => { if (event.key === "Enter" && titleDraft.trim()) beginHighlight(); }} /><div className="modal-actions"><button className="secondary-button" onClick={() => setShowTitlePrompt(false)}>Cancel</button><button className="primary-button" onClick={beginHighlight} disabled={!titleDraft.trim()}>Choose photos</button></div></section></div>}

    {draft && <div className="story-builder-backdrop" role="presentation"><section className="story-builder" role="dialog" aria-modal="true" aria-labelledby="story-builder-title">
      <header><button className="story-builder-close" onClick={() => setDraft(null)} aria-label="Close">×</button><div><p className="eyebrow">Highlight Editor</p><input id="story-builder-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} aria-label="Highlight title" /></div><button className="text-button" onClick={() => saveStory("draft")}>Save draft</button></header>
      <div className="story-builder-body">
        <aside className="story-slide-rail"><button className="story-add-slide" onClick={() => setShowPhotoPicker(true)}>＋</button>{draft.slides.map((slide, index) => <div className={slide.id === selectedSlide?.id ? "active" : ""} key={slide.id}><button onClick={() => setSelectedSlideId(slide.id)}><small>{index + 1}</small>{slide.photoId && photoUrls[slide.photoId] ? <img src={photoUrls[slide.photoId]} alt="" /> : <span style={{ background: slide.background }}>{slide.emoji}</span>}</button><nav><button onClick={() => moveSlide(index, -1)} disabled={index === 0}>↑</button><button onClick={() => moveSlide(index, 1)} disabled={index === draft.slides.length - 1}>↓</button></nav></div>)}</aside>
        {selectedSlide ? <main className="story-editing-area">
          <div className={`story-phone-preview freeform layout-${selectedSlide.layout}`} style={{ background: selectedSlide.background }} onClick={() => setSelectedElementId("")}>
            {selectedSlide.photoId && photoUrls[selectedSlide.photoId] && <img src={photoUrls[selectedSlide.photoId]} alt="Story preview" />}
            {(selectedSlide.elements ?? []).map((element) => <button className={`highlight-canvas-element ${element.kind} ${element.id === selectedElementId ? "selected" : ""}`} style={{ left: `${element.x}%`, top: `${element.y}%`, color: element.color, background: element.background, transform: `translate(-50%,-50%) rotate(${element.rotation}deg) scale(${element.scale})` }} onPointerDown={(event) => beginElementDrag(event, element)} key={element.id}>{element.value}</button>)}
          </div>
          <div className="story-controls">
            <div className="highlight-add-elements"><button onClick={() => addElement("text")}>＋ Text</button><button onClick={() => addElement("emoji")}>＋ Emoji</button><button onClick={() => addElement("sticker")}>＋ Sticker</button></div>
            {selectedElement ? <div className="highlight-element-controls"><label><span>{selectedElement.kind === "text" ? "Text" : selectedElement.kind === "emoji" ? "Emoji" : "Sticker"}</span><input value={selectedElement.value} onChange={(event) => updateElement({ value: event.target.value })} maxLength={selectedElement.kind === "text" ? 120 : 16} /></label><fieldset><legend>Colour</legend><div className="story-colours">{elementColours.map((colour) => <button className={selectedElement.color === colour ? "active" : ""} style={{ background: colour }} onClick={() => updateElement({ color: colour })} key={colour} aria-label={`Use ${colour}`} />)}</div></fieldset><label><span>Size</span><input type="range" min="0.5" max="2.5" step="0.1" value={selectedElement.scale} onChange={(event) => updateElement({ scale: Number(event.target.value) })} /></label><label><span>Rotation</span><input type="range" min="-30" max="30" value={selectedElement.rotation} onChange={(event) => updateElement({ rotation: Number(event.target.value) })} /></label><button className="danger-button" onClick={() => { updateSlide({ elements: (selectedSlide.elements ?? []).filter((item) => item.id !== selectedElement.id) }); setSelectedElementId(""); }}>Remove element</button></div> : <p className="highlight-drag-hint">Add text, emoji or stickers, then drag them anywhere on the photo.</p>}
            <label><span>Photo layout</span><select value={selectedSlide.layout} onChange={(event) => updateSlide({ layout: event.target.value as TripStorySlide["layout"] })}>{layouts.map((layout) => <option value={layout.value} key={layout.value}>{layout.label}</option>)}</select></label>
            <fieldset><legend>Background</legend><div className="story-colours">{backgrounds.map((colour) => <button className={selectedSlide.background === colour ? "active" : ""} style={{ background: colour }} onClick={() => updateSlide({ background: colour })} key={colour} aria-label={`Use ${colour}`} />)}</div></fieldset>
            <label><span>Slide duration</span><select value={selectedSlide.duration} onChange={(event) => updateSlide({ duration: Number(event.target.value) })}><option value={2}>2 seconds</option><option value={4}>4 seconds</option><option value={6}>6 seconds</option><option value={8}>8 seconds</option></select></label>
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
      <main>{(slide.elements ?? []).map((element) => <span className={`highlight-play-element ${element.kind}`} style={{ left: `${element.x}%`, top: `${element.y}%`, color: element.color, background: element.background, transform: `translate(-50%,-50%) rotate(${element.rotation}deg) scale(${element.scale})` }} key={element.id}>{element.value}</span>)}</main><small>{playIndex + 1} / {playing.slides.length}</small>
    </div>; })()}
  </>;
}
