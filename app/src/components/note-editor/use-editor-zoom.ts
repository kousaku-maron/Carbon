import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const EDITOR_ZOOM_STORAGE_KEY = "carbon.editor.zoom";
const DEFAULT_EDITOR_ZOOM = 1;
const MIN_EDITOR_ZOOM = 0.6;
const MAX_EDITOR_ZOOM = 2;
const EDITOR_ZOOM_STEP = 0.1;
const ZOOM_INDICATOR_DISPLAY_MS = 2000;

function clampEditorZoom(value: number): number {
  return Math.min(MAX_EDITOR_ZOOM, Math.max(MIN_EDITOR_ZOOM, value));
}

function parseStoredEditorZoom(value: string | null): number {
  if (!value) return DEFAULT_EDITOR_ZOOM;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return DEFAULT_EDITOR_ZOOM;
  return clampEditorZoom(parsed);
}

export function useEditorZoom() {
  const [editorZoom, setEditorZoom] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_EDITOR_ZOOM;
    return parseStoredEditorZoom(window.localStorage.getItem(EDITOR_ZOOM_STORAGE_KEY));
  });
  const [zoomIndicatorVisible, setZoomIndicatorVisible] = useState(false);
  const zoomIndicatorTimeoutRef = useRef<number | null>(null);
  const editorZoomRef = useRef(editorZoom);

  const showZoomIndicator = useCallback(() => {
    if (zoomIndicatorTimeoutRef.current !== null) {
      window.clearTimeout(zoomIndicatorTimeoutRef.current);
      zoomIndicatorTimeoutRef.current = null;
    }
    setZoomIndicatorVisible(true);
    zoomIndicatorTimeoutRef.current = window.setTimeout(() => {
      setZoomIndicatorVisible(false);
      zoomIndicatorTimeoutRef.current = null;
    }, ZOOM_INDICATOR_DISPLAY_MS);
  }, []);

  const setNextEditorZoom = useCallback(
    (delta: number) => {
      const nextZoom = clampEditorZoom(
        Math.round((editorZoomRef.current + delta) * 10) / 10,
      );
      if (nextZoom === editorZoomRef.current) return;
      editorZoomRef.current = nextZoom;
      setEditorZoom(nextZoom);
      showZoomIndicator();
    },
    [showZoomIndicator],
  );

  const handleZoomIn = useCallback(() => {
    setNextEditorZoom(EDITOR_ZOOM_STEP);
  }, [setNextEditorZoom]);

  const handleZoomOut = useCallback(() => {
    setNextEditorZoom(-EDITOR_ZOOM_STEP);
  }, [setNextEditorZoom]);

  useEffect(() => {
    editorZoomRef.current = editorZoom;
    window.localStorage.setItem(EDITOR_ZOOM_STORAGE_KEY, editorZoom.toFixed(1));
  }, [editorZoom]);

  useEffect(() => {
    return () => {
      if (zoomIndicatorTimeoutRef.current !== null) {
        window.clearTimeout(zoomIndicatorTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || !event.shiftKey || event.altKey) return;
      if (event.isComposing) return;

      const isZoomIn =
        event.code === "Equal" || event.code === "NumpadAdd" || event.key === "+";
      const isZoomOut =
        event.code === "Minus" ||
        event.code === "NumpadSubtract" ||
        event.key === "-" ||
        event.key === "_";
      if (!isZoomIn && !isZoomOut) return;

      event.preventDefault();
      if (isZoomIn) {
        handleZoomIn();
      } else {
        handleZoomOut();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleZoomIn, handleZoomOut]);

  const editorContentStyle = useMemo<CSSProperties>(
    () => ({ ["--editor-zoom" as any]: editorZoom.toString() }) as CSSProperties,
    [editorZoom],
  );

  return {
    editorContentStyle,
    zoomIndicatorVisible,
    zoomPercent: Math.round(editorZoom * 100),
  };
}
