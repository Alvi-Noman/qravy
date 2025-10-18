import { Link } from 'react-router-dom';
import Logo from './Logo';

export default function AuthErrorScreen() {
  return (
    <div className="min-h-screen w-full bg-[#fcfcfc] flex flex-col font-inter">
      <div className="w-full max-w-md flex flex-col items-center mx-auto mt-60">
        <Logo />
        <div className="w-full flex flex-col items-center">
          <h2 className="text-xl font-medium mb-6 text-[#2e2e30]">Session Expired</h2>
          <p className="text-base text-[#5b5b5d] mb-8 text-center max-w-xs">
            Your session has timed out for security reasons. Please log in again to continue.
          </p>
          <Link
            to="/login"
            className="text-[#2e2f30] text-sm hover:underline font-medium"
          >
            Log In Again
          </Link>
        </div>
      </div>
    </div>
  );
}