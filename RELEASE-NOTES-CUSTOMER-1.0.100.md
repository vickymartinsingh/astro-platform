v1.0.100 - Customer build

Live experience overhaul:
- Full-screen reels-style live stream with comment auto-scroll
- Phone-style Live Call button + pre-call estimator (rate, max minutes, 3-min minimum)
- In-call controls: Mute / Camera / + Recharge / End call
- Astrologer profile sheet inside the live (avatar, skills, languages, stats, bio, gallery, reviews)
- Swipe up for the next live; tap the grid icon to browse all live astrologers
- Live request handshake with Accept / Decline + countdown timer

Pricing:
- Discount strikethrough everywhere (chrome, profile, estimator) when an astrologer runs an offer
- Smart low-balance recommend ("Add Rs 150 for a 10-minute buffer") with one-tap recharge chips
- Mid-call recharge - top up without disconnecting

Update + app pages:
- Play-Store-style in-app update popup with actual brand logo
- Astrologer gallery: upload up to 5 photos with admin approval before they appear
- /live no longer hangs on Loading - resolves cleanly to empty state when nothing is live

Stability:
- Login redirect to Home consistent across all entry points
- Kundli profile prompt before paid report generation
- Duplicate-order guard (Name / DOB / TOB / POB fingerprint)
- Mobile number gate before wallet recharge
- iOS WebView login freeze fixed (profile lookup 3s cap)
- Mandatory mobile field locked once set
