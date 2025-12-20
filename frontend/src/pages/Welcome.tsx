import { Link } from 'react-router-dom';

export default function Welcome() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center max-w-2xl mx-auto">
        {/* Logo/Title */}
        <h1 
          className="text-6xl sm:text-7xl md:text-9xl font-bold text-indigo-600 mb-4 sm:mb-6 md:mb-12"
          style={{ fontFamily: 'Holiday, serif' }}
        >
          Owezy
        </h1>
        
        {/* Tagline */}
        <p className="text-xl sm:text-2xl md:text-3xl text-gray-700 mb-8 sm:mb-12 font-light">
          Keep trips fun, not finances.
        </p>
        
        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center max-w-md mx-auto">
          <Link
            to="/login"
            className="w-full sm:w-auto px-8 py-4 bg-indigo-600 text-white text-lg font-semibold rounded-lg hover:bg-indigo-700 transition-all transform hover:scale-105 shadow-lg"
          >
            Login
          </Link>
          <Link
            to="/register"
            className="w-full sm:w-auto px-8 py-4 bg-white text-indigo-600 text-lg font-semibold rounded-lg border-2 border-indigo-600 hover:bg-indigo-50 transition-all transform hover:scale-105 shadow-lg"
          >
            Register
          </Link>
        </div>
      </div>
    </div>
  );
}
