import { useState } from 'react';

const TOPICS = [
  { id: 'love', label: 'Love and Relationship', icon: '♥' },
  { id: 'marriage', label: 'Marriage', icon: '∞' },
  { id: 'career', label: 'Career and Finance', icon: '★' },
  { id: 'health', label: 'Health', icon: '◆' },
  { id: 'family', label: 'Family', icon: '△' },
  { id: 'general', label: 'General Guidance', icon: '☽' },
];

const NEEDS_PARTNER = ['love', 'marriage'];

export default function PreSessionModal({ onConfirm, onCancel, astrologerName }) {
  const [step, setStep] = useState(1); // 1 = topic, 2 = partner info
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [partnerChoice, setPartnerChoice] = useState(null); // 'have_info' | 'no_info'
  const [partnerForm, setPartnerForm] = useState({
    name: '', gender: '', dob: '', tob: '', ampm: 'AM', place: '',
  });

  function handleTopicSelect(topicId) {
    setSelectedTopic(topicId);
    if (NEEDS_PARTNER.includes(topicId)) {
      setStep(2);
    } else {
      onConfirm({
        topic: topicId,
        topicLabel: TOPICS.find((t) => t.id === topicId)?.label,
        partnerProfile: null,
      });
    }
  }

  function handlePartnerConfirm() {
    const topicLabel = TOPICS.find((t) => t.id === selectedTopic)?.label
      || selectedTopic;
    if (partnerChoice === 'no_info') {
      onConfirm({ topic: selectedTopic, topicLabel, partnerProfile: null });
    } else if (partnerChoice === 'have_info') {
      if (!partnerForm.name || !partnerForm.dob) return;
      onConfirm({ topic: selectedTopic, topicLabel, partnerProfile: partnerForm });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg rounded-t-3xl bg-white p-5 pb-8 shadow-2xl"
        style={{ maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {step === 1 && (
          <>
            <div
              className="mb-1 text-center text-lg font-bold"
              style={{ color: '#7F2020' }}
            >
              What would you like guidance on?
            </div>
            <p className="mb-5 text-center text-sm text-gray-500">
              Select your consultation topic
              {astrologerName ? ` with ${astrologerName}` : ''}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {TOPICS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleTopicSelect(t.id)}
                  className="flex flex-col items-center gap-2 rounded-2xl
                    py-4 px-3 border-2 transition active:scale-95"
                  style={{ borderColor: '#E8D5B0', background: '#FFFDF8' }}
                >
                  <span className="text-2xl">{t.icon}</span>
                  <span
                    className="text-sm font-semibold text-center"
                    style={{ color: '#1A1A2E' }}
                  >
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={onCancel}
              className="mt-4 w-full py-2 text-sm text-gray-400"
            >
              Cancel
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <button
              onClick={() => { setStep(1); setPartnerChoice(null); }}
              className="mb-3 text-sm font-semibold"
              style={{ color: '#7F2020' }}
            >
              Back
            </button>
            <div
              className="mb-1 text-center text-lg font-bold"
              style={{ color: '#7F2020' }}
            >
              Do you have your partner's birth details?
            </div>
            <p className="mb-5 text-center text-sm text-gray-500">
              This helps us give you a more accurate reading
            </p>

            <div className="space-y-3 mb-5">
              <button
                onClick={() => setPartnerChoice('have_info')}
                className="w-full rounded-2xl p-4 text-left border-2 transition"
                style={{
                  borderColor: partnerChoice === 'have_info'
                    ? '#7F2020' : '#E8D5B0',
                  background: partnerChoice === 'have_info'
                    ? '#FFF8E7' : '#FFFDF8',
                }}
              >
                <div
                  className="font-semibold text-sm"
                  style={{ color: '#1A1A2E' }}
                >
                  Yes, I have partner's birth information
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Name, date of birth, time of birth, place
                </div>
              </button>

              <button
                onClick={() => setPartnerChoice('no_info')}
                className="w-full rounded-2xl p-4 text-left border-2 transition"
                style={{
                  borderColor: partnerChoice === 'no_info'
                    ? '#7F2020' : '#E8D5B0',
                  background: partnerChoice === 'no_info'
                    ? '#FFF8E7' : '#FFFDF8',
                }}
              >
                <div
                  className="font-semibold text-sm"
                  style={{ color: '#1A1A2E' }}
                >
                  I don't know partner's birth information
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Continue without partner details
                </div>
              </button>
            </div>

            {partnerChoice === 'have_info' && (
              <div
                className="space-y-3 mb-5 rounded-2xl p-4"
                style={{ background: '#F9F5F0', border: '1px solid #E8D5B0' }}
              >
                <div
                  className="text-sm font-bold mb-2"
                  style={{ color: '#7F2020' }}
                >
                  Partner Details
                </div>
                <input
                  className="w-full rounded-xl border border-gray-300 px-3
                    py-2.5 text-sm outline-none focus:border-[#7F2020]"
                  placeholder="Partner's full name"
                  value={partnerForm.name}
                  onChange={(e) =>
                    setPartnerForm((f) => ({ ...f, name: e.target.value }))}
                />

                <select
                  className="w-full rounded-xl border border-gray-300 px-3
                    py-2.5 text-sm outline-none focus:border-[#7F2020]"
                  value={partnerForm.gender}
                  onChange={(e) =>
                    setPartnerForm((f) => ({ ...f, gender: e.target.value }))}
                >
                  <option value="">Select gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Date of Birth
                    </label>
                    <input
                      type="date"
                      className="w-full rounded-xl border border-gray-300 px-3
                        py-2.5 text-sm outline-none focus:border-[#7F2020]"
                      value={partnerForm.dob}
                      onChange={(e) =>
                        setPartnerForm((f) => ({ ...f, dob: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Time of Birth
                    </label>
                    <div className="flex gap-1">
                      <input
                        type="time"
                        className="flex-1 rounded-xl border border-gray-300 px-2
                          py-2.5 text-sm outline-none focus:border-[#7F2020]"
                        value={partnerForm.tob}
                        onChange={(e) =>
                          setPartnerForm((f) => ({ ...f, tob: e.target.value }))}
                      />
                      <select
                        className="rounded-xl border border-gray-300 px-1
                          py-2.5 text-sm outline-none"
                        value={partnerForm.ampm}
                        onChange={(e) =>
                          setPartnerForm((f) => ({
                            ...f, ampm: e.target.value,
                          }))}
                      >
                        <option>AM</option>
                        <option>PM</option>
                      </select>
                    </div>
                  </div>
                </div>

                <input
                  className="w-full rounded-xl border border-gray-300 px-3
                    py-2.5 text-sm outline-none focus:border-[#7F2020]"
                  placeholder="Place of birth (city, state)"
                  value={partnerForm.place}
                  onChange={(e) =>
                    setPartnerForm((f) => ({ ...f, place: e.target.value }))}
                />
              </div>
            )}

            <button
              onClick={handlePartnerConfirm}
              disabled={
                !partnerChoice
                || (partnerChoice === 'have_info'
                  && (!partnerForm.name || !partnerForm.dob))
              }
              className="w-full rounded-full py-3 text-sm font-bold text-white
                transition disabled:opacity-40"
              style={{ background: '#7F2020' }}
            >
              Continue to Consultation
            </button>
          </>
        )}
      </div>
    </div>
  );
}
