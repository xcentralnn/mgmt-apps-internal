const http = require('http');
const https = require('https');
const fs = require('fs');
const { execSync, spawn } = require('child_process');

const BUCKET = process.env.LISTMONK_BUCKET_NAME || process.env.BUCKET_NAME || 'mgmt-apps-n8n-data';
const DUMP_PATH = '/tmp/listmonk-db.dump';
const UPLOADS_DIR = '/listmonk/uploads';
const UPLOADS_ARCHIVE = '/tmp/listmonk-uploads.tar.gz';
const PG_DATA = '/var/lib/postgresql/data';

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

function downloadGcsFile(objectName, destinationPath) {
  return new Promise(async (resolve) => {
    const token = await getGcpToken();
    if (!token) {
      resolve(false);
      return;
    }

    const req = https.request({
      hostname: 'storage.googleapis.com',
      path: `/storage/v1/b/${BUCKET}/o/${encodeURIComponent(objectName)}?alt=media`,
      headers: { 'Authorization': `Bearer ${token}` }
    }, (res) => {
      if (res.statusCode === 200) {
        const fileStream = fs.createWriteStream(destinationPath);
        res.pipe(fileStream);
        fileStream.on('finish', () => resolve(true));
        fileStream.on('error', () => resolve(false));
      } else {
        resolve(false);
      }
    });

    req.on('error', () => resolve(false));
    req.end();
  });
}

function uploadGcsFile(objectName, filePath, contentType) {
  return new Promise(async (resolve) => {
    if (!fs.existsSync(filePath)) {
      resolve(false);
      return;
    }

    const token = await getGcpToken();
    if (!token) {
      resolve(false);
      return;
    }

    try {
      const fileData = fs.readFileSync(filePath);
      const req = https.request({
        hostname: 'storage.googleapis.com',
        path: `/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(objectName)}`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': contentType,
          'Content-Length': fileData.length
        }
      }, (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          console.log(`Uploaded ${objectName} to GCS (${fileData.length} bytes, status: ${res.statusCode})`);
          resolve(res.statusCode >= 200 && res.statusCode < 300);
        });
      });

      req.on('error', (err) => {
        console.error(`Upload error for ${objectName}:`, err.message);
        resolve(false);
      });

      req.write(fileData);
      req.end();
    } catch (err) {
      console.error(`Failed reading ${filePath}:`, err.message);
      resolve(false);
    }
  });
}

function initPostgres() {
  console.log('Initializing embedded PostgreSQL 17...');
  execSync('mkdir -p /var/lib/postgresql/data /run/postgresql');
  execSync('chown -R postgres:postgres /var/lib/postgresql /run/postgresql');
  execSync('chmod 700 /var/lib/postgresql/data');

  if (!fs.existsSync(`${PG_DATA}/PG_VERSION`)) {
    console.log('Running initdb...');
    execSync(`su - postgres -c "initdb -D ${PG_DATA}"`);
  }

  console.log('Starting PostgreSQL server...');
  execSync(`su - postgres -c "pg_ctl -D ${PG_DATA} -l /tmp/pg.log start"`);

  try {
    execSync('su - postgres -c "createuser -s listmonk 2>/dev/null || true"');
    execSync('su - postgres -c "psql -c \\"ALTER USER listmonk WITH PASSWORD \'listmonk\';\\""');
    execSync('su - postgres -c "createdb -O listmonk listmonk 2>/dev/null || true"');
  } catch (err) {
    console.error('PostgreSQL user/db preparation notice:', err.message);
  }
}

async function restoreState() {
  console.log(`Checking GCS bucket ${BUCKET} for existing backups...`);
  const restoredDb = await downloadGcsFile('listmonk-db.dump', DUMP_PATH);

  if (restoredDb) {
    console.log('Found existing database dump. Restoring into PostgreSQL...');
    try {
      execSync('su - postgres -c "dropdb --if-exists -U postgres listmonk && createdb -O listmonk listmonk"');
      execSync(`su - postgres -c "pg_restore -U listmonk -d listmonk ${DUMP_PATH}"`);
      console.log('Database restored successfully. Checking for migrations...');
      execSync('./listmonk --upgrade --yes', { env: process.env });
    } catch (err) {
      console.error('Error during database restore:', err.message);
    }
  } else {
    console.log('No existing backup found. Performing first-time Listmonk installation...');
    try {
      execSync('./listmonk --install --idempotent --yes', {
        env: {
          ...process.env,
          LISTMONK_ADMIN_USER: process.env.LISTMONK_ADMIN_USER || 'admin',
          LISTMONK_ADMIN_PASSWORD: process.env.LISTMONK_ADMIN_PASSWORD || 'adminpassword'
        }
      });
      console.log('Listmonk initial schema created.');
    } catch (err) {
      console.error('Error installing Listmonk schema:', err.message);
    }
  }

  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  const restoredUploads = await downloadGcsFile('listmonk-uploads.tar.gz', UPLOADS_ARCHIVE);
  if (restoredUploads) {
    console.log('Restoring media uploads archive...');
    try {
      execSync(`tar -xzf ${UPLOADS_ARCHIVE} -C ${UPLOADS_DIR}`);
    } catch (err) {
      console.error('Error extracting uploads:', err.message);
    }
  }
}

async function saveState() {
  try {
    execSync(`su - postgres -c "pg_dump -U listmonk -Fc -f ${DUMP_PATH} listmonk"`);
    await uploadGcsFile('listmonk-db.dump', DUMP_PATH, 'application/octet-stream');
  } catch (err) {
    console.error('Error dumping database:', err.message);
  }

  try {
    if (fs.existsSync(UPLOADS_DIR) && fs.readdirSync(UPLOADS_DIR).length > 0) {
      execSync(`tar -czf ${UPLOADS_ARCHIVE} -C ${UPLOADS_DIR} .`);
      await uploadGcsFile('listmonk-uploads.tar.gz', UPLOADS_ARCHIVE, 'application/gzip');
    }
  } catch (err) {
    console.error('Error archiving uploads:', err.message);
  }
}

async function main() {
  initPostgres();
  await restoreState();

  console.log('Starting Listmonk web application...');
  const listmonk = spawn('./listmonk', ['--config', 'config.toml'], {
    stdio: 'inherit',
    env: process.env
  });

  const interval = setInterval(async () => {
    await saveState();
  }, 60000);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Shutdown signal received. Performing final sync to GCS...');
    clearInterval(interval);
    listmonk.kill('SIGTERM');
    await saveState();

    try {
      execSync(`su - postgres -c "pg_ctl -D ${PG_DATA} stop"`);
    } catch {}

    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  listmonk.on('exit', async (code) => {
    clearInterval(interval);
    await saveState();
    try {
      execSync(`su - postgres -c "pg_ctl -D ${PG_DATA} stop"`);
    } catch {}
    process.exit(code || 0);
  });
}

main();
