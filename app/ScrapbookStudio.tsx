"use client";

import { type PointerEvent as ReactPointerEvent, useMemo, useState } from "react";
import type { SharedPhoto, TripDay, TripMember, TripScrapbookPage, TripScrapbookPageElement } from "../lib/googleDrive";

type Props = {
  days: TripDay[];
  currentMember?: TripMember;
  media: SharedPhoto[];
  mediaUrls: Record<string, string>;
  pages: TripScrapbookPage[];
  onChange: (pages: TripScrapbookPage[]) => void;
};

const papers = ["#fffaf0", "#eef6f5", "#f8eee9", "#f1edf7", "#edf3fa", "#f5f1e7"];

function emptyPage(member: TripMember, type: TripScrapbookPage["pageType"], day?: TripDay): TripScrapbookPage {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), title: day ? `${day.label} recap` : "Untitled scrapbook", pageType: type, dayId: day?.id,
    background: papers[0], freeText: "", favouriteThings: ["", "", "", "", ""], weather: "", steps: "", distance: "",
    favouriteMemory: "", elements: [], memberId: member.id, memberName: member.name, createdAt: now, updatedAt: now,
  };
}

export default function ScrapbookStudio({ days, currentMember, media, mediaUrls, pages, onChange }: Props) {
  const [draft, setDraft] = useState<TripScrapbookPage | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [selectedElementId, setSelectedElementId] = useState("");
  const selectedElement = draft?.elements.find((item) => item.id === selectedElementId);
  const availableMedia = useMemo(() => media.filter((item) => mediaUrls[item.fileId]), [media, mediaUrls]);

  function create(type: TripScrapbookPage["pageType"], day?: TripDay) {
    if (!currentMember) return;
    setDraft(emptyPage(currentMember, type, day)); setCreateOpen(false); setSelectedElementId("");
  }

  function save() {
    if (!draft) return;
    const saved = { ...draft, title: draft.title.trim() || "Untitled scrapbook", updatedAt: new Date().toISOString() };
    onChange([...pages.filter((page) => page.id !== saved.id), saved]); setDraft(null);
  }

  function update(changes: Partial<TripScrapbookPage>) { setDraft((page) => page ? { ...page, ...changes } : page); }
  function updateElement(changes: Partial<TripScrapbookPageElement>) {
    if (!draft || !selectedElementId) return;
    update({ elements: draft.elements.map((item) => item.id === selectedElementId ? { ...item, ...changes } : item) });
  }
  function addElement(kind: TripScrapbookPageElement["kind"], value: string) {
    if (!draft) return;
    const element: TripScrapbookPageElement = { id: crypto.randomUUID(), kind, value, x: 50, y: 45, width: kind === "emoji" || kind === "sticker" ? 18 : 55, rotation: 0, colour: "#294552", frame: kind === "photo" || kind === "video" ? "polaroid" : "none" };
    update({ elements: [...draft.elements, element] }); setSelectedElementId(element.id); setMediaOpen(false);
  }
  function drag(event: ReactPointerEvent, element: TripScrapbookPageElement) {
    const canvas = event.currentTarget.parentElement; if (!canvas) return;
    event.preventDefault(); event.stopPropagation(); setSelectedElementId(element.id);
    const move = (pointer: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      update({ elements: (draft?.elements ?? []).map((item) => item.id === element.id ? { ...item, x: Math.max(3, Math.min(97, (pointer.clientX - rect.left) / rect.width * 100)), y: Math.max(3, Math.min(97, (pointer.clientY - rect.top) / rect.height * 100)) } : item) });
    };
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop);
  }

  return <section className="scrapbook-studio">
    <header><div><p className="eyebrow">Pages made together</p><h2>Digital Scrapbook</h2><p>Create guided day recaps or completely freeform pages.</p></div><button className="primary-button" onClick={() => setCreateOpen(true)} disabled={!currentMember}>＋ New Page</button></header>
    {pages.length ? <div className="scrapbook-library">{pages.map((page) => <article style={{ background: page.background }} key={page.id}><button onClick={() => { setDraft(structuredClone(page)); setSelectedElementId(""); }}><small>{page.pageType === "day-recap" ? "Day recap" : "Freeform"}</small><strong>{page.title}</strong><span>{page.elements.length} decoration{page.elements.length === 1 ? "" : "s"}</span></button>{page.memberId === currentMember?.id && <button className="scrapbook-page-delete" onClick={() => window.confirm(`Delete “${page.title}”?`) && onChange(pages.filter((item) => item.id !== page.id))}>×</button>}</article>)}</div> : <button className="scrapbook-library-empty" onClick={() => setCreateOpen(true)}><span>📖</span><strong>Start your first scrapbook page</strong><small>Choose a day recap or begin with blank paper.</small></button>}

    {createOpen && <div className="modal-backdrop" onMouseDown={() => setCreateOpen(false)}><section className="modal scrapbook-create-modal" onMouseDown={(event) => event.stopPropagation()}><p className="eyebrow">New scrapbook page</p><h2>How would you like to begin?</h2><button className="scrapbook-template-choice" onClick={() => create("freeform")}><span>✦</span><div><strong>Blank freeform page</strong><small>Photos, videos, words, stickers and anything you like.</small></div></button><div className="scrapbook-day-templates"><strong>Day recap</strong>{days.map((day, index) => <button onClick={() => create("day-recap", day)} key={day.id}><span>Day {index + 1}</span><b>{day.label}</b></button>)}</div><div className="modal-actions"><button className="secondary-button" onClick={() => setCreateOpen(false)}>Cancel</button></div></section></div>}

    {draft && <div className="scrapbook-editor-backdrop"><section className="scrapbook-editor"><header><button onClick={() => setDraft(null)}>×</button><input value={draft.title} onChange={(event) => update({ title: event.target.value })} aria-label="Scrapbook page title" /><button className="primary-button" onClick={save}>Save page</button></header><div className="scrapbook-editor-body"><aside><strong>Add</strong><button onClick={() => addElement("text", "Write something…")}>T Text</button><button onClick={() => addElement("emoji", "✨")}>😊 Emoji</button><button onClick={() => addElement("sticker", "♡")}>♡ Sticker</button><button onClick={() => setMediaOpen(true)}>▧ Photo / video</button><fieldset><legend>Paper</legend><div>{papers.map((paper) => <button className={draft.background === paper ? "active" : ""} style={{ background: paper }} onClick={() => update({ background: paper })} key={paper} />)}</div></fieldset>{selectedElement && <section className="scrapbook-element-controls"><strong>Edit selected item</strong>{selectedElement.kind !== "photo" && selectedElement.kind !== "video" && <input value={selectedElement.value} onChange={(event) => updateElement({ value: event.target.value })} />}<label>Size<input type="range" min="10" max="90" value={selectedElement.width} onChange={(event) => updateElement({ width: Number(event.target.value) })} /></label><label>Rotate<input type="range" min="-30" max="30" value={selectedElement.rotation} onChange={(event) => updateElement({ rotation: Number(event.target.value) })} /></label><button className="danger-button" onClick={() => { update({ elements: draft.elements.filter((item) => item.id !== selectedElement.id) }); setSelectedElementId(""); }}>Remove</button></section>}</aside><main className={`scrapbook-canvas ${draft.pageType}`} style={{ background: draft.background }} onClick={() => setSelectedElementId("")}>
      {draft.pageType === "day-recap" && <div className="day-recap-template"><p className="eyebrow">{days.findIndex((day) => day.id === draft.dayId) >= 0 ? `Day ${days.findIndex((day) => day.id === draft.dayId) + 1}` : "Day recap"}</p><textarea className="recap-free-text" value={draft.freeText} onChange={(event) => update({ freeText: event.target.value })} placeholder="How did today feel? Write anything you want…" /><section><h3>My five favourite things today</h3>{draft.favouriteThings.map((thing, index) => <label key={index}><span>{index + 1}</span><input value={thing} onChange={(event) => { const favouriteThings = [...draft.favouriteThings]; favouriteThings[index] = event.target.value; update({ favouriteThings }); }} placeholder="A little moment worth remembering" /></label>)}</section><div className="recap-metrics"><label><span>☀️ Weather</span><input value={draft.weather} onChange={(event) => update({ weather: event.target.value })} placeholder="18°C · Sunny" /></label><label><span>👟 Steps</span><input value={draft.steps} onChange={(event) => update({ steps: event.target.value })} placeholder="Optional" /></label><label><span>↝ Distance</span><input value={draft.distance} onChange={(event) => update({ distance: event.target.value })} placeholder="Optional" /></label></div><section className="recap-favourite"><h3>My favourite memory today</h3><textarea value={draft.favouriteMemory} onChange={(event) => update({ favouriteMemory: event.target.value })} placeholder="The moment I keep thinking about…" /></section></div>}
      {draft.pageType === "freeform" && draft.elements.length === 0 && <div className="scrapbook-blank-hint"><span>✦</span><strong>Your blank page</strong><small>Add photos, videos, words and decorations from the toolbar.</small></div>}
      {draft.elements.map((element) => <button className={`scrapbook-canvas-element ${element.kind} ${selectedElementId === element.id ? "selected" : ""}`} style={{ left: `${element.x}%`, top: `${element.y}%`, width: `${element.width}%`, color: element.colour, transform: `translate(-50%,-50%) rotate(${element.rotation}deg)` }} onPointerDown={(event) => drag(event, element)} key={element.id}>{element.kind === "photo" ? <img src={mediaUrls[element.value]} alt="Scrapbook memory" /> : element.kind === "video" ? <video src={mediaUrls[element.value]} controls onPointerDown={(event) => event.stopPropagation()} /> : element.value}</button>)}
    </main></div></section></div>}

    {mediaOpen && draft && <div className="modal-backdrop scrapbook-media-backdrop" onMouseDown={() => setMediaOpen(false)}><section className="modal scrapbook-media-picker" onMouseDown={(event) => event.stopPropagation()}><h2>Choose a trip memory</h2><p className="modal-copy">Use a photo or video from anywhere in this trip.</p><div>{availableMedia.map((item) => <button onClick={() => addElement(item.mimeType.startsWith("video/") ? "video" : "photo", item.fileId)} key={item.fileId}>{item.mimeType.startsWith("video/") ? <video src={mediaUrls[item.fileId]} /> : <img src={mediaUrls[item.fileId]} alt={item.name} />}<small>{item.memberName}</small></button>)}</div><div className="modal-actions"><button className="secondary-button" onClick={() => setMediaOpen(false)}>Cancel</button></div></section></div>}
  </section>;
}
