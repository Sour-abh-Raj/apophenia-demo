# Design rationale: the experimental battery

## Learning objective

Students should *experience* the gap between **perceiving** a pattern and **establishing** that the pattern reflects something real. Then they should discover, through an instructor-led reveal, why their judgments felt reasonable at the time.

## The final battery (about 8 minutes of testing)

| # | Task | Phenomenon | Trials | Signal / non-signal | Response |
|---|---|---|---|---|---|
| 1 | **Faces in the Noise** | Pareidolia, perceptual false alarms, top-down expectation | 2 practice + 20 scored | 5 faces / 15 pure noise | Tap the face *or* "No face"; then confidence |
| 2 | **Coin Sequences** | Illusory pattern perception in randomness; the clustering illusion / alternation bias | 1 practice + 12 scored | 6 rule-based / 6 fair coin | "Fair, random coin" vs "Hidden rule"; then confidence |
| 3 | **Branch Data** | Illusory correlation; selection effects (data dredging); replication | 1 practice + 12 scored | 4 planted relationships / 8 unrelated (4 typical + 4 cherry-picked) | "Real relationship" vs "No real relationship"; then confidence |

Confidence is a single tap: Guessing (1), Fairly sure (2), Very sure (3).

**Why these three, and why only three.** The three tasks move from *perception* (faces) to *sequential inference* (coins) to *managerial data judgment* (charts). That progression supports the MTM discussion: the same error type, a false alarm, appears at each level. All three share an identical signal-detection structure, so the debrief can show *the same metric* across very different material. A fourth task would push testing past about 10 minutes and squeeze the debrief. The candidates we considered (see [RESEARCH.md §2.4](RESEARCH.md)) were weaker on ground truth, time, or replicability.

**Concealment, not deception.** Participants are told truthfully what they are doing ("some images contain a faint face; others only noise"; "some sequences come from a fair coin, others from a coin with a hidden rule"; "synthetic data, variable names illustrative"). They are **not** told the base rates, that the session is about apophenia, or that some charts were cherry-picked. Nothing they are told is false. (Contrast Liu et al., 2014, who misinformed participants that 50 % of images contained faces; we deliberately did not copy that.)

---

## Task 1: Faces in the Noise

**Source paradigm.** Noise Pareidolia Test (Yokoi et al., 2014; Mamiya et al., 2016): 40 images, 8 with embedded faces, noise of 1/f³ spectral character.

**Adaptation (must be labelled as such).**
- **Stimuli are newly generated**, because the original figshare files could not be downloaded from the build environment. `scripts/stimuli/generate_faces.py` creates 420×420 greyscale images:
  - Noise: Gaussian amplitude spectrum ∝ 1/f^1.5 (power ∝ 1/f³) with random phases, z-scored, mean luminance 0.5, SD 0.17.
  - Faces: procedurally rendered, Lambert-shaded 3-D face height-maps with varied proportions and lighting (5 distinct faces). They are blurred and added to the noise through a soft elliptical mask at a fixed contrast. Difficulty levels: moderate (0.95, 0.88), hard (0.75, 0.72), very hard (0.60). These were calibrated by visual inspection so that faces are findable with effort but not obvious.
  - Exact face centre and ellipse radii are recorded in `stimuli/faces_manifest.json`.
- 20 scored trials (5 faces = 25 %; the original uses 20 %). Two practice images (one clearly visible face, one noise) are unscored and get no feedback.
- Added **localisation** (tap the face) and **confidence**.
- File names are opaque hashes, so a URL reveals nothing. The "hidden face without noise" reveal images live in `stimuli/private_faces/` and are served only to the projector or instructor key after the walkthrough begins.

**Ground truth.** Face present / absent per image; location for present faces.

**Scoring.**
- Hit = "face" on a face image; false alarm = "face" on a noise image; plus misses and correct rejections.
- Hit rate = hits / 5; false-alarm rate = FAs / 15; accuracy = (hits + CRs) / 20.
- d′ uses the log-linear correction: (count + 0.5) / (n + 1).
- Localisation = share of hits whose tap lies within 1.3× the face ellipse.
- Confidence is reported separately for correct and incorrect responses.

**What it cannot tell us.** Twenty trials give noisy individual estimates. The task is not the validated NPT and has no norms. It says nothing about hallucination proneness, mental health or personality.

---

## Task 2: Coin Sequences

**Source paradigms.** van Prooijen et al. (2018, Study 1) had participants rate random coin sequences as random vs. determined. Falk & Konold (1997) showed that people judge over-alternating sequences as most random.

**Adaptation.** We add **known non-random processes** so that responses have a ground truth.
- *Fair*: independent fair flips (P(switch) = 0.5); 6 sequences.
- *Switchy*: Markov coin, P(switch) = 0.7; 3 sequences.
- *Streaky*: Markov coin, P(switch) = 0.3; 3 sequences.
- 20 flips each; the first flip is 50/50.
- Seeded PRNG (mulberry32; seed `seq:20261009`).

**Selection rule (fixed before any data collection).** For each planned item, the generator kept the first draw that is *representative of its process*: alternation count within ±1 SD of the process mean, and 7–13 heads. This prevents a lopsided H/T count from giving the answer away, and it ensures each item illustrates its process rather than being an outlier. The plan order is shuffled so item IDs carry no information.

**What students typically experience.** Fair sequences contain runs of 4–7 (P(longest run ≥ 4 in 20 fair flips) ≈ 77 %, computed exactly and unit-tested), so they "look patterned". Switchy sequences look "nicely random". That is the Falk–Konold alternation bias, now visible as a false-alarm/miss pattern.

**Reveal content.** For each item: the process; alternations vs. 9.5 expected; the longest run and the probability of a run that long under a fair coin; and the **ideal-observer posterior** P(fair | sequence) given the three processes and their base rates (6:3:3). This is honest about uncertainty: a perfect statistician would be only 73–83 % confident on some fair items. The full answer-key view also explains the "specific sequence vs. category" distinction: every particular 20-flip sequence has probability 2⁻²⁰ under a fair coin, but categories (e.g. "≥ 14 switches") differ greatly in probability.

**Scoring.** Signal = rule-based sequence. Hit rate = rule items labelled "hidden rule" / 6. False-alarm rate = fair items labelled "hidden rule" / 6. Accuracy, d′, and the per-process "hidden rule" rate (fair / switchy / streaky) are also reported.

**Limits.** Prediction accuracy is not a measure of apophenia, so we do not ask for predictions. Following Miller & Sanjurjo (2018), we do not claim streaks are *never* informative in real-world processes. We only claim they are common in processes known to have no memory.

---

## Task 3: Branch Data

**Design.** Twelve scatterplots, each showing 30 "branches" of a fictional retailer. Every dataset is bivariate normal, rescaled to plausible business units and rounded for display.
- **Planted (4):** population ρ = +0.5 (2 charts) or −0.5 (2 charts). Realised sample r ranged from 0.41 to 0.60 in absolute value.
- **Independent (4):** ρ = 0, first draw kept (|r| between 0.05 and 0.27).
- **Cherry-picked (4):** ρ = 0, but each is the most correlated of **100** independent candidate datasets (|r| between 0.39 and 0.53). This simulates an analyst scanning many variable pairs.
- Seeds: `charts:20261009`. Label pairs come from a pool of 12 and were assigned by a separate seeded shuffle (`labels:20261009`) that is independent of the truth, so label plausibility carries no information. (The debrief reveals this: "any story linking them came from you".)
- **No deception in display:** the same axis rule for every chart (data range ± 8 %, "nice" ticks); no trend lines, r values or p-values during testing; no truncated or stretched axes (cf. Cleveland et al., 1982).
- **Replication sample:** for every chart, 300 fresh branches were drawn from the *same* process. In the reveal, planted relationships persist (replication r 0.49–0.52 in absolute value), and cherry-picked ones collapse (|r| ≤ 0.10).

**Scoring.** Signal = planted relationship. Hit rate / 4. False-alarm rate over the 8 unrelated charts, and separately for the 4 cherry-picked charts. Accuracy, d′, and confidence by correctness are also reported.

**Interpretation boundaries.** A planted association is a *genuine association*, not evidence of causation (stated in the reveal). Seeing the cherry-picked charts as related is not "irrational": with n = 30, they look exactly like the planted ones. The lesson is about the **process** that produced the chart (search across many candidates) and about **replication**.

---

## Scoring principles (all tasks)

- Scores are **task-specific**. There is **no overall apophenia score** and no trait language.
- Rates are only computed for **complete** tasks, so every participant included in an aggregate has the same denominators.
- A participant counts towards a task's class average if they (a) completed that task, (b) consented to inclusion, and (c) were not excluded by the instructor (e.g. a test device). N is shown with every aggregate.
- Class averages are the **mean of individual rates**, using the same functions (`src/shared/scoring.ts`) as the personal reports and rankings.
- The results snapshot is computed when the instructor **locks** the test. It is recomputed only if the instructor re-opens the test or changes an exclusion.
- Practice trials are stored but never scored.

## Rankings

Rankings are off by default. The instructor chooses a **task**, a **metric** and a disclosure mode (top 1/3/N, bottom 1/3/N, a rank, a range, or all). Every metric has an explicit direction (e.g. "false-alarm rate — lower is better") shown on the projector. Ties use competition ranking ("1224") and are never split by a selection boundary. Only nicknames are shown, with the caption "a ranking on one metric of one short task … not a personal trait". The wording never says "most apophenic".

## Suggested 30-minute run of show

| Time | Phase (app state) | Instructor | Students see |
|---|---|---|---|
| 0:00–0:03 | LOBBY | Share the join link in Zoom chat; screen-share the projector (join code). Say only: "three short perception and judgment activities". | Join → lobby |
| 0:03–0:11 | TESTING_OPEN | Watch the dashboard; answer questions about controls only. | Tasks; then "You've completed all the activities…" |
| 0:11 | → TEST_LOCKED | Ask "Has everyone finished?" → **CLOSE TEST & LOCK RESPONSES** | "Your responses have been submitted…" |
| 0:11–0:16 | TEST_LOCKED | Slides: apophenia (Conrad; Brugger), pareidolia, clustering illusion, illusory correlation, confirmation bias; management examples. | Waiting screen |
| 0:16–0:23 | ANSWER_WALKTHROUGH | **BEGIN ANSWER WALKTHROUGH**. Use the "featured" path: faces (start with two noise images, then the faces), 4 sequences, then the charts with their replications. Use "Show full answer key" to summarise a task quickly. | Waiting screen |
| 0:23–0:27 | RESULTS_RELEASED | **SHOW CLASS & INDIVIDUAL RESULTS**. Projector tabs: Overview → Faces (click maps on noise) → Coins (fair vs switchy) → Branch Data (cherry-picked) → Confidence. Optional ranking. | Personal report vs class |
| 0:27–0:30 | RESULTS_RELEASED → CLOSED | Discussion questions; Conclusion; **Close & archive**. | Report remains available |
