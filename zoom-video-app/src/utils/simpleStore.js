const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { EventEmitter } = require('events');

const ensureDirectory = (filePath) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch (error) {
    if (error && error.code !== 'EEXIST') {
      throw error;
    }
  }
};

const readStoreFile = (filePath, defaults) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch (error) {
    return { ...defaults };
  }
};

const writeStoreFile = (filePath, contents) => {
  try {
    ensureDirectory(filePath);
    fs.writeFileSync(filePath, JSON.stringify(contents, null, 2), 'utf8');
  } catch (error) {
    console.warn('Failed to persist store contents:', error);
  }
};

class SimpleStore {
  constructor({ fileName = 'settings.json', defaults = {} } = {}) {
    const userDataPath = app.getPath('userData');
    this.filePath = path.join(userDataPath, fileName);
    this.defaults = defaults;
    this.emitter = new EventEmitter();
    this.data = readStoreFile(this.filePath, this.defaults);
  }

  get(key, defaultValue) {
    if (typeof key === 'undefined') {
      return undefined;
    }

    if (Object.prototype.hasOwnProperty.call(this.data, key)) {
      return this.data[key];
    }

    if (typeof defaultValue !== 'undefined') {
      return defaultValue;
    }

    if (Object.prototype.hasOwnProperty.call(this.defaults, key)) {
      return this.defaults[key];
    }

    return undefined;
  }

  set(key, value) {
    const previousValue = this.data[key];
    this.data[key] = value;
    writeStoreFile(this.filePath, this.data);
    this.emitter.emit('change', key, value, previousValue);
  }

  delete(key) {
    if (!Object.prototype.hasOwnProperty.call(this.data, key)) {
      return;
    }

    const previousValue = this.data[key];
    delete this.data[key];
    writeStoreFile(this.filePath, this.data);
    this.emitter.emit('change', key, undefined, previousValue);
  }

  clear() {
    this.data = { ...this.defaults };
    writeStoreFile(this.filePath, this.data);
    this.emitter.emit('clear');
  }

  onDidChange(key, callback) {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const handler = (changedKey, newValue, previousValue) => {
      if (changedKey === key) {
        callback(newValue, previousValue);
      }
    };

    this.emitter.on('change', handler);

    return () => {
      this.emitter.off('change', handler);
    };
  }
}

const createPersistentStore = (options) => {
  try {
    return new SimpleStore(options);
  } catch (error) {
    console.error('Failed to initialize persistent store:', error);
    return null;
  }
};

module.exports = {
  SimpleStore,
  createPersistentStore,
};
