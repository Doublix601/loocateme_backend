import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';

ffmpeg.setFfmpegPath(ffmpegPath.path);
// Requis par fluent-ffmpeg pour .screenshots() (calcule les timestamps en %,
// donc a besoin de sonder la durée de la vidéo) : sans ça, "Cannot find ffprobe".
ffmpeg.setFfprobePath(ffprobePath.path);

// Redimensionne + recompresse une image sur place (remplace le fichier original,
// en normalisant son extension en .jpg) afin de ne pas surcharger le stockage/l'API
// avec des photos envoyées en pleine résolution. Retourne le nouveau nom de fichier.
export async function processImage(absPath, { maxWidth = 1600, maxHeight = 1600, quality = 82 } = {}) {
  const dir = path.dirname(absPath);
  const base = path.basename(absPath, path.extname(absPath));
  const outPath = path.join(dir, `${base}.jpg`);

  await sharp(absPath)
    .rotate() // applique l'orientation EXIF puis la retire (strip par défaut)
    .resize({ width: maxWidth, height: maxHeight, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toFile(outPath + '.tmp');

  fs.renameSync(outPath + '.tmp', outPath);
  if (outPath !== absPath && fs.existsSync(absPath)) fs.unlinkSync(absPath);

  return path.basename(outPath);
}

// Transcode une vidéo story en H.264/AAC mp4 raisonnablement compressé (limite la
// résolution et le bitrate) afin qu'une vidéo brute de téléphone ne surcharge pas
// le stockage/la diffusion. Retourne le nouveau nom de fichier.
export async function processVideo(absPath, { maxHeight = 1280, videoBitrate = '1500k', audioBitrate = '128k' } = {}) {
  const dir = path.dirname(absPath);
  const base = path.basename(absPath, path.extname(absPath));
  const outPath = path.join(dir, `${base}_c.mp4`);

  await new Promise((resolve, reject) => {
    ffmpeg(absPath)
      .videoFilters(`scale=-2:'min(${maxHeight},ih)'`)
      .videoCodec('libx264')
      .videoBitrate(videoBitrate)
      .audioCodec('aac')
      .audioBitrate(audioBitrate)
      .outputOptions(['-movflags +faststart', '-preset veryfast'])
      .on('end', resolve)
      .on('error', reject)
      .save(outPath);
  });

  if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
  return path.basename(outPath);
}

// Extrait une frame de la vidéo (déjà compressée) pour servir de miniature/poster,
// puis la recompresse en JPEG léger via processImage. Retourne le nom de fichier
// de la miniature.
export async function extractVideoThumbnail(absPath, { maxWidth = 480 } = {}) {
  const dir = path.dirname(absPath);
  const base = path.basename(absPath, path.extname(absPath));
  const thumbName = `${base}_thumb.jpg`;

  await new Promise((resolve, reject) => {
    ffmpeg(absPath)
      .on('end', resolve)
      .on('error', reject)
      .screenshots({
        // Pourcentage plutôt qu'un temps fixe en secondes : reste valide même
        // pour une story vidéo très courte (quelques centaines de ms).
        timestamps: ['10%'],
        filename: thumbName,
        folder: dir,
      });
  });

  return processImage(path.join(dir, thumbName), { maxWidth, maxHeight: maxWidth, quality: 75 });
}
