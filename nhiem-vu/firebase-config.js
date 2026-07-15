/*
 * =========================================================
 * CẤU HÌNH FIREBASE
 * Hệ thống Quản lý nhiệm vụ
 * Trung tâm Bảo trợ xã hội Tân Hiệp
 * =========================================================
 */

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";

import {
  getAuth
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";


const firebaseConfig = {
  apiKey: "AIzaSyCwrGqShsBWchSjTB0iHrrzstRERAjuCW4",
  authDomain: "quan-ly-nhiem-vu-tanhiep.firebaseapp.com",
  projectId: "quan-ly-nhiem-vu-tanhiep",
  messagingSenderId: "293564832220",
  appId: "1:293564832220:web:2c5174f047ac8246a9d719"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export {
  app,
  auth,
  db
};
