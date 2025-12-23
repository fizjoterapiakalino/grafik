// Firebase App (the core Firebase SDK) is always required and must be listed first
// database for testing purposes

// Testowa Baza Danych
const firebaseConfig = {
  apiKey: 'AIzaSyDNY67dtYOw5z8rDqs_7rfSixsMDDukQEw',
  authDomain: 'grafikkalinowa.firebaseapp.com',
  databaseURL: 'https://grafikkalinowa-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'grafikkalinowa',
  storageBucket: 'grafikkalinowa.firebasestorage.app',
  messagingSenderId: '531819524737',
  appId: '1:531819524737:web:bb3f279ef99419095e1380',
  measurementId: 'G-5X744M8VG5',
};
// Właściwa baza danych
//const firebaseConfig = {
//  apiKey: "AIzaSyCdPhCgZeFYv3fLrd9Xc4AVwBu70cCvlVQ",
//  authDomain: "grafikkalinowa-c1b41.firebaseapp.com",
//  projectId: "grafikkalinowa-c1b41",
//  storageBucket: "grafikkalinowa-c1b41.firebasestorage.app",
//  messagingSenderId: "59665168961",
//  appId: "1:59665168961:web:166b1816b1981b2babe4c0",
//  measurementId: "G-RXBFWH2CXN"
//};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
export const db = firebase.firestore();
export const auth = firebase.auth();

// Backward compatibility
window.db = db;
window.auth = auth;