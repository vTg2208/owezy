import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  sendEmailVerification
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // User is signed in
        try {
          // We can try to get the name from the backend if we want to be sure,
          // but for performance, we can rely on what we have or fetch lazily.
          // For this hackathon, let's just set the user.
          
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
        // User is signed out
        setUser(null);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    
    if (!userCredential.user.emailVerified) {
      await signOut(auth);
      throw new Error('Please verify your email before logging in.');
    }

    // Sync with backend to ensure user exists (JIT provisioning)
    await authAPI.syncUser(userCredential.user.email!, userCredential.user.displayName || '');
  };

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    const userCredential = await signInWithPopup(auth, provider);
    // Sync with backend
    await authAPI.syncUser(userCredential.user.email!, userCredential.user.displayName || '');
  };

  const register = async (email: string, password: string, name: string) => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    
    // Send verification email
    await sendEmailVerification(userCredential.user);

    // Sync with backend to save the name
    await authAPI.syncUser(email, name);
    
    // Force logout so they can't access the app until verified
    await signOut(auth);
    setUser(null);
  };

  const logout = async () => {
    await signOut(auth);
    setUser(null);
    localStorage.removeItem('currentTrip'); // Clear app state
  };

  const deleteAccount = async () => {
    if (!user) return;
    
    // Call backend to delete from Mongo + Firebase Admin
    await authAPI.deleteAccount();
    
    // Sign out locally
    await signOut(auth);
    setUser(null);
    localStorage.removeItem('currentTrip');
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
