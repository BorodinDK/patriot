const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const express = require('express');
const app = express();
const cors = require('cors');
const base = require('airtable').base('app3s2vKFnIOixrfm');
const panorams = base('panorams');
const markers = base('markers');
const points = base('points');
const markerIcon = base('markerIcon');
const objects = base('objects');
const services = base('services');
const units = base('units');
const popups = base('popups');
const dumps = base('dumps');
const characteristics = base('characteristics');
const fetch = require('node-fetch');
const path = require('path');
const { createCube } = require('./cube.js');
const fsp = require('fs').promises;
const fs = require('fs');
const { existsSync, mkdirSync } = require('fs');
const fse = require('fs-extra');
const serveIndex = require('serve-index');
const rmfr = require('rmfr');
const bodyParser = require('body-parser');
const moment = require('moment');
const CryptoJS = require('crypto-js');
const sizeOf = promisify(require('image-size'));
const archiver = require('archiver');



const projectFolder = '/var/www/tour-360.ru/projects/patriot/';

const PORT = 9095;


app.use(cors());
app.use(bodyParser.json(true));

const checkPassword = (password) => CryptoJS.SHA512('patriot').toString() === password;

app.use((req, res, next) => {
  if (!!~req.originalUrl.indexOf('/api')) {
    if (checkPassword(req.headers['token'] || req.query.token)) {
      next();
    } else {
      res.status(403).send({
        error: '403 Forbidden'
      })
    }
  } else {
    next();
  }
});

const getAllTable = (table, params) => {
  const allRecords = [];
  return table.select(params).eachPage((records, fetchNextPage) => {
    records.forEach((record) => {
      allRecords.push({
        ...record.fields,
        id: record.id,
      });
    });
    fetchNextPage();
  }).then(() => {
    return allRecords;
  })
}

const deleteRecord = (base, records) => new Promise((response, reject) => {
  base.destroy(records, (err, deletedRecords) => {
    if (err) {
      reject(err);
    } else {
      response(deletedRecords);
    }
  });
});

const createRecord = (base, records) => new Promise((response, reject) => {
  base.create(records.map(r => ({
    fields: r
  })), (err, records) => {
    if (err) {
      reject(err);
    } else {
      response(records.map(record => ({
        ...record.fields,
        id: record.id
      })));
    }
  });
});

const tableUpdate = (table, id, fields) => new Promise((resolve, reject) => {
  table.update([{
    id, fields
  }], (err) => {
    if (!err) {
      resolve();
    } else {
      reject(err);
    }
  });
});

const updatePano = (id, fields) => tableUpdate(panorams, id, fields);


['temp'].forEach(dir => {
  if (!existsSync(dir)){
    mkdirSync(path.resolve(__dirname, dir));
  }
})

// app.get('/api/patriot/manifest.json', (req, res) => {
//   getAllTable(panorams, {
//     view: "grid"
//   }).then(allRecords => {
//     return res.send({
//       panorams: allRecords
//         .filter(r => r.visible)
//         .map(r => ({
//           id: r.id,
//           title: r.title,
//           heading: r.heading,
//           markers: [],
//           points: [
//           ]
//         }))
//     });
//   }).catch(e => {
//     console.log('error', e);
//   });
// });

app.get('/api/patriot/pano/:id', (req, res) => {
  const { id } = req.params;
  panorams.find(id, async (err, record) => {
    try {
      if (err) {
        throw err;
      }
      const panorama = {
        ...record.fields,
        id: record.id
      };
      if (!panorama.image?.length) {
        throw 'image not found';
      }

      const [ image ] = panorama.image;

      console.log("Image URL:", image.url);
      await updatePano(id, { status: 'downloading' });
      const response = await fetch(image.url);
      const buffer = await response.buffer();
      const filePath = path.resolve(__dirname, `./temp/${panorama.id}.jpg`);
      await fsp.writeFile(filePath, buffer);
      const { width, height } = await sizeOf(filePath);
      await updatePano(id, {
        status: 'processing',
        resolution: [width, height].join('x')
      });
      await createCube(filePath, panorama.id, panorama.type);
      await rmfr(filePath);
      await updatePano(id, {
        status: 'done',
        image: [],
        preview: [{
          url: `https://tour-360.ru/projects/patriot/panorams/${panorama.id}/thumbnail/mini.jpg`
        }]
      });
      res.redirect(302, `https://tour-360.ru/projects/patriot/?id=${panorama.id}`)
    } catch (error) {
      await updatePano(id, { status: 'error' });
      console.error(e);
      res.status(500).send({ error });
    }
  });
});

app.put('/api/patriot/marker/:id', (req, res) => {
  tableUpdate(markers, req.params.id, {
      title: req.body.title || "",
      lat: req.body.lat,
      lon: req.body.lon,
      type: req.body.type,
      markerIconId: [req.body.markerIconId],
      [req.body.type + 'Id']: req.body.type !== 'info' ? [req.body.actionId] : undefined,
    }).then(() => {
    res.send({
      success: true,
      body: req.body,
    });
  }).catch(error => {
    res.status(500).send({ error, body: req.body });
  });
});


app.post('/api/patriot/marker', (req, res) => {
  createRecord(markers, [{
    title: req.body.title || "",
    lat: req.body.lat,
    lon: req.body.lon,
    type: req.body.type,
    panorama: [req.body.panorama],
    markerIconId: [req.body.markerIconId],
    [req.body.type + 'Id']: req.body.type !== 'info' ? [req.body.actionId] : undefined,
  }]).then(records => {
    res.send({
      success: true,
      body: req.body,
      id: records[0].id,
    });
  }).catch(error => {
    res.status(500).send({ error, body: req.body });
  });
});

app.delete('/api/patriot/marker/:id', (req, res) => {
  deleteRecord(markers, [req.params.id]).then(() => {
    res.send({
      success: true,
      body: req.body,
    });
  }).catch(error => {
    res.status(500).send({ error, body: req.body });
  });
});


app.use('/api/patriot/panorams', express.static('./panorams'));
app.use('/api/patriot/temp', express.static('./temp'), serveIndex('./temp'));
// app.use('/api/patriot/', express.static('./static'));

app.get('/api/patriot/auto', (req, res) => {
  const allRecords = [];
  panorams.select({
    view: "grid"
  }).eachPage((records, fetchNextPage) => {
    records.forEach((record) => {
      allRecords.push({
        ...record.fields,
        id: record.id,
      });
    });
    fetchNextPage();
  }).finally(async () => {
    for (const panorama of allRecords.filter(p => p.image && !p.status )) {
      try {
        if (!panorama.image?.length) {
          throw 'image not found';
        }

        const [ image ] = panorama.image;

        console.log("Image URL:", image.url);
        await updatePano(panorama.id, { status: 'downloading' });
        const response = await fetch(image.url);
        const buffer = await response.buffer();
        const filePath = path.resolve(__dirname, `./temp/${panorama.id}.jpg`);
        await fsp.writeFile(filePath, buffer);
        const { width, height } = await sizeOf(filePath);
        await updatePano(panorama.id, {
          status: 'processing',
          resolution: [width, height].join('x')
        });
        await createCube(filePath, panorama.id, panorama.type);
        await rmfr(filePath);
        await updatePano(panorama.id, {
          status: 'done',
          image: [],
          preview: [{
            url: `https://tour-360.ru/projects/patriot/panorams/${panorama.id}/thumbnail/mini.jpg`
          }]
        });
      } catch (e) {
        await updatePano(panorama.id, { status: 'error' });
        console.error(e);
      }
    }
  }).catch(e => {
    console.log('error', e);
  });
});

const createObject = () => {
  const panoramsPromise = getAllTable(panorams, {
    view: "grid"
  });

  const servicesPromise = getAllTable(services, {
    view: "grid"
  });

  const objectsPromise = getAllTable(objects, {
    view: "grid"
  });

  const unitsPromise = getAllTable(units, {
    view: "grid"
  });

  const markersPromise = getAllTable(markers, {
    view: "grid"
  });

  const pointsPromise = getAllTable(points, {
    view: "grid"
  });

  const characteristicsPromise = getAllTable(characteristics, {
    view: "grid"
  });

  const markerIconPromise = getAllTable(markerIcon, {
    view: "grid"
  });

  const popupsPromise = getAllTable(popups, {
    view: "grid"
  });

  return Promise.all([
    panoramsPromise,
    servicesPromise,
    objectsPromise,
    unitsPromise,
    markersPromise,
    pointsPromise,
    characteristicsPromise,
    markerIconPromise,
    popupsPromise
  ]).then(([
     panorams,
     services,
     objects,
     units,
     markers,
     points,
     characteristics,
     markerIcon,
     popups
   ]) => ({
      title: "Парк Патриот",
      panorams: panorams.filter(r => r.visible),
      services: services.map(s => ({
        ...s,
        image: s.images?.[0].url,
      })),
      objects,
      markers: markers.map(m => ({
        panorama: m.panorama?.[0],
        id: m.id,
        actionId: m[m.type+'Id']?.[0] || null,
        type: m.type,
        title: m.title,
        markerIconId: m.markerIconId?.[0] || null,
        lat: m.lat,
        lon: m.lon,
      })),
      points,
      markerIcon: markerIcon.map(m => ({
        id: m.id,
        name: m.name,
        icon: m.icon?.[0].url,
      })),
      units: units.map(u => ({
        ...u,
        image: u.images?.[0].url,
        characteristics: characteristics
          .filter(c => c.unit[0] === u.id)
          .map(({ key, value }) => ({ key, value }))
      })),
      popups: popups.map(m => ({
        id: m.id,
        title: m.title,
        text: m.text,
        image: m.images?.[0].url,
      })
  )}))
}


app.get('/api/patriot/dump', async (req, res) => {
  try {

    const dumpsFolder = path.resolve(projectFolder, 'dumps');
    const publicFolder = path.resolve(projectFolder, 'public');
    !existsSync(dumpsFolder) && mkdirSync(dumpsFolder);
    const dumpName = moment().format('YYYY-MM-DD_HH-mm-ss');
    const dumpFolder = path.resolve(dumpsFolder, dumpName);
    !existsSync(dumpFolder) && mkdirSync(dumpFolder);
    const dumpFilesFolder = path.resolve(dumpFolder, 'files');
    !existsSync(dumpFilesFolder) && mkdirSync(dumpFilesFolder);
    const panoramsFolder = path.resolve(projectFolder, 'panorams');

    const dumpRecord = await createRecord(dumps, [{
      name: dumpName,
      status: 'progress',
      url: `https://tour-360.ru/projects/patriot/dumps/${dumpName}`
    }]);

    createObject().then(async object => {
      try {
        await rmfr(dumpFolder);
        await fse.copy(publicFolder, dumpFolder);
        await fse.symlink(panoramsFolder, path.resolve(dumpFolder, 'panorams'));
        !existsSync(dumpFilesFolder) && mkdirSync(dumpFilesFolder);

        res.send({
          folder: dumpFolder
        });

        const prepareTable = async (objects, name) => {
          try {
            const result = [];
            for (let i = 0; i<objects.length; i++) {
              const object = objects[i];
              const fileUrl = object[name];

              if (!fileUrl) {
                result.push(object);
              } else {
                const fileExt = fileUrl.split('.').pop();
                const fileName = [
                  CryptoJS.MD5(fileUrl).toString(),
                  fileExt
                ].join('.');

                console.log('fetch: ', fileUrl);

                const response = await fetch(fileUrl);
                const buffer = await response.buffer();
                const filePath = path.resolve(dumpFilesFolder, fileName);
                await fsp.writeFile(filePath, buffer);
                result.push({
                  ...object,
                  [name]: ['files', fileName].join('/')
                })
              }
            }
            return result;
          } catch (e) {
            console.log(e);
          }
        };

        await fsp.writeFile(path.resolve(dumpFolder, 'data.json'), JSON.stringify({
          ...object,
          services: await prepareTable(object.services, 'image'),
          units: await prepareTable(object.units, 'image'),
          popups: await prepareTable(object.popups, 'image'),
          markerIcon: await prepareTable(object.markerIcon, 'icon'),
        }));

        try {
          await exec(`mogrify -resize 800x600\\> -quality 70 ${dumpFilesFolder}/*.jpg`);
        } catch (e) {
          await tableUpdate(dumps, dumpRecord[0].id, {
            status: 'error',
          });
          console.log('mogrify error:', e);
        }

        const archive = archiver('zip', {
          zlib: { level: 9 } // Sets the compression level.
        });

        const output = fs.createWriteStream(path.resolve(dumpsFolder, dumpName + '.zip'));

        output.on('close', async () => {
          console.log('done', dumpRecord[0].id);
          await tableUpdate(dumps, dumpRecord[0].id, {
            status: 'done',
          });
        });

        archive.on("progress", (progress) => {
          console.log("TOTAL", progress.entries.total, "PROCESSED", progress.entries.processed);
        });

        archive.on('error', (err) => {
          console.log('error', err);
          tableUpdate(dumps, dumpRecord[0].id, {
            status: 'error',
          });
          throw err;
        });

        archive.pipe(output);
        archive.directory(dumpFolder, false);
        // archive.directory(panoramsFolder, 'panorams');

        await archive.finalize();
      } catch (e) {
        console.log('error:', e);
      }
    })
  } catch (e) {
    console.log('error', e);
  }
});

app.get([
  '/api/patriot',
  '/projects/patriot/public/data.json'
], (req, res) => {
  createObject().then(object => {
    res.send(object);
  }).catch(console.error);
});





app.listen(PORT, () => {
  console.log(`Listening at http://localhost:${PORT}`)
})
