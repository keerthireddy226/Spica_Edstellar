# Test proctoring: what is built and what is left

Spica's proctoring never fails a learner automatically. Every signal adds to
a risk score with readable reasons, and a reviewer (Org Admin, or Edstellar
staff with Score review) clears the session or confirms a violation.
Organizations choose a mode (off / standard / strict) and privacy rules
(global / EU-UK / US / India) under **Test integrity → Settings**; staff edit
the same settings from the organization window.

## Built

| Method | How it works |
|---|---|
| ID verification | Photo of a passport or ID card plus a live selfie. The machine-readable zone (MRZ) is read on the server (Tesseract), its check digits verified, the name compared with the account and the expiry date checked. The face on the document is compared with the selfie, and the selfie is checked for a photo or screen (liveness). A reviewer makes the decision. Works for any ICAO 9303 document worldwide. |
| Continuous face tracking | Camera on for the whole test. Snapshots every ~15 s in strict mode (~30 s otherwise, at uneven intervals): face present, one face only, face matches the enrolled photo, head direction (looking away, measured against the learner's own usual position). Between snapshots the picture is watched every 2 s for a covered lens or a frozen feed. |
| Voice matching | After the test, spoken answers are joined into ≥15 s stretches and compared with each other and a voice sample read at the start (TitaNet-Large). Calibration in `MODELS.md`. |
| Copy and paste blocking | Copy, cut, paste, drag-and-drop and the context menu are blocked; text that appears without typing is recorded. |
| Screenshot detection | Screenshot keys are recorded. With **Require Safe Exam Browser**, screenshots are blocked by the operating system. |
| Secure browser | Safe Exam Browser: the page's config-key hash is checked on the server against the organization's keys. |
| Multi-monitor | A second screen is detected (Chrome, Edge) and the learner told to disconnect it. Safe Exam Browser blocks it outright. |
| Object detection | Each snapshot is checked for a phone, a book and extra people (SSD-MobileNet). |
| Audio analytics | Microphone open between answers; sustained talking or whispering while no answer is being recorded and no question audio is playing is flagged with an 8 s clip. |
| Background noise in answers | Each recorded answer's signal-to-noise is measured on the server; under 12 dB (noise loud enough to cover words) it's listed on the timeline and the learner's result with no risk points. 3 of 161 real answers measured that low. Part of **Listen for talking**, which is now on by default for employees (it was a paid option); individual learners stay off. |
| Keystroke dynamics | Per written answer, only timing statistics (key hold time, gaps, common letter pairs) are sent. The rhythm is compared between the two halves of the test and with the learner's earlier tests. Low weight: typing changes with fatigue and keyboards. |
| Randomized question banks | A learner's mock exam draws each section from every set of the test type, questions the learner hasn't seen first; a candidate's assessment draws from every set when the organization turns this on. Questions sharing a passage stay together. The placement test is adaptive. |
| Practice and mock modes | Practice mode (pause, go back, the answer after each question) isn't monitored: no proctoring policy applies, only the face check an organization may require before any test. Mock exams and candidates' assessments get the organization's full policy. Mock questions are timed on the server from when each is first shown; a late answer counts as unanswered. |
| Room scan | A 12 s video of the room before the test. |
| Automated proctoring (post-exam review) | Risk score, reasons, snapshots, recordings, event timeline, ID, voice and typing results in one review screen. High-risk sessions notify the Org Admin. |
| Record and review | Webcam video (with sound when listening is on) and the entire screen, recorded in 30 s segments and played back in order. |
| Live proctoring | Active tests with their latest snapshot and the last 30 s of video; the proctor can message the learner or end the test. |
| Privacy | Consent screen with the retention period; a manual identity route instead of biometrics; files stored outside the public uploads folder and served only to reviewers; deleted after the organization's retention period and when a learner is erased. |

## Left for later (cannot be finished in code alone)

| Item | Why | What it needs |
|---|---|---|
| Third-party ID verification (Veriff, Onfido, Persona, Didit) | Database checks against issuing authorities and certified document forensics are only available from these vendors. | A contract and API keys; then an adapter next to `idDocument.ts`. |
| DigiLocker (Aadhaar, PAN, driving licence) | India only; it's an Indian government system, reached through a licensed aggregator. | A Cashfree, Signzy or similar account, for Indian customers only. |
| Real-time live video (WebRTC) | Live proctoring today shows snapshots and 30 s video segments, not a real-time stream. Corporate networks need a TURN relay for a reliable stream. | A TURN server (e.g. coturn) and proctor staffing; then WebRTC signalling through the API. |
| Blocking screenshots and second screens without Safe Exam Browser | No web page can block operating-system screenshots or disconnect a monitor. | Use **Require Safe Exam Browser**. It still needs a real test on Windows and macOS with an organization's SEB config file. |
| Calibration with real learners | Voice cut-offs come from 3 speakers; head-direction limits from 71 face-check photos; typing cut-offs aren't calibrated yet. | Recordings from 20+ people across accents, microphones, cameras and keyboards, then adjust `voiceCheck.ts`, `headPose.ts`, `typing.ts`. |
| Translations of the new screens | Spanish is complete; the other 14 languages still need the strings added since the translation pass started. | Finish the translation blocks, then a native-speaker review. |
| Check alerts on a real test | Live alerts and flagged-test emails (instant or daily) haven't fired on a real test yet. | One test where the learner leaves the tab and covers the camera; check the bell and the email. |
| Click through the candidate device check | The device check and demo were tried in a browser for practice tests and the placement test; the candidate path ("I'm ready", check, demo, test) only passed the type check. | One mock candidate invitation, opened in a browser. |
| A second voice inside an answer | Someone whispering or talking during a recorded answer isn't detected (talking between answers is). Tested 2026-10-16 on lab recordings mixed with a second speaker: Gemini 3.5 Flash-Lite found it 0 of 6 times, even asked directly; Gemini 3.5 Flash found the one clip it got to before this account's quota ran out; Spica's own voice model, comparing 3-second windows inside an answer, separates two people taking turns (similarity 0.35-0.53) but real one-speaker answers also dropped to 0.16. | A labelled set of real answers (one speaker vs. prompted), then either Gemini Flash with a paid quota or a speaker-diarization model, tested on that set before it flags anyone. |
| Legal review | Biometric consent wording, the DPA and an EU AI Act technical file (high-risk deadline 2 Dec 2027). | A privacy lawyer before selling in the EU and US. |
