"use client";

import { useEffect, useRef, useState } from "react";

export type SwipeMediaItem = {
  id: string;
  mediaType: "photo" | "video";
  thumbnailUrl: string;
  originalUrl: string;
  alt: string;
};

type MediaSwipeStageProps = {
  items: SwipeMediaItem[];
  currentId: string;
  onChange: (id: string) => void;
};

export default function MediaSwipeStage({ items, currentId, onChange }: MediaSwipeStageProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const [loadedOriginals, setLoadedOriginals] = useState<string[]>([]);
  const currentIndex = Math.max(0, items.findIndex((item) => item.id === currentId));

  useEffect(() => {
    const track = trackRef.current;
    if (!track || !items.length) return;
    const target = currentIndex * track.clientWidth;
    if (Math.abs(track.scrollLeft - target) > 2) track.scrollTo({ left: target, behavior: "auto" });
  }, [currentId, currentIndex, items.length]);

  useEffect(() => () => {
    if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
  }, []);

  function settleOnVisibleSlide() {
    const track = trackRef.current;
    if (!track || !items.length || track.clientWidth === 0) return;
    const index = Math.max(0, Math.min(items.length - 1, Math.round(track.scrollLeft / track.clientWidth)));
    const nextId = items[index]?.id;
    if (nextId && nextId !== currentId) onChange(nextId);
  }

  return <div
    ref={trackRef}
    className="native-media-track"
    onScroll={() => {
      if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = window.setTimeout(settleOnVisibleSlide, 70);
    }}
  >
    {items.map((item, index) => {
      const nearby = Math.abs(index - currentIndex) <= 2;
      const originalLoaded = loadedOriginals.includes(item.id);
      return <div className="native-media-slide" key={item.id} aria-hidden={item.id !== currentId}>
        {item.mediaType === "photo" ? <>
          <img className={`native-media-thumbnail ${originalLoaded ? "covered" : ""}`} src={item.thumbnailUrl} alt="" draggable={false} />
          {nearby && <img
            className={`native-media-original ${originalLoaded ? "loaded" : ""}`}
            src={item.originalUrl}
            alt={item.alt}
            draggable={false}
            decoding="async"
            onLoad={() => setLoadedOriginals((current) => current.includes(item.id) ? current : [...current, item.id])}
          />}
        </> : item.id === currentId ? (
          <video src={item.originalUrl} controls autoPlay playsInline preload="auto" />
        ) : (
          <video src={item.thumbnailUrl || item.originalUrl} muted playsInline preload={nearby ? "metadata" : "none"} />
        )}
      </div>;
    })}
  </div>;
}
