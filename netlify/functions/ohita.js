// netlify/functions/ohita.js
// Saves skips to admin/ohitukset.json via GitHub API

exports.handler = async (event, context) => {
  // 1. Ota vastaan pyyntö
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // 2. Tsekkaa salasana
  const authHeader = event.headers.authorization;
  const adminPswd = process.env.ADMIN_PASSWORD;
  
  if (!adminPswd || !authHeader || authHeader !== `Bearer ${adminPswd}`) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const item = JSON.parse(event.body);
    const token = process.env.GITHUB_TOKEN;
    const repo = 'albrto/uutisrapsa';
    const path = 'admin/ohitukset.json';
    
    if (!token) throw new Error('GITHUB_TOKEN missing');

    // 3. Hae nykyinen ohitukset.json GitHubista
    const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    let currentSkipList = [];
    let sha = null;

    if (getRes.ok) {
      const getJson = await getRes.json();
      sha = getJson.sha;
      const content = Buffer.from(getJson.content, 'base64').toString('utf8');
      try {
        currentSkipList = JSON.parse(content);
      } catch(e) {}
    } else if (getRes.status !== 404) {
      throw new Error(`Failed to fetch existing ohitukset.json: ${getRes.statusText}`);
    }

    // 4. Lisää uusi ohitus (jos ei jo ole siellä)
    const exists = currentSkipList.find(o => o.jakso_id === item.jakso_id && o.r_idx === item.r_idx);
    if (!exists) {
      currentSkipList.push(item);
    }

    // 5. Tallenna takaisin GitHubiin
    const newContent = Buffer.from(JSON.stringify(currentSkipList, null, 2)).toString('base64');
    
    const putBody = {
      message: `Tallenna ohitus (ja kanta): ${item.jakso_id}:${item.r_idx}`,
      content: newContent,
      branch: 'main'
    };
    if (sha) putBody.sha = sha;

    const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(putBody)
    });

    if (!putRes.ok) {
        const errJson = await putRes.json();
        throw new Error(`GitHub API virhe: ${errJson.message}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'Saved to GitHub' }),
    };
  } catch (error) {
    console.error('Error fetching/saving to github:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
