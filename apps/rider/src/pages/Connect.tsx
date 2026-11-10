// apps/rider/src/pages/Connect.tsx — the app opened on its own (after installing it, or to switch restaurant): the
// restaurants this phone already has, and "connect" a new one — scan the QR code the restaurant shows on its Riders
// page, or paste the link they sent on WhatsApp. No account, no password: the link is the key.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { savedLinks, tokenFrom } from '../links';

type Lang = 'bn' | 'en';
const tx = (lang: Lang, bn: string, en: string) => (lang === 'en' ? en : bn);

/** Reads QR codes with the phone's camera where the browser can (Chrome on Android — the Android app runs in it). */
function Scanner({ lang, onCode, onClose }: { lang: Lang; onCode: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    const Detector = (window as any).BarcodeDetector;
    if (!Detector) {
      setError(tx(lang, 'এই ফোনে স্ক্যান করা যাচ্ছে না — লিংকটা পেস্ট করুন।', "This phone can't scan here — paste the link instead."));
      return;
    }
    const detector = new Detector({ formats: ['qr_code'] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stop || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = async () => {
          if (stop || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            if (codes?.[0]?.rawValue) return onCodeRef.current(String(codes[0].rawValue));
          } catch {
            /* a frame it couldn't read */
          }
          window.setTimeout(tick, 250);
        };
        void tick();
      } catch {
        setError(tx(lang, 'ক্যামেরা খোলা যায়নি — অনুমতি দিন, অথবা লিংকটা পেস্ট করুন।', "Couldn't open the camera — allow it, or paste the link instead."));
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [lang]);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+14px)] text-white">
        <span className="text-[17px] font-semibold">{tx(lang, 'রেস্টুরেন্টের QR কোড স্ক্যান করুন', "Scan the restaurant's QR code")}</span>
        <button type="button" onClick={onClose} className="h-11 rounded-full bg-white/15 px-4 text-[15px] font-semibold">
          {tx(lang, 'বন্ধ', 'Close')}
        </button>
      </div>
      {error ? (
        <p className="m-6 rounded-2xl bg-white p-5 text-[16px]">{error}</p>
      ) : (
        <div className="relative flex-1">
          <video ref={video} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
          <div aria-hidden="true" className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-3xl border-4 border-white/90" />
        </div>
      )}
    </div>
  );
}

export default function Connect() {
  const navigate = useNavigate();
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return localStorage.getItem('qravy:rider:lang') === 'en' ? 'en' : 'bn';
    } catch {
      return 'bn';
    }
  });
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const [scanning, setScanning] = useState(false);
  const links = savedLinks();
  useEffect(() => {
    try {
      localStorage.setItem('qravy:rider:lang', lang);
    } catch {
      /* storage blocked */
    }
    document.title = 'Qravy Rider';
  }, [lang]);

  const open = (raw: string) => {
    const token = tokenFrom(raw);
    if (!token) return setBad(true);
    setBad(false);
    navigate(`/r/${token}`);
  };

  return (
    <div className="min-h-[100dvh] bg-[#F6F6F4] text-[#111]">
      <div className="mx-auto flex max-w-[480px] flex-col gap-5 px-4 pb-10 pt-[calc(env(safe-area-inset-top,0px)+20px)]">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/icons/icon-192.png" alt="" className="h-11 w-11 rounded-xl" />
            <div>
              <div className="text-[20px] font-bold">Qravy Rider</div>
              <div className="text-[13px] text-[#666]">{tx(lang, 'আপনার ডেলিভারি, এক জায়গায়', 'Your deliveries, in one place')}</div>
            </div>
          </div>
          <button type="button" onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')} className="h-11 rounded-full border border-[#D5D5D5] bg-white px-4 text-[14px] font-semibold">
            {lang === 'bn' ? 'English' : 'বাংলা'}
          </button>
        </header>

        {links.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="px-1 text-[13px] font-bold tracking-[0.8px] text-[#777]">{tx(lang, 'আপনার রেস্টুরেন্ট', 'YOUR RESTAURANTS')}</h2>
            {links.map((l) => (
              <Link key={l.token} to={`/r/${l.token}`} className="flex items-center justify-between rounded-2xl bg-white px-4 py-4">
                <span className="flex flex-col">
                  <span className="text-[17px] font-semibold">{l.restaurant || tx(lang, 'রেস্টুরেন্ট', 'Restaurant')}</span>
                  <span className="text-[13px] text-[#666]">{l.rider}</span>
                </span>
                <span aria-hidden="true" className="text-[22px] text-[#999]">›</span>
              </Link>
            ))}
          </section>
        )}

        <section className="flex flex-col gap-3 rounded-3xl bg-white p-5">
          <h2 className="text-[19px] font-bold">{links.length ? tx(lang, 'আরেকটা রেস্টুরেন্ট যোগ করুন', 'Add another restaurant') : tx(lang, 'শুরু করতে রেস্টুরেন্টের সাথে যুক্ত হন', 'Connect to your restaurant to start')}</h2>
          <p className="text-[15px] leading-snug text-[#555]">
            {tx(lang, 'রেস্টুরেন্ট আপনাকে WhatsApp-এ একটা লিংক পাঠিয়েছে, অথবা তাদের স্ক্রিনে একটা QR কোড দেখাবে।', 'The restaurant sent you a link on WhatsApp, or will show you a QR code on their screen.')}
          </p>
          <button type="button" onClick={() => setScanning(true)} className="h-14 rounded-2xl bg-[#0F766E] text-[17px] font-bold text-white">
            {tx(lang, 'QR কোড স্ক্যান করুন', 'Scan the QR code')}
          </button>
          <div className="flex items-center gap-3 text-[13px] text-[#999]">
            <span className="h-px flex-1 bg-[#E5E5E5]" />
            {tx(lang, 'অথবা', 'or')}
            <span className="h-px flex-1 bg-[#E5E5E5]" />
          </div>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              open(text);
            }}
          >
            <label htmlFor="rider-link" className="text-[14px] font-semibold">
              {tx(lang, 'লিংকটা এখানে পেস্ট করুন', 'Paste the link here')}
            </label>
            <input
              id="rider-link"
              value={text}
              onChange={(e) => (setText(e.target.value), setBad(false))}
              placeholder="https://rider.qravy.com/r/…"
              inputMode="url"
              autoComplete="off"
              className="h-14 rounded-2xl border border-[#D5D5D5] px-4 text-[15px] outline-none focus:border-[#0F766E]"
            />
            {bad && <p className="text-[14px] text-[#B91C1C]">{tx(lang, 'এটা রাইডার লিংক মনে হচ্ছে না — রেস্টুরেন্টের পাঠানো পুরো লিংকটা দিন।', "That doesn't look like a rider link — paste the whole link the restaurant sent.")}</p>}
            <button type="submit" disabled={!text.trim()} className="h-14 rounded-2xl bg-[#111] text-[17px] font-bold text-white disabled:opacity-40">
              {tx(lang, 'খুলুন', 'Open')}
            </button>
          </form>
        </section>
      </div>
      {scanning && (
        <Scanner
          lang={lang}
          onClose={() => setScanning(false)}
          onCode={(code) => {
            setScanning(false);
            open(code);
          }}
        />
      )}
    </div>
  );
}
