/**
 * One-shot Web Speech API capture (Chrome / Edge). No dependency on ElevenLabs ConvAI.
 */
export function getSpeechRecognitionCtor(): (new () => SpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function browserSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

/**
 * Listens until the user stops speaking (non-continuous). Resolves with transcript.
 */
export function recognizeSpeechOnce(lang: string): Promise<string> {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    return Promise.reject(
      new Error("Speech recognition is not supported in this browser. Try Chrome or Edge.")
    );
  }

  return new Promise((resolve, reject) => {
    const rec = new Ctor();
    let settled = false;

    const done = (err: Error | null, text?: string) => {
      if (settled) return;
      settled = true;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else if (text) resolve(text);
      else reject(new Error("No speech detected. Try again."));
    };

    rec.lang = lang;
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) done(null, transcript);
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      const code = event.error || "unknown";
      if (code === "not-allowed") {
        done(new Error("Microphone permission denied. Allow the mic for this site."));
      } else if (code === "no-speech") {
        done(new Error("No speech heard. Try again, speak closer to the microphone."));
      } else if (code === "aborted") {
        done(new Error("Recognition was cancelled."));
      } else {
        done(new Error(`Speech recognition error: ${code}`));
      }
    };

    rec.onend = () => {
      if (!settled) {
        done(new Error("No speech detected. Tap again and speak after the prompt."));
      }
    };

    try {
      rec.start();
    } catch (e) {
      done(e instanceof Error ? e : new Error("Could not start speech recognition"));
    }
  });
}
