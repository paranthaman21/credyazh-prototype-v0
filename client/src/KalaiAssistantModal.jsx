import { useState } from 'react';

export default function KalaiAssistantModal({ isOpen, onClose }) {
  const [topic, setTopic] = useState('voice'); // 'voice' | 'combined' | 'reversal' | 'whatsapp' | 'archive'
  const [language, setLanguage] = useState('english'); // 'english' | 'tamil' | 'tanglish'

  if (!isOpen) return null;

  const content = {
    english: {
      introTitle: 'Kalai AI Assistant',
      introSub: 'Product guidance & merchant ledger help',
      roleNotice: 'Architectural Note: I am Kalai, your guide for CredYazh. The Voice Transaction Engine processes spoken drafts for your manual review. I provide help and answer accounting questions. I never automatically commit entries to your ledger.',
      topics: {
        voice: {
          title: 'Spoken Voice Transactions',
          desc: 'How the Voice Transaction Engine turns speech into reviewable drafts',
          points: [
            'Supported languages: Spoken Tamil, Tanglish, and English.',
            'Signature phrase: "Kumar account-la 1 kg arisi, rendu packet paal, total 85 rupees".',
            'No price fabrication: If you do not state individual item prices, CredYazh keeps them null. Only the spoken total is recorded.',
            'Review required: Every draft appears on screen for you to edit and confirm. Nothing is saved until you press Confirm.'
          ]
        },
        combined: {
          title: 'Combined Repayment & Credit',
          desc: 'Handle cash repayments and new purchases in a single customer interaction',
          points: [
            'Real shop scenario: A customer pays back ₹200 cash towards their old tab and buys ₹70 of rice on new credit in the same visit.',
            'Spoken phrase: "Kumar 200 kuduthutu 70-ku arisi vaanginaan".',
            'Atomic execution: Both events are linked by an audit Group ID. If any part fails validation, neither is posted.',
            'Calculated balance: ₹500 balance - ₹200 repayment + ₹70 credit = ₹370 final balance.'
          ]
        },
        reversal: {
          title: 'Financial Reversals & Audit Safety',
          desc: 'Why CredYazh never deletes financial history',
          points: [
            'Append-only ledger: Financial records cannot be quietly deleted. A wrong entry is cancelled by adding a REVERSAL event.',
            'Audit reason: When you tap "Reverse", you are prompted to provide a reason for the record.',
            'Integer paise: All calculations are performed in integer paise (₹1 = 100 paise) to prevent floating-point rounding errors.',
            'Duplicate prevention: Every confirmation carries an Idempotency-Key to prevent accidental double-billing on network retries.'
          ]
        },
        whatsapp: {
          title: 'WhatsApp Statements & Transparency',
          desc: 'How to share clear, itemized balance updates with customers',
          points: [
            'Multilingual statements: Generate statements in formal Tamil script, Tanglish, or business English.',
            'Direct deep-link: Opens WhatsApp directly on your phone with the pre-filled message.',
            'Merchant control: You can review and edit the exact statement text before sending.',
            'Phone prefill: Customer phone numbers are automatically formatted with country code (91).'
          ]
        },
        archive: {
          title: 'Customer Archival & Settle Safety',
          desc: 'Safeguards for closing customer tabs without losing history',
          points: [
            'Settled balance rule: A customer can only be archived when their balance is exactly ₹0.00.',
            'Active dues protected: If a customer owes money or has advance credit, archiving is blocked until the balance is cleared.',
            'Restoration: Archived customers can be viewed and restored at any time from the Customers directory.',
            'Zero history loss: All past ledger events remain permanently stored for audit purposes.'
          ]
        }
      }
    },
    tamil: {
      introTitle: 'கலை AI உதவியாளர் (Kalai Assistant)',
      introSub: 'செயலி வழிகாட்டுதல் மற்றும் கணக்கு உதவி',
      roleNotice: 'கட்டமைப்பு விதி: நான் கலை, உங்கள் உதவி வழிகாட்டி. குரல் பதிவு இயந்திரம் (Voice Engine) உங்கள் பேச்சை வரைவாக மாற்றுகிறது. அதை நீங்கள் சரிபார்த்து உறுதி செய்த பிறகே கணக்கில் பதியப்படும். நான் தன்னிச்சையாக கணக்கில் எதையும் எழுத மாட்டேன்.',
      topics: {
        voice: {
          title: 'குரல் வழி கணக்குப் பதிவு',
          desc: 'குரல் குறிப்புகளை வணிகர் வரைவாக மாற்றுவது எப்படி',
          points: [
            'ஆதரிக்கப்படும் மொழிகள்: தமிழ், ஆங்கிலம் மற்றும் தங்கிலீஷ்.',
            'எடுத்துக்காட்டு பேச்சு: "குமார் கணக்கில் அரை கிலோ பருப்பு, ஒரு லிட்டர் பால், மொத்தம் 160 ரூபாய்".',
            'விலை கற்பனை செய்யப்படாது: பொருளின் தனி விலையை நீங்கள் கூறாவிட்டால், அது பதிவு செய்யப்படாது. மொத்த தொகை மட்டுமே கணக்கில் வைக்கப்படும்.',
            'வணிகர் சரிபார்ப்பு: வரைவு திரையில் காட்டப்படும்; நீங்கள் சரிபார்த்து உறுதி செய்த பின்னரே கணக்கில் பதியப்படும்.'
          ]
        },
        combined: {
          title: 'வரவு மற்றும் கடன் ஒரே நேரத்தில்',
          desc: 'பழைய கடனைத் திருப்பித் தந்து, புதிய பொருளை கடனாகப் பெறுதல்',
          points: [
            'வணிக சூழல்: வாடிக்கையாளர் பழைய பாக்கிக்கு ₹200 தந்து, அதே நேரத்தில் ₹70-க்கு அரிசி கடனாகப் பெறுகிறார்.',
            'பேச்சு வடிவம்: "குமார் 200 குடுத்துட்டு 70-க்கு அரிசி வாங்கினான்".',
            'இணைந்த பாதுகாப்பு: இரண்டும் ஒரே பரிவர்த்தனையாகப் பதிவாகும். ஒன்றில் தவறு இருந்தாலும் இரண்டும் தடுத்து நிறுத்தப்படும்.',
            'மீதி கணக்கீடு: ₹500 பாக்கி - ₹200 வரவு + ₹70 கடன் = ₹370 புதிய பாக்கி.'
          ]
        },
        reversal: {
          title: 'ரத்து மற்றும் நிதிப் பாதுகாப்பு',
          desc: 'தவறான பதிவுகளை பாதுகாப்பாகத் திருத்துவது எப்படி',
          points: [
            'அழிக்க முடியாத லெட்ஜர்: தவறான பதிவை நிரந்தரமாக நீக்க முடியாது; அதற்குப் பதிலாக ஒரு ரத்து பதிவு (Reversal) சேர்க்கப்படும்.',
            'காரணம் பதிவு: ரத்து செய்யும் போது அதற்கான காரணம் தணிக்கைக்காக கேட்கப்படும்.',
            'பைசா கணக்கீடு: தசம் புள்ளி பிழைகளைத் தவிர்க்க அனைத்து தொகைகளும் பைசாக்களாக (1 ரூபாய் = 100 பைசா) கணக்கிடப்படுகின்றன.',
            'இரட்டைப் பதிவு தடுப்பு: ஒரே பதிவு தவறுதலாக இரண்டு முறை விழுவதைத் தடுக்க Idempotency பாதுகாப்பு உள்ளது.'
          ]
        },
        whatsapp: {
          title: 'வாட்ஸ்அப் கணக்கு விவரம்',
          desc: 'வாடிக்கையாளருக்கு கணக்கு விவரங்களை எளிதாகப் பகிர்தல்',
          points: [
            'மும்மொழி அறிக்கை: தமிழ் எழுத்துக்கள், தங்கிலீஷ் அல்லது ஆங்கிலத்தில் கணக்கு விவரங்களை உருவாக்கலாம்.',
            'நேரடி பகிர்வு: உங்கள் தொலைபேசியின் வாட்ஸ்அப் செயலிக்கு நேரடியாக செய்தி அனுப்பப்படும்.',
            'முழு கட்டுப்பாடு: அனுப்பும் முன் செய்தியை நீங்களே படித்து திருத்தலாம்.',
            'தொலைபேசி எண் தானியங்கி பொருத்தம்: வாடிக்கையாளரின் பதிவு செய்யப்பட்ட எண் தானாக எடுத்துக்கொள்ளப்படும்.'
          ]
        },
        archive: {
          title: 'வாடிக்கையாளர் கணக்கை முடித்தல் / காப்பகப்படுத்துதல்',
          desc: 'கணக்கு முடிந்த வாடிக்கையாளர்களை மறைக்கும் பாதுகாப்பு',
          points: [
            'பூஜ்ஜிய பாக்கி விதி: வாடிக்கையாளர் பாக்கி தொகை சரியாக ₹0.00 ஆக இருந்தால் மட்டுமே கணக்கை காப்பகப்படுத்த (Archive) முடியும்.',
            'பாக்கி பாதுகாப்பு: வாடிக்கையாளர் பணம் தர வேண்டியிருந்தால் அல்லது முன்பணம் இருந்தால் காப்பகப்படுத்த முடியாது.',
            'மீண்டும் திறத்தல்: காப்பகப்படுத்திய வாடிக்கையாளரை எப்போது வேண்டுமானாலும் வாடிக்கையாளர் பட்டியலில் இருந்து மீட்டெடுக்கலாம்.',
            'வரலாறு அழியாது: பழைய பரிவர்த்தனை வரலாறு அனைத்தும் பாதுகாப்பாக இருக்கும்.'
          ]
        }
      }
    },
    tanglish: {
      introTitle: 'Kalai AI Assistant (Tanglish)',
      introSub: 'App guidance & merchant accounting support',
      roleNotice: 'Architectural Note: Naan Kalai, ungal CredYazh assistant. Spoken voice notes-ai Voice Engine draft-aa maathum; neenga review panni Confirm pannathaan ledger-la save aagum. Naan thaanaga transactions save panna maatten.',
      topics: {
        voice: {
          title: 'Voice-to-Ledger Workflow',
          desc: 'Spoken Tanglish/Tamil-ai draft-aa maathum method',
          points: [
            'Supported languages: Tamil, Tanglish, and English.',
            'Example sentence: "Kumar account-la 1 kg arisi, rendu packet paal, total 85 rupees".',
            'No price guessing: Item price sonna mattum thaan save aagum, illaina blank-aa irukkum. Total amount mattum thaan ledger-ku pogum.',
            'Merchant review: Confirm button click pannaama edhuvum database-la store aagaadhu.'
          ]
        },
        combined: {
          title: 'Combined Payment & Credit',
          desc: 'Cash repayment + new credit purchase in one interaction',
          points: [
            'Real shop case: Customer pazhaya baakiku ₹200 kuduthuttu, pudhusa ₹70-ku arisi kadan vanguraru.',
            'Voice input: "Kumar 200 kuduthutu 70 rupees-ku arisi vaanginaan".',
            'Atomic protection: Rendu operations-um ore Idempotency group-la safety-aa post aagum.',
            'Balance calculation: ₹500 - ₹200 + ₹70 = ₹370 correct balance.'
          ]
        },
        reversal: {
          title: 'Reversals & Audit History',
          desc: 'Edhukku transaction delete panna koodathu?',
          points: [
            'Append-only ledger: Thappana entry-ai delete panna koodathu; Reversal event add panni reverse pannuvom.',
            'Audit reason: Reversal pannumbothu reason kettu save pannuvom.',
            'Integer paise: Float calculation mistake varama irukka integer paise (₹1 = 100 paise) use panrom.',
            'Double posting protection: Idempotency-Key network drop aanaalum duplicate entry create pannaadhu.'
          ]
        },
        whatsapp: {
          title: 'WhatsApp Statements',
          desc: 'Customer-ku respectful balance update share panradhu',
          points: [
            '3 languages: Tamil script, Tanglish, and English available.',
            'Direct wa.me link: Direct-aa ungal phone WhatsApp open aagum.',
            'Merchant edit: Message send pandrathukku munnaadi neenga check panni edit pannikkalaam.',
            'Saved phone number: Customer profile-la phone number irundha direct-aa fill aagum.'
          ]
        },
        archive: {
          title: 'Customer Settle & Archiving',
          desc: 'Settled customers-ai archive panni restore panradhu',
          points: [
            'Zero balance rule: Customer account balance exact-aa ₹0.00 irundhaa mattum thaan archive panna mudiyum.',
            'Outstanding balance lock: Balance pending irundha archive panna mudiyadhu.',
            'Restore at any time: Archived list-la irundhu eppo venaalum restore pannikkalaam.',
            'No data loss: Pazhaya transactions ellam ledger-la permanent-aa irukkum.'
          ]
        }
      }
    }
  };

  const activeData = content[language] || content.english;
  const currentTopic = activeData.topics[topic] || activeData.topics.voice;

  return (
    <div className="voice-modal-backdrop" onClick={onClose}>
      <div className="modal-dialog-card kalai-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-dialog-header">
          <div className="kalai-modal-title-wrap">
            <div className="kalai-avatar-circle">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
            </div>
            <div>
              <h3>{activeData.introTitle}</h3>
              <span className="kalai-modal-sub">{activeData.introSub}</span>
            </div>
          </div>
          <button type="button" className="voice-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body-content">
          {/* Architectural role banner */}
          <div className="kalai-role-notice">
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" className="kalai-notice-icon">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/>
            </svg>
            <p>{activeData.roleNotice}</p>
          </div>

          {/* Language selector */}
          <div className="kalai-lang-bar">
            <span className="kalai-lang-label">Language:</span>
            <div className="kalai-lang-pills">
              <button
                type="button"
                className={`kalai-lang-btn ${language === 'english' ? 'active' : ''}`}
                onClick={() => setLanguage('english')}
              >
                English
              </button>
              <button
                type="button"
                className={`kalai-lang-btn ${language === 'tamil' ? 'active' : ''}`}
                onClick={() => setLanguage('tamil')}
              >
                தமிழ் (Tamil)
              </button>
              <button
                type="button"
                className={`kalai-lang-btn ${language === 'tanglish' ? 'active' : ''}`}
                onClick={() => setLanguage('tanglish')}
              >
                Tanglish
              </button>
            </div>
          </div>

          {/* Topic Pills */}
          <div className="kalai-topics-pills">
            <button
              type="button"
              className={`kalai-topic-pill ${topic === 'voice' ? 'active' : ''}`}
              onClick={() => setTopic('voice')}
            >
              Voice Entry
            </button>
            <button
              type="button"
              className={`kalai-topic-pill ${topic === 'combined' ? 'active' : ''}`}
              onClick={() => setTopic('combined')}
            >
              Combined Repayment + Credit
            </button>
            <button
              type="button"
              className={`kalai-topic-pill ${topic === 'reversal' ? 'active' : ''}`}
              onClick={() => setTopic('reversal')}
            >
              Reversals & Audit
            </button>
            <button
              type="button"
              className={`kalai-topic-pill ${topic === 'whatsapp' ? 'active' : ''}`}
              onClick={() => setTopic('whatsapp')}
            >
              WhatsApp Statements
            </button>
            <button
              type="button"
              className={`kalai-topic-pill ${topic === 'archive' ? 'active' : ''}`}
              onClick={() => setTopic('archive')}
            >
              Settle & Archive
            </button>
          </div>

          {/* Topic Detail Card */}
          <div className="kalai-topic-card">
            <h4>{currentTopic.title}</h4>
            <p className="kalai-topic-desc">{currentTopic.desc}</p>
            <ul className="kalai-points-list">
              {currentTopic.points.map((pt, idx) => (
                <li key={idx}>
                  <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" className="kalai-check-icon">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                  </svg>
                  <span>{pt}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="primary voice-btn-submit" onClick={onClose}>
            Got it, thanks!
          </button>
        </div>
      </div>
    </div>
  );
}
