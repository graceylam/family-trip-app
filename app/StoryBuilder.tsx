"use client";

import { useEffect, useMemo, useState } from "react";
import type { SharedPhoto, TripDay, TripMember, TripStory, TripStorySlide } from "../lib/googleDrive";

type StoryBuilderProps = {
  day: TripDay;
  currentMember?: TripMember;
  photos: SharedPhoto[];
  photoUrls: Record<string, string>;
  onChange: (stories: TripStory[]) => void;
};

const backgrounds = ["#173e54", "#d98973", "#8fae9a", "#ad98bd", "#e7b967", "#f7efe3"];
const layouts: Array<{ value: TripStorySlide["layout"]; label: string }> = [
  { value: "full", label: "Full photo" },
  { value: "caption", label: "Photo + caption" },
  { value: "quote", label: "Quote card" },
  { value: "split", label: "Split" },
];

function newSlide(photoId = ""): TripStorySlide {
  return { id: crypto.randomUUID(), photoId: photoId || undefined, layout: photoId ? "caption" : "quote", text: "", emoji: "✨", background: backgrounds[0], duration: 4 };
}

function coverUrl(story: TripStory, urls: Record<string, string>): string {
  const slide = story.slides.find((item) => item.photoId && urls[item.photoId]);
  return slide?.photoId ? urls[slide.photoId] : "";
}

export default function StoryBuilder({ day, currentMember, photos, photoUrls, onChange }: StoryBuilderProps) {
  const stories = day.stories ?? [];
  const [draft, setDraft] = useState<TripStory | null>(null);
  const [selectedSlideId, setSelectedSlideId] = useState("");
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const [playing, setPlaying] = useState<TripStory | null>(null);
  const [playIndex, setPlayIndex] = useState(0);
  const selectedSlide = draft?.slides.find((slide) => slide.id === selectedSlideId) ?? draft?.slides[0];
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
    const now = new Date().toISOString();
    const first = newSlide(availablePhotos[0]?.fileId);
    setDraft({ id: crypto.randomUUID(), title: `${day.label} Story`, memberId: currentMember.id, memberName: currentMember.name, status: "draft", slides: [first], createdAt: now, updatedAt: now });
    setSelectedSlideId(first.id);
  }

  function editStory(story: TripStory) {
    setDraft(structuredClone(story));
    setSelectedSlideId(story.slides[0]?.id ?? "");
  }

  function updateSlide(changes: Partial<TripStorySlide>) {
    if (!draft || !selectedSlide) return;
    setDraft({ ...draft, slides: draft.slides.map((slide) => slide.id === selectedSlide.id ? { ...slide, ...changes } : slide) });
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
    const saved = { ...draft, title: draft.title.trim() || `${day.label} Story`, status, updatedAt: new Date().toISOString() };
    onChange([...stories.filter((story) => story.id !== saved.id), saved]);
    setDraft(null);
  }

  function deleteStory(story: TripStory) {
    if (story.memberId !== currentMember?.id || !window.confirm(`Delete “${story.title}”?`)) return;
    onChange(stories.filter((item) => item.id !== story.id));
  }

  return <>
    <section className="story-studio" aria-labelledby="story-studio-title">
      <header><div><p className="eyebrow">Tap-through memories</p><h2 id="story-studio-title">Stories</h2><p>Create a vertical photo story with your own words, colours and emoji.</p></div><button className="primary-button" onClick={startStory} disabled={!currentMember}>＋ Create Story</button></header>
      {stories.length === 0 ? <button className="story-empty" onClick={startStory} disabled={!currentMember}><span>✦</span><strong>Your first story starts here</strong><small>Choose snapshots, add a caption and make this day move.</small></button> : <div className="story-library">{stories.map((story) => {
        const cover = coverUrl(story, photoUrls);
        const mine = story.memberId === currentMember?.id;
        return <article key={story.id} className="story-library-card" style={cover ? { backgroundImage: `linear-gradient(rgba(8,22,29,.16), rgba(8,22,29,.76)), url(${cover})` } : undefined}>
          <button className="story-library-open" onClick={() => { setPlaying(story); setPlayIndex(0); }}><small>{story.status === "draft" ? "Draft" : `${story.slides.length} slides`}</small><strong>{story.title}</strong><span>by {story.memberName}</span></button>
          {mine && <div><button onClick={() => editStory(story)}>Edit</button><button onClick={() => deleteStory(story)}>Delete</button></div>}
        </article>;
      })}</div>}
    </section>

    {draft && <div className="story-builder-backdrop" role="presentation"><section className="story-builder" role="dialog" aria-modal="true" aria-labelledby="story-builder-title">
      <header><button className="story-builder-close" onClick={() => setDraft(null)} aria-label="Close">×</button><div><p className="eyebrow">Story Builder</p><input id="story-builder-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} aria-label="Story title" /></div><button className="text-button" onClick={() => saveStory("draft")}>Save draft</button></header>
      <div className="story-builder-body">
        <aside className="story-slide-rail"><button className="story-add-slide" onClick={() => setShowPhotoPicker(true)}>＋</button>{draft.slides.map((slide, index) => <div className={slide.id === selectedSlide?.id ? "active" : ""} key={slide.id}><button onClick={() => setSelectedSlideId(slide.id)}><small>{index + 1}</small>{slide.photoId && photoUrls[slide.photoId] ? <img src={photoUrls[slide.photoId]} alt="" /> : <span style={{ background: slide.background }}>{slide.emoji}</span>}</button><nav><button onClick={() => moveSlide(index, -1)} disabled={index === 0}>↑</button><button onClick={() => moveSlide(index, 1)} disabled={index === draft.slides.length - 1}>↓</button></nav></div>)}</aside>
        {selectedSlide && <main className="story-editing-area">
          <div className={`story-phone-preview layout-${selectedSlide.layout}`} style={{ background: selectedSlide.background }}>
            {selectedSlide.photoId && photoUrls[selectedSlide.photoId] && <img src={photoUrls[selectedSlide.photoId]} alt="Story preview" />}
            <div><b>{selectedSlide.emoji}</b>{selectedSlide.text && <p>{selectedSlide.text}</p>}</div>
          </div>
          <div className="story-controls">
            <label><span>Layout</span><select value={selectedSlide.layout} onChange={(event) => updateSlide({ layout: event.target.value as TripStorySlide["layout"] })}>{layouts.map((layout) => <option value={layout.value} key={layout.value}>{layout.label}</option>)}</select></label>
            <label><span>Your words</span><textarea value={selectedSlide.text} onChange={(event) => updateSlide({ text: event.target.value })} maxLength={240} placeholder="Write anything you want…" /></label>
            <label><span>Emoji</span><input value={selectedSlide.emoji} onChange={(event) => updateSlide({ emoji: event.target.value })} maxLength={12} placeholder="✨" /></label>
            <fieldset><legend>Background</legend><div className="story-colours">{backgrounds.map((colour) => <button className={selectedSlide.background === colour ? "active" : ""} style={{ background: colour }} onClick={() => updateSlide({ background: colour })} key={colour} aria-label={`Use ${colour}`} />)}</div></fieldset>
            <label><span>Slide duration</span><select value={selectedSlide.duration} onChange={(event) => updateSlide({ duration: Number(event.target.value) })}><option value={2}>2 seconds</option><option value={4}>4 seconds</option><option value={6}>6 seconds</option><option value={8}>8 seconds</option></select></label>
            <div className="story-control-actions"><button className="secondary-button" onClick={() => setShowPhotoPicker(true)}>Change/Add photos</button><button className="danger-button" disabled={draft.slides.length === 1} onClick={() => { const remaining = draft.slides.filter((slide) => slide.id !== selectedSlide.id); setDraft({ ...draft, slides: remaining }); setSelectedSlideId(remaining[0]?.id ?? ""); }}>Delete slide</button></div>
          </div>
        </main>}
      </div>
      <footer><span>{draft.slides.length} slide{draft.slides.length === 1 ? "" : "s"}</span><div><button className="secondary-button" onClick={() => { setPlaying(draft); setPlayIndex(0); }}>Preview</button><button className="primary-button" onClick={() => saveStory("finished")}>Finish Story</button></div></footer>
    </section></div>}

    {showPhotoPicker && draft && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowPhotoPicker(false)}><section className="modal story-photo-picker" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><h2>Choose snapshots</h2><p className="modal-copy">Tap one or more photos to add them as new slides.</p><div>{availablePhotos.map((photo) => <button onClick={() => addSlides([photo.fileId])} key={photo.fileId}><img src={photoUrls[photo.fileId]} alt={photo.name} /><span>＋</span></button>)}</div><div className="modal-actions"><button className="secondary-button" onClick={() => setShowPhotoPicker(false)}>Done</button><button className="primary-button" onClick={() => { const slide = newSlide(); setDraft({ ...draft, slides: [...draft.slides, slide] }); setSelectedSlideId(slide.id); setShowPhotoPicker(false); }}>Add text slide</button></div></section></div>}

    {playing && playing.slides[playIndex] && (() => { const slide = playing.slides[playIndex]; return <div className={`story-player layout-${slide.layout}`} role="dialog" aria-modal="true" style={{ background: slide.background }} onClick={() => playIndex < playing.slides.length - 1 ? setPlayIndex(playIndex + 1) : setPlaying(null)}>
      <div className="story-progress">{playing.slides.map((_, index) => <i className={index <= playIndex ? "active" : ""} key={index} />)}</div><header><strong>{playing.title}</strong><button onClick={(event) => { event.stopPropagation(); setPlaying(null); }}>×</button></header>
      {slide.photoId && photoUrls[slide.photoId] && <img src={photoUrls[slide.photoId]} alt="" />}
      <main><b>{slide.emoji}</b>{slide.text && <p>{slide.text}</p>}</main><small>{playIndex + 1} / {playing.slides.length}</small>
    </div>; })()}
  </>;
}
