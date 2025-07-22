const firebaseConfig = {
  apiKey: "AIzaSyDNY67dtYOw5z8rDqs_7rfSixsMDDukQEw",
  authDomain: "grafikkalinowa.firebaseapp.com",
  // USUNIĘTO NIEPOPRAWNY KLUCZ databaseURL
  projectId: "grafikkalinowa",
  storageBucket: "grafikkalinowa.appspot.com", // Poprawiono również na standardowy format, bez "firebase" w środku
  messagingSenderId: "531819524737",
  appId: "1:531819524737:web:bb3f279ef99419095e1380",
  measurementId: "G-5X744M8VG5"
};

// Inicjalizacja Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
