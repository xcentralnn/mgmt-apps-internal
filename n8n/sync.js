const http = require('http');
const https = require('https');
const fs = require('fs');
const { execSync, spawn } = require('child_process');

const BUCKET = process.env.N8N_BUCKET_NAME || 'mgmt-apps-n8n-data';
const BACKUP_PATH = '/tmp/n8n-backup.tar.gz';
const N8N_DIR = '/home/node/.n8n';

function getGcpToken() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'metadata.google.internal',
      path: '/computeMetadata/v1/instance/service-accounts/default/token',
      headers: { 'Metadata-Flavor': 'Google' },
      timeout: 2000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.access_token);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function restoreBackup() {
  const token = await getGcpToken();
  if (!token) {
    console.log('No metadata token, skipping restore.');
    return;
  }
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'storage.googleapis.com',
      path: `/storage/v1/b/${BUCKET}/o/n8n-backup.tar.gz?alt=media`,
      headers: { 'Authorization': `Bearer ${token}` }
    }, (res) => {
      if (res.statusCode === 200) {
        const file = fs.createWriteStream(BACKUP_PATH);
        res.pipe(file);
        file.on('finish', () => {
          try {
            if (!fs.existsSync(N8N_DIR)) {
              fs.mkdirSync(N8N_DIR, { recursive: true });
            }
            execSync(`tar -xzf ${BACKUP_PATH} -C ${N8N_DIR}`);
            console.log('Restored n8n backup from GCS successfully.');
          } catch (e) {
            console.error('Failed to extract backup:', e);
          }
          resolve();
        });
      } else {
        console.log('No previous backup found on GCS. Starting clean.');
        resolve();
      }
    });
    req.on('error', (e) => {
      console.error('Error fetching backup:', e);
      resolve();
    });
    req.end();
  });
}

async function saveBackup() {
  if (!fs.existsSync(N8N_DIR)) return;
  const token = await getGcpToken();
  if (!token) return;
  try {
    execSync(`tar -czf ${BACKUP_PATH} -C ${N8N_DIR} .`);
    const fileData = fs.readFileSync(BACKUP_PATH);
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'storage.googleapis.com',
        path: `/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=n8n-backup.tar.gz`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/gzip',
          'Content-Length': fileData.length
        }
      }, (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          console.log(`Saved n8n backup to GCS (${fileData.length} bytes, status: ${res.statusCode}).`);
          resolve();
        });
      });
      req.on('error', (e) => {
        console.error('Failed to upload backup:', e);
        resolve();
      });
      req.write(fileData);
      req.end();
    });
  } catch (e) {
    console.error('Error creating backup archive:', e);
  }
}

async function main() {
  console.log('Starting n8n with GCS local disk sync...');
  await restoreBackup();

  const n8n = spawn('n8n', { stdio: 'inherit' });

  const interval = setInterval(async () => {
    await saveBackup();
  }, 60000);

  const shutdown = async () => {
    console.log('Graceful shutdown initiated. Saving state to GCS...');
    clearInterval(interval);
    n8n.kill('SIGTERM');
    await saveBackup();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  n8n.on('exit', async (code) => {
    clearInterval(interval);
    await saveBackup();
    process.exit(code || 0);
  });
}

main();
