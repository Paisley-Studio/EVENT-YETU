// Default content for THE NEXT CHAPTER.
// Everything here is a fallback: once the admin saves settings, Firestore (settings/site) wins.
// Image paths are relative to the site root.

export const DEFAULT_SETTINGS = {
  brand: {
    title: 'THE NEXT CHAPTER',
    short: 'TNC',
    monogram: 'M',            // letter engraved on the loading coin
    tagline: 'A love story, written together.',
  },
  couple: {
    partnerA: 'Mesh',
    partnerB: 'Reachel',
    photoA: 'assets/img/couple-mesh.jpg',
    photoB: 'assets/img/couple-reachel.jpg',
    heroImage: 'assets/img/art-moon-couple.jpg',
    story:
      'It started with a conversation that refused to end. Two people, two different worlds, one quiet certainty that grew louder with every season. ' +
      'We have laughed through the ordinary days and held on through the hard ones. Now we are turning the page, and we would love for you to be in the next chapter with us.',
    message:
      'Thank you for opening this invitation. Whether you stay for a minute or walk the whole journey, you are already part of our story.',
    milestones: [
      { year: '2019', title: 'The First Hello', text: 'A chance meeting, a long conversation, and a feeling neither of us could explain.' },
      { year: '2021', title: 'Choosing Each Other', text: 'Through distance and busy seasons, we kept choosing us, again and again.' },
      { year: '2024', title: 'The Question', text: 'Under a full moon, one question and the easiest yes.' },
      { year: '2026', title: 'The Next Chapter', text: 'Families meet, traditions are honoured, and a new story begins.' },
    ],
  },
  gallery: [
    { src: 'assets/img/couple-mesh.jpg', caption: 'Mesh' },
    { src: 'assets/img/couple-reachel.jpg', caption: 'Reachel' },
    { src: 'assets/img/art-moon-couple.jpg', caption: 'Under the same moon' },
    { src: 'assets/img/art-held-hands.jpg', caption: 'Hand in hand' },
    { src: 'assets/img/art-roses.jpg', caption: 'Every rose, a promise' },
    { src: 'assets/img/art-moon-hands.jpg', caption: 'Reaching for forever' },
    { src: 'assets/img/art-sunset-tree.jpg', caption: 'Home is a person' },
    { src: 'assets/img/art-tulips.jpg', caption: 'Growing together' },
    { src: 'assets/img/art-lions.jpg', caption: 'Strength in two' },
    { src: 'assets/img/art-rose-bw.jpg', caption: 'Timeless' },
    { src: 'assets/img/art-moon-dreamer.jpg', caption: 'Dreaming of us' },
    { src: 'assets/img/art-balance.jpg', caption: 'Balance' },
  ],
  occasion: {
    title: 'The Family Introduction',
    subtitle: 'Ruracio · Traditional Introduction Ceremony',
    date: '2026-12-12T10:00',
    venue: 'Membley-Rolex, Ruiru',
    venueMapUrl: '',
    description:
      'In our tradition, the introduction is the moment two families formally meet, share a meal, exchange blessings and agree to walk together. ' +
      'It is the first public step on the road to marriage, a celebration of roots, respect and the joining of two homes.',
    details: 'Dress code: elegant traditional · Lunch will be served · Kindly arrive by 9:30 AM',
    showCountdown: true,
  },
  finance: {
    target: 500000,
    currency: 'KES',
    presets: [500, 1000, 2000, 5000, 10000],
    mpesaEnabled: true,
    stkEndpoint: '/api/stkPush',     // Cloud Function (via Hosting rewrite)
    paybill: '',                     // optional manual-payment fallback
    account: 'TNC',
    till: '',
  },
  texts: {
    agreementTitle: 'Before we begin…',
    agreementBody: 'This will take about five minutes. No pressure, no obligations, just a story we would love to share with you.',
    agreementLabel: 'I agree to walk this journey to the end.',
    participateIntro: 'There is no right way to be part of this. Give, gift, share wisdom, or simply say hello. Every way is welcome.',
    impactIntro: 'Every contribution, gift and kind word, gathered in one place.',
    guestbookIntro: 'Leave your mark, just like signing the book at the door.',
    finale: 'Thank you for walking with us. The best chapters are written together.',
  },
  share: {
    whatsapp: "You're invited to be part of {couple}'s next chapter. Open the invitation here: {link}",
  },
  reminders: {
    pledge: "Hello {name}, a gentle note from {couple}. You kindly mentioned you may support The Next Chapter around today. Only if it's convenient, no pressure at all. Reply STOP to opt out.",
    gift: "Hi {name}, a friendly reminder about the gift idea ({gift}) you liked on The Next Chapter. Whatever you decide, thank you for thinking of us! Reply STOP to opt out.",
    collection: "Hi {name}, thank you for your gift! We'll be in touch about collection on {date}.",
    call: "Hi {name}, {couple} would love to chat about your gift. Expect a call soon!",
  },
  thankyou: {
    financial: 'Your generosity is a seed planted in our new home. Thank you for believing in our story.',
    gift: 'Your thoughtful gift will become part of our everyday life, and every time we use it, we will remember you.',
    wisdom: 'Your words will travel with us. Thank you for sharing your wisdom so generously.',
    blessing: 'Your prayers and blessings are the strongest gift of all. Thank you for covering us.',
    general: 'Thank you for being part of our journey. Your presence in our story means more than words can say.',
  },
  invitation: {
    template: 'noir',  // noir | ivory | burgundy
    message: 'Together with our families, we joyfully invite you to celebrate the beginning of our next chapter.',
    families: '',
  },
  game: { tiles: 0 },          // 0 = one tile per gift (min 12, max 30)
  autoThankYou: true,
  thankyouTemplate: 'ivory',
  wisdomCategories: [
    'Marriage advice', 'Life lessons', 'Wisdom from experience', 'Prayers and blessings',
    'Funny marriage lessons', 'Personal messages', 'Words of encouragement',
  ],
  giftCategories: ['Kitchen', 'Home', 'Electronics', 'Experiences', 'Personal', 'Vouchers'],
};

// Gift suggestions seeded into the numbers game until the admin adds their own.
export const DEFAULT_GIFTS = [
  { name: 'Premium Cookware Set', category: 'Kitchen', img: 'assets/img/gift-cookware.jpg', color: '#6D011A', note: 'For every meal we will cook together.' },
  { name: 'Dual-Fuel Cooker', category: 'Kitchen', img: 'assets/img/gift-cooker.jpg', color: '#2A2A2A', note: 'The heart of every kitchen.' },
  { name: 'Smart 4K Television', category: 'Electronics', img: 'assets/img/gift-tv.jpg', color: '#1E2235', note: 'For movie nights on the couch.' },
  { name: 'Washing Machine', category: 'Home', img: 'assets/img/gift-washer.jpg', color: '#3B3B44', note: 'Less laundry, more time together.' },
  { name: 'Air Fryer', category: 'Kitchen', img: 'assets/img/gift-airfryer.jpg', color: '#8A1B2E', note: 'Crispy, quick and guilt-free.' },
  { name: 'Cinema Soundbar', category: 'Electronics', img: 'assets/img/gift-soundbar.jpg', color: '#121212', note: 'Turn up the love songs.' },
  { name: 'Champagne for Two', category: 'Experiences', img: 'assets/img/gift-champagne.jpg', color: '#B88A8F', note: 'For a toast to forever.' },
  { name: 'Modern Tea Set', category: 'Kitchen', img: 'assets/img/gift-teaset.jpg', color: '#1F3550', note: 'Slow mornings and long talks.' },
  { name: 'Home Décor Vases', category: 'Home', img: 'assets/img/gift-vases.jpg', color: '#C7B79E', note: 'A touch of calm for our home.' },
  { name: 'Kitchen Utensil Kit', category: 'Kitchen', img: 'assets/img/gift-utensils.jpg', color: '#3A3A3A', note: 'Every tool for every recipe.' },
  { name: 'Water Dispenser', category: 'Home', img: 'assets/img/gift-dispenser.jpg', color: '#2B5288', note: 'Hot and cold, always ready.' },
  { name: 'Steam Iron', category: 'Home', img: 'assets/img/gift-iron.jpg', color: '#0E0E0E', note: 'Crisp and ready for every occasion.' },
  { name: 'Elegant Watch Set', category: 'Personal', img: 'assets/img/gift-watch.jpg', color: '#1B1B1B', note: 'Time well spent, together.' },
  { name: 'Desktop Monitor', category: 'Electronics', img: 'assets/img/gift-monitor.jpg', color: '#5A4632', note: 'For building dreams from home.' },
  { name: 'Shopping Voucher', category: 'Vouchers', img: '', color: '#7F0020', note: 'Let us choose something special.' },
  { name: 'A Surprise Experience', category: 'Experiences', img: '', color: '#000000', note: 'Dinner, a getaway, a memory.' },
];

export const STATUS = {
  contribution: ['PENDING', 'SUCCESS', 'FAILED'],
  pledge: ['PENDING', 'REMINDER_SENT', 'PAID', 'CANCELLED'],
  gift: ['OFFERED', 'ACCEPTED', 'ARRANGEMENT_PENDING', 'COLLECTION_REQUESTED', 'RECEIVED', 'CANCELLED'],
  moderation: ['PENDING', 'APPROVED', 'REJECTED'],
  reminder: ['SCHEDULED', 'SENT', 'OPTED_OUT', 'CANCELLED'],
};

// Deep merge (objects only; arrays replaced) so partially saved settings still render.
export function mergeDeep(base, over) {
  if (!over || typeof over !== 'object') return structuredClone(base);
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over)) {
    const b = base?.[k], o = over[k];
    if (o && typeof o === 'object' && !Array.isArray(o) && b && typeof b === 'object' && !Array.isArray(b)) out[k] = mergeDeep(b, o);
    else if (o !== undefined && o !== null && o !== '') out[k] = o;
  }
  return out;
}
