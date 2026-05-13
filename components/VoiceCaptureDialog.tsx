"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

// Minimal Web Speech API typings — TS doesn't ship them.
interface SRResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SRResultList {
  length: number;
  [i: number]: SRResult;
}
interface SREvent extends Event {
  resultIndex: number;
  results: SRResultList;
}
interface SR extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: { new(): SR };
    webkitSpeechRecognition?: { new(): SR };
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCommit: (transcript: string) => void;
}

export default function VoiceCaptureDialog({ open, onClose, onCommit }: Props) {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [supported, setSupported] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SR | null>(null);
  const finalsRef = useRef<string>("");

  useEffect(() => {
    if (!open) return;
    const SR = (typeof window !== "undefined" &&
      (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;
    setSupported(!!SR);
    return () => {
      try { recRef.current?.abort(); } catch {}
      recRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  function start() {
    setError(null);
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      return;
    }
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    finalsRef.current = transcript ? transcript + " " : "";
    r.onresult = (e) => {
      let finals = "";
      let interimPart = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finals += res[0].transcript;
        else interimPart += res[0].transcript;
      }
      if (finals) {
        finalsRef.current += finals;
        setTranscript(finalsRef.current.trim());
        setInterim("");
      } else {
        setInterim(interimPart);
      }
    };
    r.onerror = (e) => {
      setError(e.error || "Recording error");
      setRecording(false);
    };
    r.onend = () => {
      setRecording(false);
      setInterim("");
    };
    recRef.current = r;
    try {
      r.start();
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start recording");
    }
  }

  function stop() {
    try { recRef.current?.stop(); } catch {}
  }

  async function commitAndCopy() {
    const text = (transcript + (interim ? " " + interim : "")).trim();
    if (!text) return;
    try {
      stop();
      await navigator.clipboard.writeText(text);
    } catch {}
    onCommit(text);
    onClose();
  }

  function reset() {
    stop();
    setTranscript("");
    setInterim("");
    finalsRef.current = "";
    setError(null);
  }

  const display = (transcript + (interim ? (transcript ? " " : "") + interim : "")).trim();

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-lg sm:rounded-xl rounded-t-2xl shadow-xl p-5"
        style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold">Voice note</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Speak your thoughts. The transcript saves to the board and copies to your clipboard.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-2 -mt-1"
            aria-label="Close"
          >
            <Icon name="x" size={20} />
          </button>
        </div>

        {supported === false && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
            This browser doesn&apos;t support live speech recognition. Paste a transcript below instead.
          </div>
        )}

        <textarea
          value={display}
          onChange={(e) => {
            const v = e.target.value;
            setTranscript(v);
            setInterim("");
            finalsRef.current = v + " ";
          }}
          placeholder="Tap the mic and start talking…"
          rows={6}
          className="w-full border rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

        <div className="flex gap-2 mt-4">
          {supported !== false && (
            recording ? (
              <button
                onClick={stop}
                className="flex-1 px-4 py-3 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 font-medium flex items-center justify-center gap-2"
              >
                <Icon name="mic-recording" size={18} />
                Stop
              </button>
            ) : (
              <button
                onClick={start}
                className="flex-1 px-4 py-3 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 font-medium flex items-center justify-center gap-2 text-slate-800"
              >
                <Icon name="mic" size={18} />
                {transcript ? "Resume" : "Record"}
              </button>
            )
          )}
          <button
            onClick={commitAndCopy}
            disabled={!display.trim()}
            className="flex-1 px-4 py-3 text-sm rounded-lg bg-slate-900 text-white disabled:opacity-50 font-medium flex items-center justify-center gap-2"
          >
            <Icon name="check" size={18} />
            Save & copy
          </button>
        </div>
        {transcript && (
          <button
            onClick={reset}
            className="text-xs text-slate-400 hover:text-slate-700 mt-3"
          >
            Clear transcript
          </button>
        )}
        <p className="text-xs text-slate-400 mt-3">
          Saved as a sticky note on the board. Paste the copied transcript into Claude chat and ask for a mindmap.
        </p>
      </div>
    </div>
  );
}
