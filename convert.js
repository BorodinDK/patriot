const inkjet = require('inkjet');
const fs = require('fs');
const path = require('path');
const encode = require('image-encode')
const Jimp = require('jimp');
const mergeImg = require('merge-img');
const { createCanvas, loadImage } = require('canvas');
const { exec } = require('child_process');


const settings = {
  cubeRotation: 180,
  interpolation: 'linear',
  format: 'jpg',
};

const types = [
  {
    size: 1024,
    name: 'low',
    quality: 75
  },
  {
    size: 2048,
    name: 'standard',
    quality: 75
  }
]

function clamp(x, min, max) {
  return Math.min(max, Math.max(x, min));
}

function mod(x, n) {
  return ((x % n) + n) % n;
}

function copyPixelNearest(read, write) {
  const {width, height, data} = read;
  const readIndex = (x, y) => 4 * (y * width + x);

  return (xFrom, yFrom, to) => {

    const nearest = readIndex(
      clamp(Math.round(xFrom), 0, width - 1),
      clamp(Math.round(yFrom), 0, height - 1)
    );

    for (let channel = 0; channel < 3; channel++) {
      write.data[to + channel] = data[nearest + channel];
    }
  };
}

function copyPixelBilinear(read, write) {
  const {width, height, data} = read;
  const readIndex = (x, y) => 4 * (y * width + x);

  return (xFrom, yFrom, to) => {
    const xl = clamp(Math.floor(xFrom), 0, width - 1);
    const xr = clamp(Math.ceil(xFrom), 0, width - 1);
    const xf = xFrom - xl;

    const yl = clamp(Math.floor(yFrom), 0, height - 1);
    const yr = clamp(Math.ceil(yFrom), 0, height - 1);
    const yf = yFrom - yl;

    const p00 = readIndex(xl, yl);
    const p10 = readIndex(xr ,yl);
    const p01 = readIndex(xl, yr);
    const p11 = readIndex(xr, yr);

    for (let channel = 0; channel < 3; channel++) {
      const p0 = data[p00 + channel] * (1 - xf) + data[p10 + channel] * xf;
      const p1 = data[p01 + channel] * (1 - xf) + data[p11 + channel] * xf;
      write.data[to + channel] = Math.ceil(p0 * (1 - yf) + p1 * yf);
    }
  };
}

// performs a discrete convolution with a provided kernel
function kernelResample(read, write, filterSize, kernel) {
  const {width, height, data} = read;
  const readIndex = (x, y) => 4 * (y * width + x);

  const twoFilterSize = 2*filterSize;
  const xMax = width - 1;
  const yMax = height - 1;
  const xKernel = new Array(4);
  const yKernel = new Array(4);

  return (xFrom, yFrom, to) => {
    const xl = Math.floor(xFrom);
    const yl = Math.floor(yFrom);
    const xStart = xl - filterSize + 1;
    const yStart = yl - filterSize + 1;

    for (let i = 0; i < twoFilterSize; i++) {
      xKernel[i] = kernel(xFrom - (xStart + i));
      yKernel[i] = kernel(yFrom - (yStart + i));
    }

    for (let channel = 0; channel < 3; channel++) {
      let q = 0;

      for (let i = 0; i < twoFilterSize; i++) {
        const y = yStart + i;
        const yClamped = clamp(y, 0, yMax);
        let p = 0;
        for (let j = 0; j < twoFilterSize; j++) {
          const x = xStart + j;
          const index = readIndex(clamp(x, 0, xMax), yClamped);
          p += data[index + channel] * xKernel[j];

        }
        q += p * yKernel[i];
      }

      write.data[to + channel] = Math.round(q);
    }
  };
}

function copyPixelBicubic(read, write) {
  const b = -0.5;
  const kernel = x => {
    x = Math.abs(x);
    const x2 = x*x;
    const x3 = x*x*x;
    return x <= 1 ?
      (b + 2)*x3 - (b + 3)*x2 + 1 :
      b*x3 - 5*b*x2 + 8*b*x - 4*b;
  };

  return kernelResample(read, write, 2, kernel);
}

function copyPixelLanczos(read, write) {
  const filterSize = 5;
  const kernel = x => {
    if (x === 0) {
      return 1;
    }
    else {
      const xp = Math.PI * x;
      return filterSize * Math.sin(xp) * Math.sin(xp / filterSize) / (xp * xp);
    }
  };

  return kernelResample(read, write, filterSize, kernel);
}

const orientations = {
  0: (out, x, y) => {
    out.x = 1;
    out.y = x;
    out.z = -y;
  },
  1: (out, x, y) => {
    out.x = -x;
    out.y = 1;
    out.z = -y;
  },
  2: (out, x, y) => {
    out.x = -1;
    out.y = -x;
    out.z = -y;
  },
  3: (out, x, y) => {
    out.x = x;
    out.y = -1;
    out.z = -y;
  },
  4: (out, x, y) => {
    out.x = -y;
    out.y = -x;
    out.z = 1;
  },
  5: (out, x, y) => {
    out.x = y;
    out.y = -x;
    out.z = -1;
  },
};

function renderFace({data: readData, face, interpolation, maxWidth = Infinity}) {

  const faceWidth = maxWidth || Math.min(maxWidth, readData.width / 4);
  const faceHeight = faceWidth;

  const cube = {};
  const orientation = orientations[face];

  const writeData = { width: faceWidth, height: faceWidth, data: []};
  // const writeData = { width: faceWidth, height: faceWidth, data: new Uint8Array(faceWidth*faceWidth*4)};

  const copyPixel =
    interpolation === 'linear' ? copyPixelBilinear(readData, writeData) :
    interpolation === 'cubic' ? copyPixelBicubic(readData, writeData) :
    interpolation === 'lanczos' ? copyPixelLanczos(readData, writeData) :
    copyPixelNearest(readData, writeData);

  for (let x = 0; x < faceWidth; x++) {
    for (let y = 0; y < faceHeight; y++) {
      const to = 4 * (y * faceWidth + x);

      // fill alpha channel
      writeData.data[to + 3] = 255;

      // get position on cube face
      // cube is centered at the origin with a side length of 2
      orientation(cube, (2 * (x + 0.5) / faceWidth - 1), (2 * (y + 0.5) / faceHeight - 1));

      // project cube face onto unit sphere by converting cartesian to spherical coordinates
      const r = Math.sqrt(cube.x*cube.x + cube.y*cube.y + cube.z*cube.z);
      const lon = mod(Math.atan2(cube.y, cube.x) + Math.PI, 2 * Math.PI);
      const lat = Math.acos(cube.z / r);

      copyPixel(readData.width * lon / Math.PI / 2 - 0.5, readData.height * lat / Math.PI - 0.5, to);
    }
  }

  return writeData;
}


const createCube = (panoName, buf) => {
  console.log('prepare image');
  inkjet.decode(buf, (err, decoded) => {
    if (err) {
      console.error(err);
      return;
    }

    const normalHeight = decoded.width / 2;
    const row = decoded.data.slice(-(decoded.width * 4));

    const newData = new Uint8Array(decoded.width * normalHeight * 4);
    newData.set(decoded.data);


    for (let i = 0; i < (normalHeight - decoded.height); i++) {
      newData.set(row, decoded.data.length + i * row.length);
    }

    const image = {
      width: decoded.width,
      height: normalHeight,
      data: newData
    };

    const width = 2048 || decoded.width / 4;

    console.log('start creating face of cube');

    Promise.all([0,1,2,3,4,5].map((name) => {
      const result = renderFace({
        data: image,
        face: name,
        // interpolation: 'linear',
        maxWidth: width,
      });

      console.log('result', result);

      return new Promise((resolve, reject) => {
        inkjet.encode(result.data, {
          width: width,
          height: width,
          quality: 100
        }, (err, encoded) => {
          if (!err) {
            resolve(encoded);
          } else {
            reject(err);
          }
        });
      });
    })).then((images) => {
      return Promise.all([
        Promise.all(images.map((image, name) => {
          console.log(image)

          return Promise.all(types.map(type => {
            return new Promise((resolve, reject) => {
              Jimp.read(image.data.buffer, (err, file) => {
                if (err) {
                  console.error(err);
                  return reject();
                }
                const fileName =`./panorams/${panoName}/${type.name}/${name}.jpg`
                console.log('start', fileName);
                file
                  .resize(type.size, type.size)
                  .quality(type.quality)
                  .write(`./panorams/${panoName}/${type.name}/${name}.jpg`, () => {
                    console.log('done', fileName);
                    return resolve();
                  });
              })
            });
          }))
        })),
        new Promise((resolve, reject) => {

          inkjet.encode(image.data, {
            width: image.width,
            height: image.height,
            quality: 70
          }, (err, encoded) => {
            if (err) {
              reject(err); return;
            }
            Jimp.read(encoded.data.buffer, (err, file) => {
              if (err) {
                reject(err); return;
              }
              file
                .resize(256, 128)
                .quality(95)
                .write(`./panorams/${panoName}/thumbnail/mini.jpg`, () => {
                  const inputPath = path.resolve(`./panorams/${panoName}/low/*.jpg`);
                  const outputPath = path.resolve(`./panorams/${panoName}/thumbnail/0.jpg`);
                  exec(`montage -mode concatenate -tile 6x -resize 128x128 -quality 20 -format jpg ${inputPath} ${outputPath}`, () => {
                    return resolve();
                  });
                });
            });
          });
        })
      ])
    }).then(() => console.log("DONE!")).catch(console.error);


  // !err && Jimp.read(encoded.data.buffer, (err, image) => {
  //   console.log('start', type.name, name);
  //   !err && image
  //     .resize(type.size, type.size)
  //     .quality(type.quality)
  //     .write(`./panorams/${panoName}/${type.name}/${name}.jpg`, console.log);
  // })

    // [
    //   {
    //     size: 1024,
    //     name: 'low',
    //     quality: 75
    //   },
    //   {
    //     size: 2048,
    //     name: 'standard',
    //     quality: 75
    //   }
    // ]

    // mergeImg(cube).then((img) => {
    //   // Save image as file
    //   img.write('out_cube.jpg', () => console.log('done'));
    // });

  });
};

module.exports = {
  createCube
}
