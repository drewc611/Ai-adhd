# The mark

`mark.svg` is the square mark. `banner.svg` is the header, with the mark's geometry copied in;
a test fails if the two drift apart.

It draws the architecture rather than decorating it:

- **The gap between the origin and every ray is the isolation.** No ray touches the dot, and no
  ray touches another. That is the whole mechanism: a branch receives its brief and returns an
  artifact, and never learns the others exist.
- **The angles are uneven on purpose.** An evenly spaced fan would be a tree of thought, which
  is one idea sampled N times. Heterogeneous means the spacing is wrong deliberately.
- **Three survivors, three colours**, because they are three kinds of reasoning rather than
  three draws from one.
- **Two rays end in a cut, and the cuts stay visible.** A detector fired and the position
  stopped, and the reader still sees where. The pruned block always ships.

Five rays with two pruned is what the recorded runs actually do.

## Using it

Both files are plain SVG with no scripts and no external references, so they render anywhere
GitHub renders an image. `mark.svg` works as the repository social preview and as an avatar. It
holds up to about 48px and turns to mush below that, which is what five rays cost.

Colours: `#F0C24B` amber, `#45D0C0` teal, `#F97B6B` coral, `#3C4453` pruned, `#E9EFF6` origin,
on a `#1B202B` to `#0C0E13` tile.
