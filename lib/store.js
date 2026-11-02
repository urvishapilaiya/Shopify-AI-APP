// Tiny JSON-file storage. NOTE: on hosts with an ephemeral disk (Render free) the file is lost on
// redeploy/restart. Set DATA_DIR to a persistent disk path (Render "Disk") to keep it.
const fs = require('fs');
const path = require('path');
const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const file = (name) => path.join(DIR, name + '.json');

function read(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch (e) { return fallback; }
}
function write(name, data) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = file(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file(name));
}
module.exports = { read, write };
