// An MP3's real length, from its frame headers (Google's text-to-speech
// returns 64 kbps / 24 kHz MPEG-2 audio; nothing in its reply gives the length).
const BITRATE_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATE_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATE_V1 = [44100, 48000, 32000];

export function mp3DurationMs(buf: Buffer): number {
  let i = 0;
  let seconds = 0;
  // Skip an ID3 tag.
  if (buf.length > 10 && buf.toString("latin1", 0, 3) === "ID3") {
    i = 10 + ((buf[6] & 0x7f) << 21) + ((buf[7] & 0x7f) << 14) + ((buf[8] & 0x7f) << 7) + (buf[9] & 0x7f);
  }
  while (i < buf.length - 4) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
      const version = (buf[i + 1] >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
      const layer = (buf[i + 1] >> 1) & 3; // 1 = Layer III
      const bitrateIndex = (buf[i + 2] >> 4) & 15;
      const rateIndex = (buf[i + 2] >> 2) & 3;
      const padding = (buf[i + 2] >> 1) & 1;
      if (layer === 1 && version !== 1 && bitrateIndex > 0 && bitrateIndex < 15 && rateIndex < 3) {
        const mpeg1 = version === 3;
        const bitrate = (mpeg1 ? BITRATE_V1 : BITRATE_V2)[bitrateIndex] * 1000;
        const sampleRate = RATE_V1[rateIndex] / (mpeg1 ? 1 : version === 2 ? 2 : 4);
        const size = Math.floor(((mpeg1 ? 144 : 72) * bitrate) / sampleRate) + padding;
        seconds += (mpeg1 ? 1152 : 576) / sampleRate;
        i += size;
        continue;
      }
    }
    i++;
  }
  return Math.round(seconds * 1000);
}
