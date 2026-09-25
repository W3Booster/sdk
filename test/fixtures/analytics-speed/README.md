# Captured maximum-speed replay regressions

Captured on 2026-09-24 in actual Warcraft III 3.0.0.24268, using the normal replay
controls and recorder DLL SHA-256
`9e5bcacea06334806747fef1e436159b30e5a7810deedf1f2b45399bb03aed5a`.

- `antoine-64x.json`: supplied Hommage Jason replay, 1×:8s → 64×:5s → 1×:8s.
  62 paired economy samples. Previous SDK history cleared 16 times.
- `sok-lyn-64x.json`: public warcraft3.info replay 142152, Northern Isles,
  1×:8s → 64×:15s → 1×:8s. 81 paired samples, 36 previous history clears.
  The UI selected 64×; achieved simulation rate was lower on this replay.

Files retain receipt times, native clock observations, coarse match times and
gold/upkeep counters only. Player IDs and clock sample origins are normalized.
Each file records its private source-capture hash. No account identifiers,
connection context, replay binaries, artwork or personal replay data is included.

Tests exercise the real interpolator's 50 ms scheduler and history with recorded
receipt times. Both feeds were valid throughout; every paired sample must survive.
Zero native rates and speed transitions are retained exactly, including a forward
heartbeat that previously rebased the displayed integer clock backwards.
