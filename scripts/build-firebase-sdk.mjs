import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = path.join(root, 'web', 'vendor');
fs.mkdirSync(outDir, { recursive: true });

const configPath = path.join(root, 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const entrySource = `
import { initializeApp, deleteApp, getApps } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updatePassword,
  deleteUser,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  collection,
  collectionGroup,
  getDoc,
  getDocFromServer,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  runTransaction,
  serverTimestamp,
  Timestamp,
  documentId
} from 'firebase/firestore';

export const FIREBASE_CONFIG = ${JSON.stringify({
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  storageBucket: firebaseConfig.storageBucket || '',
  messagingSenderId: firebaseConfig.messagingSenderId || '',
  appId: firebaseConfig.appId,
  firestoreDatabaseId: firebaseConfig.firestoreDatabaseId
})};

export {
  initializeApp,
  deleteApp,
  getApps,
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updatePassword,
  deleteUser,
  signOut,
  onAuthStateChanged,
  getFirestore,
  connectFirestoreEmulator,
  doc,
  collection,
  collectionGroup,
  getDoc,
  getDocFromServer,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  runTransaction,
  serverTimestamp,
  Timestamp,
  documentId
};
`;

const tmpEntry = path.join(outDir, '.firebase-entry.mjs');
fs.writeFileSync(tmpEntry, entrySource, 'utf8');

try {
  await esbuild.build({
    entryPoints: [tmpEntry],
    bundle: true,
    format: 'iife',
    globalName: 'IDFirebaseSDK',
    minify: true,
    sourcemap: false,
    target: ['es2020'],
    outfile: path.join(outDir, 'firebase-bundle.js')
  });
} finally {
  fs.rmSync(tmpEntry, { force: true });
}

console.log('Firebase browser SDK bundle generated at web/vendor/firebase-bundle.js');
