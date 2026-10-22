import { useCallback, useEffect, useRef, useState } from "react";

type State = "idle" | "playing" | "paused";

/** แบ่งข้อความเป็นท่อนสั้นๆ เพราะบางเบราว์เซอร์อ่านข้อความยาวๆ ในครั้งเดียวไม่ได้ */
function splitForSpeech(text: string, max = 180): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/).map((p) => p.trim()).filter(Boolean)) {
    if (para.length <= max) {
      out.push(para);
      continue;
    }
    let cur = "";
    for (const word of para.split(/\s+/)) {
      if (cur && cur.length + word.length + 1 > max) {
        out.push(cur);
        cur = word;
      } else {
        cur = cur ? `${cur} ${word}` : word;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

export function useSpeech() {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [state, setState] = useState<State>("idle");
  const [rate, setRateState] = useState(1);
  const [unsupported, setUnsupported] = useState(!supported);
  const queue = useRef<string[]>([]);
  const generation = useRef(0);
  const rateRef = useRef(1);

  const speakNext = useCallback((gen: number) => {
    if (gen !== generation.current) return;
    const next = queue.current.shift();
    if (!next) {
      setState("idle");
      return;
    }
    const u = new SpeechSynthesisUtterance(next);
    u.lang = "th-TH";
    u.rate = rateRef.current;
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("th"));
    if (voice) u.voice = voice;
    u.onend = () => speakNext(gen);
    u.onerror = () => {
      if (gen === generation.current) setState("idle");
    };
    window.speechSynthesis.speak(u);
  }, []);

  const stop = useCallback(() => {
    if (!supported) return;
    generation.current += 1;
    queue.current = [];
    window.speechSynthesis.cancel();
    setState("idle");
  }, [supported]);

  const play = useCallback(
    (text: string) => {
      if (!supported) return;
      const hasThai = window.speechSynthesis.getVoices().some((v) => v.lang.toLowerCase().startsWith("th"));
      // บางระบบโหลดรายชื่อเสียงช้า จึงยังลองเล่นต่อไป แต่แจ้งเตือนถ้าไม่พบเสียงไทยเลย
      setUnsupported(window.speechSynthesis.getVoices().length > 0 && !hasThai);
      generation.current += 1;
      window.speechSynthesis.cancel();
      queue.current = splitForSpeech(text);
      setState("playing");
      speakNext(generation.current);
    },
    [supported, speakNext],
  );

  const pause = useCallback(() => {
    window.speechSynthesis.pause();
    setState("paused");
  }, []);

  const resume = useCallback(() => {
    window.speechSynthesis.resume();
    setState("playing");
  }, []);

  const setRate = useCallback((r: number) => {
    rateRef.current = r;
    setRateState(r);
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { state, rate, setRate, play, pause, resume, stop, unsupported };
}
