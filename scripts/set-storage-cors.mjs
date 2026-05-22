// Set CORS on the Firebase Storage bucket so the admin panel can upload
// APKs straight from the browser (the new .firebasestorage.app buckets
// ship with no browser CORS, which made uploads hang at 0%).
// Uses the firebase-key.json service account - no gcloud needed.
import { google } from 'googleapis';

const BUCKET = 'astrology-2092d.firebasestorage.app';

const CORS = [{
  origin: [
    'https://astroseer.in',
    'https://www.astroseer.in',
    'https://astro-platform.vercel.app',
    'https://*.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'capacitor://localhost',
    'https://localhost',
    'http://localhost',
  ],
  method: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
  responseHeader: [
    'Content-Type', 'Content-Length', 'Content-Range', 'Content-Encoding',
    'Authorization', 'User-Agent', 'x-goog-resumable', 'x-goog-meta-*',
    'X-Goog-Upload-Status', 'X-Goog-Upload-URL', 'Location', 'Range',
    'Access-Control-Allow-Origin',
  ],
  maxAgeSeconds: 3600,
}];

const auth = new google.auth.GoogleAuth({
  keyFile: './firebase-key.json',
  scopes: ['https://www.googleapis.com/auth/devstorage.full_control'],
});
const storage = google.storage({ version: 'v1', auth });

(async () => {
  console.log('Setting CORS on', BUCKET, '…');
  const res = await storage.buckets.patch({
    bucket: BUCKET,
    requestBody: { cors: CORS },
  });
  console.log('OK. Bucket CORS now:',
    JSON.stringify(res.data.cors, null, 2));
})().catch((e) => {
  console.error('FAILED:', e && (e.errors || e.message) || e);
  process.exit(1);
});
