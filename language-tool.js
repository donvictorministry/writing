/**
 * LanguageTool Client Integration
 * Handles inline grammatical errors highlighting and correction replacement
 */
export async function checkGrammar(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('Please input text to inspect grammar.');
  }

  const endpoint = 'https://api.languagetool.org/v2/check';
  const params = new URLSearchParams();
  params.append('text', text);
  params.append('language', 'en-US');

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: params.toString()
    });

    if (!response.ok) {
      throw new Error(`LanguageTool API responded with status ${response.status}`);
    }

    const data = await response.json();
    return data.matches || [];
  } catch (error) {
    console.error('LanguageTool error:', error);
    throw new Error('Unable to connect to Grammar Check Service. Check network connectivity.');
  }
}

/**
 * Generates an interactive HTML string replacing errors with actionable spans
 */
export function renderGrammarErrors(text, matches) {
  if (!matches || matches.length === 0) {
    return { hasErrors: false, html: text, errorCount: 0 };
  }

  // Sort matches backwards to replace indices safely without offset shift
  const sortedMatches = [...matches].sort((a, b) => b.offset - a.offset);
  let annotatedText = text;

  sortedMatches.forEach((match, index) => {
    const start = match.offset;
    const end = match.offset + match.length;
    const errorWord = text.substring(start, end);
    const replacement = (match.replacements && match.replacements.length > 0) 
      ? match.replacements[0].value 
      : '';
    const message = match.message.replace(/"/g, '&quot;');

    const tag = `<span class="grammar-error-highlight" data-start="${start}" data-end="${end}" data-replacement="${replacement}" data-msg="${message}">${errorWord}</span>`;
    
    annotatedText = annotatedText.substring(0, start) + tag + annotatedText.substring(end);
  });

  return {
    hasErrors: true,
    html: annotatedText,
    errorCount: matches.length
  };
}
