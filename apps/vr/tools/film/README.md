# Film composer

Renders the whole demo film from one edit-decision list (EDL), so a re-cut is a JSON edit and a re-render.

```
node apps/vr/tools/film/compose.mjs <edl.json> [--preview] [--stills] [--out <file>] [--dry] [--keep]
```

- default output `apps/vr/Saved/demo/out/film.mp4` (git-ignored); `--preview` writes `film.preview.mp4` at 960x540, x264 veryfast
- `--stills`: one PNG per caption, card and clip midpoint plus every `stills[]` mark, in `<out>.stills/`, with
  `index.tsv` (file, time, what) and `contact.png` (4 across)
- `--dry`: validate, print the three ffmpeg commands and both filter graphs, render nothing
- `--keep`: keep the work folder `.<name>.work/` (graphs, `captions.ass`, `premaster.wav`)
- always writes `<out>.srt` (our line, then Glim's line)
- output: H.264 High, yuv420p, AAC 192k 48 kHz stereo, `+faststart`, exactly `duration` long (frame-rounded)

Timing on the PC (2026-11-18): 2:19 at 1080p about 40 s on synthetic sources, about 70 s on take4 with a 33 s
split; preview about 35 s.

## EDL

See `edl.sample.json` (the 2:19 cut on the picked cue, acts from `docs/concepts/demo-video/dry-run.md`). Paths are
relative to the repo root, or to the EDL's folder, or absolute. Keys starting with `_` are ignored (notes).

| Key | Meaning |
|---|---|
| `output` | `width`, `height`, `fps` (30), `crf` (18), `x264Preset` (medium) |
| `duration` | film length in seconds; the timeline ends here |
| `music` | `file`, `gainDb` (-20), `duckDb` (8, extra cut under every voice line), `duckAttackS` 0.25, `duckReleaseS` 0.5, `fadeInS` 0, `fadeOutS` 2 |
| `loudness` | `lufs` -14, `truePeakDb` -1, `lra` 20 (two-pass loudnorm, linear) |
| `style` | `font` (Segoe UI), `topSize` 58, `bottomSize` 46, `bottomColour` (#FFC98A), `band` (0.55 opacity); sizes are in 1080p pixels |
| `clips[]` | `at` (timeline s), `src`, `in`, `out` (source s), `speed` (1; retimes the picture), `preset`, `fadeInS`, `fadeOutS`, optional `name`, `crop {x,y,w,h}`, `cropYOffset` |
| `cards[]` | `at`, `dur`, `lines` (first large, the rest smaller), `colour` (black), `fadeInS`, `fadeOutS`, `textFadeS` (0.4) |
| `voice[]` | `at`, `file`, `gainDb` (0) |
| `voiceGainDb` | top level, added to every voice line's `gainDb` (e.g. -1.94 = Glim 20% quieter) |
| `splits[]` | `at`, `dur`, `left`/`right` {`src`, `in`, `speed`, `preset`, `loop`, `cropYOffset`, `crop`, `aspect`}, `labels` [2], `transitionIn` / `transitionOut` (`left`, `right`, `fade`, `cut`; default left / right), `transitionInS` / `transitionOutS` (0.6), `fadeInS`, `fadeOutS` |
| `captions[]` | `from`, `to`, `top` (ours, large, white), `bottom` (Glim's words, smaller, warm) |
| `stills[]` | extra still marks `{t, what}` (e.g. the sync points) |

Presets: `quest-left-eye-wide` (the left eye's centred 1832x1200, fitted to the height with navy at the sides),
`quest-left-eye-tall` (centred 1832x1600, for a split's headset panel), `quest-left-eye` (side-by-side Quest capture: the left eye's centred 16:9 region, 1832x1030 from 3664x1920,
`cropYOffset` nudges it, `crop` replaces it), `web` / `fit` (scale into the frame, letterbox if not 16:9), `fill`
(scale and centre-crop). Source audio is never used. Variable frame rate sources are resampled to `fps`.

Split screen: two panels of the same height on a navy blueprint grid (`style.splitBg`, default #0b1a2e), 2 px light
frames, letter-spaced cyan labels above (`style.labelFontFile`, default segoeuib.ttf), the caption band kept clear. The
panel widths follow the presets' aspects (web 16:9, tall 1.145). `transitionIn: "left"` starts with the left panel
filling the frame and pulls back to the layout (a zoompan camera move, eased); `transitionOut: "right"` pushes into
the right panel, so the next full-frame clip continues from it. A side source that ends early holds its last frame
(`loop: true` loops it).

```json
"voiceGainDb": -1.94,
"splits": [{ "at": 12, "dur": 33,
  "left":  { "src": "apps/vr/Saved/demo/web/s1-take1.mp4", "in": 7.595, "preset": "web", "loop": true },
  "right": { "src": "apps/vr/Saved/demo/takes/take4/seg_1.mp4", "in": 9.5, "preset": "quest-left-eye-tall" },
  "labels": ["On the web", "In the headset"],
  "transitionIn": "left", "transitionInS": 0.6, "transitionOut": "right", "transitionOutS": 0.6 }]
```

Picture track: clips, cards and splits may not overlap; gaps are black. Fades go to black. The caption band shows only while a
caption is up.

Validation fails with a list of every problem: missing files, `out` beyond the source's duration (ffprobe), `out <= in`,
overlapping clips/cards, anything ending after `duration`, unknown presets. Overlapping voice lines or captions are
warnings.

## How it renders

1. audio premaster: the bed (gain, ducked by a volume envelope computed from the voice placements, faded out) plus the
   voice lines at their `at` (adelay), mixed without normalisation
2. loudnorm pass 1 measures the premaster
3. picture: a concat of exact-frame-count segments (gaps, clips, cards), then the band (drawbox) and `captions.ass`
   (subtitles filter, fonts from `C:/Windows/Fonts`), muxed with the premaster through loudnorm pass 2

Re-cut loop: edit the EDL, `--preview --stills`, look at `contact.png`, then render full.
