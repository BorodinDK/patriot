const express = require('express');
const app = express();
const base = require('airtable').base('app3s2vKFnIOixrfm');
const panorams = base('panorams');
const fetch = require('node-fetch');
const { createCube } = require('./convert.js');

const PORT = 9095;

app.use('/', express.static('./static'));
app.use('/panorams', express.static('./panorams'));



app.get('/airtable/patriot/manifest.json', (req, res) => {
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
      panorams: allRecords.map(r => ({
        id: r.id,
        title: r.id,
        heading: 0,
        markers: [],
        points: [
          // {"lon":-1.65,"distance":8.04,"level":-1,"pano":"1"}
        ]
      }))
    });
  }).catch(e => {
    console.log('error', e);
  });
});

app.get('/airtable/patriot/:id', (req, res) => {
  const { id } = req.params;
  panorams.find(id, async (err, record) => {
    if (err) { console.error(err); return; }

    const { fields: panorama } = record;
    const [ image ] = panorama.image;

    console.log(image);
    const response = await fetch(image.url);
    const buffer = await response.buffer();
    createCube(panorama.id, buffer);
  });
});


app.listen(PORT, () => {
  console.log(`Listening at http://localhost:${PORT}`)
})
