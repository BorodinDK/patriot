const { promisify } = require('util');
const express = require('express');
const app = express();
const base = require('airtable').base('app3s2vKFnIOixrfm');
const panorams = base('panorams');
const fetch = require('node-fetch');
const path = require('path');
const { createCube } = require('./cube.js');
const fs = require('fs').promises;
const { existsSync, mkdirSync } = require('fs');
const serveIndex = require('serve-index');
const rmfr = require('rmfr');
const bodyParser = require('body-parser');
const sizeOf = promisify(require('image-size'));


const PORT = 9095;

const updatePano = (id, fields) => new Promise((resolve, reject) => {
  panorams.update([{
    id, fields
  }], (err) => {
    if (!err) {
      resolve();
    } else {
      reject(err);
    }
  });
});

['temp', 'panorams'].forEach(dir => {
  if (!existsSync(dir)){
    mkdirSync(path.resolve(__dirname, dir));
  }
})


app.use(bodyParser.json());

app.get('/api/patriot/manifest.json', (req, res) => {
  const allRecords = [];
  panorams.select({
    view: "grid"
  }).eachPage((records, fetchNextPage) => {
    records.forEach((record) => {
      console.log(record);
      allRecords.push(record.fields);
    });
    fetchNextPage();
  }).finally(() => {
    console.log('records', allRecords);

    return res.send({
      panorams: allRecords
        .filter(r => r.visible)
        .map(r => ({
          id: r.id,
          title: r.title,
          heading: r.heading,
          markers: [],
          points: [
          ]
        }))
    });
  }).catch(e => {
    console.log('error', e);
  });
});

app.get('/api/patriot/pano/:id', (req, res) => {
  const { id } = req.params;
  panorams.find(id, async (err, record) => {
    try {
      if (err) {
        throw err;
      }
      const { fields: panorama } = record;
      if (!panorama.image?.length) {
        throw 'image not found';
      }
      const [ image ] = panorama.image;

      console.log("Image URL:", image.url);
      await updatePano(id, { status: 'downloading' });
      const response = await fetch(image.url);
      const buffer = await response.buffer();
      const filePath = path.resolve(__dirname, `./temp/${panorama.id}.jpg`);
      await fs.writeFile(filePath, buffer);
      const { width, height } = await sizeOf(filePath);
      await updatePano(id, {
        status: 'processing',
        resolution: [width, height].join('x')
      });
      await createCube(filePath, panorama.id);
      await rmfr(filePath);
      await updatePano(id, {
        status: 'done',
        image: [],
        preview: [{
          url: `https://tour-360.ru/projects/patriot/panorams/${panorama.id}/thumbnail/mini.jpg`
        }]
      });
      res.redirect(302, `https://tour-360.ru/projects/patriot/?id=${panorama.id}`)
    } catch (e) {
      await updatePano(id, { status: 'error' });
      console.error(e);
      res.send({ error: e });
    }
  });
});

app.get('/api/patriot/update/:id', (req, res) => {
  res.send(req.body);
})

app.use('/api/patriot/panorams', express.static('./panorams'));
app.use('/api/patriot/temp', express.static('./temp'), serveIndex('./temp'));
app.use('/api/patriot/', express.static('./static'));

app.listen(PORT, () => {
  console.log(`Listening at http://localhost:${PORT}`)
})
