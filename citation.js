/**
 * Citations & Bibliography Module
 * Crossref (DOIs) & Open Library (Books) APA and MLA citation formatting
 */

export async function fetchCitationByDOI(doi) {
  const cleanDoi = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  const url = `https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`;

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`DOI record not found (${response.status})`);
    }

    const data = await response.json();
    const item = data.message;

    const title = item.title ? item.title[0] : 'Untitled';
    const authors = item.author ? item.author.map(a => `${a.family}, ${a.given ? a.given[0] + '.' : ''}`).join(', ') : 'Unknown Author';
    const year = (item.issued && item.issued['date-parts'] && item.issued['date-parts'][0]) ? item.issued['date-parts'][0][0] : 'n.d.';
    const container = item['container-title'] ? item['container-title'][0] : '';
    const doiUrl = `https://doi.org/${cleanDoi}`;

    const apa = `${authors} (${year}). ${title}. ${container ? container + '.' : ''} ${doiUrl}`;
    const mla = `${authors}. "${title}." ${container ? container + ', ' : ''}${year}. ${doiUrl}`;

    return {
      title,
      authors,
      year,
      source: container || 'Crossref',
      doi: cleanDoi,
      apa,
      mla
    };
  } catch (err) {
    throw new Error(`DOI resolution error: ${err.message}`);
  }
}

export async function fetchCitationByBookTitle(titleQuery) {
  const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(titleQuery)}&limit=1`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Open Library search failed');
    const data = await res.json();

    if (!data.docs || data.docs.length === 0) {
      throw new Error('No publications found matching that title.');
    }

    const doc = data.docs[0];
    const authors = doc.author_name ? doc.author_name.join(', ') : 'Unknown Author';
    const year = doc.first_publish_year || 'n.d.';
    const title = doc.title || titleQuery;
    const publisher = doc.publisher ? doc.publisher[0] : 'Open Library';

    const apa = `${authors} (${year}). ${title}. ${publisher}.`;
    const mla = `${authors}. ${title}. ${publisher}, ${year}.`;

    return {
      title,
      authors,
      year,
      source: publisher,
      doi: '',
      apa,
      mla
    };
  } catch (err) {
    throw new Error(`Book search error: ${err.message}`);
  }
}
