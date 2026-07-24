/**
 * Production 3B.1 - Firebase Service
 * Nguồn Firebase duy nhất cho toàn bộ kiến trúc module mới.
 * Không khởi tạo Firebase lần thứ hai.
 */

import { app, auth, db } from "../firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
  where,
  orderBy,
  limit,
  Timestamp,
  writeBatch,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

function assertFirebaseReady() {
  if (!app || !auth || !db) {
    throw new Error("Firebase chưa được khởi tạo đầy đủ.");
  }
}

export const FirebaseService = Object.freeze({
  app,
  auth,
  db,

  assertReady: assertFirebaseReady,

  waitForAuthState() {
    assertFirebaseReady();

    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};

      unsubscribe = onAuthStateChanged(
        auth,
        user => {
          unsubscribe();
          resolve(user || null);
        },
        error => {
          unsubscribe();
          reject(error);
        }
      );
    });
  },

  async logout() {
    assertFirebaseReady();
    await signOut(auth);
  },

  collection,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
  where,
  orderBy,
  limit,
  Timestamp,
  writeBatch,
  runTransaction
});
