const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const clone = value => JSON.parse(JSON.stringify(value));

/**
 * Pequeno armazenamento JSON para execução local em processo único.
 * As escritas são enfileiradas e trocam o arquivo de forma atômica.
 */
class JsonStore {
  constructor({ templatePath, dataPath }) {
    this.templatePath = templatePath;
    this.dataPath = dataPath;
    this.data = null;
    this.writes = Promise.resolve();
  }

  async initialize() {
    await fsp.mkdir(path.dirname(this.dataPath), { recursive: true });
    try {
      await fsp.access(this.dataPath);
    } catch (_) {
      await fsp.copyFile(this.templatePath, this.dataPath);
    }
    this.data = JSON.parse(await fsp.readFile(this.dataPath, 'utf8'));
    this.data.meta = this.data.meta || { nextIds: {} };
    this.data.meta.nextIds = this.data.meta.nextIds || {};
  }

  read(callback) {
    if (!this.data) throw new Error('Armazenamento JSON não inicializado.');
    return clone(callback(this.data));
  }

  write(callback) {
    const task = this.writes.then(async () => {
      if (!this.data) throw new Error('Armazenamento JSON não inicializado.');
      const result = await callback(this.data);
      const temporaryPath = `${this.dataPath}.tmp`;
      await fsp.writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
      await fsp.rename(temporaryPath, this.dataPath);
      return clone(result);
    });
    this.writes = task.catch(() => {});
    return task;
  }

  nextId(data, collection) {
    const nextIds = data.meta.nextIds;
    const next = Number(nextIds[collection] || 1);
    nextIds[collection] = next + 1;
    return next;
  }

  async reset() {
    await this.writes;
    await fsp.copyFile(this.templatePath, this.dataPath);
    this.data = JSON.parse(await fsp.readFile(this.dataPath, 'utf8'));
    this.data.meta = this.data.meta || { nextIds: {} };
    this.data.meta.nextIds = this.data.meta.nextIds || {};
  }
}

module.exports = JsonStore;
