import { useRouter } from 'next/router';
import Layout from '../components/Layout';

// "Remedies" tab. Remedies on AstroConnect are recommended by your
// astrologer during a consultation (personalised to your kundli). This
// is the store-style landing; the per-astrologer remedy catalogue is
// delivered inside chat / the dedicated remedies module.
const CATS = [
  ['Gemstones', 'Energised stones matched to your chart',
    'from ₹499'],
  ['Rudraksha', 'Authentic, lab-certified beads', 'from ₹299'],
  ['Yantra', 'Sacred geometry for home & work', 'from ₹199'],
  ['Puja & Havan', 'Performed by verified pandits', 'from ₹999'],
  ['Mantra', 'Personalised chanting guidance', 'Free with consult'],
  ['Spiritual items', 'Bracelets, malas, idols & more', 'from ₹149'],
];

export default function RemediesPage() {
  const router = useRouter();
  return (
    <Layout>
      <div className="hero-grad overflow-hidden rounded-2xl p-5
                      text-white">
        <h1 className="text-xl font-bold">Astro Remedies</h1>
        <p className="mt-1 max-w-md text-sm opacity-90">
          Get powerful, personalised remedies recommended by your
          astrologer after reading your birth chart.
        </p>
        <button onClick={() => router.push('/astrologers')}
          className="mt-4 rounded-full bg-white px-5 py-2.5 text-sm
            font-semibold text-primary">
          Talk to an astrologer
        </button>
      </div>

      <h2 className="mb-3 mt-6 text-lg font-bold">Browse remedies</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {CATS.map(([name, desc, price]) => (
          <button key={name}
            onClick={() => router.push('/astrologers')}
            className="surface flex flex-col p-4 text-left
                       transition hover:shadow-md">
            <span className="flex h-11 w-11 items-center justify-center
              rounded-xl bg-bg-light text-xl">✨</span>
            <span className="mt-3 font-semibold">{name}</span>
            <span className="mt-0.5 line-clamp-2 text-xs text-sub-text">
              {desc}
            </span>
            <span className="mt-2 text-sm font-bold text-primary">
              {price}
            </span>
          </button>
        ))}
      </div>

      <div className="surface mt-6 p-5 text-center">
        <div className="font-semibold">How remedies work</div>
        <p className="mx-auto mt-1 max-w-md text-sm text-sub-text">
          Consult an astrologer, share your concern, and receive a
          personalised remedy with exact items and the right procedure -
          delivered to your chat.
        </p>
      </div>
    </Layout>
  );
}
