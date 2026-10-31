const DB_NAME = 'ardesia-local';
let database;
export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('library');
    request.onsuccess = () => { database = request.result; resolve(database); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Chiudi le altre finestre di Ardesia e riprova.'));
  });
}
export function readLibrary() {
  return new Promise((resolve, reject) => { const request = database.transaction('library').objectStore('library').get('main'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
export function saveLibrary(library) {
  return new Promise((resolve, reject) => { const tx = database.transaction('library', 'readwrite'); tx.objectStore('library').put(library, 'main'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Salvataggio annullato.')); });
}
