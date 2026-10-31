const DB_NAME='ardesia-ink-lab';
let database;
export function openLabDatabase(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore('sessions',{keyPath:'id'});request.onsuccess=()=>{database=request.result;resolve(database);};request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Chiudi le altre finestre di Ink Lab e riprova.'));});}
function requestResult(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export async function saveLabSession(session){const tx=database.transaction('sessions','readwrite');tx.objectStore('sessions').put(session);return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Salvataggio della sessione annullato.'));});}
export async function readLabSession(id){return requestResult(database.transaction('sessions').objectStore('sessions').get(id));}
export async function listLabSessions(){return requestResult(database.transaction('sessions').objectStore('sessions').getAll());}
export async function deleteLabSession(id){const tx=database.transaction('sessions','readwrite');tx.objectStore('sessions').delete(id);return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
