import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  GoogleAuthProvider,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  sendEmailVerification,
  updateProfile,
} from 'firebase/auth';
import { auth } from '../firebase';
import { authAPI } from '../api';

// We'll map Firebase User to our app's User interface
export interface User {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const e2eAuthEnabled = import.meta.env.VITE_E2E_AUTH === 'true';
const e2eUser: User = {
  id: 'e2e-user', email: 'traveller@example.com', name: 'Test Traveller', emailVerified: true,
};

const googleRedirectFallbackCodes = new Set([
  'auth/internal-error',
  'auth/operation-not-supported-in-this-environment',
  'auth/popup-blocked',
]);

function firebaseErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string' ? error.code : undefined;
}

async function sendVerificationWithRetry(firebaseUser: Parameters<typeof sendEmailVerification>[0]) {
  try {
    await sendEmailVerification(firebaseUser);
  } catch {
    await sendEmailVerification(firebaseUser);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (e2eAuthEnabled) {
      setUser(e2eUser);
      setIsLoading(false);
      return undefined;
    }
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser?.emailVerified) {
        try {
          await authAPI.syncUser(firebaseUser.email || '', firebaseUser.displayName || '');
          setUser({
            id: firebaseUser.uid,
            email: firebaseUser.email || '',
            name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
            emailVerified: firebaseUser.emailVerified
          });
        } catch (error) {
          console.error("Error syncing auth state", error);
          setUser(null);
        }
      } else {
        setUser(null);
      }
      setIsLoading(false);
    });

    void getRedirectResult(auth).catch((error) => {
      console.error('Google redirect completion failed', error);
    });

    return () => unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    if (e2eAuthEnabled) { setUser({ ...e2eUser, email: email.trim() || e2eUser.email }); return; }
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    
    if (!userCredential.user.emailVerified) {
      try {
        await sendVerificationWithRetry(userCredential.user);
      } catch {
        throw new Error('Your email is not verified, and a new verification email could not be sent. Please try again.');
      } finally {
        await signOut(auth);
        setUser(null);
      }
      throw new Error('Your email is not verified. A new verification email has been sent.');
    }

    // Sync with backend to ensure user exists (JIT provisioning)
    await authAPI.syncUser(userCredential.user.email!, userCredential.user.displayName || '');
  };

  const loginWithGoogle = async () => {
    if (e2eAuthEnabled) { setUser(e2eUser); return; }
    const provider = new GoogleAuthProvider();
    let userCredential;
    try {
      userCredential = await signInWithPopup(auth, provider);
    } catch (error) {
      if (!googleRedirectFallbackCodes.has(firebaseErrorCode(error) ?? '')) throw error;
      await signInWithRedirect(auth, provider);
      return;
    }
    // Sync with backend
    await authAPI.syncUser(userCredential.user.email!, userCredential.user.displayName || '');
  };

  const register = async (email: string, password: string, name: string) => {
    if (e2eAuthEnabled) { setUser(null); return; }
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    try {
      await updateProfile(userCredential.user, { displayName: name.trim() });
      try {
        await sendVerificationWithRetry(userCredential.user);
      } catch {
        throw new Error('Your account was created, but the verification email could not be sent. Log in again to retry delivery.');
      }
    } finally {
      await signOut(auth);
      setUser(null);
    }
  };

  const logout = async () => {
    if (e2eAuthEnabled) { setUser(null); return; }
    await signOut(auth);
    setUser(null);
  };

  const deleteAccount = async () => {
    if (!user) return;
    if (e2eAuthEnabled) { setUser(null); return; }
    
    // Call backend to delete from Mongo + Firebase Admin
    await authAPI.deleteAccount();
    
    // Sign out locally
    await signOut(auth);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, loginWithGoogle, register, logout, deleteAccount, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
