const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const fs = require('fs').promises;
const { existsSync, mkdirSync } = require('fs');
const path = require('path');
const rmfr = require('rmfr');
const sizeOf = promisify(require('image-size'));

const projectPath = "/var/www/tour-360.ru/projects/patriot/"

const createCube = async (filePath, panoName, type) => {

  console.log(filePath, panoName);

  // 0. Удаляем папки
  // 1. Создаем папки
  // 2. Выводим тоды файлы через pt
  //   2.1 Выполняем PTmender script.pt pano.jpg
  //   2.2 Полученый файл pano0000.tif перемещаем в нужную папку
  //   2.3 После того как все стороны будут сделаны выполняем конвертацию в jpg
  // 3. Уменьшаем кубы в папку low
  // 4. Создаем спрайт
  // 5. Создаем превью панорамы


  try {
    const { width, height } = await sizeOf(filePath);
    if (width === height*2) {
      console.log('Skip image:', panoName);
      await fs.rename(
        filePath,
        path.resolve(__dirname, 'temp', `_${panoName}.jpg`)
      );
    } else {
      console.log('Prepare image:', panoName);
      await exec([
        'convert',
        filePath,
        '-thumbnail 6434x3217 -background black -gravity',
        type === 'aero' ? 'south' : 'north',
        '-extent 6434x3217',
        // '-set option:distort:viewport 6434x3217 -virtual-pixel edge -resize 6434x3217 -distort SRT "6434,3217 1 0 6434,3217"',
        path.resolve(__dirname, 'temp', `_${panoName}.jpg`),
      ].join(' '));
    }
    try {
      await rmfr(path.resolve(projectPath, `./panorams/${panoName}`));
    } catch (e) {
      console.log('folder is not exist', e.path);
    }
    [
      './panorams',
      `./panorams/${panoName}`,
      `./panorams/${panoName}/low`,
      `./panorams/${panoName}/standard`,
      `./panorams/${panoName}/thumbnail`
    ].forEach((dir) => {
      const newDir = path.resolve(projectPath, dir);
      if (!existsSync(newDir)) {
        mkdirSync(newDir);
        console.log('create', newDir)
      }
    });

    for (const face of [0, 1, 2, 3, 4, 5]) {
      console.log('PTmender:', face);
      const { stdout, stderr } = await exec([
        'PTmender',
        path.resolve(__dirname, `pt_scripts/${face}.pts`),
        path.resolve(__dirname, 'temp', `_${panoName}.jpg`),
      ].join(' '));
      stderr && console.error(stderr, stdout);

      console.log('rename:', face);
      await fs.rename(
        path.resolve(__dirname, './pano0000.tif'),
        path.resolve(projectPath, `./panorams/${panoName}/standard/${face}.tif`)
      );

      console.log('convert low jpg:', face);
      await exec([
        'convert',
        '-resize 1024x1024',
        '-quality 65',
        path.resolve(projectPath, `./panorams/${panoName}/standard/${face}.tif`),
        path.resolve(projectPath, `./panorams/${panoName}/low/${face}.jpg`),
      ].join(' '));

      console.log('convert standard jpg:', face);
      await exec([
        'convert',
        '-quality 76',
        path.resolve(projectPath, `./panorams/${panoName}/standard/${face}.tif`),
        path.resolve(projectPath, `./panorams/${panoName}/standard/${face}.jpg`),
      ].join(' '));

      console.log('remove tif:', face);
      await rmfr(path.resolve(projectPath, `./panorams/${panoName}/standard/${face}.tif`));
    }

    console.log('create thumbnail/mini.jpg');
    await exec([
      'convert',
      '-resize 256x128',
      path.resolve(__dirname, 'temp', `_${panoName}.jpg`),
      path.resolve(projectPath, `./panorams/${panoName}/thumbnail/mini.jpg`),
    ].join(' '));

    console.log('create thumbnail/0.jpg');
    await exec([
      `montage`,
      '-mode concatenate',
      '-tile 6x',
      // '-resize 128x',
      '-thumbnail 128x',
      '-quality 30',
      '-format jpg',
      path.resolve(projectPath, `./panorams/${panoName}/low/*.jpg`),
      path.resolve(projectPath, `./panorams/${panoName}/thumbnail/0.jpg`),
    ].join(' '));


    console.log('remove temp file');
    await rmfr(path.resolve(__dirname, 'temp', `_${panoName}.jpg`));

    console.log('Done!');
  } catch (e) {
    console.error(e);
    throw e;
  }
};



module.exports = {
  createCube
}
