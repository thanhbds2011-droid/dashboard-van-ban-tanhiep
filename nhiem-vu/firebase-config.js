/*
 * =========================================================
 * CẤU HÌNH FIREBASE
 * Hệ thống quản lý, theo dõi và đánh giá nhiệm vụ
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


/*
 * Thay các giá trị bên dưới bằng cấu hình
 * được cung cấp tại Firebase Console.
 */
const firebaseConfig = {
  apiKey: "AIzaSyCwrGqShsBWchSjTB0iHrrzstRERAjuCW4",
  authDomain: "quan-ly-nhiem-vu-tanhiep.firebaseapp.com",
  projectId: "quan-ly-nhiem-vu-tanhiep",
  storageBucket: "quan-ly-nhiem-vu-tanhiep.firebasestorage.app",
  messagingSenderId: "293564832220",
  appId: "1:293564832220:web:2c5174f047ac8246a9d719"
};


/*
 * Khởi tạo Firebase App.
 */
const app = initializeApp(firebaseConfig);


/*
 * Khởi tạo Firebase Authentication.
 */
const auth = getAuth(app);


/*
 * Khởi tạo Cloud Firestore.
 */
const db = getFirestore(app);


/*
 * Xuất các đối tượng dùng chung cho các file khác.
 */
export {
  app,
  auth,
  db
};
