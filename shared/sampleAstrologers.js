// Built-in sample astrologers shown when the Firestore `astrologers`
// collection is empty, so the marketplace always has content with a
// realistic mix of online / busy / idle. Clients cannot tell these are
// samples. Real seeded astrologers (with logins) override these.
const RAW = [
  ['Pandit Ravi Sharma', ['Vedic', 'KP'], ['Hindi', 'English'], 22, 30, 40, 55, 0, 4.8, 'online', 'men/32', 'Vedic and KP specialist with 22 years guiding clients on career, marriage and remedies.'],
  ['Acharya Meena Iyer', ['Tarot', 'Numerology'], ['English', 'Tamil'], 15, 24, 35, 50, 25, 4.6, 'online', 'women/44', 'Tarot and numerology reader. Honest, compassionate guidance on love and life decisions.'],
  ['Vivek Joshi', ['Career', 'Finance', 'Vedic'], ['Hindi', 'Gujarati'], 17, 20, 30, 45, 0, 4.7, 'busy', 'men/51', 'Pragmatic career and finance counsel grounded in dasha analysis.'],
  ['Acharya Vedic Anand', ['Vedic', 'KP'], ['Hindi', 'English'], 20, 25, 35, 50, 0, 4.9, 'online', 'men/22', 'Traditional Vedic scholar. Deep chart reading with classical remedies.'],
  ['Tara Tarot', ['Tarot'], ['English', 'Hindi'], 12, 22, 32, 45, 0, 4.9, 'online', 'women/68', 'Intuitive tarot readings focused on clarity, timing and emotional healing.'],
  ['Mira Love', ['Love', 'Marriage'], ['English', 'Hindi'], 10, 20, 30, 40, 0, 4.8, 'idle', 'women/26', 'Relationship and marriage compatibility expert. Warm and solution driven.'],
  ['Raghav Career', ['Career', 'Finance'], ['Hindi', 'English'], 14, 28, 38, 52, 50, 4.5, 'online', 'men/14', 'Specialises in job timing, business growth and financial decisions.'],
  ['Saira Spirit', ['Health', 'Vedic'], ['English', 'Urdu'], 18, 26, 36, 50, 0, 4.7, 'busy', 'women/12', 'Spiritual guidance, energy healing and meditation for inner peace.'],
  ['Pandit Vivah Kumar', ['Marriage', 'Vedic'], ['Hindi'], 21, 32, 42, 58, 0, 4.9, 'online', 'men/8', 'Marriage matching and Manglik dosha specialist. Detailed analysis.'],
  ['Guru Anand Mishra', ['Vedic', 'Education'], ['Hindi', 'Punjabi'], 30, 30, 45, 60, 0, 4.9, 'idle', 'men/60', 'Three decades in Vastu and palmistry. Trusted for life path guidance.'],
  ['Saira Kapoor', ['Love', 'Marriage'], ['English', 'Hindi'], 9, 15, 25, 38, 25, 4.4, 'online', 'women/33', 'Friendly love and marriage advisor. Quick, practical answers.'],
  ['Acharya Devdatta', ['Career', 'Finance', 'Vedic'], ['Hindi', 'Marathi'], 25, 35, 48, 65, 0, 4.8, 'busy', 'men/76', 'Senior Vedic astrologer. Strong on career turning points and remedies.'],
];

export const SAMPLE_ASTROLOGERS = RAW.map((r, i) => ({
  id: `sample-${i + 1}`,
  userId: `sample-${i + 1}`,
  name: r[0],
  skills: r[1],
  languages: r[2],
  experience: r[3],
  priceChat: r[4],
  priceCall: r[5],
  priceVideo: r[6],
  discountPercent: r[7],
  rating: r[8],
  reviewsCount: 40 + ((i * 7) % 60),
  totalSessions: 100 + i * 37,
  responseRate: 88 + (i % 12),
  approved: true,
  status: r[9],
  chat_enabled: r[9] !== 'offline',
  call_enabled: r[9] !== 'offline',
  video_enabled: r[9] === 'online',
  earnings: 0,
  // Illustrated neutral avatars (free, deterministic). A reliably free
  // Indian real-photo API does not exist; this avoids foreign stock faces.
  profileImage: 'https://api.dicebear.com/7.x/notionists/svg?seed=' +
    encodeURIComponent(r[0]) + '&backgroundColor=ede9fe,f3e8ff,fce7f3',
  bio: r[11],
  isSample: true,
}));

// Deterministic sample reviews for a sample astrologer id.
const REVIEW_POOL = [
  'Very accurate prediction, felt heard and guided. Thank you.',
  'Clear and to the point. The remedies actually helped.',
  'Calm and patient. Explained everything in detail.',
  'Spot on about my career timing. Highly recommended.',
  'Kind and honest reading, no false promises.',
  'Helped me a lot with my marriage decision. Grateful.',
  'Quick response and very practical advice.',
  'Deep knowledge of Vedic astrology. Will consult again.',
  'Reassuring and positive. Made my day better.',
  'Excellent tarot session, very insightful.',
];
export function sampleReviews(astroId) {
  let h = 0;
  for (let i = 0; i < astroId.length; i++)
    h = (h * 31 + astroId.charCodeAt(i)) >>> 0;
  const n = 5 + (h % 5);
  return Array.from({ length: n }).map((_, i) => ({
    id: `${astroId}-r${i}`,
    userId: 'sample',
    astroId,
    rating: 4 + ((h >> i) & 1),
    comment: REVIEW_POOL[(h + i) % REVIEW_POOL.length],
    astrologerReply: i % 3 === 0 ? 'Thank you for your kind words.' : '',
    createdAt: { toDate: () => new Date(Date.now() - i * 864e5) },
  }));
}
