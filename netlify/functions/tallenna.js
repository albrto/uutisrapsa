// netlify/functions/tallenna.js
// Tallentaa korjaukset admin/korjaukset.json-tiedostoon GitHub API:n kautta

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const authHeader = event.headers.authorization;
  const adminPswd = process.env.ADMIN_PASSWORD;
  
  if (!adminPswd || !authHeader || authHeader !== `Bearer ${adminPswd}`) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const corrections = JSON.parse(event.body);
    if (!Array.isArray(corrections) || corrections.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Ei tallennettavaa' }) };
    }

    const token = process.env.GITHUB_TOKEN;
    const repo = 'albrto/uutisrapsa';
    const path = 'admin/korjaukset.json';
    
    if (!token) throw new Error('GITHUB_TOKEN puuttuu Netlifyn ympäristömuuttujista');

    // Lue vanhat korjaukset
    const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    let currentList = [];
    let sha = null;

    if (getRes.ok) {
      const getJson = await getRes.json();
      sha = getJson.sha;
      const content = Buffer.from(getJson.content, 'base64').toString('utf8');
      try {
        currentList = JSON.parse(content);
      } catch(e) {}
    } else if (getRes.status !== 404) {
      throw new Error(`Failed to fetch existing korjaukset.json: ${getRes.statusText}`);
    }

    // Lisäykset ("Lisää suositus"): paikka (r_idx) lasketaan täällä eikä
    // selaimessa, koska sivuston suositukset.json voi olla deployn verran
    // jäljessä. Paikka = jakson loppu mainin suositukset.json:ssa, tai
    // odottavien lisäysten perään, jos niitä ei ole vielä sovellettu.
    const lisaykset = corrections.filter(k => k.tyyppi === 'lisays');
    if (lisaykset.length > 0) {
      const sRes = await fetch(`https://api.github.com/repos/${repo}/contents/suositukset.json`, {
        headers: {
          'Authorization': `token ${token}`,
          // raw-muoto: contents-API:n JSON-vastaus ei kanna yli 1 Mt tiedostoja
          'Accept': 'application/vnd.github.raw+json'
        }
      });
      if (!sRes.ok) throw new Error(`suositukset.json lukeminen epäonnistui: ${sRes.statusText}`);
      const suositukset = await sRes.json();
      const seuraava = {};
      for (const k of lisaykset) {
        if (!(k.jakso_id in seuraava)) {
          const jakso = suositukset.find(j => j.id === k.jakso_id);
          if (!jakso) throw new Error(`Jaksoa ei löydy: ${k.jakso_id}`);
          let paikka = (jakso.suositukset || []).length;
          for (const o of currentList) {
            if (o.tyyppi === 'lisays' && o.jakso_id === k.jakso_id) paikka = Math.max(paikka, o.r_idx + 1);
          }
          seuraava[k.jakso_id] = paikka;
        }
        k.r_idx = seuraava[k.jakso_id]++;
      }
    }

    // Yhdistä taulukot
    currentList = currentList.concat(corrections);

    // Tallenna uusi lista
    const newContent = Buffer.from(JSON.stringify(currentList, null, 2)).toString('base64');
    
    const putBody = {
      message: `Tallenna ${corrections.length} korjausta admin-näkymästä`,
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
      body: JSON.stringify({ success: true, message: `Tallennettu ${corrections.length} korjausta`, tallennetut: corrections }),
    };

  } catch (error) {
    console.error('Error saving to github:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
