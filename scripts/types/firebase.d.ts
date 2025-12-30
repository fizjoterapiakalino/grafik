// scripts/types/firebase.d.ts
/**
 * Typy dla Firebase compatibility layer
 * Ten plik definiuje typy dla wrapperów Firebase v8-compatible
 */

/**
 * Snapshot dokumentu Firestore
 */
export interface FirestoreDocumentSnapshot<T = unknown> {
    exists: boolean;
    data(): T | undefined;
    id: string;
}

/**
 * Snapshot kolekcji Firestore
 */
export interface FirestoreCollectionSnapshot<T = unknown> {
    docs: FirestoreDocumentSnapshot<T>[];
    empty: boolean;
    size: number;
}

/**
 * Opcje dla setDoc
 */
export interface SetOptions {
    merge?: boolean;
}

/**
 * Wrapper dokumentu Firestore (v8-compatible API)
 */
export interface FirestoreDocumentWrapper<T = unknown> {
    get(): Promise<FirestoreDocumentSnapshot<T>>;
    set(data: T, options?: SetOptions): Promise<void>;
    update(data: Partial<T> | Record<string, unknown>): Promise<void>;
    delete(): Promise<void>;
    onSnapshot(
        callback: (snapshot: FirestoreDocumentSnapshot<T>) => void,
        errorCallback?: (error: Error) => void
    ): () => void;
    _ref: unknown;
}

/**
 * Wrapper zapytania Firestore
 */
export interface FirestoreQueryWrapper<T = unknown> {
    get(): Promise<FirestoreCollectionSnapshot<T>>;
}

/**
 * Wrapper kolekcji Firestore (v8-compatible API)
 */
export interface FirestoreCollectionWrapper<T = unknown> {
    doc(docId: string): FirestoreDocumentWrapper<T>;
    get(): Promise<FirestoreCollectionSnapshot<T>>;
    where(field: string, op: string, value: unknown): FirestoreQueryWrapper<T>;
}

/**
 * Wrapper Batch Firestore
 */
export interface FirestoreBatchWrapper {
    set<T>(docWrapper: FirestoreDocumentWrapper<T>, data: T, options?: SetOptions): this;
    update<T>(docWrapper: FirestoreDocumentWrapper<T>, data: Partial<T>): this;
    delete<T>(docWrapper: FirestoreDocumentWrapper<T>): this;
    commit(): Promise<void>;
}

/**
 * Wrapper transakcji Firestore
 */
export interface FirestoreTransactionWrapper {
    get<T>(docWrapper: FirestoreDocumentWrapper<T>): Promise<FirestoreDocumentSnapshot<T>>;
    set<T>(docWrapper: FirestoreDocumentWrapper<T>, data: T, options?: SetOptions): void;
    update<T>(docWrapper: FirestoreDocumentWrapper<T>, data: Partial<T>): void;
    delete<T>(docWrapper: FirestoreDocumentWrapper<T>): void;
}

/**
 * Główny wrapper db (v8-compatible API)
 */
export interface FirestoreDbWrapper {
    collection<T = unknown>(collectionName: string): FirestoreCollectionWrapper<T>;
    batch(): FirestoreBatchWrapper;
    runTransaction<T>(
        updateFunction: (transaction: FirestoreTransactionWrapper) => Promise<T>
    ): Promise<T>;
    _native: unknown;
}

/**
 * Użytkownik Firebase Auth
 */
export interface FirebaseUser {
    uid: string;
    email: string | null;
    displayName: string | null;
}

/**
 * Wynik logowania
 */
export interface UserCredential {
    user: FirebaseUser;
}

/**
 * Wrapper auth (v8-compatible API)
 */
export interface FirebaseAuthWrapper {
    signInWithEmailAndPassword(email: string, password: string): Promise<UserCredential>;
    signOut(): Promise<void>;
    onAuthStateChanged(callback: (user: FirebaseUser | null) => void): () => void;
    readonly currentUser: FirebaseUser | null;
    _native: unknown;
}

/**
 * FieldValue helper
 */
export interface FieldValueHelper {
    delete(): unknown;
}

// Deklaracje modułu
declare module './firebase-config.js' {
    export const db: FirestoreDbWrapper;
    export const auth: FirebaseAuthWrapper;
    export const FieldValue: FieldValueHelper;
}
