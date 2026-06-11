// Chaldean numerology (the system most commonly used in India). Computes
// the core numbers from a person's full name + date of birth and returns
// the per-number meanings. All client-side, no API required.
//
// Chaldean letter -> number map (1..8, no 9 by design):
//   A I J Q Y         -> 1
//   B K R             -> 2
//   C G L S           -> 3
//   D M T             -> 4
//   E H N X           -> 5
//   U V W             -> 6
//   O Z               -> 7
//   F P               -> 8
const LETTER = {
  A: 1, I: 1, J: 1, Q: 1, Y: 1,
  B: 2, K: 2, R: 2,
  C: 3, G: 3, L: 3, S: 3,
  D: 4, M: 4, T: 4,
  E: 5, H: 5, N: 5, X: 5,
  U: 6, V: 6, W: 6,
  O: 7, Z: 7,
  F: 8, P: 8,
};
const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

// Reduce to a single digit unless the running sum hits a recognised
// master number (11, 22, 33).
function reduce(n) {
  let x = Math.abs(Math.round(n));
  while (x > 9 && x !== 11 && x !== 22 && x !== 33) {
    x = String(x).split('').reduce((a, d) => a + Number(d), 0);
  }
  return x;
}

function digitsOnly(s) { return String(s || '').toUpperCase()
  .replace(/[^A-Z]/g, ''); }

function letterSum(s, filter) {
  let total = 0;
  digitsOnly(s).split('').forEach((c) => {
    if (filter && !filter(c)) return;
    total += LETTER[c] || 0;
  });
  return total;
}

// Per-number traits used by the customer-facing report.
// Each entry has: keyword, personality, career, love, health, habits,
// interests, finance, strengths, challenges, advice, lucky.
const TRAITS = {
  1: {
    keyword: 'The Leader (Sun)',
    personality: 'You are a born leader who thinks independently and '
      + 'acts with purpose. You set your own standards, trust your own '
      + 'instincts, and prefer to be in charge rather than follow '
      + 'instructions. You are original, confident and driven. '
      + 'Obstacles do not stop you; they motivate you. You can be '
      + 'stubborn at times, but that stubbornness is what makes you '
      + 'succeed where others give up.',
    career: 'You perform best in roles where you lead or work '
      + 'independently. Good career paths include entrepreneurship, '
      + 'government, politics, management, the military, medicine as '
      + 'a specialist or surgeon, creative direction, sports coaching '
      + 'and any pioneering field. You dislike taking orders for long; '
      + 'your goal is to be at the top or to run your own venture.',
    love: 'You are loyal, protective and deeply caring. You like being '
      + 'the one who provides and protects. You attract partners who '
      + 'admire your confidence and strength. Choose someone who gives '
      + 'you space and does not try to control you, as you need to feel '
      + 'free even in a committed relationship. You show love through '
      + 'actions, not words.',
    health: 'You are prone to stress-related issues because you push '
      + 'yourself very hard. Common concerns include high blood pressure, '
      + 'heart strain, headaches and eye problems (Sun rules the eyes). '
      + 'You must sleep enough, avoid excess caffeine, and take time to '
      + 'unwind daily. Early morning sunlight and brisk walking or '
      + 'running suit your energy perfectly. Avoid ignoring small '
      + 'symptoms; your tendency to push on can worsen minor issues.',
    habits: 'You wake up with a plan in your head and feel restless if '
      + 'the day has no direction. You tend to take on too much at once '
      + 'and find it hard to delegate. You are fiercely punctual and '
      + 'expect the same from others. You can be impatient when things '
      + 'move slowly. You need alone time to recharge even though you '
      + 'are naturally social.',
    interests: 'Leadership seminars, biographies of successful people, '
      + 'competitive sports, adventure travel, history, strategy games '
      + 'and debates. You enjoy activities where you can improve, compete '
      + 'or teach others.',
    finance: 'You are financially ambitious and driven to build wealth '
      + 'independently. You take calculated risks and are often rewarded '
      + 'for them. Best approach: invest in your own skills and ventures '
      + 'first. Avoid making impulsive financial decisions out of ego. '
      + 'Your best financial years come through self-employment or a '
      + 'leadership role where your efforts are directly rewarded.',
    strengths: 'Leadership, determination, originality, courage, '
      + 'self-reliance and the ability to start things.',
    challenges: 'Stubbornness, impatience, difficulty asking for help, '
      + 'tendency to dominate others and ignoring rest.',
    advice: 'Learn to collaborate. Your best results come when you lead '
      + 'a team, not when you do everything yourself. Let others '
      + 'contribute; it does not weaken your position.',
    lucky: { color: 'Golden / Orange', day: 'Sunday',
      stone: 'Ruby', planet: 'Sun', friendly: [1, 2, 4] },
  },
  2: {
    keyword: 'The Diplomat (Moon)',
    personality: 'You are sensitive, intuitive and deeply empathetic. '
      + 'You feel the emotions of people around you, often before they '
      + 'say anything. You are a natural peacemaker who brings harmony '
      + 'and understanding to any situation. People feel comfortable '
      + 'opening up to you. You work well in partnerships and prefer '
      + 'cooperation over competition. Your biggest challenge is '
      + 'learning to set boundaries so others do not take advantage of '
      + 'your kindness.',
    career: 'You thrive in supportive, people-focused roles. Best '
      + 'career options include counselling, psychology, nursing, '
      + 'social work, teaching, diplomacy, HR, design, hospitality, '
      + 'music and any role that requires patience and empathy. You '
      + 'work best in a harmonious team; conflict at the workplace '
      + 'deeply affects your performance.',
    love: 'Love is the centre of your world. You are deeply romantic, '
      + 'loyal and devoted. You give a lot in relationships and expect '
      + 'the same emotional depth in return. You need a partner who is '
      + 'patient, affectionate and communicates openly. Be careful not '
      + 'to lose yourself in a relationship or become too dependent on '
      + 'a partner for your self-worth.',
    health: 'Your health is closely linked to your emotional state. '
      + 'Stress, anxiety, overthinking and lack of emotional support '
      + 'can lead to digestive problems, hormonal imbalances, '
      + 'menstrual issues, water retention and low immunity. A stable '
      + 'home environment, regular sleep, gentle exercise such as '
      + 'yoga or swimming, and strong social connections are essential '
      + 'for your wellbeing. Moon rules the stomach and fluids in the '
      + 'body, so a clean, nourishing diet is very important for you.',
    habits: 'You are a nurturing person who often puts others first. '
      + 'You like routines and feel unsettled when your day is chaotic. '
      + 'You collect sentimental items and have a deep attachment to '
      + 'your home and family. You can overthink situations and replay '
      + 'conversations in your head. Journalling or talking to a '
      + 'trusted friend helps you process emotions.',
    interests: 'Cooking, gardening, interior decorating, music, poetry, '
      + 'psychology, astrology, family history, volunteering and '
      + 'creative arts. You enjoy making spaces and people feel warm '
      + 'and beautiful.',
    finance: 'You are careful with money and dislike financial '
      + 'uncertainty. You tend to save rather than spend lavishly. '
      + 'Avoid making financial decisions based purely on emotion or '
      + 'to please others. Partnerships and joint ventures can be '
      + 'very profitable for you if you choose reliable partners. '
      + 'Property investment and stable, long-term savings plans '
      + 'suit your temperament.',
    strengths: 'Empathy, intuition, patience, teamwork, attention to '
      + 'detail and the ability to make others feel at ease.',
    challenges: 'Over-sensitivity, indecisiveness, people-pleasing, '
      + 'emotional mood swings and dependence on others for validation.',
    advice: 'Learn to say no without guilt. Setting a boundary is not '
      + 'being unkind; it protects your own wellbeing so you can '
      + 'continue caring for others.',
    lucky: { color: 'Cream / Silver', day: 'Monday',
      stone: 'Pearl', planet: 'Moon', friendly: [1, 2, 7] },
  },
  3: {
    keyword: 'The Sage (Jupiter)',
    personality: 'You are wise, optimistic, expressive and full of '
      + 'enthusiasm. You have a natural gift for teaching, speaking '
      + 'and spreading joy. You see the good in every situation and '
      + 'your presence lifts the energy of the room. You love sharing '
      + 'knowledge and are naturally drawn to philosophy, spirituality '
      + 'and the bigger questions of life. You can be scattered if '
      + 'you take on too many projects, so focus is your key lesson.',
    career: 'Any role that involves communication, teaching or '
      + 'inspiring others. Best paths: teacher, professor, writer, '
      + 'motivational speaker, judge, lawyer, financial advisor, '
      + 'priest or spiritual guide, comedian, actor, publisher, '
      + 'coach and content creator. You need variety and intellectual '
      + 'stimulation; repetitive routine work drains you quickly.',
    love: 'You are affectionate, generous and fun to be with. You need '
      + 'a partner who is intellectually engaging and shares your love '
      + 'of learning. You express love through words, gifts and '
      + 'experiences. Avoid being too preachy with a partner; '
      + 'remember that love is also about listening, not just sharing '
      + 'wisdom. Children and family bring you great joy.',
    health: 'Jupiter rules the liver, thighs and fat in the body. '
      + 'You may have a tendency to overindulge in food or drink, '
      + 'which can lead to weight gain, liver issues, blood sugar '
      + 'problems or cholesterol concerns. Regular physical activity '
      + 'is important; choose something you enjoy such as dancing, '
      + 'cycling or team sports. Avoid excess sweets and fatty foods. '
      + 'Your health benefits greatly from an active spiritual or '
      + 'meditation practice.',
    habits: 'You read widely and love a good conversation. You tend '
      + 'to give advice freely, sometimes without being asked. You '
      + 'are generous with your time and money, occasionally to a '
      + 'fault. You enjoy social gatherings and are usually the one '
      + 'sharing a story or a lesson. You procrastinate on practical '
      + 'tasks because ideas excite you more than execution.',
    interests: 'Reading, writing, philosophy, religion, travel, '
      + 'astrology, law, investing, teaching, public speaking, '
      + 'comedy and documentary films. You love expanding your '
      + 'understanding of how the world works.',
    finance: 'Jupiter brings financial blessings through good judgment '
      + 'and wise investments. You attract abundance naturally but '
      + 'can be overly generous, giving away more than you can afford. '
      + 'Your best financial strategy is to invest in education, '
      + 'real estate, gold, or mentorship. Avoid speculative '
      + 'short-term bets. Build wealth through knowledge and sound '
      + 'long-term planning.',
    strengths: 'Wisdom, optimism, communication, generosity, faith '
      + 'and the ability to inspire and guide others.',
    challenges: 'Overindulgence, lack of focus, over-giving, '
      + 'procrastination and unrealistic expectations.',
    advice: 'Focus on one meaningful project at a time. Your greatest '
      + 'impact comes when you channel your wide knowledge into a '
      + 'single, sustained effort.',
    lucky: { color: 'Yellow', day: 'Thursday',
      stone: 'Yellow Sapphire', planet: 'Jupiter',
      friendly: [3, 6, 9] },
  },
  4: {
    keyword: 'The Builder (Rahu)',
    personality: 'You are hardworking, unconventional and highly '
      + 'systematic. You build things that last. While others chase '
      + 'shortcuts, you do the steady, deep work. You see patterns '
      + 'and structures that others miss, which gives you an edge in '
      + 'technical and analytical fields. You can be a rebel at heart '
      + 'and often challenge the accepted way of doing things. You '
      + 'work best when you believe in what you are doing.',
    career: 'You excel in technical, analytical and structural roles. '
      + 'Best paths: engineer, software developer, data analyst, '
      + 'scientist, architect, project manager, researcher, IT '
      + 'specialist, urban planner and any role that involves '
      + 'building long-term systems. You are dependable and thorough, '
      + 'making you a valuable team member or manager.',
    love: 'You are loyal and deeply committed once you decide to be '
      + 'in a relationship. You do not rush into love; you take time '
      + 'to assess compatibility carefully. You show love through '
      + 'acts of service and practical care. Choose a patient, '
      + 'understanding partner who does not mind your occasional need '
      + 'for solitude. Avoid letting work take over your relationship.',
    health: 'Rahu creates irregular or unpredictable health patterns. '
      + 'You may experience sudden spells of exhaustion, nervous '
      + 'system issues, skin conditions, digestive irregularities '
      + 'or respiratory concerns. Regular routine is your best '
      + 'medicine: consistent sleep, regular meals and structured '
      + 'exercise. Avoid skipping meals and overworking late into the '
      + 'night, which are habits you are prone to.',
    habits: 'You are systematic and meticulous. Your workspace may '
      + 'look cluttered to others, but you know where everything is. '
      + 'You research thoroughly before making any major decision. '
      + 'You can get so absorbed in work that you forget to rest or '
      + 'socialise. You are a person of few but very close friends.',
    interests: 'Technology, puzzles, science fiction, strategy games, '
      + 'DIY projects, coding, history, documentary films, travel to '
      + 'unusual or off-the-beaten-path places, and anything that '
      + 'involves solving a problem or building something new.',
    finance: 'You are careful, methodical and rarely impulsive with '
      + 'money. You do best with structured, long-term financial plans: '
      + 'systematic investments, fixed deposits, real estate and '
      + 'building assets steadily over time. Avoid speculative or '
      + 'get-rich-quick schemes. Your wealth comes from patience '
      + 'and consistency, never from shortcuts.',
    strengths: 'Reliability, diligence, analytical thinking, '
      + 'discipline, originality and the ability to build lasting work.',
    challenges: 'Rigidity, over-working, social isolation, stubbornness '
      + 'and resistance to change even when change is needed.',
    advice: 'Take breaks and nurture your relationships. Hard work is '
      + 'your strength, but life is richer when you allow yourself '
      + 'to relax and connect with the people who matter to you.',
    lucky: { color: 'Grey / Electric blue', day: 'Saturday',
      stone: 'Hessonite (Gomedh)', planet: 'Rahu',
      friendly: [1, 5, 8] },
  },
  5: {
    keyword: 'The Messenger (Mercury)',
    personality: 'You are quick-witted, adaptable, charming and '
      + 'always curious. You love variety, movement and new '
      + 'experiences. You pick up new skills with ease and can talk '
      + 'to anyone about anything. You become restless in routine and '
      + 'need constant mental stimulation to feel alive. You are the '
      + 'person who has tried ten different things by 30, and this '
      + 'variety is actually your strength because it makes you '
      + 'resourceful and versatile.',
    career: 'Any role involving communication, sales, movement or '
      + 'technology suits you. Best paths: journalist, content '
      + 'creator, salesperson, trader, stock broker, travel agent, '
      + 'tour guide, IT consultant, marketer, social media manager, '
      + 'writer, translator and entrepreneur. You need autonomy '
      + 'and variety; rigid corporate structures suffocate you.',
    love: 'You need a partner who is intellectually stimulating, '
      + 'fun and gives you space. You enjoy the excitement of romance '
      + 'but can struggle with long-term commitment if a relationship '
      + 'becomes too predictable. Once you find a partner who keeps '
      + 'you mentally engaged and respects your freedom, you are '
      + 'remarkably fun and devoted. Avoid making relationship '
      + 'decisions when you are bored; boredom is temporary.',
    health: 'Mercury rules the nervous system, lungs, arms, hands and '
      + 'shoulders. You are prone to anxiety, nervous exhaustion, '
      + 'respiratory issues, hand or wrist strain and insomnia when '
      + 'overstimulated. Your mind rarely switches off, so meditation, '
      + 'breathwork and digital detox days are very important for you. '
      + 'Regular physical movement, especially walking, cycling or '
      + 'dancing, helps you discharge mental restlessness.',
    habits: 'You multitask constantly, often with several tabs open '
      + 'in your browser and in your mind. You speak fast, think fast '
      + 'and make decisions quickly, sometimes too quickly. You get '
      + 'bored with the same environment and rearrange your space '
      + 'often. You are sociable and enjoy meeting new people.',
    interests: 'Travel, languages, trivia, technology, writing, '
      + 'podcasts, comedy, games, social media, current affairs, '
      + 'photography, cultural events and anything that teaches you '
      + 'something new.',
    finance: 'You can earn well through communication, trading, sales '
      + 'or commission-based work. Your challenge is consistency; '
      + 'you may earn a lot then spend freely. Build financial '
      + 'discipline by automating savings. Avoid speculative trading '
      + 'based on tips or trends. Mercury energy rewards quick '
      + 'business deals and negotiations, so use those strengths.',
    strengths: 'Adaptability, communication, quick learning, '
      + 'networking, resourcefulness and creative problem-solving.',
    challenges: 'Inconsistency, impulsiveness, difficulty committing, '
      + 'scattered focus and nervous energy.',
    advice: 'Choose depth in at least one area. Being good at many '
      + 'things is a gift, but mastery in one area will give you '
      + 'both fulfilment and long-term financial security.',
    lucky: { color: 'Green', day: 'Wednesday',
      stone: 'Emerald', planet: 'Mercury', friendly: [1, 4, 6] },
  },
  6: {
    keyword: 'The Nurturer (Venus)',
    personality: 'You are warm, artistic, responsible and deeply '
      + 'devoted to the people you love. Beauty, harmony and family '
      + 'are central to your life. You have a strong sense of '
      + 'fairness and feel deeply uncomfortable in conflict. You '
      + 'are the person others come to when they need comfort, '
      + 'support or a beautiful space to rest in. You carry a lot '
      + 'for others and must learn to let them carry some of it too.',
    career: 'You do best in roles involving service, beauty, care '
      + 'or family. Best paths: interior designer, architect, '
      + 'fashion designer, chef, hotel manager, nurse, doctor, '
      + 'therapist, social worker, teacher, real estate agent, '
      + 'wedding planner, makeup artist and family business. '
      + 'You also do very well in any creative field where '
      + 'aesthetics and quality matter.',
    love: 'Love is your life purpose. You are one of the most '
      + 'devoted, affectionate and romantic numbers. You go above '
      + 'and beyond for your partner and family. Be careful not to '
      + 'lose your own identity in a relationship. You deserve a '
      + 'partner who actively appreciates and reciprocates your care. '
      + 'Marriage and long-term commitment bring out your best self.',
    health: 'Venus rules the throat, kidneys, skin and reproductive '
      + 'organs. You may experience throat infections, hormonal '
      + 'imbalances, kidney strain or skin issues, especially when '
      + 'under emotional stress. Stress affects you physically very '
      + 'quickly. Eating well, staying hydrated, regular gentle '
      + 'exercise (yoga, dancing, swimming) and maintaining a '
      + 'peaceful home environment are essential for your health.',
    habits: 'Your home and personal space matter deeply to you; you '
      + 'invest time and care in making it beautiful and comfortable. '
      + 'You cook and care for others naturally. You tend to put '
      + 'others before yourself and may neglect your own needs. You '
      + 'have a strong aesthetic sense and notice details in art, '
      + 'music and design that others miss.',
    interests: 'Cooking, interior design, music, singing, dance, '
      + 'painting, gardening, fashion, reading romance or family '
      + 'stories, photography, travel to cultural or scenic '
      + 'destinations and anything that combines beauty with purpose.',
    finance: 'You are responsible with money and tend to spend on '
      + 'your home, family and quality of life. Avoid lending money '
      + 'to people who do not repay as this causes you stress. '
      + 'Real estate, gold, art and long-term savings suit you well. '
      + 'Venus blesses you with comfort and abundance; you rarely '
      + 'go truly without, but building a financial safety net '
      + 'gives you the security you need.',
    strengths: 'Compassion, creativity, responsibility, devotion, '
      + 'aesthetic sensibility and the ability to create harmony.',
    challenges: 'Over-responsibility, people-pleasing, difficulty '
      + 'saying no, martyrdom and putting others so far first that '
      + 'you run dry.',
    advice: 'Care for yourself with the same energy you give others. '
      + 'You cannot pour from an empty cup; your relationships '
      + 'improve when you prioritise your own needs too.',
    lucky: { color: 'White / Pastel pink', day: 'Friday',
      stone: 'Diamond / White Sapphire', planet: 'Venus',
      friendly: [3, 5, 6] },
  },
  7: {
    keyword: 'The Mystic (Ketu)',
    personality: 'You are reflective, intuitive, analytical and '
      + 'spiritually inclined. You are not satisfied with surface-level '
      + 'explanations; you want to understand the deeper truth behind '
      + 'everything. You are quiet in large groups but deeply '
      + 'thoughtful in one-on-one conversations. People sense your '
      + 'depth and wisdom. You have strong psychic or intuitive '
      + 'abilities that often show up as gut feelings that turn out '
      + 'to be correct.',
    career: 'You excel in research, analysis, investigation and '
      + 'spiritual fields. Best paths: scientist, researcher, '
      + 'mathematician, astrologer, psychologist, philosopher, '
      + 'analyst, writer, spiritual teacher, detective, doctor, '
      + 'healer, data scientist and any role requiring deep '
      + 'independent thinking. You dislike superficial work or '
      + 'environments that prioritise appearances over substance.',
    love: 'You are selective with your inner circle and take time '
      + 'to open up. You need a partner who respects your need '
      + 'for solitude and does not mistake quietness for coldness. '
      + 'Depth, loyalty and intellectual connection are more '
      + 'important to you than physical attraction or social status. '
      + 'Once you trust someone, you are deeply devoted and '
      + 'emotionally rich as a partner.',
    health: 'Ketu creates unusual or difficult-to-diagnose health '
      + 'patterns. You may experience nervous system sensitivity, '
      + 'chronic fatigue, mysterious pains, skin conditions or '
      + 'issues that take time to identify. Your mind-body connection '
      + 'is very strong, so mental and emotional peace directly '
      + 'affects your physical health. Meditation, time in nature, '
      + 'a quiet sleep environment and spiritual practice are the '
      + 'best medicine for you.',
    habits: 'You spend time alone willingly and need it to '
      + 'recharge. You keep a small, trusted circle of friends. '
      + 'You read and research topics deeply. You are observant '
      + 'and notice things others walk past. You often have '
      + 'unusual interests or spiritual practices that your '
      + 'immediate social circle may not fully understand.',
    interests: 'Astrology, numerology, philosophy, ancient history, '
      + 'occult sciences, meditation, nature, music (especially '
      + 'classical or ambient), scientific research, puzzles, '
      + 'psychology, spiritual texts and solitary outdoor activities '
      + 'like hiking.',
    finance: 'Your relationship with money is unconventional. '
      + 'You can go from having a lot to having very little and '
      + 'back again. You are not particularly motivated by wealth '
      + 'for its own sake, but you need financial security to '
      + 'have the freedom to pursue your true interests. Best '
      + 'approach: invest in knowledge, spiritual practices and '
      + 'long-term assets. Avoid lending based on emotion or '
      + 'trusting unverified financial advice.',
    strengths: 'Intuition, depth of thought, analytical ability, '
      + 'wisdom, independence and strong inner knowing.',
    challenges: 'Isolation, distrust, pessimism, difficulty '
      + 'expressing emotions and detaching from relationships '
      + 'before giving them enough time.',
    advice: 'Share your inner world more. Your depth is a gift '
      + 'to others, but only if you allow people close enough '
      + 'to experience it. Not everyone is a threat.',
    lucky: { color: 'Light blue / White', day: 'Monday',
      stone: "Cat's Eye", planet: 'Ketu', friendly: [2, 4, 7] },
  },
  8: {
    keyword: 'The Achiever (Saturn)',
    personality: 'You are disciplined, patient, ambitious and '
      + 'deeply karmic in your outlook. You understand that real '
      + 'success takes time, and you are willing to put in the '
      + 'work. You have strong executive ability and natural '
      + 'authority. Life often gives you challenges early on, '
      + 'but those challenges build the resilience that eventually '
      + 'leads to great achievement. You are not afraid of '
      + 'responsibility; in fact, you carry it better than most.',
    career: 'You are built for positions of authority and long-term '
      + 'responsibility. Best paths: finance, banking, law, '
      + 'judiciary, politics, real estate, construction, government, '
      + 'mining, corporate management, accounts and auditing, '
      + 'business ownership and any field that rewards patience '
      + 'and sustained effort. You do best in structured environments '
      + 'where your work is measured fairly.',
    love: 'You are serious about love and do not enter relationships '
      + 'lightly. You are reliable, consistent and expect the same '
      + 'from your partner. Show affection more openly; your partner '
      + 'may need verbal reassurance that you might not give naturally. '
      + 'A stable, loyal partner who understands your ambition and '
      + 'does not compete with it is your ideal match.',
    health: 'Saturn rules the bones, teeth, joints, skin, spine and '
      + 'nervous system. You may be prone to joint pain, back issues, '
      + 'dental problems, chronic fatigue or skin dryness. Late nights '
      + 'and overwork without adequate recovery take a toll. Regular '
      + 'oil massage, strength training, calcium-rich diet, adequate '
      + 'sleep and a structured daily routine are important for '
      + 'your long-term health.',
    habits: 'You are structured and follow routines carefully. '
      + 'You are not a big spender and prefer value over status. '
      + 'You are the person who finishes every task they start. '
      + 'You can be so focused on a long-term goal that you '
      + 'forget to enjoy the present. You rarely ask for help, '
      + 'even when you need it.',
    interests: 'History, long-term investing, governance, '
      + 'philosophy, biographies of great leaders, classical '
      + 'music or literature, archival research, estate planning '
      + 'and any hobby that builds a skill slowly over time '
      + 'such as chess, woodworking or calligraphy.',
    finance: 'Wealth comes to you slowly and steadily, but once '
      + 'built it lasts. You are excellent at long-term '
      + 'financial planning. Best approach: property, long-term '
      + 'equity investments, fixed assets and businesses with '
      + 'proven models. Avoid risky ventures or anything that '
      + 'promises quick returns. Your wealth peak typically '
      + 'comes in your 40s and 50s.',
    strengths: 'Discipline, perseverance, responsibility, '
      + 'organisational ability, long-term thinking and integrity.',
    challenges: 'Over-seriousness, workaholism, emotional '
      + 'guardedness, fear of failure and resistance to asking '
      + 'for help.',
    advice: 'Enjoy the journey, not just the destination. Success '
      + 'at the cost of health or relationships is not true success. '
      + 'Rest is also productive.',
    lucky: { color: 'Black / Deep blue', day: 'Saturday',
      stone: 'Blue Sapphire (consult an expert before wearing)',
      planet: 'Saturn', friendly: [4, 5, 8] },
  },
  9: {
    keyword: 'The Warrior (Mars)',
    personality: 'You are courageous, energetic, passionate and '
      + 'driven by a strong sense of justice. You feel deeply '
      + 'and act boldly. When you believe in something, you '
      + 'fight for it with everything you have. You are '
      + 'compassionate toward the underdog and often take up '
      + 'causes bigger than yourself. You can be intense, '
      + 'impatient and quick to anger, but you are also '
      + 'equally quick to forgive.',
    career: 'You do well in fields requiring courage, action '
      + 'and physical or mental strength. Best paths: military, '
      + 'police, surgery, emergency medicine, sports, fitness '
      + 'coaching, social activism, engineering, construction, '
      + 'law, real estate and entrepreneurship. You are '
      + 'especially good in crisis situations where others '
      + 'freeze and you stay calm and decisive.',
    love: 'You are passionate, protective and intensely devoted '
      + 'to those you love. Romantic relationships are never '
      + 'lukewarm for you; they are deep and intense. You need '
      + 'a partner who can handle your energy and does not '
      + 'wilt under your passion. Avoid letting anger or '
      + 'pride damage relationships; learn to cool down '
      + 'before you speak in conflict.',
    health: 'Mars rules the blood, muscles, adrenal glands, '
      + 'head and fire energy in the body. You are prone to '
      + 'accidents, cuts, burns, high fevers, high blood '
      + 'pressure, migraines and anger-related stress. '
      + 'You have a high physical energy, so regular intense '
      + 'exercise (gym, martial arts, running, team sports) '
      + 'is essential. Physical activity is your primary stress '
      + 'reliever; without it, your mental state suffers.',
    habits: 'You are direct, sometimes blunt, and have little '
      + 'patience for indecision. You move fast and expect '
      + 'things to happen quickly. You tend to take on '
      + 'challenges head-on rather than planning around them. '
      + 'You are generous to people in need and have a strong '
      + 'sense of loyalty.',
    interests: 'Martial arts, adventure sports, military history, '
      + 'social justice causes, competitive games, action films '
      + 'and documentaries, travel to challenging places, '
      + 'cooking spicy food, fitness and bodybuilding.',
    finance: 'You have the energy and drive to earn well, but '
      + 'impulsive spending or risky bets can set you back. '
      + 'Build financial discipline by separating emotions '
      + 'from money decisions. Real estate, sports-related '
      + 'business, manufacturing, construction and action-focused '
      + 'entrepreneurship all work well for you financially.',
    strengths: 'Courage, energy, determination, passion, '
      + 'leadership in crisis and strong moral conviction.',
    challenges: 'Anger, impulsiveness, impatience, aggression '
      + 'and a tendency to take on too many battles at once.',
    advice: 'Pick your battles wisely. Your energy is your '
      + 'greatest asset; spend it on what truly matters. '
      + 'Not every conflict needs your participation.',
    lucky: { color: 'Red / Crimson', day: 'Tuesday',
      stone: 'Red Coral', planet: 'Mars', friendly: [3, 6, 9] },
  },
  11: {
    keyword: 'The Illuminator (Master 11)',
    personality: 'You are one of the rarest souls in numerology. '
      + 'Eleven is a master number, which means your potential '
      + 'is extraordinary but so are your challenges. You are '
      + 'highly intuitive, sensitive and visionary. You sense '
      + 'things before they happen and understand people at a '
      + 'very deep level. You are here to inspire and illuminate '
      + 'others, not just to live for yourself. When 11 energy '
      + 'is expressed at its lower vibration (2), you feel '
      + 'anxious, overwhelmed and uncertain; when elevated, '
      + 'you become a beacon of light for those around you.',
    career: 'Your calling involves uplifting or inspiring others. '
      + 'Best paths: spiritual teacher, healer, psychologist, '
      + 'life coach, motivational speaker, artist, musician, '
      + 'journalist with a mission, social reformer, diplomat '
      + 'and any creative or public role where your vision '
      + 'and sensitivity are assets. Avoid purely commercial '
      + 'or materialistic roles as they drain your energy rapidly.',
    love: 'You experience love on a spiritual level. Superficial '
      + 'relationships leave you empty. You need a partner '
      + 'who can understand your depth, intuition and '
      + 'sensitivity, and who supports your mission. You tend '
      + 'to attract lost or broken people; choose a partner '
      + 'who has done their own inner work.',
    health: 'Your nervous system is highly sensitive. Anxiety, '
      + 'overthinking, emotional overwhelm, insomnia and '
      + 'psychosomatic symptoms are common. Grounding practices '
      + 'are essential: meditation, time in nature, consistent '
      + 'sleep, reducing screen time and limiting exposure '
      + 'to negative news or environments. Your sensitivity '
      + 'is a strength but requires careful management.',
    habits: 'You absorb the energy of your environment deeply. '
      + 'You need quiet spaces to recover after social '
      + 'interactions. You often receive ideas or intuitions '
      + 'that you cannot explain rationally. You are drawn '
      + 'to mystical or spiritual experiences from an early age.',
    interests: 'Spirituality, healing arts, meditation, music, '
      + 'astrology, metaphysics, poetry, humanitarian causes, '
      + 'psychology, esoteric studies and creative arts with '
      + 'a message.',
    finance: 'Your financial life is directly tied to how well '
      + 'you are living your purpose. When you are aligned, '
      + 'money flows with less effort. When you compromise '
      + 'your values for money, you struggle. Build a career '
      + 'around your gift; financial security will follow.',
    strengths: 'Spiritual intuition, empathy, creativity, '
      + 'inspiration, diplomacy and the ability to see what '
      + 'others cannot.',
    challenges: 'Anxiety, self-doubt, nervous exhaustion, '
      + 'over-sensitivity and difficulty with practical, '
      + 'day-to-day responsibilities.',
    advice: 'Trust your intuition. It has never truly failed '
      + 'you; your mind has talked you out of it. Ground '
      + 'yourself daily and let your sensitivity be your '
      + 'compass, not your burden.',
    lucky: { color: 'Silver / Iridescent', day: 'Monday',
      stone: 'Moonstone', planet: 'Moon (elevated)',
      friendly: [2, 7, 11] },
  },
  22: {
    keyword: 'The Master Builder (22)',
    personality: 'You are a practical visionary, one of the most '
      + 'powerful numbers in Chaldean numerology. You can take '
      + 'the largest, most complex dreams and actually build '
      + 'them into reality. You combine the spiritual vision '
      + 'of number 11 with the practical power of number 4. '
      + 'When you operate at your full potential, you create '
      + 'things that benefit not just yourself but entire '
      + 'communities, organisations or even generations.',
    career: 'Anything that builds something large and meaningful. '
      + 'Best paths: business leader, CEO, architect, civil '
      + 'engineer, policymaker, large-scale entrepreneur, '
      + 'diplomat, organisational leader, global NGO head '
      + 'and any role where you create systems that outlast you.',
    love: 'You need a partner who is grounded, shares your '
      + 'ambitions and is willing to build a life together '
      + 'with long-term intention. Superficial romance does '
      + 'not hold your attention. A stable, mission-aligned '
      + 'partnership is what fulfils you.',
    health: 'The pressure you put on yourself can manifest as '
      + 'physical tension, especially in the back, shoulders, '
      + 'and cardiovascular system. Schedule recovery time '
      + 'the same way you schedule your work. Structured '
      + 'physical exercise, adequate sleep and delegation '
      + 'of tasks are essential for sustainable performance.',
    habits: 'You think in systems and structures. You plan '
      + 'years ahead. You are not satisfied with small or '
      + 'local impact; you want to build something that '
      + 'changes lives at scale. You can overwhelm people '
      + 'with your vision if you do not simplify it for them.',
    interests: 'Urban planning, global affairs, architecture, '
      + 'economics, philosophy, leadership literature, '
      + 'long-term strategic planning and large projects '
      + 'in any domain.',
    finance: 'You are built for significant wealth if you '
      + 'channel your energy wisely. Your best financial '
      + 'vehicle is building or leading a meaningful '
      + 'enterprise. Avoid underestimating your worth '
      + 'or working for others when you have the capacity '
      + 'to build your own legacy.',
    strengths: 'Visionary thinking, practical execution, '
      + 'determination, leadership and the rare ability to '
      + 'build things that matter at scale.',
    challenges: 'Overwhelming pressure, perfectionism, '
      + 'difficulty trusting others and burning out from '
      + 'taking on too much.',
    advice: 'Delegate without guilt. No great builder builds '
      + 'alone. Your legacy is larger when you allow '
      + 'others to contribute to it.',
    lucky: { color: 'Royal blue', day: 'Saturday',
      stone: 'Sapphire', planet: 'Saturn (elevated)',
      friendly: [4, 8, 22] },
  },
  33: {
    keyword: 'The Master Teacher (33)',
    personality: 'You carry one of the highest vibrations in '
      + 'numerology. You are a compassionate guide, a healer '
      + 'and a teacher at soul level. You exist to serve, '
      + 'to comfort and to elevate others. You feel the '
      + 'world\'s pain deeply and are driven to ease it. '
      + 'When expressed fully, you become a beacon of '
      + 'unconditional love and wisdom. At the lower '
      + 'vibration (6), you are simply a deeply caring, '
      + 'creative and responsible person.',
    career: 'Any role centred on healing, teaching or '
      + 'compassionate service. Best paths: spiritual healer, '
      + 'therapist, doctor, nurse, teacher, social worker, '
      + 'artist with a message, humanitarian leader, '
      + 'religious guide and counsellor.',
    love: 'Love is your medicine and your mission. You give '
      + 'love unconditionally, sometimes to your own '
      + 'detriment. Choose a partner who recognises your '
      + 'giving nature and actively gives back to you. '
      + 'Healing partnerships rooted in mutual service '
      + 'and shared spiritual values bring out your best.',
    health: 'You absorb others\' emotional pain. Establishing '
      + 'clear energetic boundaries is essential for your '
      + 'health. Regular rest, spiritual practice, time in '
      + 'nature and creative expression are your medicine. '
      + 'Watch for burnout from over-giving.',
    habits: 'You are naturally selfless, sometimes to the '
      + 'point of self-neglect. You see the best in everyone '
      + 'and can be slow to acknowledge when someone is '
      + 'taking advantage of your generosity.',
    interests: 'Healing arts, music, painting, writing with '
      + 'a message, spiritual practices, volunteering, '
      + 'working with children or elders and any creative '
      + 'pursuit that serves a higher purpose.',
    finance: 'Money flows when you serve with authenticity. '
      + 'Avoid letting guilt prevent you from charging '
      + 'for your gifts. Setting fair prices for your '
      + 'skills is not greed; it is sustainability.',
    strengths: 'Unconditional love, compassion, wisdom, '
      + 'creative ability, selfless service and inspiring '
      + 'others through example.',
    challenges: 'Self-sacrifice to the point of exhaustion, '
      + 'difficulty accepting help, over-idealising people '
      + 'and carrying others\' burdens as your own.',
    advice: 'You can only give from what you have. '
      + 'Filling yourself first is not selfish; it is '
      + 'what makes your service sustainable and real.',
    lucky: { color: 'Soft pink / Gold', day: 'Friday',
      stone: 'Rose Quartz', planet: 'Venus (elevated)',
      friendly: [3, 6, 9, 33] },
  },
};

export function traitsFor(n) { return TRAITS[n] || TRAITS[reduce(n)]; }

// Produce a human-readable step string showing how a number is reduced.
// e.g. reduceSteps(15) -> "1+5=6", reduceSteps(29) -> "2+9=11"
function reduceSteps(n) {
  let x = Math.abs(Math.round(n));
  const parts = [];
  while (x > 9 && x !== 11 && x !== 22 && x !== 33) {
    const digits = String(x).split('');
    const next = digits.reduce((a, d) => a + Number(d), 0);
    parts.push(`${digits.join('+')}=${next}`);
    x = next;
  }
  return parts.join(' → ');
}

// Show how life path number is derived from DOB.
// Returns: "Day 15: 1+5=6  Month 08: 8  Year 1990: 1+9+9+0=19 → 1+9=10 → 1+0=1  Total: 6+8+1=15 → 1+5=6"
export function lifePathDerivation(dob) {
  const m = String(dob || '').match(/(\d{1,2})\D+(\d{1,2})\D+(\d{2,4})/);
  if (!m) return null;
  const dNum = Number(m[1]);
  const moNum = Number(m[2]);
  const yNum = Number(m[3]);
  const dR = reduce(dNum);
  const moR = reduce(moNum);
  const yR = reduce(yNum);
  const total = dR + moR + yR;
  const parts = [];
  const dSteps = reduceSteps(dNum);
  parts.push(`Day ${String(dNum).padStart(2, '0')}: ${
    dSteps ? `${dSteps} = ${dR}` : dR}`);
  const moSteps = reduceSteps(moNum);
  parts.push(`Month ${String(moNum).padStart(2, '0')}: ${
    moSteps ? `${moSteps} = ${moR}` : moR}`);
  const yStr = String(yNum);
  const ySteps = reduceSteps(yNum);
  const yRaw = yStr.split('').join('+') + '=' + yStr.split('').reduce((a, d) => a + Number(d), 0);
  parts.push(`Year ${yStr}: ${ySteps ? `${yRaw} → ${ySteps} = ${yR}` : `${yRaw}`}`);
  const totalSteps = reduceSteps(total);
  parts.push(`Sum: ${dR}+${moR}+${yR}=${total}${totalSteps ? ` → ${totalSteps}` : ''}`);
  return parts.join('   ');
}

// Show how a name's letter values are summed.
export function destinyDerivation(fullName) {
  const clean = digitsOnly(fullName);
  if (!clean) return null;
  const vals = clean.split('').map((c) => `${c}=${LETTER[c] || 0}`);
  const total = clean.split('').reduce((a, c) => a + (LETTER[c] || 0), 0);
  const steps = reduceSteps(total);
  return `${vals.join(' + ')} = ${total}${steps ? ` → ${steps}` : ''}`;
}

// Life-path number from DOB (DD-MM-YYYY). Each component is reduced
// separately, then summed and reduced again - keeps master numbers.
export function lifePath(dob) {
  const m = String(dob || '').match(/(\d{1,2})\D+(\d{1,2})\D+(\d{2,4})/);
  if (!m) return null;
  const d = reduce(Number(m[1]));
  const mo = reduce(Number(m[2]));
  const y = reduce(Number(m[3]));
  return reduce(d + mo + y);
}

// Day-of-birth (the literal day, reduced).
export function birthdayNumber(dob) {
  const m = String(dob || '').match(/^(\d{1,2})/);
  return m ? reduce(Number(m[1])) : null;
}

export function destinyNumber(fullName) {
  return reduce(letterSum(fullName));
}
export function soulUrgeNumber(fullName) {
  return reduce(letterSum(fullName, (c) => VOWELS.has(c)));
}
export function personalityNumber(fullName) {
  return reduce(letterSum(fullName, (c) => !VOWELS.has(c)));
}

// Personal year (current cycle), useful for "what's this year about".
export function personalYear(dob, year = new Date().getFullYear()) {
  const m = String(dob || '').match(/(\d{1,2})\D+(\d{1,2})\D+\d{2,4}/);
  if (!m) return null;
  const d = reduce(Number(m[1]));
  const mo = reduce(Number(m[2]));
  return reduce(d + mo + reduce(year));
}

// Full report. Pass { name, dob } -> returns every number + traits +
// derived lucky numbers and a friendly summary.
export function fullReport({ name, dob } = {}) {
  if (!name && !dob) return null;
  const destiny = destinyNumber(name);
  const soul = soulUrgeNumber(name);
  const persona = personalityNumber(name);
  const life = lifePath(dob);
  const day = birthdayNumber(dob);
  const year = personalYear(dob);
  const luckySet = Array.from(new Set([life, destiny, day]
    .filter((x) => x && x > 0))).slice(0, 5);
  return {
    name: String(name || '').trim(),
    dob: String(dob || '').trim(),
    destiny, destinyTraits: traitsFor(destiny),
    destinyDerivation: destinyDerivation(name),
    soul, soulTraits: traitsFor(soul),
    personality: persona, personalityTraits: traitsFor(persona),
    lifePath: life, lifeTraits: traitsFor(life),
    lifePathDerivation: lifePathDerivation(dob),
    birthday: day,
    personalYear: year, yearTraits: traitsFor(year),
    luckyNumbers: luckySet,
  };
}

// Compact "lucky set" for a person - the unique single digits derived
// from life path, destiny and birthday. Used by every check / suggest
// helper below as the source of truth for "what numbers favour you".
// Falls back to an empty array if neither name nor dob is provided.
export function luckyNumbersFor({ name, dob } = {}) {
  const candidates = [];
  if (dob) {
    const lp = lifePath(dob); if (lp) candidates.push(lp);
    const bd = birthdayNumber(dob); if (bd) candidates.push(bd);
  }
  if (name) {
    const d = destinyNumber(name); if (d) candidates.push(d);
  }
  // Reduce master numbers (11/22/33) to their roots for digit-level
  // checks against a phone / vehicle / name sum.
  const root = (n) => (n > 9 ? reduce(reduce(n)) : n);
  return Array.from(new Set(candidates.map(root))).slice(0, 5);
}

// Digit-sum any string of digits down to its root (e.g. mobile or
// vehicle number). Non-digits are ignored. Returns 0 for empty input.
export function digitRoot(numericLike) {
  const digits = String(numericLike || '').replace(/\D/g, '');
  if (!digits) return 0;
  let total = 0;
  for (const ch of digits) total += Number(ch);
  return reduce(total);
}

// Check whether a phone / vehicle number is "lucky" for this person.
// Returns { ok, root, luckySet, message }. ok=true means the digit
// root of `numericLike` matches one of the person's lucky numbers.
export function checkNumberLuck(numericLike, { name, dob } = {}) {
  const root = digitRoot(numericLike);
  const luckySet = luckyNumbersFor({ name, dob });
  if (!root) {
    return { ok: false, root: 0, luckySet,
      message: 'Enter at least one digit to check.' };
  }
  if (!luckySet.length) {
    return { ok: false, root, luckySet,
      message: 'Add your name and date of birth to compute lucky '
        + 'numbers first.' };
  }
  const traits = traitsFor(root);
  const friendly = (traits && traits.lucky && traits.lucky.friendly) || [];
  const luckyMatch = luckySet.includes(root);
  const friendlyMatch = luckySet.some((n) => friendly.includes(n));
  let message;
  if (luckyMatch) {
    message = `Great pick - this number reduces to ${root}, one of `
      + 'your lucky numbers.';
  } else if (friendlyMatch) {
    message = `Reasonable - it reduces to ${root} which is friendly `
      + `to your lucky numbers (${luckySet.join(', ')}).`;
  } else {
    message = `Not aligned - it reduces to ${root}; your lucky `
      + `numbers are ${luckySet.join(', ')}. Try a different number.`;
  }
  return { ok: luckyMatch, friendly: friendlyMatch,
    root, luckySet, friendlyTo: friendly, message };
}

// Generate up to N candidate "lucky" trailing digit pairs for the
// person. Used by the mobile-number / vehicle-number helpers to
// suggest replacements when the user's current number doesn't align.
// Returns an array of strings like ['11', '28', '46', ...].
export function suggestLuckyPairs({ name, dob } = {}, count = 10) {
  const luckySet = luckyNumbersFor({ name, dob });
  if (!luckySet.length) return [];
  const out = [];
  for (let n = 10; n < 100 && out.length < count; n += 1) {
    if (luckySet.includes(digitRoot(String(n)))) {
      out.push(String(n).padStart(2, '0'));
    }
  }
  return out;
}

// Name correction helper. Computes the current name's destiny number
// and, when it doesn't already match the person's life path, suggests
// small spelling tweaks (add / drop / change a vowel) that land on
// the target destiny. Returns:
//   {
//     ok,                            // already matches life path
//     current: { name, destiny },
//     target,                        // life-path number to aim for
//     suggestions: [{ name, destiny }] // up to 6 candidates
//   }
export function suggestNameCorrection(name, dob) {
  const lp = lifePath(dob);
  if (!lp) {
    return { ok: false, error: 'Enter your date of birth first.' };
  }
  const current = { name, destiny: destinyNumber(name) };
  if (!name || !current.destiny) {
    return { ok: false, error: 'Enter your full name first.' };
  }
  if (current.destiny === lp) {
    return { ok: true, current, target: lp, suggestions: [],
      message: `Your name "${name}" already aligns with your `
        + `life path ${lp}. No change needed.` };
  }
  const target = lp;
  const tweaks = new Set();
  const trimmed = name.trim();
  // Strategy 1: add a vowel at the end of the first name.
  ['A', 'I', 'E', 'Y', 'U'].forEach((v) => {
    const parts = trimmed.split(/\s+/);
    parts[0] = parts[0] + v.toLowerCase();
    tweaks.add(parts.join(' '));
  });
  // Strategy 2: double the last letter of the first word.
  const first = trimmed.split(/\s+/)[0] || '';
  if (first.length > 1) {
    tweaks.add(`${first}${first.slice(-1)}${trimmed.slice(first.length)}`);
  }
  // Strategy 3: try alternate single-letter swaps near the end.
  ['a', 'e', 'i', 'h', 'y'].forEach((c) => {
    if (first.length > 2) {
      tweaks.add(first.slice(0, -1) + c + trimmed.slice(first.length));
    }
  });
  const suggestions = Array.from(tweaks)
    .map((n) => ({ name: n, destiny: destinyNumber(n) }))
    .filter((x) => x.destiny === target)
    .slice(0, 6);
  return { ok: false, current, target, suggestions,
    message: suggestions.length
      ? `Your current name reduces to ${current.destiny}. These small `
        + `tweaks land on your life path ${target}:`
      : `Your name destiny ${current.destiny} doesn't match your life `
        + `path ${target}. No simple spelling tweak gets you to ${target}; `
        + 'consider a Vedic numerologist for a deeper rework.' };
}

// Lucky day / colour / gemstone for a person (derived from life path).
// Convenience wrapper over traitsFor so the UI can render them as
// stand-alone cards without re-computing.
export function luckyContext({ name, dob } = {}) {
  const lp = lifePath(dob);
  const traits = traitsFor(lp);
  return {
    lifePath: lp,
    color: traits?.lucky?.color || '-',
    day: traits?.lucky?.day || '-',
    stone: traits?.lucky?.stone || '-',
    planet: traits?.lucky?.planet || '-',
    luckySet: luckyNumbersFor({ name, dob }),
  };
}
