# Shaped: reshape and icons

**Idea.** A lens never recolours a tile. It reshapes the outline to say something about its field,
and brings its own icons, words and one accent for its marks and text only.

**General composes the lenses.** Fixtures keep the plain rectangle. One icon chip per enabled lens sits
in the top edge in tab order (the six built-ins: ticket, artboard, brackets, dial, padlock, checkbox; any
other lens: its manifest glyph and rail, drawn by subtle's channel). Each is inked by that lens's
health (ink, amber, red), so the row is the General reading; on small tiles the chips become health
cells. On a lens switch the other five shrink and fade, the chosen chip slides to the head and
widens into a tag with a small readout, and the outline morphs in by dominance. Lens to lens passes
through the plain rectangle.

**Lenses** (outline · edge marks · tag · density):
- **Business**: ticket; bite depth = value · value pips · standard, sans.
- **Design**: artboard; crop marks grow with maturity, dashed for sketches · maturity steps · sparse, sans, one fact.
- **Development**: brackets; left spine = progress, right = agent-written share · agent bar and PR ticks · dense mono.
- **Operations**: pill; rollout gauge on the foot, red stop when live without alerting · environment pips · dense.
- **Security**: cut corners, deepest at foot-right (three for card data, two for personal); dashed second wall when unreviewed · class pips · standard.
- **Quality**: checklist edge, one notch per end-to-end test, filled when passing · pass bar · standard.

At L0 and L1, ribbon segments carry each lens's motif as a small mark (bite, cut, spine, gauge,
ticks, crops). Labels, sheet panels, tabs and the legend also change per lens.

**Known limits.** `marks` gets dominance through a hand-off from `shape` (the seam doesn't pass it).
The chip row needs fixtures about 100 px wide or more for six chips (wider for more lenses).
