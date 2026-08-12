"use client";

import { useCallback, useRef, useState } from "react";
import { DOCX_EXTENSION, DOCX_MIME_TYPE } from "@/lib/docx/upload";

interface DropzoneProps {
  readonly onFile: (file: File) => void;
  readonly disabled: boolean;
}

export function Dropzone({ onFile, disabled }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDraggedOver, setIsDraggedOver] = useState(false);

  // dragenter/dragleave also fire when crossing child elements, so a plain
  // boolean flickers. Counting entries against leaves tracks the real boundary.
  const dragDepth = useRef(0);

  const handleDragEnter = useCallback(() => {
    dragDepth.current += 1;
    setIsDraggedOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setIsDraggedOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepth.current = 0;
      setIsDraggedOver(false);

      const [dropped] = Array.from(event.dataTransfer.files);
      if (dropped) {
        onFile(dropped);
      }
    },
    [onFile],
  );

  const openFilePicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      className={[
        "group relative flex flex-col items-center justify-center gap-4",
        "rounded-2xl border-2 border-dashed px-8 py-16 text-center",
        "transition-all duration-300 ease-out",
        isDraggedOver
          ? "border-violet-400 bg-violet-500/10 scale-[1.01]"
          : "border-zinc-300 bg-white/50 dark:border-zinc-700 dark:bg-zinc-900/40",
        disabled ? "pointer-events-none opacity-60" : "",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        accept={`${DOCX_EXTENSION},${DOCX_MIME_TYPE}`}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          const [picked] = Array.from(event.target.files ?? []);
          if (picked) {
            onFile(picked);
          }
          // Reset so picking the same file twice still fires onChange.
          event.target.value = "";
        }}
      />

      <DocumentIcon isActive={isDraggedOver} />

      <div className="space-y-1">
        <p className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          {isDraggedOver ? "Drop it here" : "Drop a .docx file"}
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Word or Google Docs export &middot; up to 25 MB
        </p>
      </div>

      <button
        type="button"
        onClick={openFilePicker}
        disabled={disabled}
        className={[
          "rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white",
          "transition-colors duration-200 hover:bg-violet-600",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500",
          // Hover flips to violet in both themes, so the label goes white with
          // it — dark zinc text on violet reads as washed-out gray-on-color.
          "dark:bg-zinc-100 dark:text-zinc-900",
          "dark:hover:bg-violet-500 dark:hover:text-white",
        ].join(" ")}
      >
        Browse files
      </button>
    </div>
  );
}

function DocumentIcon({ isActive }: { readonly isActive: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={1.5}
      aria-hidden="true"
      className={[
        "h-12 w-12 transition-all duration-300",
        isActive
          ? "-translate-y-1 stroke-violet-500"
          : "stroke-zinc-400 dark:stroke-zinc-600",
      ].join(" ")}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14 3v4a1 1 0 0 0 1 1h4M15 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-4-4Z"
      />
      <path strokeLinecap="round" d="M9 13h6M9 17h4" />
    </svg>
  );
}
