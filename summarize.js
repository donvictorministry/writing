/**
 * Summarization Engine
 * Handles extractive & abstractive text reduction
 */
export async function getSummarizedText(text, ratio = 0.5) {
  if (!text || text.trim().length === 0) {
    throw new Error('Please enter text to summarize.');
  }

  // Attempt free Hugging Face summarization model
  try {
    const hfRes = await fetch('https://api-inference.huggingface.co/models/facebook/bart-large-cnn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        inputs: text,
        parameters: { max_length: 120, min_length: 30, do_sample: false }
      })
    });

    if (hfRes.ok) {
      const data = await hfRes.json();
      if (Array.isArray(data) && data[0]?.summary_text) {
        return data[0].summary_text;
      }
    }
  } catch (err) {
    console.warn('HF Summarizer offline, utilizing local frequency summarizer');
  }

  // Resilient Local Frequency-Scoring Extractive Summarizer
  return localExtractiveSummarize(text, ratio);
}

function localExtractiveSummarize(text, ratio) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  if (sentences.length <= 2) return text;

  const wordFreq = {};
  const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
  words.forEach(w => {
    wordFreq[w] = (wordFreq[w] || 0) + 1;
  });

  const scoredSentences = sentences.map((sentence, idx) => {
    const sWords = sentence.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    const score = sWords.reduce((acc, w) => acc + (wordFreq[w] || 0), 0) / (sWords.length || 1);
    return { sentence: sentence.trim(), score, idx };
  });

  const countToKeep = Math.max(1, Math.ceil(sentences.length * ratio));
  const topSentences = scoredSentences
    .sort((a, b) => b.score - a.score)
    .slice(0, countToKeep)
    .sort((a, b) => a.idx - b.idx)
    .map(s => s.sentence);

  return topSentences.join(' ');
}
