# Machine-learning models

All models run locally on the backend; no learner image or audio is sent to a
third party. The files live in `backend/models/` and are stored with Git LFS.

| File | Used for | Model | Licence |
|---|---|---|---|
| `yunet.onnx` | Finding faces | OpenCV YuNet | MIT |
| `auraface.onnx` | Face matching | AuraFace | Apache-2.0 |
| `minifasnet_v2.onnx` | Photo and screen spoof detection | MiniFASNet v2 | Apache-2.0 |
| `object-detection.onnx` | Phones, books and extra people in proctoring snapshots | SSD-MobileNet v1 (COCO), ONNX Model Zoo | Apache-2.0 |
| `speaker-embedding.onnx` | Voice consistency after a proctored test | NVIDIA NeMo TitaNet-Large, via sherpa-onnx | CC-BY-4.0 |
| `eng.traineddata.gz` | Reading the machine-readable zone of ID documents | Tesseract English (4.0.0 best_int, from `@tesseract.js-data/eng`) | Apache-2.0 |

TitaNet-Large is © NVIDIA, licensed under CC-BY-4.0
(https://huggingface.co/nvidia/speakerverification_en_titanet_large). The
ONNX export comes from the sherpa-onnx speaker-recognition model releases
(sha256 `d51abcf31717ef28162f26acb9d44dd4127c3d44c9b8624f699f3425daca8e77`).

SSD-MobileNet v1 comes from the ONNX Model Zoo,
`validated/vision/object_detection_segmentation/ssd-mobilenetv1/model/ssd_mobilenet_v1_12.onnx`
(sha256 `b8fba5e404077d4048d27fcd1667e85e27e192eb9bf51e696c46a3acd7d21058`).

Head direction on proctoring snapshots uses YuNet's five landmarks, no extra
model (`src/proctoring/headPose.ts`).

## Voice check calibration

The thresholds in `src/proctoring/voiceCheck.ts` come from the recordings in
`uploads/voice-lab` (3 speakers, 6 speaking styles, 3 takes each):

| Compared | Same speaker, lowest | Different speakers, highest | Equal error rate |
|---|---|---|---|
| One clip (about 4 s of speech) | 0.404 | 0.716 | about 11% |
| Two clips joined (about 8 s) | 0.634 | 0.714 | about 2% |
| Four clips joined (about 16 s) | 0.838 | 0.732 | 0% |

Stretches of at least 15 s of speech are compared: 0.80 or more is the same
speaker, below 0.74 is flagged, and the band between is "uncertain". Three
speakers is a small sample. Recalibrate with more voices, accents and
microphones before relying on the cut-offs.
