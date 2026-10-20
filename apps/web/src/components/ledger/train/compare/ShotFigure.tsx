// One screen of the compare panel: a captioned 16:9 frame (the caption's left side names it, the right side carries a
// fact or a control) with whatever the mode draws inside: one image, the slider's two, blink's two or the change map.
// Every compare mode renders its frame through this, so the caption and frame look the same in all four.
import type { ReactNode } from 'react';
import './ShotFigure.css';

export interface ShotFigureProps {
  cap: ReactNode;
  aside?: ReactNode;
  asideTitle?: string;
  /** Extra classes on the frame (`blink`, `after-on`). */
  frame?: string;
  /** The frame element, for a mode that drives a CSS variable on it (the slider's cut). */
  frameRef?: React.Ref<HTMLDivElement>;
  children: ReactNode;
}

export function ShotFigure({ cap, aside, asideTitle, frame, frameRef, children }: ShotFigureProps) {
  return (
    <figure className="tr-fig" data-role="tr-cmp-shot">
      <figcaption><span>{cap}</span>{aside !== undefined ? <span title={asideTitle}>{aside}</span> : null}</figcaption>
      <div ref={frameRef} className={'tr-scr' + (frame ? ' ' + frame : '')}>{children}</div>
    </figure>
  );
}

/** A screenshot inside a frame: decoded off the main thread, never lazy (only the open item's pair is mounted). */
export function ShotImg({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return <img src={src} alt={alt} className={className} decoding="async" draggable={false} />;
}

/** A frame with no capture on one side. */
export function NoCapture({ what }: { what: string }) {
  return <span className="tr-scr-none">no {what} capture</span>;
}
