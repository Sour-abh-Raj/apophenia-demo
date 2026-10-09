# Literature review: paradigms for an apophenia teaching lab

This review informed the choice of tasks (see [DESIGN.md](DESIGN.md)). It focuses on paradigms that (a) produce a genuine perceptual or judgmental experience, (b) have an objective ground truth, and (c) fit a ~8-minute in-class testing window.

## How sources were verified (read this first)

The build environment could reach only GitHub and package registries. Publisher sites, PubMed/PMC, figshare and doi.org were **blocked** for both direct download and page fetching. Each reference below was therefore checked with web-search results: bibliographic records, abstracts, publisher and index pages, and citing papers. Full texts were **not** read. Where a detail comes from a secondary source or could not be confirmed, the entry says so. Please check the starred (★) details against the original PDFs before citing them in academic work.

## 1. Key concept and scientific-integrity frame

- **Apophenia.** The German term *Apophänie* was introduced by psychiatrist Klaus Conrad in *Die beginnende Schizophrenie* (1958), describing the "unmotivated seeing of connections" with a feeling of abnormal meaningfulness in early psychosis (Merriam-Webster etymology note, verified via search). In English, Peter Brugger popularised a broader, non-clinical sense: the general tendency to perceive meaningful patterns or connections in random or meaningless data (Brugger, 2001, chapter in *Hauntings and Poltergeists*; ★ exact chapter title not verified).
- **No diagnostic test exists.** No validated instrument measures "general apophenia" in healthy people. The related instruments below fall into two groups. Some are clinical research tools, such as the Pareidolia Test for visual-hallucination susceptibility in Lewy body disease. Others are experimental paradigms used to study individual differences, such as noise-face detection or coin-sequence ratings. This lab uses classroom **adaptations** of such paradigms and draws **no** individual-level psychological conclusions.

## 2. Candidate paradigms

### 2.1 Noise pareidolia / face detection in noise

| Question | Finding |
|---|---|
| What was tested | Whether people report faces in images that contain only visual noise. Clinically, this is a marker of susceptibility to visual hallucinations in dementia with Lewy bodies (DLB). |
| Task | Look at a noise image and say whether a face is present (and point to it). |
| Evidence | **Uchiyama et al. (2012)**, *Brain* 135(8), 2458–2469, doi:10.1093/brain/aws126. Introduced the (scene) Pareidolia Test with 34 DLB, 34 AD and 26 controls. DLB patients produced far more pareidolic illusions, which separated DLB from AD with 100 % sensitivity and 88 % specificity (abstract). **Yokoi et al. (2014)**, *Neuropsychologia* 56, 245–254, "Hallucinators find meaning in noises: pareidolic illusions in dementia with Lewy bodies" (★ title wording varies between citing sources). Introduced the *noise* pareidolia test. **Mamiya et al. (2016)**, *PLoS ONE* 11(5), e0154713, doi:10.1371/journal.pone.0154713 (CC BY 4.0). Developed a simplified version as a valid, reliable surrogate marker of visual hallucinations in DLB. Citing papers describe the noise test as **40 images, 8 containing a black-and-white face, with noise of 1/f³ spectral character** and 3 practice trials; a pareidolia is scored when noise is reported as a face. A 20-item version (NPT-20: 7 faces, 13 noise) has since been used in Parkinson's disease research (PMC9941920). |
| Type | Validated **clinical research instrument** (for DLB/PD populations). Not validated as a trait measure in students. |
| Reuse of stimuli | Published on figshare (doi:10.6084/m9.figshare.3187669). ★ The figshare licence could not be checked (site blocked); figshare datasets are normally CC BY 4.0. **The files could not be downloaded here**, so this lab uses newly generated stimuli built on the published principle (see DESIGN.md §Task 1). |
| Reveal value | Very high. Showing the hidden face next to pure-noise images where many people "saw" one is striking. Click maps on pure noise make the effect visible at class level. |
| Ground truth | Exact: a face was or was not embedded, at a known location. |
| Time | About 5 s per image. 20 images take about 2 min. |
| Faithful adaptation? | Yes, if labelled as an adaptation: fewer trials, new stimuli, added confidence and localisation. |
| What it can / cannot say | It measures hits and false alarms on these images under these conditions. It cannot diagnose anything or measure a stable trait from 20 trials. |

**Related evidence that people "see" faces in pure noise.** **Liu, Li, Feng, Li, Tian & Lee (2014)**, "Seeing Jesus in toast", *Cortex* 53, 60–77, doi:10.1016/j.cortex.2014.01.013. Participants told that 50 % of pure-noise images contained faces or letters reported faces on 34 % and letters on 38 % of trials. The right fusiform face area responded during illusory face reports, and classification images resembled faces. The study used deception about base rates, so this lab does **not** copy that instruction. **Gosselin & Schyns (2003)**, *Psychological Science* 14(5), 505–509: observers shown white noise reported seeing an "S" or a smile, and reverse correlation recovered their internal templates. **Riekki et al. (2013; online 2012)**, *Applied Cognitive Psychology*, doi:10.1002/acp.2874. Paranormal and religious believers had a more liberal criterion (more false alarms) for faces in scenery pictures, not better sensitivity. This is a signal-detection framing directly relevant to our scoring. **Partos, Cropper & Rawlings (2016)**, *PLoS ONE* (★ title not verified). Faces in pink (1/f) noise, with schizotypy related to sensitivity and bias (per a citing paper).

### 2.2 Illusory pattern perception in random sequences

| Question | Finding |
|---|---|
| What was tested | Whether people perceive structure in genuinely random coin-toss outcomes, and whether that relates to irrational beliefs. |
| Task | **van Prooijen, Douglas & De Inocencio (2018)**, *European Journal of Social Psychology* 48(3), 320–335, doi:10.1002/ejsp.2331 (open access, PMC5900972). Study 1 used one random.org sequence of 100 tosses (constrained to 50 H / 50 T), shown as 10 sets of 10. Participants rated each set (and the whole sequence) from "random" to "determined" on 1–7. The 11 ratings formed a reliable scale (α = .95). Pattern perception in random tosses predicted belief in conspiracies and the supernatural. |
| Randomness-perception literature | **Falk & Konold (1997)**, *Psychological Review* 104, 301–318. People judge **over-alternating** sequences as most random. In nearly all reviewed studies the subjectively ideal alternation probability was about .6 (★ via secondary sources citing their Table 1), versus .5 for a fair coin. Perceived randomness tracks how hard a sequence is to encode. **Bar-Hillel & Wagenaar (1991)**, *Advances in Applied Mathematics* 12(4), 428–454: people expect "local representativeness" of short random segments. **Tversky & Kahneman (1971)**, *Psychological Bulletin* 76(2), 105–110: belief in the "law of small numbers". |
| Caveat for the debrief | The classic "hot hand fallacy" result (**Gilovich, Vallone & Tversky, 1985**) was re-examined by **Miller & Sanjurjo (2018)**, *Econometrica* 86(6), 2019–2047, doi:10.3982/ECTA14943. They identified a *streak selection bias* in the standard measure; after correcting it, the original conclusion is reversed. The lab therefore does **not** claim that "streaks never mean anything". It claims only that streaks are common in sequences whose generating process is known to have none. |
| Type | Experimental paradigm (no validated norms). |
| Reuse | Sequences are easy to generate reproducibly; no licensing issue. |
| Reveal value | High, if the ground truth is a known process. The van Prooijen design has only a "random" truth, so it measures pattern ratings rather than accuracy. Mixing fair sequences with sequences from known **rule-governed** processes (a Markov coin that tends to switch or repeat) gives a scorable ground truth. It also produces the Falk–Konold signature: fair sequences called "patterned" and switching sequences called "random". |
| Time | About 6–8 s per 20-flip sequence. 12 sequences take about 1.5 min. |
| Limits | Twenty flips carry only modest evidence, so some items are ambiguous even for an ideal observer. We show that posterior in the reveal. Prediction accuracy is not a measure of apophenia. |

### 2.3 Illusory correlation and relationships in data

| Question | Finding |
|---|---|
| Classic findings | **Chapman & Chapman (1967; 1969)**: clinicians and students "saw" expected associations between drawing features and diagnoses that were absent from the data (expectancy-based illusory correlation). **Hamilton & Gifford (1976)**: distinctiveness-based illusory correlation between a minority group and infrequent behaviours (★ exact stimulus counts differ between secondary sources). **Jennings, Amabile & Ross (1982)**, chapter 15 in *Judgment under Uncertainty*: data-based covariation estimates are conservative, while theory-based estimates are inflated. |
| Scatterplot perception | **Rensink & Baldridge (2010)**, *Computer Graphics Forum* 29(3): perceived correlation follows simple laws, with intermediate correlations underestimated and little correlation perceived when \|r\| < .2 (Rensink, 2017, *Psychonomic Bulletin & Review*). **Cleveland, Diaconis & McGill (1982)**, *Science* 216, 1138–1141: scatterplots look more correlated when the scales are enlarged. Hence the design rule of **identical axis-padding for every chart** and no manipulated scales. |
| Selection / multiple comparisons | **Simmons, Nelson & Simonsohn (2011)**, *Psychological Science* 22(11), 1359–1366: undisclosed flexibility inflates false positives. **Gelman & Loken (2013 working paper; ★ 2014 *American Scientist* version not verified)**: the "garden of forking paths". |
| Graphical inference | **Wickham, Cook, Hofmann & Buja (2010)**, *IEEE TVCG* 16(6), 973–979, doi:10.1109/TVCG.2010.161: the *line-up* protocol hides the real plot among null plots to guard against "discovering" spurious structure; implemented in the R package *nullabor*. Our "selected from 100 nulls" charts are the mirror image: the most striking null plot, shown alone. |
| Type | Classic experimental paradigms; the business-chart task is a **classroom design** built from these principles. |
| Reveal value | Very high for an MIS/management audience. "The chart you believed was the best of 100 random datasets" leads directly to data dredging, dashboard-driven decisions and replication. |
| Ground truth | Exact: the data-generating process (ρ = 0.5 or ρ = 0) and the selection mechanism are fixed before any responses. |

### 2.4 Other paradigms considered and why they were not selected

| Paradigm | Why not (for a 30-minute class) |
|---|---|
| Snowy Pictures Task (**Whitson & Galinsky, 2008**, *Science*; lack of control increases illusory pattern perception) | The control manipulation has replication problems: a seven-experiment Tilburg paper reported Bayesian evidence for the null and publication bias in the control-threat literature. The stimuli are not openly available. Noise-face detection gives the same experience with a firmer ground truth. |
| Hamilton–Gifford statement stream | Needs about 40 sequential statements plus estimation questions (5+ min) and works through memory rather than perception. It is better told as a debrief example. |
| Moving-triangle agency attribution (Heider–Simmel style; **Fyfe et al., 2008**, *Cortex*, ★ details not verified) | No objective "right answer" in a classroom version; it needs animation stimuli we could not source. |
| Words / letters in noise (**Brugger/Krummenacher et al.**) | Adds little beyond faces. The L-dopa findings are interesting for the debrief only (★ verified only through secondary reports). |
| Lineup task (Wickham et al., 2010) | Strong idea, but a 9-panel lineup per trial is slow on phones. It is used conceptually in the chart task and the debrief. |
| Stock-chart / "hot hand" streak prediction | The Miller–Sanjurjo correction makes the simple "fallacy" story scientifically contested, and prediction accuracy is not a measure of apophenia. |

## 3. Summary of the evidence base for the chosen battery

1. **Faces in the Noise**: adaptation of a validated clinical research paradigm (NPT). Perceptual false alarms with exact ground truth.
2. **Coin Sequences**: randomness-perception paradigm (Falk & Konold; van Prooijen et al.) extended with known rule-governed processes, so it has a scorable ground truth.
3. **Branch Data**: classroom design combining illusory-correlation, scatterplot-perception and selection-effect research. False alarms on data, where search inflates apparent evidence.

All three share a **signal-detection structure** (signal present/absent; hits, misses, false alarms, correct rejections). Students can therefore compare the *same* kind of error across perception, sequences and data, without the tasks being collapsed into one score.

## 4. Reference list

- Bar-Hillel, M., & Wagenaar, W. A. (1991). The perception of randomness. *Advances in Applied Mathematics, 12*(4), 428–454.
- Brugger, P. (2001). From haunted brain to haunted science: A cognitive neuroscience view of paranormal and pseudoscientific thought. In J. Houran & R. Lange (Eds.), *Hauntings and poltergeists*. McFarland. ★
- Chapman, L. J., & Chapman, J. P. (1967). Genesis of popular but erroneous psychodiagnostic observations. *Journal of Abnormal Psychology, 72*(3), 193–204. ★ (pages not verified)
- Cleveland, W. S., Diaconis, P., & McGill, R. (1982). Variables on scatterplots look more highly correlated when the scales are increased. *Science, 216*, 1138–1141.
- Conrad, K. (1958). *Die beginnende Schizophrenie*. Thieme.
- Falk, R., & Konold, C. (1997). Making sense of randomness: Implicit encoding as a basis for judgment. *Psychological Review, 104*, 301–318.
- Gelman, A., & Loken, E. (2013). The garden of forking paths. Working paper, Columbia University.
- Gilovich, T., Vallone, R., & Tversky, A. (1985). The hot hand in basketball. *Cognitive Psychology, 17*, 295–314. ★ (pages not verified)
- Gosselin, F., & Schyns, P. G. (2003). Superstitious perceptions reveal properties of internal representations. *Psychological Science, 14*(5), 505–509.
- Hamilton, D. L., & Gifford, R. K. (1976). Illusory correlation in interpersonal perception. *Journal of Experimental Social Psychology, 12*, 392–407. ★ (pages not verified)
- Hautus, M. J. (1995). Corrections for extreme proportions and their biasing effects on estimated values of d′. *Behavior Research Methods, 27*, 46–51. (log-linear correction used in scoring) ★
- Jennings, D. L., Amabile, T. M., & Ross, L. (1982). Informal covariation assessment: Data-based versus theory-based judgments. In D. Kahneman, P. Slovic, & A. Tversky (Eds.), *Judgment under uncertainty* (ch. 15). Cambridge University Press.
- Liu, J., Li, J., Feng, L., Li, L., Tian, J., & Lee, K. (2014). Seeing Jesus in toast: Neural and behavioral correlates of face pareidolia. *Cortex, 53*, 60–77. https://doi.org/10.1016/j.cortex.2014.01.013
- Mamiya, Y., Nishio, Y., Watanabe, H., et al. (2016). The Pareidolia Test: A simple neuropsychological test measuring visual hallucination-like illusions. *PLoS ONE, 11*(5), e0154713. https://doi.org/10.1371/journal.pone.0154713 — stimuli: https://figshare.com/articles/dataset/The_noise_pareidolia_test/3187669
- Miller, J. B., & Sanjurjo, A. (2018). Surprised by the hot hand fallacy? A truth in the law of small numbers. *Econometrica, 86*(6), 2019–2047. https://doi.org/10.3982/ECTA14943
- Rensink, R. A., & Baldridge, G. (2010). The perception of correlation in scatterplots. *Computer Graphics Forum, 29*(3), 1203–1210.
- Riekki, T., Lindeman, M., Aleneff, M., Halme, A., & Nuortimo, A. (2013). Paranormal and religious believers are more prone to illusory face perception than skeptics and non-believers. *Applied Cognitive Psychology, 27*, 150–155. https://doi.org/10.1002/acp.2874 ★ (pages not verified)
- Simmons, J. P., Nelson, L. D., & Simonsohn, U. (2011). False-positive psychology. *Psychological Science, 22*(11), 1359–1366.
- Tversky, A., & Kahneman, D. (1971). Belief in the law of small numbers. *Psychological Bulletin, 76*(2), 105–110.
- Uchiyama, M., Nishio, Y., Yokoi, K., et al. (2012). Pareidolias: Complex visual illusions in dementia with Lewy bodies. *Brain, 135*(8), 2458–2469. https://doi.org/10.1093/brain/aws126
- van Prooijen, J.-W., Douglas, K. M., & De Inocencio, C. (2018). Connecting the dots: Illusory pattern perception predicts belief in conspiracies and the supernatural. *European Journal of Social Psychology, 48*(3), 320–335. https://doi.org/10.1002/ejsp.2331
- Whitson, J. A., & Galinsky, A. D. (2008). Lacking control increases illusory pattern perception. *Science, 322*, 115–117. ★ (pages not verified)
- Wickham, H., Cook, D., Hofmann, H., & Buja, A. (2010). Graphical inference for infovis. *IEEE Transactions on Visualization and Computer Graphics, 16*(6), 973–979. https://doi.org/10.1109/TVCG.2010.161
- Yokoi, K., Nishio, Y., Uchiyama, M., et al. (2014). Hallucinators find meaning in noises: Pareidolic illusions in dementia with Lewy bodies. *Neuropsychologia, 56*, 245–254. ★ (title wording)
