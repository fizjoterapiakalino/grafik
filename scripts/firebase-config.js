// scripts/firebase-config.js
/**
 * Konfiguracja Firebase SDK v10+ (modularny) z warstwą kompatybilności
 *
 * Ten plik zapewnia kompatybilność wsteczną z kodem używającym API v8
 * (namespace), podczas gdy wewnętrznie używa Firebase v10+ (modularnego).
 */

// Firebase v10+ modular imports z CDN
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
    getFirestore,
    collection,
    doc,
    getDoc,
    setDoc,
    onSnapshot,
    updateDoc,
    deleteDoc,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    writeBatch,
    runTransaction,
    deleteField,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import {
    getAuth,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    createUserWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// Testowa Baza Danych (dla localhost / development)
const testFirebaseConfig = {
    apiKey: 'AIzaSyDNY67dtYOw5z8rDqs_7rfSixsMDDukQEw',
    authDomain: 'grafikkalinowa.firebaseapp.com',
    databaseURL: 'https://grafikkalinowa-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'grafikkalinowa',
    storageBucket: 'grafikkalinowa.firebasestorage.app',
    messagingSenderId: '531819524737',
    appId: '1:531819524737:web:bb3f279ef99419095e1380',
    measurementId: 'G-5X744M8VG5',
};

// Produkcyjna Baza Danych (dla GitHub Pages)
const prodFirebaseConfig = {
    apiKey: 'AIzaSyCdPhCgZeFYv3fLrd9Xc4AVwBu70cCvlVQ',
    authDomain: 'grafikkalinowa-c1b41.firebaseapp.com',
    projectId: 'grafikkalinowa-c1b41',
    storageBucket: 'grafikkalinowa-c1b41.firebasestorage.app',
    messagingSenderId: '59665168961',
    appId: '1:59665168961:web:166b1816b1981b2babe4c0',
    measurementId: 'G-RXBFWH2CXN',
};

// Automatyczne wykrywanie środowiska
const isLocalDevelopment = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === '');

const firebaseConfig = isLocalDevelopment ? testFirebaseConfig : prodFirebaseConfig;

// Inicjalizacja Firebase
const app = initializeApp(firebaseConfig);
const firestoreDb = getFirestore(app);
const firebaseAuth = getAuth(app);

/**
 * Tworzy wrapper dla dokumentu z API kompatybilnym z v8
 * @param {string} collectionName - Nazwa kolekcji
 * @param {string} docId - ID dokumentu
 * @returns {Object} - Wrapper z metodami get, set, update, delete, onSnapshot
 */
const createDocWrapper = (collectionName, docId) => {
    const docRef = doc(firestoreDb, collectionName, docId);

    return {
        get: async () => {
            const snapshot = await getDoc(docRef);
            return {
                exists: snapshot.exists(),
                data: () => snapshot.data(),
                id: snapshot.id,
            };
        },
        set: (data, options = {}) => setDoc(docRef, data, options),
        update: (data) => updateDoc(docRef, data),
        delete: () => deleteDoc(docRef),
        onSnapshot: (callback, errorCallback) => {
            return onSnapshot(
                docRef,
                (snapshot) => {
                    callback({
                        exists: snapshot.exists(),
                        data: () => snapshot.data(),
                        id: snapshot.id,
                    });
                },
                errorCallback,
            );
        },
        // Dostęp do natywnego docRef dla transakcji/batch
        _ref: docRef,
    };
};

/**
 * Tworzy wrapper dla kolekcji z API kompatybilnym z v8
 * @param {string} collectionName - Nazwa kolekcji
 * @returns {Object} - Wrapper z metodami doc, get, where
 */
const createCollectionWrapper = (collectionName) => {
    const collectionRef = collection(firestoreDb, collectionName);

    return {
        doc: (docId) => createDocWrapper(collectionName, docId),
        get: async () => {
            const snapshot = await getDocs(collectionRef);
            return {
                docs: snapshot.docs.map((d) => ({
                    id: d.id,
                    data: () => d.data(),
                    exists: d.exists(),
                })),
                empty: snapshot.empty,
                size: snapshot.size,
            };
        },
        where: (field, op, value) => ({
            get: async () => {
                const q = query(collectionRef, where(field, op, value));
                const snapshot = await getDocs(q);
                return {
                    docs: snapshot.docs.map((d) => ({
                        id: d.id,
                        data: () => d.data(),
                        exists: d.exists(),
                    })),
                    empty: snapshot.empty,
                    size: snapshot.size,
                };
            },
        }),
    };
};

/**
 * Tworzy wrapper dla WriteBatch z API kompatybilnym z v8
 */
const createBatchWrapper = () => {
    const batch = writeBatch(firestoreDb);

    return {
        set: (docWrapper, data, options) => {
            const docRef = docWrapper._ref || doc(firestoreDb, docWrapper._collectionName, docWrapper._docId);
            batch.set(docRef, data, options || {});
            return this;
        },
        update: (docWrapper, data) => {
            const docRef = docWrapper._ref || doc(firestoreDb, docWrapper._collectionName, docWrapper._docId);
            batch.update(docRef, data);
            return this;
        },
        delete: (docWrapper) => {
            const docRef = docWrapper._ref || doc(firestoreDb, docWrapper._collectionName, docWrapper._docId);
            batch.delete(docRef);
            return this;
        },
        commit: () => batch.commit(),
    };
};

/**
 * Wrapper db z API kompatybilnym z Firebase v8
 * Pozwala na używanie składni: db.collection('name').doc('id').get()
 */
export const db = {
    collection: (collectionName) => createCollectionWrapper(collectionName),

    /**
     * Tworzy nowy batch do grupowych operacji
     * @returns {Object} - Wrapper batch z metodami set, update, delete, commit
     */
    batch: () => createBatchWrapper(),

    /**
     * Wykonuje transakcję
     * @param {Function} updateFunction - Funkcja transakcji
     * @returns {Promise}
     */
    runTransaction: (updateFunction) => {
        return runTransaction(firestoreDb, async (transaction) => {
            // Tworzymy wrapper dla transakcji z API v8
            const transactionWrapper = {
                get: async (docWrapper) => {
                    const docRef = docWrapper._ref;
                    const snapshot = await transaction.get(docRef);
                    return {
                        exists: snapshot.exists(),
                        data: () => snapshot.data(),
                        id: snapshot.id,
                    };
                },
                set: (docWrapper, data, options) => {
                    const docRef = docWrapper._ref;
                    transaction.set(docRef, data, options || {});
                },
                update: (docWrapper, data) => {
                    const docRef = docWrapper._ref;
                    transaction.update(docRef, data);
                },
                delete: (docWrapper) => {
                    const docRef = docWrapper._ref;
                    transaction.delete(docRef);
                },
            };
            return updateFunction(transactionWrapper);
        });
    },

    // Bezpośredni dostęp do natywnego Firestore dla nowego kodu
    _native: firestoreDb,
};

/**
 * Wrapper auth z API kompatybilnym z Firebase v8
 */
export const auth = {
    signInWithEmailAndPassword: (email, password) => signInWithEmailAndPassword(firebaseAuth, email, password),
    signOut: () => signOut(firebaseAuth),
    onAuthStateChanged: (callback) => onAuthStateChanged(firebaseAuth, callback),
    get currentUser() {
        return firebaseAuth.currentUser;
    },
    // Bezpośredni dostęp do natywnego Auth dla nowego kodu
    _native: firebaseAuth,
};

/**
 * FieldValue kompatybilny z v8
 * Używany do specjalnych operacji jak usuwanie pól
 */
export const FieldValue = {
    delete: () => deleteField(),
    // Dodaj inne metody w razie potrzeby (arrayUnion, arrayRemove, increment, serverTimestamp)
};

// Eksporty funkcji modularnych (dla nowego kodu)
export {
    collection,
    doc,
    getDoc,
    setDoc,
    onSnapshot,
    updateDoc,
    deleteDoc,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    writeBatch,
    runTransaction,
    deleteField,
};

export { signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword };

// Backward compatibility dla window.db, window.auth i firebase.firestore.FieldValue
if (typeof window !== 'undefined') {
    window.db = db;
    window.auth = auth;
    // Emulacja starego API firebase.firestore.FieldValue i firebase.auth()
    window.firebase = {
        firestore: {
            FieldValue: FieldValue,
        },
        auth: () => auth,
    };
}

const environmentType = isLocalDevelopment ? 'TESTOWA (localhost)' : 'PRODUKCYJNA (GitHub Pages)';
console.log(`Firebase v10.7.1 (modular) initialized with v8 compatibility layer`);
console.log(`🔥 Aktywna baza danych: ${environmentType} (${firebaseConfig.projectId})`);
